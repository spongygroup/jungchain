import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { User, Chain, Message } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

// ---- User queries ----

export function insertUser(user: Omit<User, 'created_at' | 'stats_chains' | 'stats_completions' | 'stats_score'>): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO users (id, telegram_id, timezone, utc_offset, is_virtual)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, user.telegram_id, user.timezone, user.utc_offset, user.is_virtual ? 1 : 0);
}

export function getUsersByOffset(offset: number): User[] {
  return getDb().prepare(`SELECT * FROM users WHERE utc_offset = ?`).all(offset) as User[];
}

export function getUserByTelegramId(telegramId: number): User | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId) as User | undefined;
}

// ---- Chain queries ----

export function insertChain(chain: Pick<Chain, 'id' | 'date' | 'hour'>): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO chains (id, date, hour) VALUES (?, ?, ?)
  `).run(chain.id, chain.date, chain.hour);
}

export function getChain(id: string): Chain | undefined {
  return getDb().prepare(`SELECT * FROM chains WHERE id = ?`).get(id) as Chain | undefined;
}

export function getActiveChains(): Chain[] {
  return getDb().prepare(`SELECT * FROM chains WHERE status = 'active'`).all() as Chain[];
}

export function updateChain(id: string, updates: Partial<Chain>): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    values.push(val);
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE chains SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ---- Message queries ----

export function insertMessage(msg: Message): void {
  getDb().prepare(`
    INSERT INTO messages (id, chain_id, block_num, user_id, is_ai, content, content_translated, media_type, media_url, timezone, utc_offset, context_tag, hash, prev_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id, msg.chain_id, msg.block_num, msg.user_id, msg.is_ai ? 1 : 0,
    msg.content, msg.content_translated, msg.media_type, msg.media_url,
    msg.timezone, msg.utc_offset, msg.context_tag, msg.hash, msg.prev_hash
  );
}

export function getChainMessages(chainId: string): Message[] {
  return getDb().prepare(`SELECT * FROM messages WHERE chain_id = ? ORDER BY block_num`).all(chainId) as Message[];
}

export function getLastMessage(chainId: string): Message | undefined {
  return getDb().prepare(`SELECT * FROM messages WHERE chain_id = ? ORDER BY block_num DESC LIMIT 1`).get(chainId) as Message | undefined;
}
