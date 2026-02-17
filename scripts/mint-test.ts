#!/usr/bin/env npx tsx
import { config } from 'dotenv'; config({ override: true });
import { makeChainId, mintSoulbound, explorerUrl } from '../src/onchain.js';

const chainId = makeChainId('v6-test-1771316612378');
const result = await mintSoulbound(
  '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1',
  chainId, 9, 24, 24
);
console.log(`🎖️ NFT #${result.tokenId} 민팅 완료!`);
console.log(`Explorer: ${explorerUrl(result.txHash)}`);
