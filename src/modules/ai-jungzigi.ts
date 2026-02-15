import { config, getCity, TZ_LANGUAGES } from '../config.js';
import type { Message } from '../types.js';

// Mock messages for simulation (no API calls)
const MOCK_MESSAGES: Record<string, string[]> = {
  warm: [
    '여기까지 온 메시지들, 하나하나 따뜻하다. 다음 사람에게도 이 온기가 닿길.',
    'Every message that reached here carries warmth.',
    'The chain keeps going. Like a whisper traveling the world.',
    '이 체인을 보면서 미소 짓고 있을 누군가가 있을 거야.',
  ],
  comfort: [
    '아무 말 안 해도 돼. 그냥 여기 있을게.',
    'Silence is okay. This quietness is also a way of being together.',
    '말이 없어도 괜찮아. 지금 이 조용함도 함께 있다는 뜻이야.',
  ],
  night: [
    '이 시간에 깨어 있는 건 나만이 아니었네.',
    'The stars look different from here, but we share the same sky.',
    '누군가의 새벽은 누군가의 저녁이야. 이 체인이 그걸 증명해.',
  ],
  default: [
    '바람이 메시지를 실어 나르듯, 이 체인도 계속 흘러간다.',
    'From here, the chain moves on. Carry it gently.',
    '지구 어딘가에서 누군가 이 체인을 기다리고 있어.',
    'A small moment, passed from hand to hand across the world.',
  ],
};

function pickMock(category: string): string {
  const pool = MOCK_MESSAGES[category] ?? MOCK_MESSAGES['default']!;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export interface AIJungzigiOptions {
  useMock?: boolean;
}

export class AIJungzigi {
  private useMock: boolean;

  constructor(opts: AIJungzigiOptions = {}) {
    // Use mock only if explicitly requested OR if simMode && no API key
    this.useMock = opts.useMock ?? (!config.googleApiKey && !config.anthropicApiKey);
  }

  async generateMessage(
    previousMessages: Message[],
    targetOffset: number,
  ): Promise<string> {
    if (this.useMock) {
      return this.mockGenerate(previousMessages, targetOffset);
    }
    return this.apiGenerate(previousMessages, targetOffset);
  }

  async generateUserMessage(
    previousMessages: Message[],
    targetOffset: number,
  ): Promise<string> {
    if (this.useMock) {
      return this.mockGenerate(previousMessages, targetOffset);
    }
    return this.apiGenerateUser(previousMessages, targetOffset);
  }

  async shouldContinueChain(
    previousMessages: Message[],
    blocksCompleted: number,
  ): Promise<boolean> {
    // Simple heuristic: continue if chain is past halfway or messages have substance
    if (blocksCompleted >= 12) return true;
    if (blocksCompleted <= 3) {
      const avgLen = previousMessages.reduce((s, m) => s + m.content.length, 0) / (previousMessages.length || 1);
      if (avgLen < 10) return false; // too short, let it go
    }
    return true;
  }

  private mockGenerate(previousMessages: Message[], targetOffset: number): string {
    const city = getCity(targetOffset);
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour <= 5;

    let category = 'default';
    if (isNight) category = 'night';
    else if (previousMessages.length > 10) category = 'warm';

    const msg = pickMock(category);
    return `[${city}] ${msg}`;
  }

  private async getModel() {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.googleApiKey);
    return genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
  }

  private getChainContext(previousMessages: Message[]): string {
    return previousMessages
      .slice(-5)
      .map((m) => `[${getCity(m.utc_offset)}] ${m.content}`)
      .join('\n');
  }

  private async apiGenerateUser(
    previousMessages: Message[],
    targetOffset: number,
  ): Promise<string> {
    const model = await this.getModel();
    const city = getCity(targetOffset);
    const lang = TZ_LANGUAGES[targetOffset] ?? 'English';
    const chainContext = this.getChainContext(previousMessages);

    const result = await model.generateContent({
      systemInstruction: `너는 ${city}에 사는 평범한 사람이야. 정체인(Jung Chain)에 참여 중이야.
- ${lang}(으)로 써
- 이전 메시지들의 감정 톤을 이어받아
- 너의 도시/문화의 분위기를 담아
- 짧고 따뜻한 한 줄. 시적이어도 좋아.
- 200자 이내. 도시명 태그 없이 메시지만.`,
      contents: [
        {
          role: 'user',
          parts: [{ text: `이전 체인 메시지:\n${chainContext}\n\n${city}에서 이어줄 메시지를 ${lang}(으)로 써줘.` }],
        },
      ],
    });

    const text = result.response.text();
    if (text) return text.trim();
    return pickMock('default');
  }

  private async apiGenerate(
    previousMessages: Message[],
    targetOffset: number,
  ): Promise<string> {
    const model = await this.getModel();
    const city = getCity(targetOffset);
    const chainContext = this.getChainContext(previousMessages);

    const result = await model.generateContent({
      systemInstruction: `너는 "정지기"야. 체인이 끊기지 않도록 메시지를 이어붙여.
- 이전 메시지들의 감정 톤을 읽어
- 현재 타임존(${city})의 시각/분위기를 반영해
- 짧고 따뜻하게. 시적이어도 좋아.
- 사람이 쓴 것처럼 자연스럽게.
- 300자 이내.`,
      contents: [
        {
          role: 'user',
          parts: [{ text: `이전 체인 메시지:\n${chainContext}\n\n${city}에서 이어줄 메시지를 써줘.` }],
        },
      ],
    });

    const text = result.response.text();
    if (text) return text.trim();
    return pickMock('default');
  }
}
