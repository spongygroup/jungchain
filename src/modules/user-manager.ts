import { randomUUID } from 'crypto';
import type { User } from '../types.js';
import { insertUser, getUsersByOffset, getUserByTelegramId } from '../db/database.js';

export function registerUser(telegramId: number, timezone: string, utcOffset: number, isVirtual = false): User {
  const id = randomUUID();
  const user: User = {
    id,
    telegram_id: telegramId,
    timezone,
    utc_offset: utcOffset,
    is_virtual: isVirtual,
    created_at: new Date().toISOString(),
    stats_chains: 0,
    stats_completions: 0,
    stats_score: 0,
  };
  insertUser(user);
  return user;
}

export function getUsersForOffset(offset: number): User[] {
  return getUsersByOffset(offset);
}

export function pickParticipant(offset: number): User | null {
  const users = getUsersByOffset(offset);
  if (users.length === 0) return null;
  return users[Math.floor(Math.random() * users.length)];
}

export function findByTelegramId(telegramId: number): User | undefined {
  return getUserByTelegramId(telegramId);
}
