import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db: InstanceType<typeof Database> = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Init schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

export default db;

// ─── Translation Cache ───

export function getTranslation(lang: string, key: string): string | null {
  const row = db.prepare('SELECT value FROM translations WHERE lang = ? AND key = ?').get(lang, key) as any;
  return row?.value ?? null;
}

export function setTranslation(lang: string, key: string, value: string) {
  db.prepare(`
    INSERT OR REPLACE INTO translations (lang, key, value) VALUES (?, ?, ?)
  `).run(lang, key, value);
}

// ─── Users ───

export function upsertUser(
  telegramId: number, username: string | undefined, firstName: string | undefined,
  tzOffset: number, notifyHour: number, lang?: string, city?: string,
) {
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, tz_offset, notify_hour, lang, city)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username, first_name = excluded.first_name,
      tz_offset = excluded.tz_offset, notify_hour = excluded.notify_hour, lang = excluded.lang, city = excluded.city
  `).run(telegramId, username ?? null, firstName ?? null, tzOffset, notifyHour, lang ?? 'en', city ?? null);
}

export function setUserWallet(telegramId: number, walletAddress: string) {
  db.prepare('UPDATE users SET wallet_address = ? WHERE telegram_id = ?').run(walletAddress, telegramId);
}

export function getUser(telegramId: number) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any;
}

export function getUsersByNotifyHour(utcHour: number): any[] {
  return db.prepare(`
    SELECT * FROM users WHERE ((? + tz_offset + 24) % 24) = notify_hour
  `).all(utcHour) as any[];
}

// ─── Chains ───

export function createChain(
  creatorId: number, creatorTz: number, startUtc: string,
  mode: string = 'text', chainHour: number, mission?: string,
): number {
  const result = db.prepare(`
    INSERT INTO chains (creator_id, creator_tz, start_utc, mode, chain_hour, mission)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(creatorId, creatorTz, startUtc, mode, chainHour, mission ?? null);
  return Number(result.lastInsertRowid);
}

export function getChain(chainId: string | number) {
  return db.prepare('SELECT * FROM chains WHERE id = ?').get(chainId) as any;
}

export function getActiveChains(): any[] {
  return db.prepare('SELECT * FROM chains WHERE status = ?').all('active') as any[];
}

export function completeChain(chainId: number) {
  const chain = db.prepare('SELECT * FROM chains WHERE id = ?').get(chainId) as any;
  if (!chain) return;
  // deliver_at = start_utc + 24h (result arrives at same hour next day)
  const startTime = new Date(chain.start_utc);
  const deliverAt = new Date(startTime.getTime() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE chains SET status = 'completed', completed_at = datetime('now'),
    deliver_at = ?, block_count = (SELECT COUNT(*) FROM blocks WHERE chain_id = ?) WHERE id = ?`)
    .run(deliverAt, chainId, chainId);
}

// Get completed chains ready for result delivery
export function getChainsToDeliver(nowUtc: string): any[] {
  return db.prepare(`
    SELECT * FROM chains WHERE status = 'completed' AND deliver_at <= ?
  `).all(nowUtc) as any[];
}

export function markDelivered(chainId: number) {
  db.prepare("UPDATE chains SET status = 'delivered' WHERE id = ?").run(chainId);
}

// ─── Blocks ───

export function addBlock(
  chainId: number, slotIndex: number, userId: number, tzOffset: number,
  content: string, mediaUrl?: string, mediaType: string = 'text',
) {
  db.prepare(`
    INSERT INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_url, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(chainId, slotIndex, userId, tzOffset, content, mediaUrl ?? null, mediaType);
  db.prepare('UPDATE chains SET block_count = block_count + 1 WHERE id = ?').run(chainId);
}

export function getLastBlock(chainId: number) {
  return db.prepare('SELECT * FROM blocks WHERE chain_id = ? ORDER BY slot_index DESC LIMIT 1').get(chainId) as any;
}

export function getBlockCount(chainId: number): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM blocks WHERE chain_id = ?').get(chainId) as any;
  return row?.cnt ?? 0;
}

export function getAllBlocks(chainId: number): any[] {
  return db.prepare('SELECT * FROM blocks WHERE chain_id = ? ORDER BY slot_index ASC').all(chainId) as any[];
}

// ─── Assignments ───

