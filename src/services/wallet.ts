/**
 * CDP Server Wallet — 유저별 지갑 생성/관리
 * 유저는 지갑 존재를 모름. 서버가 투명하게 관리.
 * wallets.json에 백업 — DB 리셋해도 지갑 매핑 유지.
 */
import { CdpClient } from '@coinbase/cdp-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = join(__dirname, '../../data/wallets.json');

// Load CDP credentials
const cdpCredsPath = process.env.CDP_CREDENTIALS_PATH ?? join(process.env.HOME!, '.config/cdp/credentials.json');
const cdpPerms = statSync(cdpCredsPath).mode & 0o777;
if (cdpPerms & 0o077) {
  console.warn(`⚠️ CDP credentials file has loose permissions (${cdpPerms.toString(8)}). Run: chmod 600 ${cdpCredsPath}`);
}
const cdpCreds = JSON.parse(readFileSync(cdpCredsPath, 'utf8'));

let cdpClient: CdpClient | null = null;

async function getClient(): Promise<CdpClient> {
  if (!cdpClient) {
    cdpClient = new CdpClient({
      apiKeyId: cdpCreds.apiKeyId,
      apiKeySecret: cdpCreds.apiKeySecret,
      walletSecret: cdpCreds.walletSecret,
    });
  }
  return cdpClient;
}

// ─── Wallet backup (wallets.json) ───

function loadWalletMap(): Record<string, string> {
  if (!existsSync(WALLETS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(WALLETS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveWalletMap(map: Record<string, string>) {
  mkdirSync(dirname(WALLETS_PATH), { recursive: true });
  writeFileSync(WALLETS_PATH, JSON.stringify(map, null, 2));
}

/**
 * Get existing wallet for a user from backup (no API call)
 */
export function getExistingWallet(telegramId: number): string | null {
  const map = loadWalletMap();
  return map[String(telegramId)] ?? null;
}

/**
 * Create a new EVM account (wallet) for a user
 * Checks backup first — reuses existing wallet if found
 */
export async function createWallet(telegramId: number): Promise<{ address: string; isNew: boolean }> {
  // Check backup first
  const existing = getExistingWallet(telegramId);
  if (existing) {
    return { address: existing, isNew: false };
  }

  // Create new
  const client = await getClient();
  const account = await client.evm.createAccount();
  const address = account.address;

  // Save to backup
  const map = loadWalletMap();
  map[String(telegramId)] = address;
  saveWalletMap(map);

  return { address, isNew: true };
}
