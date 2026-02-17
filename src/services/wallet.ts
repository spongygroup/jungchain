/**
 * CDP Server Wallet — 유저별 지갑 생성/관리
 * 유저는 지갑 존재를 모름. 서버가 투명하게 관리.
 */
import { CdpClient } from '@coinbase/cdp-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load CDP credentials
const cdpCreds = JSON.parse(readFileSync(join(process.env.HOME!, '.config/cdp/credentials.json'), 'utf8'));

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

/**
 * Create a new EVM account (wallet) for a user
 * Returns the wallet address
 */
export async function createWallet(): Promise<{ address: string; accountId: string }> {
  const client = await getClient();
  const account = await client.evm.createAccount();
  return {
    address: account.address,
    accountId: account.address, // CDP EVM accounts use address as ID
  };
}

/**
 * Get wallet address — just returns stored address (no API call needed)
 */
export function getWalletAddress(address: string): string {
  return address;
}
