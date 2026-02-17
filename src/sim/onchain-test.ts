/**
 * 온체인 테스트 — 새 체인으로 24블록 기록 + NFT
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../data/jung.db');
const db = new Database(DB_PATH);

// Direct setup (no NonceManager — manual nonce)
const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
const DEPLOYER = wallet.address;

// Load ABIs
import { readFileSync } from 'fs';
const jungBlockABI = JSON.parse(readFileSync(resolve(__dirname, '../../artifacts/contracts/JungBlock.sol/JungBlock.json'), 'utf8')).abi;
const jungSoulboundABI = JSON.parse(readFileSync(resolve(__dirname, '../../artifacts/contracts/JungSoulbound.sol/JungSoulbound.json'), 'utf8')).abi;
const deployed = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/deployed.json'), 'utf8'));

const jungBlock = new ethers.Contract(deployed.jungBlock, jungBlockABI, wallet);
const jungSoulbound = new ethers.Contract(deployed.jungSoulbound, jungSoulboundABI, wallet);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('⛓️ 온체인 테스트\n');

  const blocks = db.prepare('SELECT * FROM blocks WHERE chain_id = 1 ORDER BY slot_index').all() as any[];
  console.log(`  ${blocks.length} 블록 준비\n`);

  // Use unique chain ID
  const chainLabel = `jung-e2e-${Date.now()}`;
  const chainId = ethers.keccak256(ethers.toUtf8Bytes(chainLabel));
  console.log(`  체인: ${chainLabel}`);

  // Get current nonce
  let nonce = await provider.getTransactionCount(DEPLOYER, 'latest');
  console.log(`  시작 nonce: ${nonce}\n`);

  // 1) Create chain
  console.log('1️⃣ 체인 생성...');
  try {
    const tx = await jungBlock.createChain(chainId, DEPLOYER, 9, { nonce });
    await tx.wait();
    nonce++;
    console.log(`  ✅ ${tx.hash.slice(0, 14)}...\n`);
  } catch (e: any) {
    console.error('  ❌', e.message?.slice(0, 80));
    return;
  }

  // 2) Record blocks
  console.log('2️⃣ 블록 기록...');
  let prevBlockHash = ethers.ZeroHash;
  let successCount = 0;

  for (const block of blocks) {
    const content = block.content || `slot-${block.slot_index}`;
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(content));
    const sign = block.tz_offset >= 0 ? '+' : '';

    process.stdout.write(`  [${block.slot_index}/24] UTC${sign}${block.tz_offset} ... `);

    try {
      const tx = await jungBlock.addBlock(chainId, msgHash, prevBlockHash, DEPLOYER, block.tz_offset, { nonce });
      const receipt = await tx.wait();
      nonce++;

      // Extract blockHash from event
      const event = receipt.logs
        .map((log: any) => { try { return jungBlock.interface.parseLog(log); } catch { return null; } })
        .find((e: any) => e?.name === 'BlockAdded');
      prevBlockHash = event?.args?.blockHash || ethers.ZeroHash;

      successCount++;
      console.log(`✅ ${tx.hash.slice(0, 14)}...`);
    } catch (e: any) {
      console.log(`❌ ${e.message?.slice(0, 60)}`);
      // Try to recover nonce
      nonce = await provider.getTransactionCount(DEPLOYER, 'latest');
    }

    await sleep(1000);
  }

  console.log(`\n  ${successCount}/${blocks.length} 기록 완료\n`);

  // 3) Mint NFT
  if (successCount >= 24) {
    console.log('3️⃣ Soulbound NFT 민팅...');
    try {
      const tx = await jungSoulbound.mint(DEPLOYER, chainId, 9, 24, 1, { nonce });
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return jungSoulbound.interface.parseLog(log); } catch { return null; } })
        .find((e: any) => e?.name === 'JungMinted');
      const tokenId = Number(event?.args?.tokenId || 0);
      console.log(`  🎖️ NFT #${tokenId}`);
      console.log(`  https://sepolia.basescan.org/tx/${tx.hash}`);
    } catch (e: any) {
      console.error(`  ❌ ${e.message?.slice(0, 80)}`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📋 컨트랙트: https://sepolia.basescan.org/address/${deployed.jungBlock}`);
}

main().catch(console.error);
