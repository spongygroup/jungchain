#!/usr/bin/env npx tsx
/**
 * 온체인 v6 테스트 — 24블록 전체 릴레이 + Soulbound NFT
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { ethers } from 'ethers';
import { makeChainId, recordBlock, mintSoulbound, explorerUrl, jungBlock } from '../src/onchain.js';

// 24 정수 타임존 (UTC+9 시작 → 한 바퀴)
const TZ_ORDER = [9, 10, 11, 12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];

const CITIES: Record<number, string> = {
  9: 'Seoul', 10: 'Sydney', 11: 'Noumea', 12: 'Auckland',
  '-11': 'Pago Pago', '-10': 'Honolulu', '-9': 'Anchorage', '-8': 'LA',
  '-7': 'Denver', '-6': 'Mexico City', '-5': 'New York', '-4': 'Santiago',
  '-3': 'São Paulo', '-2': 'Azores', '-1': 'Cape Verde', 0: 'London',
  1: 'Paris', 2: 'Cairo', 3: 'Moscow', 4: 'Dubai',
  5: 'Karachi', 6: 'Dhaka', 7: 'Bangkok', 8: 'Singapore',
};

async function main() {
  const label = `v6-test-${Date.now()}`;
  const chainId = makeChainId(label);
  const creatorTz = 9; // Seoul

  console.log(`⛓️ 온체인 v6 테스트 — 24블록 기록 + NFT`);
  console.log(`체인: ${label}, creator_tz=${creatorTz}\n`);

  // 1️⃣ 체인 생성
  console.log('1️⃣ 체인 생성...');
  const createTx = await jungBlock.createChain(chainId, ethers.ZeroAddress, creatorTz);
  await createTx.wait();
  console.log(`   ✅ 체인 생성 완료: ${createTx.hash.slice(0, 14)}...\n`);

  // 2️⃣ 24블록 기록
  console.log('2️⃣ 블록 기록...');
  let prevHash = ethers.ZeroHash;
  let successCount = 0;

  for (let i = 0; i < 24; i++) {
    const tz = TZ_ORDER[i];
    const city = CITIES[tz] || `UTC${tz}`;
    const msg = `[${i + 1}/24] ${city} (UTC${tz >= 0 ? '+' : ''}${tz}) — 정이 흐르고 있습니다`;

    try {
      const result = await recordBlock(chainId, msg, prevHash, tz);
      prevHash = result.blockHash;
      successCount++;
      console.log(`   [${i + 1}/24] UTC${tz >= 0 ? '+' : ''}${tz} ${city} ... ✅ ${result.txHash.slice(0, 14)}...`);
    } catch (err: any) {
      console.log(`   [${i + 1}/24] UTC${tz >= 0 ? '+' : ''}${tz} ${city} ... ❌ ${err.message?.slice(0, 60)}`);
      // 에러 후에도 계속 시도하지 않음 — prevHash 체이닝 깨짐
      break;
    }
  }

  console.log(`\n📊 결과: ${successCount}/24 블록 성공`);

  // 3️⃣ 완주 확인 + NFT 민팅
  if (successCount === 24) {
    const completed = await jungBlock.chainCompleted(chainId);
    console.log(`🏁 완주 여부: ${completed}`);

    if (completed) {
      console.log('\n3️⃣ Soulbound NFT 민팅...');
      const nft = await mintSoulbound(
        process.env.DEPLOYER_ADDRESS || '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1',
        chainId, creatorTz, 24, 24,
      );
      console.log(`   🎖️ NFT #${nft.tokenId} 민팅 완료!`);
      console.log(`   Explorer: ${explorerUrl(nft.txHash)}`);
    }
  }

  console.log('\n✅ 테스트 종료');
}

main().catch(console.error);
