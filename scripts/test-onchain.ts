#!/usr/bin/env npx tsx
/**
 * 온체인 기록 테스트 — 3블록만 기록하고 확인
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { ethers } from 'ethers';
import { makeChainId, recordBlock, mintSoulbound, explorerUrl } from '../src/onchain.js';

async function main() {
  const chainLabel = `test-${Date.now()}`;
  const chainId = makeChainId(chainLabel);
  console.log(`⛓️  Test chain: ${chainLabel}`);
  console.log(`   chainId: ${chainId.slice(0, 14)}...`);

  let prevHash = ethers.ZeroHash;

  // Block 0: Auckland (human)
  console.log('\n--- Block 0: Auckland ---');
  const b0 = await recordBlock(chainId, 0, 'Kia ora! The story begins...', prevHash, true);
  const blockHash0 = b0.blockHash;
  prevHash = blockHash0;
  console.log(`   Explorer: ${explorerUrl(b0.txHash)}`);

  // Verify block 0 stored correctly
  const { jungBlock } = await import('../src/onchain.js');
  const stored = await jungBlock.blocks(blockHash0);
  console.log('   stored chainId:', stored[0]);
  console.log('   stored slot:', Number(stored[1]));
  console.log('   chainId match:', stored[0] === chainId);

  // Block 1: Solomon Islands (AI)
  await new Promise(r => setTimeout(r, 3000)); // wait for state sync
  console.log('\n--- Block 1: Solomon Islands (AI 정지기) ---');
  const b1 = await recordBlock(chainId, 1, 'The waves carried the message forward...', prevHash, false);
  prevHash = b1.blockHash;
  console.log(`   Explorer: ${explorerUrl(b1.txHash)}`);

  // Block 2: Sydney (human)
  console.log('\n--- Block 2: Sydney ---');
  const b2 = await recordBlock(chainId, 2, 'Crikey! What a story, mate!', prevHash, true);
  prevHash = b2.blockHash;
  console.log(`   Explorer: ${explorerUrl(b2.txHash)}`);

  console.log('\n✅ 3 blocks recorded on Base Sepolia!');
  console.log(`First tx: ${explorerUrl(b0.txHash)}`);
}

main().catch(console.error);
