import { createHash, randomUUID } from 'crypto';
import type { Message } from '../types.js';
import { insertMessage, getChainMessages, getLastMessage } from '../db/database.js';

export function computeHash(content: string, prevHash: string | null): string {
  const input = (prevHash ?? '') + content;
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

export function createAndSaveMessage(opts: {
  chainId: string;
  blockNum: number;
  userId: string | null;
  isAi: boolean;
  content: string;
  timezone: string;
  utcOffset: number;
  contextTag?: string | null;
}): Message {
  const prev = getLastMessage(opts.chainId);
  const prevHash = prev?.hash ?? null;
  const hash = computeHash(opts.content, prevHash);

  const msg: Message = {
    id: randomUUID(),
    chain_id: opts.chainId,
    block_num: opts.blockNum,
    user_id: opts.userId,
    is_ai: opts.isAi,
    content: opts.content,
    content_translated: null,
    media_type: 'text',
    media_url: null,
    timezone: opts.timezone,
    utc_offset: opts.utcOffset,
    context_tag: opts.contextTag ?? null,
    hash,
    prev_hash: prevHash,
    created_at: new Date().toISOString(),
  };

  insertMessage(msg);
  return msg;
}

export function getMessages(chainId: string): Message[] {
  return getChainMessages(chainId);
}

export function verifyChain(chainId: string): boolean {
  const msgs = getChainMessages(chainId);
  for (let i = 0; i < msgs.length; i++) {
    const expected = computeHash(msgs[i].content, i === 0 ? null : msgs[i - 1].hash);
    if (msgs[i].hash !== expected) return false;
  }
  return true;
}
