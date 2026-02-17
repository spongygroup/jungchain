/**
 * 정봇 E2E 포토 릴레이 — 실제 플로우 그대로
 * Imagen4 생성 → validatePhoto → 캡션 생성 → DB 저장 → 온체인
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePhoto, generatePhotoCaption } from '../services/ai.js';
import { makeChainId, recordBlock, createOnchainChain, mintSoulbound, explorerUrl } from '../services/onchain.js';
import { ethers } from 'ethers';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { config, getCity, TZ_LANGUAGES } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../data/jung.db');
const db = new Database(DB_PATH);
const OUT_DIR = resolve(__dirname, '../../data/e2e-photos');
mkdirSync(OUT_DIR, { recursive: true });

const GOOGLE_API_KEY = config.googleApiKey;
const ENABLE_ONCHAIN = process.env.ENABLE_ONCHAIN === 'true';
const DEPLOYER_ADDR = process.env.DEPLOYER_ADDRESS || '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1';
const JB_TELEGRAM_ID = 5023569703;

const TZ_VIBES: Record<number, string> = {
  '-11': 'tropical Samoan island village at sunset',
  '-10': 'Hawaiian beach with surfboards at golden hour',
  '-9': 'snowy Alaskan mountain town with cozy cabin',
  '-8': 'sunny Los Angeles street with palm trees and food truck',
  '-7': 'Denver mountain view from a coffee shop window',
  '-6': 'colorful Mexico City market with fruit stalls',
  '-5': 'busy New York City sidewalk with steam rising',
  '-4': 'Santiago Chilean cityscape with Andes mountains',
  '-3': 'São Paulo urban rooftop at golden hour',
  '-2': 'remote Fernando de Noronha island beach',
  '-1': 'misty Azores volcanic coastline',
  '0': 'rainy London street with red double-decker bus',
  '1': 'Paris café terrace with croissants and coffee',
  '2': 'Cairo street with pyramids visible at dusk',
  '3': 'snowy Moscow evening with illuminated buildings',
  '4': 'Dubai futuristic skyline reflecting in water at night',
  '5': 'Karachi bustling bazaar with colorful spices',
  '6': 'Dhaka riverfront with boats at sunrise',
  '7': 'Bangkok street food stall with neon signs at night',
  '8': 'Taipei night market with lanterns and steam',
  '9': 'Seoul hanok village with autumn maple leaves',
  '10': 'Sydney harbour with opera house at sunrise',
  '11': 'Nouméa tropical lagoon with turquoise water',
  '12': 'Auckland harbor skyline at dawn',
};

const STYLES = ['casual', 'poetic', 'funny', 'thoughtful'];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Imagen 4
async function generateImage(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1', personGeneration: 'allow_all' },
    }),
  });
  if (!res.ok) throw new Error(`Imagen4 ${res.status}: ${(await res.text()).slice(0, 80)}`);
  const data = await res.json() as any;
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('No image in response');
  return b64;
}

async function main() {
  console.log('🌏 정봇 E2E 포토 릴레이 — 풀 플로우\n');
  console.log(`  온체인: ${ENABLE_ONCHAIN ? '✅ ON' : '❌ OFF'}`);
  console.log(`  Imagen 4 + validatePhoto + generateCaption\n`);

  // 1) Find active chain
  const chain = db.prepare(`
    SELECT * FROM chains WHERE creator_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `).get(JB_TELEGRAM_ID) as any;

  if (!chain) {
    console.log('❌ 활성 체인 없음! @beanie_jungbot에서 /new → 📸 포토 릴레이 시작해줘.');
    process.exit(1);
  }

  const mission = chain.mission || '당신 주위의 아름다운 것을 보여주세요!';
  console.log(`📍 체인 #${chain.id} (mode: ${chain.mode})`);
  console.log(`📸 미션: ${mission}\n`);

  const existingBlocks = db.prepare('SELECT * FROM blocks WHERE chain_id = ? ORDER BY slot_index').all(chain.id) as any[];
  const startSlot = existingBlocks.length + 1;
  console.log(`  현재: ${existingBlocks.length}/24\n`);

  // TZ order from creator
  const tzOrder: number[] = [];
  for (let i = 1; i < 24; i++) {
    let tz = chain.creator_tz + i;
    if (tz > 12) tz -= 24;
    if (tz < -11) tz += 24;
    tzOrder.push(tz);
  }
  const remainingTzs = tzOrder.slice(startSlot - 2);

  // Create virtual users
  for (let i = 0; i < remainingTzs.length; i++) {
    const tz = remainingTzs[i];
    const fakeId = 900000001 + i;
    const city = getCity(tz);
    db.prepare(`
      INSERT OR REPLACE INTO users (telegram_id, username, first_name, tz_offset, notify_hour, lang)
      VALUES (?, ?, ?, ?, 12, 'en')
    `).run(fakeId, `sim_${city.replace(/\s/g, '_')}`, city, tz);
  }

  let prevCaption = existingBlocks.length > 0
    ? (existingBlocks[existingBlocks.length - 1].content || 'A beautiful moment')
    : null;
  let prevBlockHash = ethers.ZeroHash;

  // On-chain setup
  const onchainId = makeChainId(`jung-${chain.id}`);
  if (ENABLE_ONCHAIN) {
    try {
      await createOnchainChain(onchainId, DEPLOYER_ADDR, chain.creator_tz);
      console.log('⛓️ 온체인 체인 생성\n');
    } catch (e: any) {
      if (e.message?.includes('already')) console.log('⛓️ 온체인 체인 이미 존재\n');
      else console.error('⛓️', e.message?.slice(0, 60));
    }

    // Record existing blocks
    for (const block of existingBlocks) {
      try {
        const result = await recordBlock(onchainId, block.content || 'photo', prevBlockHash, DEPLOYER_ADDR, block.tz_offset);
        prevBlockHash = result.blockHash;
        await sleep(2000);
      } catch (e: any) {
        console.error(`⛓️ 기존 블록: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  // RELAY
  const startTime = Date.now();
  let passed = 0, failed = 0;

  for (let i = 0; i < remainingTzs.length; i++) {
    const tz = remainingTzs[i];
    const slot = startSlot + i;
    const fakeId = 900000001 + i;
    const city = getCity(tz);
    const sign = tz >= 0 ? '+' : '';
    const vibe = TZ_VIBES[tz] ?? `${city} everyday street scene`;
    const style = STYLES[i % STYLES.length];

    console.log(`\n[${slot}/24] 📍 ${city} (UTC${sign}${tz})`);

    // Step 1: Generate photo (Imagen 4)
    const photoPrompt = `Casual phone photo: ${vibe}. Candid everyday moment, natural lighting, not professional. No text, no watermark. Mission: ${mission}`;
    let photoB64: string;
    try {
      process.stdout.write('  📸 이미지 생성 중...');
      photoB64 = await generateImage(photoPrompt);
      const filePath = resolve(OUT_DIR, `slot-${String(slot).padStart(2, '0')}.png`);
      writeFileSync(filePath, Buffer.from(photoB64, 'base64'));
      console.log(` ✅ ${filePath.split('/').pop()}`);
    } catch (e: any) {
      console.log(` ❌ ${e.message?.slice(0, 50)}`);
      failed++;
      continue;
    }

    // Step 2: Validate photo (mission + safety)
    process.stdout.write('  🔍 검증 중...');
    const validation = await validatePhoto(photoB64, mission);
    console.log(` ${validation.status}`);

    if (validation.status !== 'pass') {
      console.log(`  ⚠️ ${validation.description}`);
      console.log(`  💬 "${validation.userMessage}"`);
      // In real flow, user would re-take. In sim, generate again with safer prompt.
      // For now, skip this slot.
      failed++;
      continue;
    }

    // Step 3: Generate caption
    process.stdout.write('  💬 캡션 생성 중...');
    const caption = await generatePhotoCaption(tz, mission, prevCaption, style);
    console.log(` "${caption.slice(0, 60)}${caption.length > 60 ? '...' : ''}"`);

    // Step 4: Save to DB
    db.prepare(`
      INSERT INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_url, media_type)
      VALUES (?, ?, ?, ?, ?, ?, 'photo')
    `).run(chain.id, slot, fakeId, tz, caption, resolve(OUT_DIR, `slot-${String(slot).padStart(2, '0')}.png`));

    db.prepare('UPDATE chains SET block_count = ? WHERE id = ?').run(slot, chain.id);

    // Step 5: On-chain
    if (ENABLE_ONCHAIN) {
      try {
        process.stdout.write('  ⛓️ 온체인...');
        const result = await recordBlock(onchainId, caption, prevBlockHash, DEPLOYER_ADDR, tz);
        prevBlockHash = result.blockHash;
        console.log(` ${result.txHash.slice(0, 14)}...`);
      } catch (e: any) {
        console.log(` ❌ ${e.message?.slice(0, 50)}`);
      }
    }

    prevCaption = caption;
    passed++;
    await sleep(500);
  }

  // Complete
  const now = new Date();
  const deliverAt = new Date(new Date(chain.start_utc).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const finalCount = existingBlocks.length + passed;

  if (finalCount >= 24) {
    db.prepare(`
      UPDATE chains SET status = 'completed', completed_at = ?, deliver_at = ?, block_count = 24 WHERE id = ?
    `).run(now.toISOString(), deliverAt, chain.id);
  } else {
    db.prepare('UPDATE chains SET block_count = ? WHERE id = ?').run(finalCount, chain.id);
  }

  // NFT
  if (ENABLE_ONCHAIN && finalCount >= 24) {
    try {
      const { tokenId, txHash } = await mintSoulbound(DEPLOYER_ADDR, onchainId, chain.creator_tz, 24, 1);
      console.log(`\n🎖️ Soulbound NFT #${tokenId}: ${explorerUrl(txHash)}`);
    } catch (e: any) {
      console.error(`\n🎖️ NFT: ${e.message?.slice(0, 80)}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🏁 E2E 완료! ${elapsed}s`);
  console.log(`  ✅ 통과: ${passed} | ❌ 실패: ${failed} | 총: ${finalCount}/24`);
  console.log(`  📂 사진: ${OUT_DIR}`);
  if (finalCount >= 24) console.log(`  📬 결과 전달: ${deliverAt}`);

  // Print chain
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📜 전체 체인');
  console.log('═'.repeat(50));
  const allBlocks = db.prepare('SELECT * FROM blocks WHERE chain_id = ? ORDER BY slot_index').all(chain.id) as any[];
  for (const b of allBlocks) {
    const c = getCity(b.tz_offset);
    const s = b.tz_offset >= 0 ? '+' : '';
    const isJB = b.user_id === JB_TELEGRAM_ID;
    console.log(`\n[${b.slot_index}/24] 📍 ${c} (UTC${s}${b.tz_offset}) ${isJB ? '⭐ JB' : ''}`);
    console.log(`  💬 "${b.content || '(no caption)'}"`);
    if (b.media_url) console.log(`  📸 ${b.media_url.split('/').pop()}`);
  }

  // Cleanup
  db.prepare('DELETE FROM users WHERE telegram_id >= 900000001 AND telegram_id <= 900000100').run();
  console.log('\n🧹 가상 유저 정리 완료');
}

main().catch(console.error);
