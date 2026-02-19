#!/usr/bin/env npx tsx
/**
 * 온체인 v7 테스트 — 체인 생성 + 블록 기록 + Soulbound NFT 민팅
 * Usage: npx tsx scripts/test-onchain.ts [blocks]
 *   blocks: number of blocks to record (default: 24 for full chain)
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { makeChainId, createOnchainChain, recordBlock, mintSoulbound, isChainCompleted, explorerUrl, jungBlock } from '../src/services/onchain.js';

const TZ_ORDER = [9, 10, 11, 12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];

const CITIES: Record<number, string> = {
  9: 'Seoul', 10: 'Sydney', 11: 'Noumea', 12: 'Auckland',
  '-11': 'Pago Pago', '-10': 'Honolulu', '-9': 'Anchorage', '-8': 'LA',
  '-7': 'Denver', '-6': 'Mexico City', '-5': 'New York', '-4': 'Santiago',
  '-3': 'São Paulo', '-2': 'Azores', '-1': 'Cape Verde', 0: 'London',
  1: 'Paris', 2: 'Cairo', 3: 'Moscow', 4: 'Dubai',
  5: 'Karachi', 6: 'Dhaka', 7: 'Bangkok', 8: 'Singapore',
};

const MESSAGES: Record<number, string> = {
  9: '서울에서 정을 보냅니다 🇰🇷',
  10: 'Sending warmth from Sydney 🇦🇺',
  11: 'Un message de Nouméa 🇳🇨',
  12: 'Kia ora from Auckland 🇳🇿',
  '-11': 'Talofa from Pago Pago 🇦🇸',
  '-10': 'Aloha from Honolulu 🌺',
  '-9': 'Greetings from Anchorage 🏔️',
  '-8': 'Vibes from LA 🌴',
  '-7': 'Hey from Denver 🏔️',
  '-6': '¡Saludos desde México! 🇲🇽',
  '-5': 'Love from New York 🗽',
  '-4': '¡Hola desde Santiago! 🇨🇱',
  '-3': 'Abraços de São Paulo 🇧🇷',
  '-2': 'Olá dos Açores 🌊',
  '-1': 'Greetings from Cape Verde 🏝️',
  0: 'Cheers from London 🇬🇧',
  1: 'Bonjour de Paris 🇫🇷',
  2: 'تحياتي من القاهرة 🇪🇬',
  3: 'Привет из Москвы 🇷🇺',
  4: 'مرحباً من دبي 🇦🇪',
  5: 'کراچی سے سلام 🇵🇰',
  6: 'ঢাকা থেকে শুভেচ্ছা 🇧🇩',
  7: 'สวัสดีจากกรุงเทพ 🇹🇭',
  8: 'Hello from Singapore 🇸🇬',
};

async function main() {
  const blockCount = Number(process.argv[2]) || 24;
  const label = `v7-test-${Date.now()}`;
  const chainId = makeChainId(label);
  const creatorTz = 9;
  const deployerAddr = process.env.DEPLOYER_ADDRESS || ethers.ZeroAddress;

  console.log('╔══════════════════════════════════════╗');
  console.log('║   ⛓️  온체인 v7 테스트                ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Chain: ${label}`);
  console.log(`Blocks: ${blockCount}/24`);
  console.log(`Deployer: ${deployerAddr}\n`);

  // Check balance
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
  const balance = await provider.getBalance(deployerAddr);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);
  if (Number(ethers.formatEther(balance)) < 0.001) {
    console.error('❌ Insufficient gas! Fund the deployer wallet.');
    process.exit(1);
  }

  // 1️⃣ Create chain
  console.log('\n1️⃣ 체인 생성...');
  const txHash = await createOnchainChain(chainId, deployerAddr, creatorTz);
  console.log(`   ✅ 체인 생성 완료\n`);

  // 2️⃣ Record blocks
  console.log('2️⃣ 블록 기록...');
  let prevHash = ethers.ZeroHash;
  let successCount = 0;

  for (let i = 0; i < blockCount; i++) {
    const tz = TZ_ORDER[i];
    const city = CITIES[tz] || `UTC${tz}`;
    const msg = MESSAGES[tz] || `Block from ${city}`;

    try {
      const result = await recordBlock(chainId, msg, prevHash, deployerAddr, tz);
      prevHash = result.blockHash;
      successCount++;
      const sign = tz >= 0 ? '+' : '';
      console.log(`   [${String(i + 1).padStart(2)}/24] UTC${sign}${tz} ${city.padEnd(14)} ✅ ${result.txHash.slice(0, 14)}...`);
    } catch (err: any) {
      const sign = tz >= 0 ? '+' : '';
      console.log(`   [${String(i + 1).padStart(2)}/24] UTC${sign}${tz} ${city.padEnd(14)} ❌ ${err.message?.slice(0, 60)}`);
      break;
    }
  }

  console.log(`\n📊 결과: ${successCount}/${blockCount} 블록 성공`);

  // 3️⃣ Check completion + mint NFT
  if (successCount === 24) {
    const completed = await isChainCompleted(chainId);
    console.log(`🏁 완주: ${completed ? '✅' : '❌'}`);

    if (completed) {
      console.log('\n3️⃣ Soulbound NFT 민팅...');
      try {
        const nft = await mintSoulbound(deployerAddr, chainId, creatorTz, 24, 1);
        console.log(`   🎖️ NFT #${nft.tokenId} 민팅 완료!`);
        console.log(`   🔗 ${explorerUrl(nft.txHash)}`);
      } catch (err: any) {
        console.error(`   ❌ NFT 민팅 실패: ${err.message?.slice(0, 80)}`);
      }
    }
  }

  // Summary
  const finalBalance = await provider.getBalance(deployerAddr);
  const gasUsed = Number(ethers.formatEther(balance)) - Number(ethers.formatEther(finalBalance));
  console.log(`\n💰 가스 사용: ${gasUsed.toFixed(6)} ETH`);
  console.log(`💰 잔액: ${ethers.formatEther(finalBalance)} ETH`);
  console.log('\n✅ 테스트 종료');
}

main().catch(console.error);