export function createAssignment(userId: number, chainId: number, slotIndex: number, expiresAt: string): number {
  const result = db.prepare(`
    INSERT INTO assignments (user_id, chain_id, slot_index, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, chainId, slotIndex, expiresAt);
  return Number(result.lastInsertRowid);
}

export function getPendingAssignment(userId: number) {
  return db.prepare(`
    SELECT a.*, c.mode, c.mission FROM assignments a
    JOIN chains c ON a.chain_id = c.id
    WHERE a.user_id = ? AND a.status IN ('pending', 'writing')
    ORDER BY a.assigned_at DESC LIMIT 1
  `).get(userId) as any;
}

export function updateAssignment(id: number, status: string, messageId?: number, chatId?: number) {
  if (messageId !== undefined && chatId !== undefined) {
    db.prepare('UPDATE assignments SET status = ?, message_id = ?, chat_id = ? WHERE id = ?')
      .run(status, messageId, chatId, id);
  } else {
    db.prepare('UPDATE assignments SET status = ? WHERE id = ?').run(status, id);
  }
}

export function getExpiredAssignments(nowUtc: string): any[] {
  return db.prepare(`
    SELECT * FROM assignments WHERE status IN ('pending', 'writing') AND expires_at <= ?
  `).all(nowUtc) as any[];
}

// Find next chain for user: must be active, user hasn't participated, AND
// the chain's current TZ position matches user's TZ.
// Chain TZ progression: creator_tz → creator_tz-1 → ... (wrapping around)
// Current position = creator_tz - block_count (the next slot's TZ)
export function findNextChainForUser(userId: number, tzOffset: number): any | null {
  const chains = findAllChainsForUser(userId, tzOffset);
  return chains.length > 0 ? chains[0] : null;
}

export function findAllChainsForUser(userId: number, tzOffset: number): any[] {
  // Get active chains where user hasn't participated
  const chains = db.prepare(`
    SELECT c.* FROM chains c
    WHERE c.status = 'active'
      AND c.id NOT IN (SELECT chain_id FROM blocks WHERE user_id = ?)
      AND c.id NOT IN (SELECT chain_id FROM assignments WHERE user_id = ? AND status IN ('pending', 'writing'))
    ORDER BY c.created_at ASC
  `).all(userId, userId) as any[];

  // For MVP, any user in any TZ can participate (TZ matching comes later with more users)
  return chains;
}

// Find active chains that should be delivered to a specific TZ offset at current UTC hour
// chain_hour is the local hour of creation. For a chain to reach tz_offset at utcHour:
// utcHour + tz_offset ≡ chain_hour (mod 24)
export function getChainsForTzAtHour(utcHour: number, tzOffset: number): any[] {
  const localHour = ((utcHour + tzOffset) % 24 + 24) % 24;
  return db.prepare(`
    SELECT c.* FROM chains c
    WHERE c.status = 'active' AND c.chain_hour = ?
  `).all(localHour) as any[];
}

// Find users by TZ offset
export function getUsersByTzOffset(tzOffset: number): any[] {
  return db.prepare('SELECT * FROM users WHERE tz_offset = ?').all(tzOffset) as any[];
}

// ─── Legacy compatibility shims (pre-v6 modules) ───

export function initDb(_path?: string): void {
  // v6: DB auto-initializes at import. No-op for legacy callers.
}

export function insertChain(_data: { id: string; date: string; hour: number }): void {
  // Legacy shim — v6 uses createChain() with different schema
}

export function updateChain(_id: string | number, _fields: Record<string, any>): void {
  // Legacy shim — v6 uses completeChain() with different schema
}

export function getChainMessages(chainId: string | number): any[] {
  const id = typeof chainId === 'number' ? chainId : parseInt(chainId, 10);
  if (isNaN(id)) return [];
  return getAllBlocks(id);
}

export function insertMessage(_msg: any): void {
  // Legacy shim — v6 uses addBlock()
}

export function getLastMessage(chainId: string | number): any {
  const id = typeof chainId === 'number' ? chainId : parseInt(chainId, 10);
  if (isNaN(id)) return null;
  return getLastBlock(id);
}

export function insertUser(user: any): void {
  upsertUser(
    user.telegram_id ?? 0,
    user.username,
    user.first_name ?? user.timezone,
    user.utc_offset ?? 0,
    0,
    'en',
  );
}

export { getUsersByTzOffset as getUsersByOffset };
export { getUser as getUserByTelegramId };
