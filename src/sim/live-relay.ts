#!/usr/bin/env npx tsx
/**
 * 정체인 (Jung Chain) — Live Relay
 * 독립 실행: npm run chain:live
 * 시뮬레이션 돌리고 텔레그램에 직접 전송
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCity, TZ_LANGUAGES, config } from '../config.js';
import { find as findTz } from 'geo-tz';
import { ethers } from 'ethers';
import { makeChainId, recordBlock, mintSoulbound, explorerUrl, isChainCompleted } from '../onchain.js';

function wallet_address(): string {
  return process.env.DEPLOYER_ADDRESS || '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1';
}

// ─── Config ───
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5023569703'; // JB DM default
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const BLOCK_INTERVAL_MS = Number(process.env.BLOCK_INTERVAL_MS || '5000'); // 5초 기본 (생성 자체가 ~20초)
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

// ─── Timezone flags ───
const TZ_FLAGS: Record<number, string> = {
  12: '🇳🇿', 11: '🇸🇧', 10: '🇦🇺', 9: '🇰🇷', 8: '🇹🇼', 7: '🇹🇭',
  6: '🇧🇩', 5: '🇵🇰', 4: '🇦🇪', 3: '🇷🇺', 2: '🇪🇬', 1: '🇫🇷',
  0: '🇬🇧', '-1': '🇵🇹', '-2': '🌊', '-3': '🇧🇷', '-4': '🇺🇸',
  '-5': '🇺🇸', '-6': '🇺🇸', '-7': '🇺🇸', '-8': '🇺🇸', '-9': '🇺🇸',
  '-10': '🇺🇸', '-11': '🇼🇸',
};

// ─── Timezones without users (AI 정지기 fills) ───
const AI_GAPS = new Set([11, -1, -9]);

// ─── Virtual user profiles (simulated: name, emoji, location, language_code) ───
interface VirtualUser {
  name: string;
  emoji: string;
  lat: number;
  lng: number;
  lang_code: string; // telegram language_code
}
const VIRTUAL_USERS: Record<number, VirtualUser> = {
  12: { name: 'Aroha', emoji: '👩🏽', lat: -36.85, lng: 174.76, lang_code: 'mi' },        // Auckland
  // 11: AI 정지기 (Solomon Islands)
  10: { name: 'Liam', emoji: '👨🏼', lat: -33.87, lng: 151.21, lang_code: 'en' },         // Sydney
  9:  { name: 'JB', emoji: '👤', lat: 37.57, lng: 126.98, lang_code: 'ko' },              // Seoul
  8:  { name: '小雨', emoji: '👩🏻', lat: 25.03, lng: 121.57, lang_code: 'zh-hant' },     // Taipei
  7:  { name: 'Somchai', emoji: '👨🏽', lat: 13.76, lng: 100.50, lang_code: 'th' },       // Bangkok
  6:  { name: 'Priya', emoji: '👩🏾', lat: 22.57, lng: 88.36, lang_code: 'bn' },          // Dhaka→Kolkata
  5:  { name: 'Amir', emoji: '👨🏽', lat: 33.69, lng: 73.04, lang_code: 'ur' },           // Islamabad
  4:  { name: 'Fatima', emoji: '👩🏽', lat: 25.20, lng: 55.27, lang_code: 'ar' },         // Dubai
  3:  { name: 'Dmitri', emoji: '👨🏻', lat: 55.76, lng: 37.62, lang_code: 'ru' },         // Moscow
  2:  { name: 'Mariam', emoji: '👩🏽', lat: 30.04, lng: 31.24, lang_code: 'ar' },         // Cairo
  1:  { name: 'Camille', emoji: '👩🏼', lat: 48.86, lng: 2.35, lang_code: 'fr' },         // Paris
  0:  { name: 'Oliver', emoji: '👨🏼', lat: 51.51, lng: -0.13, lang_code: 'en' },         // London
  // -1: AI 정지기 (Azores)
  '-2': { name: 'João', emoji: '👨🏽', lat: -14.24, lng: -24.00, lang_code: 'pt' },       // Cape Verde
  '-3': { name: 'Lucas', emoji: '👨🏽', lat: -22.91, lng: -43.17, lang_code: 'pt' },      // Rio
  '-4': { name: 'Maria', emoji: '👩🏽', lat: 10.49, lng: -66.88, lang_code: 'es' },       // Caracas
  '-5': { name: 'Jake', emoji: '👨🏼', lat: 40.71, lng: -74.01, lang_code: 'en' },        // New York
  '-6': { name: 'Sofia', emoji: '👩🏽', lat: 19.43, lng: -99.13, lang_code: 'es' },       // Mexico City
  '-7': { name: 'Mike', emoji: '👨🏼', lat: 34.05, lng: -118.24, lang_code: 'en' },       // LA (MST)
  '-8': { name: 'Ashley', emoji: '👩🏼', lat: 37.77, lng: -122.42, lang_code: 'en' },     // SF
  // -9: AI 정지기 (Alaska)
  '-10': { name: 'Kai', emoji: '👨🏽', lat: 21.31, lng: -157.86, lang_code: 'en' },       // Honolulu
  '-11': { name: 'Tala', emoji: '👩🏽', lat: -13.83, lng: -171.76, lang_code: 'sm' },     // Apia
};

// ─── Timezone from coordinates (via geo-tz) ───
function timezoneFromLocation(lat: number, lng: number): number {
  const tzNames = findTz(lat, lng);
  if (tzNames.length === 0) return Math.round(lng / 15); // fallback
  // IANA timezone → UTC offset (current)
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tzNames[0], timeZoneName: 'shortOffset' });
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
  // "GMT+9" or "GMT-5" → number
  const match = tzPart.match(/GMT([+-]?\d+)/);
  return match ? parseInt(match[1], 10) : Math.round(lng / 15);
}

// ─── Reverse geocoding (Nominatim, free) ───
async function getCityFromCoords(lat: number, lng: number, lang: string = 'en'): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${lang}&zoom=10`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JungChain/1.0' },
    });
    const data = await res.json() as any;
    return data.address?.city || data.address?.town || data.address?.county || data.address?.state || getCity(Math.round(lng / 15));
  } catch {
    return getCity(Math.round(lng / 15));
  }
}

// ─── Korean city names (fallback for virtual users) ───
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

// ─── Human participation: UTC offset → wait for user input ───
const HUMAN_OFFSETS = new Set([9]); // Seoul/Tokyo = JB writes
const HUMAN_TIMEOUT_MS = 300_000; // 5분 대기

// ─── Gemini ───
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// ─── Telegram (with retry) ───
async function sendTelegram(text: string, replyMarkup?: any): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  // 텔레그램 4096자 제한 — 넘으면 분할 전송
  const chunks: string[] = [];
  if (text.length > 4000) {
    for (let i = 0; i < text.length; i += 4000) {
      chunks.push(text.slice(i, i + 4000));
    }
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
          signal: AbortSignal.timeout(15000), // 15초 타임아웃
        });
        const body = await res.text();
        if (!res.ok) {
          console.error(`❌ Telegram error: ${res.status} ${body}`);
        } else {
          const json = JSON.parse(body);
          console.log(`  📨 Sent OK → chat ${json.result?.chat?.id}, msg ${json.result?.message_id}`);
        }
        break; // 성공하면 루프 탈출
      } catch (err: any) {
        console.error(`  ⚠️ Telegram send attempt ${attempt + 1}/3 failed: ${err.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
        else console.error(`  ❌ Telegram send failed after 3 attempts, skipping`);
      }
    }
  }
}

// ─── Wait for human input via Telegram ───
let lastUpdateId = 0;

// ─── Safe fetch for Telegram getUpdates (with retry) ───
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

async function clearPendingUpdates(): Promise<void> {
  const updates = await safeFetchUpdates(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1&limit=1`
  );
  if (updates.length > 0) {
    lastUpdateId = updates[updates.length - 1].update_id + 1;
  }
}

// ─── Onboarding: 위치 공유 → 타임존 등록 ───
async function requestLocation(): Promise<{ lat: number; lng: number; tz: number } | null> {
  console.log('📍 Requesting location from user...');
  await sendTelegram(
    '🌏 정체인\n\n' +
    '지구 어딘가에서 시작된 이야기가\n' +
    '타임존을 따라 여행하고 있어.\n\n' +
    '네가 있는 곳까지 닿으려면,\n' +
    '네 위치가 필요해. 📍',
    {
      keyboard: [[{ text: '📍 위치 공유', request_location: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    }
  );

  const deadline = Date.now() + 120_000; // 2분 대기
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
        console.log(`  📍 Location: ${lat}, ${lng} → UTC${tz >= 0 ? '+' : ''}${tz}`);

        // 키보드 제거 + 확인 메시지
        const userName = msg.from?.first_name || 'stranger';
        const userLang = msg.from?.language_code || 'en';
        const realCity = await getCityFromCoords(lat, lng, userLang.startsWith('ko') ? 'ko' : userLang);
        console.log(`  🏙️ City: ${realCity} (lang: ${userLang})`);
        await sendTelegram(
          `🔥 ${userName}, ${realCity}.\n\n` +
          `이야기가 지금 지구를 돌고 있어.\n` +
          `네 시간이 오면, 알려줄게.`,
          { remove_keyboard: true }
        );
        return { lat, lng, tz };
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('  ⏰ Location request timeout');
  await sendTelegram('⏰ 시간 초과! /start 로 다시 시도해주세요.', { remove_keyboard: true });
  return null;
}

async function translateContext(previousMessages: string[], targetLang: string): Promise<string> {
  if (previousMessages.length === 0) return '(No story yet)';
  const context = previousMessages.join('\n');
  try {
    const result = await model.generateContent({
      systemInstruction: `너는 번역가야. 릴레이 소설의 각 블록을 ${targetLang}(으)로 번역해줘.
- 원문의 느낌과 뉘앙스를 살려서
- 각 블록 구분은 유지 ([도시] 형식)
- 번역만 출력. 설명 없이.`,
      contents: [{ role: 'user', parts: [{ text: `다음 릴레이 소설 내용을 ${targetLang}(으)로 번역해줘:\n\n${context}` }] }],
    });
    return result.response.text().trim();
  } catch (err: any) {
    console.error(`  ⚠️ Translation failed: ${err.message}`);
    return `(번역 실패 — 원문)\n${context}`;
  }
}

async function waitForHumanMessage(city: string, previousMessages: string[]): Promise<string> {
  // 이전 내용 한국어 번역해서 먼저 보여주기
  console.log('  🔄 Translating previous blocks to Korean...');
  const translated = await translateContext(previousMessages, '한국어');
  const cityCount = previousMessages.length;
  const firstCity = getKoreanCity(12);
  await sendTelegram(
    `📖 이야기가 도착했어.\n\n` +
    `${firstCity}에서 시작돼서 ${cityCount}개 도시를 건너왔어.\n` +
    `여기서부터는 네 이야기야.\n\n` +
    `${translated}\n\n` +
    `✍️ 선택지 하나를 고르고, 이야기를 이어서 써.\n마지막에 선택지 2개도 남겨줘. (150~300자)`
  );

  const deadline = Date.now() + HUMAN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const updates = await safeFetchUpdates(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=5`
    );

    for (const update of updates) {
      lastUpdateId = update.update_id + 1;
      const msg = update.message;
      if (
        msg?.chat?.id === Number(TELEGRAM_CHAT_ID) &&
        msg?.text &&
        !msg.text.startsWith('/')
      ) {
        console.log(`  ✍️ Human input: ${msg.text.slice(0, 60)}...`);
        await sendTelegram('✈️ 네 이야기가 떠났어.\n다음 도시에서 누군가가 읽고 있을 거야.');
        return msg.text;
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Timeout — fall back to AI
  console.log('  ⏰ Human timeout, falling back to AI');
  await sendTelegram('⏰ 시간이 지나서, 정지기가 대신 이어썼어.\n다음 체인에서 다시 만나.');
  return '';
}

// ─── AI Generation (선택 게임 방식) ───
const CHOICE_FORMAT = `

형식:
1. 이전 선택지가 있으면 하나를 골라서 시작
2. 스토리를 150~300자로 전개 (배경 묘사 최소화, 액션/대화/감정 위주)
3. 마지막에 선택지 2개 제시

출력 형식:
[선택: A 또는 B] (이전 선택지가 있을 때만)

(스토리 본문 150~300자)

A) (선택지 1)
B) (선택지 2)`;

async function generateUserMessage(
  previousMessages: string[],
  offset: number,
): Promise<string> {
  const city = getCity(offset);
  const lang = TZ_LANGUAGES[offset] ?? 'English';
  const context = previousMessages.slice(-5).join('\n');

  const result = await model.generateContent({
    systemInstruction: `너는 릴레이 소설에 참여하는 ${city}의 작가야.
- 반드시 ${lang}(으)로 써
- 이전 스토리를 읽고 자연스럽게 이어가
- 너의 도시/문화적 요소를 녹여
- 배경 묘사 최소화. 대화, 액션, 감정, 반전 위주.
${CHOICE_FORMAT}`,
    contents: [{
      role: 'user',
      parts: [{ text: `릴레이 소설 진행 중:\n${context}\n\n${lang}(으)로 이어써줘.` }],
    }],
  });

  return result.response.text()?.trim() || '...';
}

async function generateJungzigiMessage(
  previousMessages: string[],
  offset: number,
): Promise<string> {
  const city = getCity(offset);
  const context = previousMessages.slice(-5).join('\n');

  const result = await model.generateContent({
    systemInstruction: `너는 "정지기"야. 릴레이 소설이 끊기지 않도록 이어써.
- 이전 스토리의 흐름을 읽어
- ${city}의 분위기를 살짝 녹여
- 배경 묘사 최소화. 대화, 액션, 감정 위주.
${CHOICE_FORMAT}`,
    contents: [{
      role: 'user',
      parts: [{ text: `릴레이 소설 진행 중:\n${context}\n\n이어써줘.` }],
    }],
  });

  return result.response.text()?.trim() || '...';
}

// ─── Main ───
async function run() {
  console.log('🌏 정체인 Live Relay 시작');
  console.log(`📡 Model: ${MODEL_NAME}`);
  console.log(`⏱  Interval: ${BLOCK_INTERVAL_MS / 1000}s`);
  console.log(`💬 Chat: ${TELEGRAM_CHAT_ID}`);
  console.log('');

  // Validate
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.error('❌ TELEGRAM_BOT_TOKEN required in .env');
    process.exit(1);
  }
  if (!GOOGLE_API_KEY) {
    console.error('❌ GOOGLE_API_KEY required in .env');
    process.exit(1);
  }

  // Clear pending Telegram updates
  await clearPendingUpdates();

  // ─── 가입 플로우: 위치 공유 요청 ───
  const userLocation = await requestLocation();
  if (!userLocation) {
    console.log('❌ 위치 공유 실패, 종료');
    return;
  }
  console.log(`🌏 정체인 시작 — 유저 타임존: UTC${userLocation.tz >= 0 ? '+' : ''}${userLocation.tz}`);

  const messages: string[] = [];
  const offsets = Array.from({ length: 24 }, (_, i) => 12 - i);
  const startTime = Date.now();

  // ─── On-chain setup ───
  const now = new Date();
  const chainLabel = `${now.toISOString().slice(0, 10)}-${now.getHours()}h`;
  const chainId = makeChainId(chainLabel);
  let prevBlockHash = ethers.ZeroHash;
  const blockTxHashes: string[] = [];
  const ENABLE_ONCHAIN = process.env.ENABLE_ONCHAIN !== 'false'; // default ON
  console.log(`⛓️  Chain ID: ${chainLabel} (onchain: ${ENABLE_ONCHAIN})`);

  for (let i = 0; i < 24; i++) {
    const offset = offsets[i]!;
    const city = getCity(offset);
    const flag = TZ_FLAGS[offset] ?? '🌍';
    const isAi = AI_GAPS.has(offset);
    const lang = TZ_LANGUAGES[offset] ?? '';
    const blockNum = String(i).padStart(2, '0');
    const isLast = i === 23;

    console.log(`[${blockNum}/24] Generating ${city}...`);
    const genStart = Date.now();

    // Seoul 블록만 한국어 번역 보여줌 (다른 블록은 내부 처리만)
    // 실제 서비스에선 각 유저에게 자기 언어로 번역해서 보여주지만,
    // 데모에선 JB에게 Seoul 차례에만 번역본 전달

    let content: string;
    try {
      if (i === 0) {
        // First block: start the story
        const result = await model.generateContent({
          systemInstruction: `You are a novelist from Auckland. Write the opening scene of a relay novel.
- Write in English with NZ flavor (kia ora, bro, etc.)
- Romance/thriller genre. Hook the reader immediately.
- 150-300 characters. Minimal scenery, focus on action/dialogue.
- End with 2 choices (A/B)`,
          contents: [{ role: 'user', parts: [{ text: 'Start the relay novel. Auckland dawn, strong opening + 2 choices.' }] }],
        });
        content = result.response.text()?.trim() || '...';
      } else if (i === 23) {
        // Last block: end the story
        const context = messages.slice(-8).join('\n');
        const lang = TZ_LANGUAGES[offset] ?? 'English';
        const result = await model.generateContent({
          systemInstruction: `너는 Samoa의 작가야. 릴레이 소설의 마지막 장면을 써.
- ${lang}(으)로
- 이전 선택지 중 하나를 골라 시작
- 감동적인 결말. 여운이 남게.
- 150~300자. 선택지 없이 마무리.`,
          contents: [{ role: 'user', parts: [{ text: `릴레이 소설:\n${context}\n\n결말을 써줘. 선택지 없이 마무리.` }] }],
        });
        content = result.response.text()?.trim() || '...';
      } else if (HUMAN_OFFSETS.has(offset)) {
        // Wait for human input
        const humanInput = await waitForHumanMessage(city, messages);
        if (humanInput) {
          content = humanInput;
        } else {
          // Fallback to AI if timeout
          content = await generateUserMessage(messages, offset);
        }
      } else {
        content = isAi
          ? await generateJungzigiMessage(messages, offset)
          : await generateUserMessage(messages, offset);
      }
    } catch (err: any) {
      console.error(`  ❌ API error: ${err.message}`);
      content = '(메시지를 이어받아 조용히 전합니다)';
    }

    const genTime = ((Date.now() - genStart) / 1000).toFixed(1);
    const utcLabel = `UTC${offset >= 0 ? '+' : ''}${offset}`;
    const statusIcon = isLast ? '✅ ' : '';
    const user = VIRTUAL_USERS[offset];
    const userLabel = isAi ? '🤖 정지기' : user ? `${user.emoji} ${user.name}` : '🧑 ???';

    console.log(`  ${userLabel} ${content.slice(0, 60)}... (${genTime}s)`);

    // ─── Record on-chain ───
    if (ENABLE_ONCHAIN) {
      try {
        const result = await recordBlock(
          chainId,
          i,                    // slotIndex (0~23)
          content,              // message content → hashed on-chain
          prevBlockHash,        // link to previous block
          !isAi,                // isHuman
          isAi ? undefined : undefined, // participant address (0x0 for now)
        );
        prevBlockHash = result.blockHash;
        blockTxHashes.push(result.txHash);
      } catch (err: any) {
        console.error(`  ⛓️  On-chain error (continuing): ${err.message?.slice(0, 80)}`);
      }
    }

    // Save for context
    messages.push(`[${city}] ${content}`);

    // ─── 진행 상황 리포트 (유저 차례 전/후) ───
    const myIndex = offsets.indexOf(userLocation.tz);
    const korCity = getKoreanCity(offset);
    if (!HUMAN_OFFSETS.has(offset)) {
      // 내 차례 전: 첫 블록 + 직전 블록만
      if (i === 0) {
        await sendTelegram(`🌏 ${korCity}에서 이야기가 시작됐어.`);
      } else if (i === myIndex - 1) {
        await sendTelegram(`🌏 이야기가 ${korCity}까지 왔어. 거의 네 차례야.`);
      }
      // 내 차례 후: 매 5블록마다 + 마지막 직전
      if (i > myIndex && ((i - myIndex) % 5 === 0 || i === 22)) {
        await sendTelegram(`🌏 네 이야기가 ${korCity}에 도착했어.`);
      }
    }

    // ─── 완주 시 전체 결과 전송 ───
    if (isLast) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`\n✅ 정체인 완주! ${elapsed}초 | 🌏 지구 한 바퀴`);

      // On-chain completion report
      if (ENABLE_ONCHAIN && blockTxHashes.length > 0) {
        const humanCount = offsets.filter(o => !AI_GAPS.has(o)).length;
        const aiCount = AI_GAPS.size;
        const lastTx = blockTxHashes[blockTxHashes.length - 1];
        console.log(`⛓️  Chain completed on-chain! ${blockTxHashes.length} blocks, ${humanCount} humans, ${aiCount} AI`);
        
        await sendTelegram(
          `⛓️ 온체인 기록 완료!\n\n` +
          `• 블록 수: ${blockTxHashes.length}/24\n` +
          `• 인간: ${humanCount} | AI 정지기: ${aiCount}\n` +
          `• 네트워크: Base Sepolia\n` +
          `• 마지막 tx: ${explorerUrl(lastTx)}\n\n` +
          `Proof of 정 — 가장 긴 체인이 가장 많은 정.`
        );

        // Mint Soulbound NFT for deployer (demo — real service would mint per participant)
        try {
          const { tokenId, txHash } = await mintSoulbound(
            wallet_address(),
            chainId,
            offsets.indexOf(userLocation.tz), // user's slot
            24,                                // chain length
            humanCount,
          );
          await sendTelegram(
            `🎖️ Soulbound NFT #${tokenId} 민팅 완료!\n\n` +
            `"나는 ${chainLabel} 체인의 일부였다"\n` +
            `전송 불가 — 정은 사고팔 수 없으니까.\n\n` +
            `${explorerUrl(txHash)}`
          );
        } catch (err: any) {
          console.error(`  🎖️ NFT mint error: ${err.message?.slice(0, 80)}`);
        }
      }

      console.log('🔄 Translating full story to Korean...');
      const fullTranslation = await translateContext(messages, '한국어');
      await sendTelegram(
        `✅ 정체인 완주!\n\n` +
        `24개 도시, 24명의 작가, 하나의 이야기.\n` +
        `지구 한 바퀴를 돌아 다시 돌아왔어.\n\n` +
        `📖 전체 이야기:\n\n${fullTranslation}`
      );
    }

    // Wait before next block (skip delay on last)
    if (!isLast) {
      await new Promise(r => setTimeout(r, BLOCK_INTERVAL_MS));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n✅ 완주! ${totalTime}s`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
