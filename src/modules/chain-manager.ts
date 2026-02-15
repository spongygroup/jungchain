import { config, getCity } from '../config.js';
import type { Chain, ChainAction, Message } from '../types.js';
import { insertChain, getChain, getActiveChains, updateChain } from '../db/database.js';
import { getChainMessages } from '../db/database.js';
import { createAndSaveMessage } from './message-store.js';
import { pickParticipant } from './user-manager.js';
import { AIJungzigi } from './ai-jungzigi.js';

const ai = new AIJungzigi();

export function createDailyChains(date: string): Chain[] {
  const chains: Chain[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const id = `${date}-${String(hour).padStart(2, '0')}h`;
    insertChain({ id, date, hour });
    const chain = getChain(id)!;
    chains.push(chain);
  }
  return chains;
}

export function getAllActiveChains(): Chain[] {
  return getActiveChains();
}

export async function processChainTick(chain: Chain): Promise<{
  action: ChainAction;
  message: Message | null;
}> {
  const currentOffset = chain.current_tz;
  const blockNum = chain.blocks_count;
  const previousMessages = getChainMessages(chain.id);
  const city = getCity(currentOffset);
  const tzName = `UTC${currentOffset >= 0 ? '+' : ''}${currentOffset}`;

  // Try to find a human participant
  const participant = pickParticipant(currentOffset);
  let content: string;
  let isAi = false;
  let userId: string | null = null;

  if (participant) {
    // All users generate via AI with local language
    content = await ai.generateUserMessage(previousMessages, currentOffset);
    userId = participant.id;
  } else {
    // No user → AI 정지기 fills the gap
    const shouldContinue = await ai.shouldContinueChain(previousMessages, blockNum);
    if (!shouldContinue) {
      updateChain(chain.id, { status: 'broken' });
      return { action: 'broken', message: null };
    }
    content = await ai.generateMessage(previousMessages, currentOffset);
    isAi = true;
  }

  // Save message
  const msg = createAndSaveMessage({
    chainId: chain.id,
    blockNum,
    userId,
    isAi,
    content,
    timezone: tzName,
    utcOffset: currentOffset,
    contextTag: JSON.stringify({ city, hour: chain.hour }),
  });

  // Advance chain
  const newBlockCount = blockNum + 1;

  if (newBlockCount >= config.chainSize) {
    // Chain completed!
    updateChain(chain.id, {
      status: 'completed',
      blocks_count: newBlockCount,
      completed_at: new Date().toISOString(),
    });
    return { action: 'completed', message: msg };
  }

  // Move to next timezone (offset decreases by 1)
  const nextOffset = currentOffset - 1;
  updateChain(chain.id, {
    current_tz: nextOffset,
    blocks_count: newBlockCount,
  });

  return { action: 'delivered', message: msg };
}

function generateVirtualMessage(city: string, _hour: number): string {
  const messages = [
    `${city}에서 인사해요. 이 체인이 계속 이어지길.`,
    `It's quiet here in ${city}. Passing this along.`,
    `From ${city} with warmth. Keep going, chain.`,
    `${city}의 밤하늘 아래서. 다음 사람에게 전해줘.`,
    `Here in ${city}, thinking of everyone on this chain.`,
    `Greetings from ${city}. The world feels smaller tonight.`,
    `${city}에서 보내는 한 줄. 연결되어 있다는 게 좋다.`,
    `A moment of calm from ${city}. Take it with you.`,
  ];
  return messages[Math.floor(Math.random() * messages.length)]!;
}
