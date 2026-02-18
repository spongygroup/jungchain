#!/usr/bin/env npx tsx
/**
 * 정체인 (Jung Chain) — Photo Relay
 * 테마: 사진 릴레이 (미션 기반)
 * 독립 실행: npm run chain:photo
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCity, TZ_LANGUAGES, config } from '../config.js';
import { find as findTz } from 'geo-tz';
import fs from 'fs';
import path from 'path';

// ─── Config ───
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5023569703';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const BLOCK_INTERVAL_MS = Number(process.env.BLOCK_INTERVAL_MS || '5000');
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

// ─── Mission ───
const MISSION = process.env.PHOTO_MISSION || '당신 주위의 빨강을 보여주세요!';
const MISSION_KEYWORD = process.env.MISSION_KEYWORD || 'red'; // for AI validation

// ─── Timezone flags ───
const TZ_FLAGS: Record<number, string> = {
  12: '🇳🇿', 11: '🇸🇧', 10: '🇦🇺', 9: '🇰🇷', 8: '🇹🇼', 7: '🇹🇭',
  6: '🇧🇩', 5: '🇵🇰', 4: '🇦🇪', 3: '🇷🇺', 2: '🇪🇬', 1: '🇫🇷',
  0: '🇬🇧', '-1': '🇵🇹', '-2': '🌊', '-3': '🇧🇷', '-4': '🇺🇸',
  '-5': '🇺🇸', '-6': '🇺🇸', '-7': '🇺🇸', '-8': '🇺🇸', '-9': '🇺🇸',
  '-10': '🇺🇸', '-11': '🇼🇸',
};

// ─── AI 정지기 gaps ───
const AI_GAPS = new Set([11, -1, -9]);

// ─── Virtual user profiles ───
interface VirtualUser {
  name: string;
  emoji: string;
  lat: number;
  lng: number;
  lang_code: string;
}
const VIRTUAL_USERS: Record<number, VirtualUser> = {
  12: { name: 'Aroha', emoji: '👩🏽', lat: -36.85, lng: 174.76, lang_code: 'mi' },
  10: { name: 'Liam', emoji: '👨🏼', lat: -33.87, lng: 151.21, lang_code: 'en' },
  9:  { name: 'JB', emoji: '👤', lat: 37.57, lng: 126.98, lang_code: 'ko' },
  8:  { name: '小雨', emoji: '👩🏻', lat: 25.03, lng: 121.57, lang_code: 'zh-hant' },
  7:  { name: 'Somchai', emoji: '👨🏽', lat: 13.76, lng: 100.50, lang_code: 'th' },
  6:  { name: 'Priya', emoji: '👩🏾', lat: 22.57, lng: 88.36, lang_code: 'bn' },
  5:  { name: 'Amir', emoji: '👨🏽', lat: 33.69, lng: 73.04, lang_code: 'ur' },
  4:  { name: 'Fatima', emoji: '👩🏽', lat: 25.20, lng: 55.27, lang_code: 'ar' },
  3:  { name: 'Dmitri', emoji: '👨🏻', lat: 55.76, lng: 37.62, lang_code: 'ru' },
  2:  { name: 'Mariam', emoji: '👩🏽', lat: 30.04, lng: 31.24, lang_code: 'ar' },
  1:  { name: 'Camille', emoji: '👩🏼', lat: 48.86, lng: 2.35, lang_code: 'fr' },
  0:  { name: 'Oliver', emoji: '👨🏼', lat: 51.51, lng: -0.13, lang_code: 'en' },
  '-2': { name: 'João', emoji: '👨🏽', lat: -14.24, lng: -24.00, lang_code: 'pt' },
  '-3': { name: 'Lucas', emoji: '👨🏽', lat: -22.91, lng: -43.17, lang_code: 'pt' },
  '-4': { name: 'Maria', emoji: '👩🏽', lat: 10.49, lng: -66.88, lang_code: 'es' },
  '-5': { name: 'Jake', emoji: '👨🏼', lat: 40.71, lng: -74.01, lang_code: 'en' },
  '-6': { name: 'Sofia', emoji: '👩🏽', lat: 19.43, lng: -99.13, lang_code: 'es' },
  '-7': { name: 'Mike', emoji: '👨🏼', lat: 34.05, lng: -118.24, lang_code: 'en' },
  '-8': { name: 'Ashley', emoji: '👩🏼', lat: 37.77, lng: -122.42, lang_code: 'en' },
  '-10': { name: 'Kai', emoji: '👨🏽', lat: 21.31, lng: -157.86, lang_code: 'en' },
  '-11': { name: 'Tala', emoji: '👩🏽', lat: -13.83, lng: -171.76, lang_code: 'sm' },
};

// ─── Human participation ───
const HUMAN_OFFSETS = new Set([9]);
const HUMAN_TIMEOUT_MS = 300_000; // 5분

// ─── Gemini ───
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });
// Imagen 4 used via REST API (no SDK model needed)

// ─── Timezone from coordinates (via geo-tz) ───
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

// ─── Reverse geocoding ───
async function getCityFromCoords(lat: number, lng: number, lang: string = 'en'): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${lang}&zoom=10`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JungChain/1.0' } });
    const data = await res.json() as any;
    return data.address?.city || data.address?.town || data.address?.county || data.address?.state || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ─── Korean city names ───
const KOREAN_CITIES: Record<number, string> = {
  12: '오클랜드', 11: '솔로몬 제도', 10: '시드니', 9: '서울', 8: '타이베이',
  7: '방콕', 6: '다카', 5: '이슬라마바드', 4: '두바이', 3: '모스크바',
  2: '카이로', 1: '파리', 0: '런던', '-1': '아조레스', '-2': '카보베르데',
  '-3': '리우', '-4': '카라카스', '-5': '뉴욕', '-6': '멕시코시티',
  '-7': 'LA', '-8': '샌프란시스코', '-9': '알래스카', '-10': '호놀룰루', '-11': '사모아',
};
function getKoreanCity(offset: number): string {
  return KOREAN_CITIES[offset] ?? getCity(offset);
}

// ─── Telegram (with retry) ───
async function sendTelegram(text: string, replyMarkup?: any): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const chunks: string[] = [];
  if (text.length > 4000) {
    for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  } else {
    chunks.push(text);
  }
  for (const chunk of chunks) {
    const payload: any = { chat_id: TELEGRAM_CHAT_ID, text: chunk };
    if (replyMarkup && chunk === chunks[chunks.length - 1]) payload.reply_markup = replyMarkup;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.text();
        if (!res.ok) console.error(`❌ Telegram error: ${res.status} ${body}`);
        else {
          const json = JSON.parse(body);
          console.log(`  📨 Sent OK → msg ${json.result?.message_id}`);
        }
        break;
      } catch (err: any) {
        console.error(`  ⚠️ Send attempt ${attempt + 1}/3 failed: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
        else console.error(`  ❌ Send failed after 3 attempts, skipping`);
      }
    }
  }
}

async function sendTelegramPhoto(photoUrl: string, caption?: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const payload: any = { chat_id: TELEGRAM_CHAT_ID, photo: photoUrl };
  if (caption) payload.caption = caption;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.text();
      if (!res.ok) console.error(`❌ Telegram photo error: ${res.status} ${body}`);
      else {
        const json = JSON.parse(body);
        console.log(`  📸 Photo sent → msg ${json.result?.message_id}`);
      }
      break;
    } catch (err: any) {
      console.error(`  ⚠️ Photo send attempt ${attempt + 1}/3 failed: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Safe fetch for getUpdates ───
async function safeFetchUpdates(url: string): Promise<any[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await res.json() as any;
      return data.result ?? [];
    } catch (err: any) {
      console.error(`  ⚠️ getUpdates attempt ${attempt + 1}/3 failed: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return [];
}

let lastUpdateId = 0;

async function clearPendingUpdates(): Promise<void> {
  const updates = await safeFetchUpdates(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1&limit=1`
  );
  if (updates.length > 0) lastUpdateId = updates[updates.length - 1].update_id + 1;
}

// ─── Get largest photo file_id from Telegram message ───
function getLargestPhoto(msg: any): string | null {
  if (!msg?.photo || msg.photo.length === 0) return null;
  // photo array is sorted by size, last = largest
  return msg.photo[msg.photo.length - 1].file_id;
}

// ─── Download photo from Telegram → base64 ───
async function getPhotoBase64(fileId: string): Promise<string> {
  // Get file path
  const fileRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json() as any;
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error('Could not get file path');

  // Download file
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const imgRes = await fetch(downloadUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return buffer.toString('base64');
}

// ─── AI: Validate photo matches mission ───
async function validatePhoto(photoBase64: string, mission: string): Promise<{ valid: boolean; status: 'pass' | 'mission_fail' | 'safety_fail'; description: string; userMessage: string }> {
  try {
    const result = await model.generateContent({
      systemInstruction: `You are a photo validator for a fun photo relay game. Check TWO things:

1. SAFETY CHECK (strict):
   - Personal info visible? (ID cards, credit cards, documents with names/numbers, license plates)
   - Faces clearly identifiable? (close-up portraits — crowd/distant faces are OK)
   - NSFW content? (nudity, violence, drugs, weapons)
   If ANY safety issue: status="safety_fail"

2. MISSION CHECK (lenient):
   - Does the photo reasonably match the mission?
   - Be generous — creative interpretations are welcome!
   If doesn't match: status="mission_fail"

3. If both pass: status="pass"

Respond in JSON:
{
  "status": "pass" | "mission_fail" | "safety_fail",
  "description": "brief description of what you see in English",
  "userMessage": "friendly Korean message to the user (1-2 sentences, casual 반말, warm tone)"
}

userMessage examples:
- pass: "오 빨간 우체통이다! 센스 좋은데? ✨"
- mission_fail: "음... 빨강이 잘 안 보여! 주변에 빨간 거 없어? 다시 한번 찾아보자 📸"
- safety_fail: "앗, 개인정보가 보이는 것 같아! 혹시 카드나 신분증이 찍혔으면 다른 걸로 보내줘 🙏"`,
      contents: [{
        role: 'user',
        parts: [
          { text: `Mission: "${mission}". Validate this photo.` },
          { inlineData: { mimeType: 'image/jpeg', data: photoBase64 } },
        ],
      }],
    });
    const text = result.response.text().trim();
    const json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```/g, ''));
    return {
      valid: json.status === 'pass',
      status: json.status || 'pass',
      description: json.description || '',
      userMessage: json.userMessage || '',
    };
  } catch (err: any) {
    console.error(`  ⚠️ Validation error: ${err.message}`);
    return { valid: true, status: 'pass', description: '(validation failed, accepting)', userMessage: '' };
  }
}

// ─── AI: Generate actual image via Gemini ───
async function generateImage(description: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: `Casual phone photo, slightly imperfect: ${description}. Shot on smartphone, natural lighting, everyday life moment.` }],
          parameters: { sampleCount: 1, aspectRatio: ['1:1', '3:4', '4:3', '9:16'][Math.floor(Math.random() * 4)] },
        }),
      }
    );
    const data = await res.json() as any;
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err: any) {
    console.error(`  ⚠️ Image generation failed: ${err.message}`);
    return null;
  }
}

// ─── Send photo buffer to Telegram ───
async function sendTelegramPhotoBuffer(imageBuffer: Buffer, caption?: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const formData = new FormData();
  formData.append('chat_id', TELEGRAM_CHAT_ID);
  formData.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'photo.png');
  if (caption) formData.append('caption', caption);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', body: formData, signal: AbortSignal.timeout(30000) });
      const body = await res.text();
      if (!res.ok) console.error(`❌ Photo send error: ${res.status} ${body}`);
      else {
        const json = JSON.parse(body);
        console.log(`  📸 Photo sent → msg ${json.result?.message_id}`);
      }
      break;
    } catch (err: any) {
      console.error(`  ⚠️ Photo send attempt ${attempt + 1}/3 failed: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── AI: Generate photo for virtual user (via Gemini image description) ───
async function generateVirtualPhoto(
  city: string,
  lang: string,
  mission: string,
  previousCaption: string | null,
  previousImage?: Buffer | null,
  blockIndex: number = 0,
): Promise<{ caption: string; imageDescription: string }> {
  const context = previousCaption ? `Previous user's caption: "${previousCaption}"` : 'This is the first photo in the chain.';
  
  const parts: any[] = [];
  
  // 직전 사진이 있으면 이미지로 전달
  if (previousImage) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: previousImage.toString('base64'),
      },
    });
    parts.push({ text: `📸 Mission: "${mission}"\nThis is the previous user's photo. You are #${blockIndex + 1} of 24 in the relay chain.\nLook at this photo, then respond with YOUR photo from ${city}. Write caption in ${lang}.` });
  } else {
    parts.push({ text: `📸 Mission: "${mission}"\nYou are #${blockIndex + 1} of 24 — the first in the chain!\nTake a quick phone photo from your everyday life in ${city}. Write caption in ${lang}.` });
  }

  const result = await model.generateContent({
    systemInstruction: `You are an ordinary person living in ${city}, participating in a photo relay chain.
Mission: "${mission}"
${context}

Your personality type (FOLLOW THIS): ${['lazy texter — super short caption, 3-5 words max, maybe just an emoji. Like a local young person who barely types.', 'enthusiastic local — 1-2 sentences, excited tone, uses local slang or expressions natural to ' + city, 'chill local — one casual sentence, no exclamation marks, dry humor typical of ' + city + ' culture', 'storyteller local — 2-3 sentences, shares a small personal story connected to daily life in ' + city][Math.floor(Math.random() * 4)]}

Write caption in ${lang}, matching your personality type above.
Also describe the photo in English for image generation. IMPORTANT: describe a CASUAL, EVERYDAY phone photo — not professional. Think:
- ${['close-up of an everyday object typical in ' + city + ', on a messy desk/table', 'something spotted while walking in a normal ' + city + ' neighborhood, slightly blurry', 'a quick snap of local food/drink from ' + city + ', fingers visible', 'an ordinary object at a typical home in ' + city + ', normal indoor lighting'][Math.floor(Math.random() * 4)]}
- Imperfect framing, real life

Respond in JSON: {"caption": "your caption in ${lang}", "imageDescription": "casual phone photo description in English"}
No markdown.`,
    contents: [{
      role: 'user',
      parts,
    }],
  });
  try {
    const text = result.response.text().trim();
    const json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```/g, ''));
    return json;
  } catch {
    return {
      caption: `📸 ${city}`,
      imageDescription: `A photo from ${city} showing something ${MISSION_KEYWORD}`,
    };
  }
}

// ─── Onboarding: 위치 공유 ───
async function requestLocation(): Promise<{ lat: number; lng: number; tz: number } | null> {
  console.log('📍 Requesting location...');
  await sendTelegram(
    `🌏 정체인 — 포토 릴레이\n\n` +
    `오늘의 미션: "${MISSION}"\n\n` +
    `네가 있는 곳에서 시작할 거야.\n` +
    `위치를 공유해줘. 📍`,
    { keyboard: [[{ text: '📍 위치 공유', request_location: true }]], one_time_keyboard: true, resize_keyboard: true }
  );

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const updates = await safeFetchUpdates(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=5`
    );
    for (const update of updates) {
      lastUpdateId = update.update_id + 1;
      const msg = update.message;
      if (msg?.chat?.id === Number(TELEGRAM_CHAT_ID) && msg?.location) {
        const { latitude: lat, longitude: lng } = msg.location;
        const tz = timezoneFromLocation(lat, lng);
        const userName = msg.from?.first_name || 'stranger';
        const userLang = msg.from?.language_code || 'en';
        const realCity = await getCityFromCoords(lat, lng, userLang.startsWith('ko') ? 'ko' : userLang);
        console.log(`  📍 ${realCity} (UTC${tz >= 0 ? '+' : ''}${tz})`);
        await sendTelegram(
          `📸 ${userName}, ${realCity}!\n\n` +
          `네가 첫 주자야.\n` +
          `카메라 준비해.`,
          { remove_keyboard: true }
        );
        return { lat, lng, tz };
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  await sendTelegram('⏰ 시간 초과!', { remove_keyboard: true });
  return null;
}

// ─── Wait for human photo ───
async function waitForHumanPhoto(previousCaption: string | null): Promise<{ fileId: string; caption: string } | null> {
  let prompt = `📸 오늘의 미션\n\n"${MISSION}"\n\n`;
  if (previousCaption) {
    prompt += `이전 도시의 캡션: "${previousCaption}"\n\n`;
    prompt += `사진을 찍어서 보내줘! 캡션도 같이 적어도 좋아.\n⏱ 5분`;
  } else {
    prompt += `네가 첫 번째야. 이 사진이 지구를 한 바퀴 돌게 돼.\n찍어서 보내줘! 캡션도 같이 적어도 좋아.\n⏱ 5분`;
  }
  await sendTelegram(prompt);

  const deadline = Date.now() + HUMAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const updates = await safeFetchUpdates(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=5`
    );
    for (const update of updates) {
      lastUpdateId = update.update_id + 1;
      const msg = update.message;
      if (msg?.chat?.id === Number(TELEGRAM_CHAT_ID)) {
        const photoId = getLargestPhoto(msg);
        if (photoId) {
          const caption = msg.caption || '';
          console.log(`  📸 Human photo received (caption: ${caption.slice(0, 40)}...)`);

          // Validate photo
          console.log('  🔍 Validating photo...');
          const photoBase64 = await getPhotoBase64(photoId);
          const validation = await validatePhoto(photoBase64, MISSION);
          console.log(`  🔍 Valid: ${validation.valid} — ${validation.description}`);

          if (validation.valid) {
            const msg = validation.userMessage || '미션 통과!';
            await sendTelegram(`✅ ${msg}\n\n✈️ 네 사진이 다음 도시로 떠났어.`);
            return { fileId: photoId, caption };
          } else if (validation.status === 'safety_fail') {
            const msg = validation.userMessage || '앗, 개인정보가 보이는 것 같아! 다른 사진으로 보내줘 🙏';
            await sendTelegram(`🛡️ ${msg}`);
            // 다시 대기 (deadline은 유지)
          } else {
            const msg = validation.userMessage || '미션이랑 좀 다른 것 같아! 다시 찍어볼래?';
            await sendTelegram(`📸 ${msg}`);
            // 다시 대기 (deadline은 유지)
          }
        }
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('  ⏰ Human photo timeout');
  await sendTelegram('⏰ 시간이 지나서, 정지기가 대신 찍었어.\n다음 체인에서 다시 만나.');
  return null;
}

// ─── Build timezone order starting from user's timezone ───
function buildOffsets(startTz: number): number[] {
  // 서쪽으로 진행 (시간이 이른 쪽으로)
  const all = Array.from({ length: 24 }, (_, i) => 12 - i); // +12 to -11
  const startIdx = all.indexOf(startTz);
  if (startIdx === -1) return all;
  return [...all.slice(startIdx), ...all.slice(0, startIdx)];
}

// ─── Main ───
async function run() {
  console.log('🌏 정체인 Photo Relay 시작');
  console.log(`📸 Mission: ${MISSION}`);
  console.log(`📡 Model: ${MODEL_NAME}`);
  console.log(`💬 Chat: ${TELEGRAM_CHAT_ID}`);
  console.log('');

  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.error('❌ TELEGRAM_BOT_TOKEN required'); process.exit(1);
  }
  if (!GOOGLE_API_KEY) {
    console.error('❌ GOOGLE_API_KEY required'); process.exit(1);
  }

  await clearPendingUpdates();

  // ─── 온보딩 ───
  const userLocation = await requestLocation();
  if (!userLocation) return;

  // ─── 타임존 순서: 유저 위치에서 시작 ───
  const offsets = buildOffsets(userLocation.tz);
  console.log(`🌏 Chain order: ${offsets.map(o => `UTC${o >= 0 ? '+' : ''}${o}`).join(' → ')}`);

  const photos: { offset: number; city: string; caption: string; fileId?: string; imageDesc?: string; imageBuffer?: Buffer }[] = [];
  const startTime = Date.now();

  // ─── 로컬 저장 디렉토리 ───
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const saveDir = path.join(process.cwd(), 'data', 'relay-photos', runId);
  fs.mkdirSync(saveDir, { recursive: true });
  console.log(`💾 Saving photos to ${saveDir}`);

  for (let i = 0; i < 24; i++) {
    const offset = offsets[i]!;
    const city = getCity(offset);
    const isAi = AI_GAPS.has(offset);
    const isHuman = HUMAN_OFFSETS.has(offset);
    const lang = TZ_LANGUAGES[offset] ?? 'English';
    const korCity = getKoreanCity(offset);
    const blockNum = String(i).padStart(2, '0');
    const isLast = i === 23;
    const previousCaption = photos.length > 0 ? photos[photos.length - 1].caption : null;

    console.log(`[${blockNum}/24] ${city}...`);
    const genStart = Date.now();

    if (isHuman) {
      // ─── JB의 차례 ───
      // 이전 사진 보여주기
      if (photos.length > 0) {
        const prev = photos[photos.length - 1];
        if (prev.fileId) {
          await sendTelegramPhoto(prev.fileId, `📸 ${getKoreanCity(prev.offset)}에서 온 사진\n"${prev.caption}"`);
        } else if (prev.imageDesc) {
          await sendTelegram(`📸 ${getKoreanCity(prev.offset)}: ${prev.caption}\n(🖼 ${prev.imageDesc})`);
        }
      }

      const result = await waitForHumanPhoto(previousCaption);
      if (result) {
        photos.push({ offset, city, caption: result.caption || '📸', fileId: result.fileId });
        // 로컬 저장: Human 사진 다운로드
        try {
          const photoBase64 = await getPhotoBase64(result.fileId);
          fs.writeFileSync(path.join(saveDir, `${blockNum}-${city.replace(/\//g, '-')}.jpg`), Buffer.from(photoBase64, 'base64'));
          fs.writeFileSync(path.join(saveDir, `${blockNum}-${city.replace(/\//g, '-')}.json`), JSON.stringify({ offset, city, caption: result.caption, lang: '한국어' }, null, 2));
        } catch (e) { console.log(`  ⚠️ Save failed: ${e}`); }
      } else {
        // AI fallback
        const prevImg = photos.length > 0 ? photos[photos.length - 1].imageBuffer : null;
        const virtual = await generateVirtualPhoto(city, '한국어', MISSION, previousCaption, prevImg, i);
        photos.push({ offset, city, caption: virtual.caption, imageDesc: virtual.imageDescription });
      }
    } else {
      // ─── AI 유저 or 정지기 ───
      const prevImage = photos.length > 0 ? photos[photos.length - 1].imageBuffer : null;
      const virtual = await generateVirtualPhoto(
        city,
        isAi ? 'English' : lang,
        MISSION,
        previousCaption,
        prevImage,
        i,
      );
      // 실제 이미지 생성
      console.log(`  🎨 Generating image: ${virtual.imageDescription.slice(0, 60)}...`);
      const imageBuffer = await generateImage(virtual.imageDescription);
      if (imageBuffer) {
        photos.push({ offset, city, caption: virtual.caption, imageBuffer });
        // 로컬 저장
        fs.writeFileSync(path.join(saveDir, `${blockNum}-${city.replace(/\//g, '-')}.jpg`), imageBuffer);
        fs.writeFileSync(path.join(saveDir, `${blockNum}-${city.replace(/\//g, '-')}.json`), JSON.stringify({ offset, city, caption: virtual.caption, imageDesc: virtual.imageDescription, lang }, null, 2));
      } else {
        photos.push({ offset, city, caption: virtual.caption, imageDesc: virtual.imageDescription });
      }
      console.log(`  📸 ${virtual.caption.slice(0, 50)}... (${((Date.now() - genStart) / 1000).toFixed(1)}s)`);

      // ─── 진행 리포트 (텍스트만, 사진 없음) ───
      if (i === 1) {
        await sendTelegram(`✈️ 네 사진이 다음 도시로 떠났어.\n🌍 네 사진이 ${korCity}에 도착했어.`);
      } else if (i % 5 === 0 && i > 0) {
        await sendTelegram(`🌍 사진이 ${korCity}을 지나는 중... (${i}/24)`);
      } else if (i === 22) {
        await sendTelegram(`🌍 거의 다 왔어! ${korCity}까지.`);
      }
    }

    // 블록 간 대기
    if (!isLast && !isHuman) {
      await new Promise(r => setTimeout(r, BLOCK_INTERVAL_MS));
    }
  }

  // ─── 완주 ───
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n✅ 정체인 포토 릴레이 완주! ${elapsed}초`);

  // 완주 메시지 (간결하게)
  await sendTelegram(`✅ 정체인 포토 릴레이 완주!\n\n📸 미션: "${MISSION}"\n🌏 24개 도시, 24장의 사진, 하나의 미션.\n⏱ ${elapsed}초 | 지구 한 바퀴`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
