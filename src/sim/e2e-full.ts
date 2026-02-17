/**
 * 정봇 E2E 풀 시뮬레이션
 * - TZ당 2~5명 유저 풀
 * - 70% 정상 / 15% 스킵 / 10% 타임아웃 / 5% 검증실패→재시도
 * - Imagen4 실사진 + validatePhoto
 * - 정지기 코멘트 + 진행 리포팅
 * - JB 텔레그램에 실시간 전송
 * - 온체인 기록 + NFT
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validatePhoto, generatePhotoCaption } from '../services/ai.js';
import { makeChainId, recordBlock, createOnchainChain, mintSoulbound, explorerUrl } from '../services/onchain.js';
import { ethers } from 'ethers';
import { writeFileSync, mkdirSync } from 'fs';
import { config, getCity } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../data/jung.db');
const db = new Database(DB_PATH);
const OUT_DIR = resolve(__dirname, '../../data/e2e-photos');
mkdirSync(OUT_DIR, { recursive: true });

const GOOGLE_API_KEY = config.googleApiKey;
const ENABLE_ONCHAIN = process.env.ENABLE_ONCHAIN === 'true';
const DEPLOYER_ADDR = process.env.DEPLOYER_ADDRESS || '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1';
const JB_TELEGRAM_ID = 5023569703;
const JUNG_BOT_TOKEN = process.env.JUNG_BOT_TOKEN!;

// ─── User pool per TZ ───
interface SimUser {
  name: string;
  lang: string;
  style: string;
}

const TZ_USERS: Record<number, SimUser[]> = {
  '-11': [{ name: 'Tui', lang: 'Samoan', style: 'casual' }],
  '-10': [
    { name: 'Kai', lang: 'Hawaiian English', style: 'casual' },
    { name: 'Leilani', lang: 'Hawaiian English', style: 'poetic' },
  ],
  '-9': [{ name: 'Jake', lang: 'American English', style: 'funny' }, { name: 'Aurora', lang: 'American English', style: 'thoughtful' }],
  '-8': [
    { name: 'Carlos', lang: 'American English', style: 'casual' },
    { name: 'Maya', lang: 'American English', style: 'poetic' },
    { name: 'Diego', lang: 'Mexican Spanish', style: 'funny' },
  ],
  '-7': [{ name: 'Sofia', lang: 'Mexican Spanish', style: 'casual' }, { name: 'Miguel', lang: 'Mexican Spanish', style: 'thoughtful' }],
  '-6': [
    { name: 'Valentina', lang: 'Mexican Spanish', style: 'poetic' },
    { name: 'José', lang: 'Mexican Spanish', style: 'casual' },
    { name: 'Ximena', lang: 'Mexican Spanish', style: 'funny' },
  ],
  '-5': [
    { name: 'Sarah', lang: 'American English', style: 'casual' },
    { name: 'Marcus', lang: 'American English', style: 'funny' },
    { name: 'Aisha', lang: 'American English', style: 'thoughtful' },
    { name: 'Tom', lang: 'American English', style: 'casual' },
    { name: 'Priya', lang: 'American English', style: 'poetic' },
  ],
  '-4': [{ name: 'Camila', lang: 'Chilean Spanish', style: 'casual' }, { name: 'Mateo', lang: 'Chilean Spanish', style: 'funny' }],
  '-3': [
    { name: 'Lucas', lang: 'Brazilian Portuguese', style: 'casual' },
    { name: 'Ana', lang: 'Brazilian Portuguese', style: 'poetic' },
    { name: 'Pedro', lang: 'Brazilian Portuguese', style: 'funny' },
  ],
  '-2': [{ name: 'João', lang: 'Portuguese', style: 'thoughtful' }],
  '-1': [{ name: 'Maria', lang: 'Portuguese', style: 'poetic' }, { name: 'André', lang: 'Portuguese', style: 'casual' }],
  '0': [
    { name: 'James', lang: 'British English', style: 'casual' },
    { name: 'Emma', lang: 'British English', style: 'funny' },
    { name: 'Ollie', lang: 'British English', style: 'thoughtful' },
    { name: 'Zara', lang: 'British English', style: 'poetic' },
    { name: 'Liam', lang: 'British English', style: 'casual' },
  ],
  '1': [
    { name: 'Pierre', lang: 'French', style: 'poetic' },
    { name: 'Amélie', lang: 'French', style: 'casual' },
    { name: 'Hugo', lang: 'French', style: 'funny' },
    { name: 'Chloé', lang: 'French', style: 'thoughtful' },
    { name: 'Louis', lang: 'French', style: 'casual' },
  ],
  '2': [
    { name: 'Ahmed', lang: 'Arabic', style: 'casual' },
    { name: 'Fatima', lang: 'Arabic', style: 'poetic' },
    { name: 'Omar', lang: 'Arabic', style: 'thoughtful' },
  ],
  '3': [
    { name: 'Dmitri', lang: 'Russian', style: 'casual' },
    { name: 'Natasha', lang: 'Russian', style: 'poetic' },
    { name: 'Alexei', lang: 'Russian', style: 'funny' },
  ],
  '4': [{ name: 'Rashid', lang: 'Arabic', style: 'casual' }, { name: 'Layla', lang: 'Arabic', style: 'poetic' }],
  '5': [
    { name: 'Imran', lang: 'Urdu', style: 'casual' },
    { name: 'Ayesha', lang: 'Urdu', style: 'poetic' },
    { name: 'Zain', lang: 'Urdu', style: 'thoughtful' },
  ],
  '6': [{ name: 'Rahim', lang: 'Bengali', style: 'casual' }, { name: 'Nusrat', lang: 'Bengali', style: 'poetic' }],
  '7': [
    { name: 'Somchai', lang: 'Thai', style: 'casual' },
    { name: 'Ploy', lang: 'Thai', style: 'funny' },
    { name: 'Nut', lang: 'Thai', style: 'poetic' },
  ],
  '8': [
    { name: 'Wei', lang: 'Traditional Chinese', style: 'casual' },
    { name: 'Mei', lang: 'Traditional Chinese', style: 'poetic' },
    { name: 'Jun', lang: 'Traditional Chinese', style: 'thoughtful' },
    { name: 'Hana', lang: 'Traditional Chinese', style: 'funny' },
  ],
  // '9' = JB (creator, already done)
  '10': [
    { name: 'Olivia', lang: 'Australian English', style: 'casual' },
    { name: 'Jack', lang: 'Australian English', style: 'funny' },
    { name: 'Chloe', lang: 'Australian English', style: 'thoughtful' },
  ],
  '11': [{ name: 'Élise', lang: 'French', style: 'poetic' }, { name: 'Taro', lang: 'Japanese', style: 'casual' }],
  '12': [
    { name: 'Aroha', lang: 'New Zealand English', style: 'casual' },
    { name: 'Wiremu', lang: 'New Zealand English', style: 'thoughtful' },
    { name: 'Grace', lang: 'New Zealand English', style: 'poetic' },
  ],
};

const TZ_VIBES: Record<number, string> = {
  '-11': 'tropical Samoan island village at sunset, palm trees, ocean',
  '-10': 'Hawaiian beach with surfboards at golden hour, red hibiscus flowers',
  '-9': 'snowy Alaskan cabin with red aurora borealis in sky',
  '-8': 'Los Angeles street with red fire hydrant and palm trees',
  '-7': 'Denver coffee shop with red neon sign in window',
  '-6': 'Mexico City market with red chili peppers hanging',
  '-5': 'New York City fire truck parked on busy street',
  '-4': 'Santiago street with red bougainvillea climbing walls',
  '-3': 'São Paulo rooftop at sunset with red sky',
  '-2': 'Fernando de Noronha beach with red coral',
  '-1': 'Azores volcanic coast with red wildflowers',
  '0': 'London red telephone booth in the rain',
  '1': 'Paris café with red awning and espresso cups',
  '2': 'Cairo market with red spices in bowls',
  '3': 'Moscow red square at snowy evening',
  '4': 'Dubai sunset with red-orange sky over skyscrapers',
  '5': 'Karachi bazaar with red fabric rolls and lanterns',
  '6': 'Dhaka rickshaw painted red on busy street',
  '7': 'Bangkok street food stall with red chili sauce bottles',
  '8': 'Taipei temple with red lanterns at night',
  '10': 'Sydney harbour with red sunset behind opera house',
  '11': 'Nouméa lagoon with red kayaks on turquoise water',
  '12': 'Auckland dawn with red sky over harbor',
};

type CaseType = 'normal' | 'skip' | 'timeout' | 'fail_retry';

function rollCase(): CaseType {
  const r = Math.random();
  if (r < 0.70) return 'normal';
  if (r < 0.85) return 'skip';
  if (r < 0.95) return 'timeout';
  return 'fail_retry';
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Send message to JB via Telegram
async function sendToJB(text: string) {
  const url = `https://api.telegram.org/bot${JUNG_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: JB_TELEGRAM_ID, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

async function sendPhotoToJB(photoB64: string, caption: string) {
  const url = `https://api.telegram.org/bot${JUNG_BOT_TOKEN}/sendPhoto`;
  try {
    const photoBuffer = Buffer.from(photoB64, 'base64');
    const blob = new Blob([photoBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('chat_id', String(JB_TELEGRAM_ID));
    formData.append('photo', blob, 'photo.png');
    formData.append('caption', caption.slice(0, 1024));
    formData.append('parse_mode', 'HTML');

    await fetch(url, { method: 'POST', body: formData });
  } catch (e: any) {
    console.error(`  📤 Telegram photo send failed: ${e.message?.slice(0, 50)}`);
  }
}

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
  if (!res.ok) throw new Error(`Imagen4 ${res.status}`);
  const data = await res.json() as any;
  return data.predictions?.[0]?.bytesBase64Encoded ?? '';
}

async function main() {
  console.log('🌏 정봇 E2E 풀 시뮬레이션\n');

  const chain = db.prepare(`
    SELECT * FROM chains WHERE creator_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `).get(JB_TELEGRAM_ID) as any;

  if (!chain) {
    console.log('❌ 활성 체인 없음!');
    process.exit(1);
  }

  const mission = chain.mission || '당신 주위의 빨강을 보여주세요!';
  console.log(`📍 체인 #${chain.id} · 미션: ${mission}\n`);

  await sendToJB(`🌏 <b>정 릴레이 시뮬레이션 시작!</b>\n\n📸 미션: ${mission}\n👥 72명의 유저가 24개 타임존에서 대기 중\n⛓️ 온체인: ${ENABLE_ONCHAIN ? 'ON' : 'OFF'}\n\n정이 지구를 한 바퀴 돕니다...`);
  await sleep(2000);

  const existingBlocks = db.prepare('SELECT * FROM blocks WHERE chain_id = ? ORDER BY slot_index').all(chain.id) as any[];
  console.log(`  기존 블록: ${existingBlocks.length}/24`);
  let prevCaption = existingBlocks.length > 0
    ? (existingBlocks[existingBlocks.length - 1].content || 'A beautiful moment')
    : 'A beautiful moment';
  let prevBlockHash = ethers.ZeroHash;

  // TZ order from creator — next TZ after creator
  const tzOrder: number[] = [];
  for (let i = 1; i < 24; i++) {
    let tz = chain.creator_tz + i;
    if (tz > 12) tz -= 24;
    if (tz < -11) tz += 24;
    tzOrder.push(tz);
  }
  // Skip already-filled slots (subtract 1 because creator = slot 1)
  const filledSlots = existingBlocks.length; // JB = 1
  const remainingTzs = tzOrder.slice(filledSlots - 1);

  // On-chain setup
  const onchainId = makeChainId(`jung-${chain.id}`);
  if (ENABLE_ONCHAIN) {
    try {
      await createOnchainChain(onchainId, DEPLOYER_ADDR, chain.creator_tz);
    } catch (e: any) {
      if (!e.message?.includes('already')) console.error('⛓️', e.message?.slice(0, 60));
    }
    for (const block of existingBlocks) {
      try {
        const result = await recordBlock(onchainId, block.content || 'photo', prevBlockHash, DEPLOYER_ADDR, block.tz_offset);
        prevBlockHash = result.blockHash;
        await sleep(2000);
      } catch (e: any) { /* skip */ }
    }
  }

  const startTime = Date.now();
  const stats = { normal: 0, skip: 0, timeout: 0, fail_retry: 0, imgFail: 0 };

  for (let i = 0; i < remainingTzs.length; i++) {
    const tz = remainingTzs[i];
    const slot = filledSlots + 1 + i; // JB=1, so next = 2
    const city = getCity(tz);
    const sign = tz >= 0 ? '+' : '';
    const users = TZ_USERS[tz] ?? [{ name: 'Anon', lang: 'English', style: 'casual' }];
    const vibe = TZ_VIBES[tz] ?? `${city} street scene with something red`;

    // Roll case for first user
    let caseType = rollCase();
    let attempts = 0;
    let selectedUser: SimUser | null = null;
    let userIdx = 0;

    // Handle skips/timeouts — try next user in pool
    while (caseType !== 'normal' && caseType !== 'fail_retry' && userIdx < users.length - 1) {
      selectedUser = users[userIdx];
      const emoji = caseType === 'skip' ? '⏭' : '⏰';
      const label = caseType === 'skip' ? 'SKIP' : 'TIMEOUT';
      stats[caseType]++;

      console.log(`[${slot}/24] 📍 ${city} · ${selectedUser.name} → ${label}`);
      await sendToJB(`${emoji} <b>[${slot}/24] ${city} (UTC${sign}${tz})</b>\n👤 ${selectedUser.name}\n→ ${caseType === 'skip' ? '스킵! 다음 유저에게...' : '1시간 타임아웃! 다음 유저에게...'}`);
      await sleep(1500);

      userIdx++;
      caseType = rollCase();
      // Force normal if last user
      if (userIdx >= users.length - 1) caseType = 'normal';
    }

    selectedUser = users[userIdx];

    // fail_retry case
    if (caseType === 'fail_retry') {
      stats.fail_retry++;
      console.log(`[${slot}/24] 📍 ${city} · ${selectedUser.name} → FAIL then RETRY`);

      await sendToJB(`❌ <b>[${slot}/24] ${city} (UTC${sign}${tz})</b>\n👤 ${selectedUser.name}\n🔍 정지기: 미션이랑 안 맞는 것 같아요~ 다시 보내주세요!`);
      await sleep(2000);
      await sendToJB(`🔄 ${selectedUser.name}이(가) 다시 시도합니다...`);
      await sleep(1000);
    }

    // Normal flow: generate photo
    stats.normal++;
    console.log(`[${slot}/24] 📍 ${city} · ${selectedUser.name} → NORMAL`);

    const header = `📨 <b>[${slot}/24] ${city} (UTC${sign}${tz})</b>\n👤 ${selectedUser.name} · ${selectedUser.lang}\n\n🌏 정이 도착했습니다!\n📍 이전: "${(prevCaption || '').slice(0, 60)}"\n📸 미션: ${mission}`;
    await sendToJB(header);
    await sleep(1000);

    // Generate image
    const photoPrompt = `Casual phone photo taken in ${vibe}. Everyday candid moment showing something red. Natural lighting, not professional. No text overlay. Mission: ${mission}`;
    let photoB64 = '';
    let filePath = '';
    try {
      photoB64 = await generateImage(photoPrompt);
      filePath = resolve(OUT_DIR, `slot-${String(slot).padStart(2, '0')}-${city.replace(/\s/g, '-')}.png`);
      writeFileSync(filePath, Buffer.from(photoB64, 'base64'));
    } catch (e: any) {
      console.error(`  📸 이미지 실패: ${e.message?.slice(0, 50)}`);
      stats.imgFail++;
      // Use placeholder
    }

    // Validate
    let jungzigiComment = '좋은 사진이네요! 📸';
    if (photoB64) {
      try {
        const validation = await validatePhoto(photoB64, mission);
        jungzigiComment = validation.jungzigiComment || jungzigiComment;
      } catch { /* use default */ }
    }

    // Caption
    const caption = await generatePhotoCaption(tz, mission, prevCaption, selectedUser.style);

    // Send photo to JB
    if (photoB64) {
      await sendPhotoToJB(photoB64, `📍 ${city} · ${selectedUser.name}\n💬 ${caption}`);
    }
    await sleep(500);

    // 정지기 response
    let nextTz = tz + 1;
    if (nextTz > 12) nextTz -= 24;
    const toCity = getCity(nextTz);

    if (slot >= 24) {
      await sendToJB(`🤖 정지기: ${jungzigiComment}\n\n🏁 ${slot}/24 · 지구 한 바퀴 완주!`);
    } else {
      await sendToJB(`🤖 정지기: ${jungzigiComment}\n\n✅ ${slot}/24 · ${city} → ${toCity}로 이동 중...`);
    }

    // Save to DB
    const fakeId = 900000001 + i;
    db.prepare(`INSERT OR REPLACE INTO users (telegram_id, username, first_name, tz_offset, notify_hour, lang)
      VALUES (?, ?, ?, ?, 12, 'en')`).run(fakeId, `sim_${selectedUser.name}`, selectedUser.name, tz);
    db.prepare(`INSERT INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_url, media_type)
      VALUES (?, ?, ?, ?, ?, ?, 'photo')`)
      .run(chain.id, slot, fakeId, tz, caption, filePath || null);
    db.prepare('UPDATE chains SET block_count = ? WHERE id = ?').run(slot, chain.id);

    // On-chain
    if (ENABLE_ONCHAIN) {
      try {
        const result = await recordBlock(onchainId, caption, prevBlockHash, DEPLOYER_ADDR, tz);
        prevBlockHash = result.blockHash;
      } catch (e: any) {
        console.error(`  ⛓️ ${e.message?.slice(0, 50)}`);
      }
    }

    prevCaption = caption;
    await sleep(2000); // pace between cities
  }

  // Complete
  const now = new Date();
  const deliverAt = new Date(new Date(chain.start_utc).getTime() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE chains SET status = 'completed', completed_at = ?, deliver_at = ?, block_count = 24 WHERE id = ?`)
    .run(now.toISOString(), deliverAt, chain.id);

  // NFT
  let nftMsg = '';
  if (ENABLE_ONCHAIN) {
    try {
      const { tokenId, txHash } = await mintSoulbound(DEPLOYER_ADDR, onchainId, chain.creator_tz, 24, 1);
      nftMsg = `\n🎖️ Soulbound NFT #${tokenId}\n${explorerUrl(txHash)}`;
      console.log(`🎖️ NFT #${tokenId}: ${explorerUrl(txHash)}`);
    } catch (e: any) {
      console.error(`🎖️ ${e.message?.slice(0, 80)}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  // Final summary to JB
  await sleep(2000);
  await sendToJB(
    `🏁 <b>정이 지구를 한 바퀴 돌아왔습니다!</b>\n\n` +
    `⏱ ${elapsed}초 (${(Number(elapsed) / 60).toFixed(1)}분)\n` +
    `📍 24개 도시\n` +
    `👥 참여: ${stats.normal}명\n` +
    `⏭ 스킵: ${stats.skip}회\n` +
    `⏰ 타임아웃: ${stats.timeout}회\n` +
    `❌ 실패→재시도: ${stats.fail_retry}회\n` +
    `📸 이미지 실패: ${stats.imgFail}회` +
    nftMsg +
    `\n\n📬 결과는 내일 같은 시간에 도착합니다!`
  );

  // Print results
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🏁 완료! ${elapsed}s`);
  console.log(`  ✅ ${stats.normal} | ⏭ ${stats.skip} | ⏰ ${stats.timeout} | 🔄 ${stats.fail_retry} | ❌ img ${stats.imgFail}`);
  console.log(`  📂 ${OUT_DIR}`);

  // Cleanup
  db.prepare('DELETE FROM users WHERE telegram_id >= 900000001 AND telegram_id <= 900000100').run();
  console.log('🧹 가상 유저 정리');
}

main().catch(console.error);
