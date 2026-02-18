#!/usr/bin/env npx tsx
/**
 * 정체인 포토 릴레이 — 3블록 테스트
 * JB 온보딩(위치공유) → JB 사진 → AI 2블록 (Imagen 4)
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCity, TZ_LANGUAGES } from '../config.js';
import { find as findTz } from 'geo-tz';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5023569703';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const MISSION = '당신 주위의 빨강을 보여주세요!';
const MISSION_KEYWORD = 'red';
const TEST_BLOCKS = 3; // JB + AI 2블록

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

const TZ_FLAGS: Record<number, string> = {
  12: '🇳🇿', 11: '🇸🇧', 10: '🇦🇺', 9: '🇰🇷', 8: '🇹🇼', 7: '🇹🇭',
  6: '🇧🇩', 5: '🇵🇰', 4: '🇦🇪', 3: '🇷🇺', 2: '🇪🇬', 1: '🇫🇷',
  0: '🇬🇧', '-1': '🇵🇹', '-2': '🌊', '-3': '🇧🇷', '-4': '🇺🇸',
  '-5': '🇺🇸', '-6': '🇺🇸', '-7': '🇺🇸', '-8': '🇺🇸', '-9': '🇺🇸',
  '-10': '🇺🇸', '-11': '🇼🇸',
};

const KOREAN_CITIES: Record<number, string> = {
  12: '오클랜드', 11: '솔로몬 제도', 10: '시드니', 9: '서울', 8: '타이베이',
  7: '방콕', 6: '다카', 5: '이슬라마바드', 4: '두바이', 3: '모스크바',
  2: '카이로', 1: '파리', 0: '런던', '-1': '아조레스', '-2': '대서양',
  '-3': '상파울루', '-4': '뉴욕', '-5': '시카고', '-6': '덴버',
  '-7': 'LA', '-8': '앵커리지', '-9': '알래스카', '-10': '호놀룰루', '-11': '사모아',
};

let lastUpdateId = 0;

// ─── Telegram ───
async function sendTelegram(text: string, reply_markup?: any): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body: any = { chat_id: TELEGRAM_CHAT_ID, text };
      if (reply_markup) body.reply_markup = reply_markup;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return;
    } catch (err: any) {
      console.error(`  ⚠️ sendTelegram attempt ${attempt + 1}/3: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function sendTelegramPhotoBuffer(buf: Buffer, caption?: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new FormData();
      form.append('chat_id', TELEGRAM_CHAT_ID);
      form.append('photo', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'photo.png');
      if (caption) form.append('caption', caption);
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as any;
      console.log(`  📸 Photo sent → msg ${data.result?.message_id}`);
      return;
    } catch (err: any) {
      console.error(`  ⚠️ sendPhoto attempt ${attempt + 1}/3: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function safeFetchUpdates(): Promise<any[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=5`,
        { signal: AbortSignal.timeout(15000) }
      );
      const data = await res.json() as any;
      return data.result ?? [];
    } catch (err: any) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return [];
}

async function clearPendingUpdates(): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1&limit=1`
  );
  const data = await res.json() as any;
  const updates = data.result ?? [];
  if (updates.length > 0) lastUpdateId = updates[updates.length - 1].update_id + 1;
}

// ─── Timezone ───
function timezoneFromLocation(lat: number, lng: number): number {
  const tzNames = findTz(lat, lng);
  if (tzNames.length === 0) return Math.round(lng / 15);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tzNames[0], timeZoneName: 'shortOffset' });
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
  const match = tzPart.match(/GMT([+-]?\d+)/);
  return match ? parseInt(match[1], 10) : Math.round(lng / 15);
}

async function getCityFromCoords(lat: number, lng: number, lang: string = 'ko'): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${lang}&zoom=10`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JungChain/1.0' } });
    const data = await res.json() as any;
    return data.address?.city || data.address?.town || data.address?.county || data.address?.state || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ─── Imagen 4 ───
async function generateImage(description: string): Promise<Buffer | null> {
  try {
    console.log(`  🎨 Imagen 4 생성 중...`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: `Photo-realistic image: ${description}` }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      }
    );
    const data = await res.json() as any;
    if (data.error) {
      console.error(`  ❌ Imagen 4: ${JSON.stringify(data.error)}`);
      return null;
    }
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err: any) {
    console.error(`  ❌ Image gen: ${err.message}`);
    return null;
  }
}

// ─── AI block generation ───
async function generateVirtualBlock(city: string, lang: string, prevCaption: string) {
  const result = await model.generateContent({
    systemInstruction: `You are a ${city} resident in a photo relay chain.
Mission: "${MISSION}"
Previous caption: "${prevCaption}"

Write a SHORT caption (1-2 sentences) in ${lang}.
Also describe the photo in English for image generation.

JSON only: {"caption": "in ${lang}", "imageDescription": "English description"}`,
    contents: [{
      role: 'user',
      parts: [{ text: `Take a photo for mission "${MISSION}" from ${city}. Caption in ${lang}.` }],
    }],
  });
  const text = result.response.text().trim();
  return JSON.parse(text.replace(/```json\n?/g, '').replace(/```/g, ''));
}

// ─── Onboarding ───
async function requestLocation(): Promise<{ lat: number; lng: number; tz: number; city: string } | null> {
  await sendTelegram(
    `🌏 정체인 — 포토 릴레이\n\n` +
    `오늘의 미션: "${MISSION}"\n\n` +
    `네가 있는 곳에서 시작할 거야.\n` +
    `위치를 공유해줘 📍`,
    { keyboard: [[{ text: '📍 위치 공유', request_location: true }]], one_time_keyboard: true, resize_keyboard: true }
  );

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const updates = await safeFetchUpdates();
    for (const update of updates) {
      lastUpdateId = update.update_id + 1;
      const msg = update.message;
      if (msg?.chat?.id === Number(TELEGRAM_CHAT_ID) && msg?.location) {
        const { latitude: lat, longitude: lng } = msg.location;
        const tz = timezoneFromLocation(lat, lng);
        const city = await getCityFromCoords(lat, lng);
        console.log(`  📍 ${city} (UTC${tz >= 0 ? '+' : ''}${tz})`);
        await sendTelegram(
          `📸 ${city}!\nUTC${tz >= 0 ? '+' : ''}${tz}\n\n네가 첫 주자야. 카메라 준비해!`,
          { remove_keyboard: true }
        );
        return { lat, lng, tz, city };
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  await sendTelegram('⏰ 시간 초과!', { remove_keyboard: true });
  return null;
}

// ─── Wait for human photo ───
async function waitForHumanPhoto(): Promise<{ fileId: string; caption: string } | null> {
  await sendTelegram(
    `📸 미션: "${MISSION}"\n\n` +
    `네가 첫 번째야. 이 사진이 지구를 돌게 돼.\n` +
    `사진 찍어서 보내줘! 캡션도 같이 적어도 좋아.\n⏱ 5분`
  );

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const updates = await safeFetchUpdates();
    for (const update of updates) {
      lastUpdateId = update.update_id + 1;
      const msg = update.message;
      if (msg?.chat?.id === Number(TELEGRAM_CHAT_ID) && msg?.photo?.length > 0) {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const caption = msg.caption || '📸';
        console.log(`  📷 JB photo received: "${caption}"`);
        return { fileId: photoId, caption };
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// ─── Build offsets from user TZ ───
function buildOffsets(startTz: number): number[] {
  const all = Array.from({ length: 24 }, (_, i) => 12 - i);
  const startIdx = all.indexOf(startTz);
  if (startIdx === -1) return all;
  return [...all.slice(startIdx), ...all.slice(0, startIdx)];
}

// ─── Main ───
async function run() {
  console.log(`🌏 정체인 포토 릴레이 — ${TEST_BLOCKS}블록 테스트`);
  console.log(`📸 미션: ${MISSION}`);
  console.log(`🤖 모델: ${MODEL_NAME} + Imagen 4`);
  console.log('');

  await clearPendingUpdates();

  // 1. 온보딩
  const loc = await requestLocation();
  if (!loc) return;

  const offsets = buildOffsets(loc.tz);
  const testOffsets = offsets.slice(0, TEST_BLOCKS);
  console.log(`🗺️ 테스트 경로: ${testOffsets.map(o => `${KOREAN_CITIES[o] || getCity(o)}`).join(' → ')}`);

  let prevCaption = '';

  for (let i = 0; i < TEST_BLOCKS; i++) {
    const offset = testOffsets[i]!;
    const city = getCity(offset);
    const korCity = KOREAN_CITIES[offset] || city;
    const flag = TZ_FLAGS[offset] || '🌍';
    const lang = TZ_LANGUAGES[offset] ?? 'English';
    const isHuman = i === 0; // 첫 블록 = JB

    console.log(`\n[${i + 1}/${TEST_BLOCKS}] ${flag} ${korCity} (${city})`);

    if (isHuman) {
      const photo = await waitForHumanPhoto();
      if (!photo) {
        await sendTelegram('⏰ 시간 초과! 다음에 다시 하자.');
        return;
      }
      prevCaption = photo.caption;
      await sendTelegram(`✅ 사진 접수! 네 사진이 이제 서쪽으로 떠나.`);
    } else {
      // AI 블록
      console.log(`  🤖 AI 생성 중 (${lang})...`);
      const block = await generateVirtualBlock(city, lang, prevCaption);
      console.log(`  📝 캡션: ${block.caption}`);
      console.log(`  🖼️ ${block.imageDescription.slice(0, 80)}...`);

      const imgBuffer = await generateImage(block.imageDescription);
      const elapsed = '';

      if (imgBuffer) {
        console.log(`  ✅ 이미지 생성 (${(imgBuffer.length / 1024).toFixed(0)}KB)`);
        await sendTelegramPhotoBuffer(imgBuffer, `${flag} ${korCity}\n${block.caption}`);
      } else {
        await sendTelegram(`${flag} ${korCity}\n${block.caption}\n\n(🖼 이미지 생성 실패)`);
      }
      prevCaption = block.caption;

      await new Promise(r => setTimeout(r, 3000)); // 블록 간 간격
    }
  }

  await sendTelegram(`\n🏁 테스트 완료! ${TEST_BLOCKS}블록 릴레이 끝.`);
  console.log('\n✅ 테스트 완료!');
}

run().catch(console.error);
