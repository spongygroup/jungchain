/**
 * 정봇 다국어 — ko/en 기본 + AI 동적 번역 + DB 캐시
 * 새 언어 요청 시 Gemini Flash로 번역 → DB 저장 → 다음엔 즉시
 */
import { getTranslation, setTranslation } from '../db/database.js';

// ─── Base strings (ko + en only) ───
const BASE: Record<string, Record<string, string>> = {
  ko: {
    welcome: '🌏 정(情)에 오신 걸 환영합니다, {name}님!\n\n당신의 이야기가 24개 타임존을 돌아 다시 돌아옵니다.\n\n📍 위치를 공유하면 타임존을 자동으로 설정해드려요.',
    share_location: '📍 위치 공유하기',
    checking_location: '📍 위치 확인 중...',
    confirm_city: '{name}님, 📍 **{city}** (UTC{sign}{offset}) 이 맞으신가요?',
    yes: '✅ 맞아요!',
    retry: '🔄 다시 공유할게요',
    retry_msg: '📍 위치를 다시 공유해주세요.',
    retry_btn: '아래 버튼을 눌러주세요:',
    pick_hour: '✅ {city} (UTC{sign}{offset})\n\n매일 몇 시에 정을 받으시겠어요?\n(현지 시간 기준)',
    pick_mode: '어떤 정을 시작할까요?',
    mode_text: '✍️ 텍스트',
    mode_story: '📖 릴레이 소설',
    mode_photo: '📸 포토 릴레이',
    setup_done: '🎉 설정 완료!\n\n👤 {name}\n📍 {city} (UTC{sign}{offset})\n⏰ 매일 {hour}:00에 정이 찾아옵니다\n\n정을 시작하려면 /new 를 입력하세요.',
    setup_first: '먼저 /start 로 설정해주세요!',
    new_chain: '🌏 새로운 정이 시작됩니다! (1/24)\n\n📍 {city}\n당신의 이야기를 적어주세요. ({max}자 이내)',
    new_story: '🌏 릴레이 소설이 시작됩니다! (1/24)\n\n📍 {city}\n첫 장면을 써주세요. 마지막에 선택지 2개(A/B)도 남겨주세요.\n({max}자 이내)',
    new_photo: '🌏 포토 릴레이가 시작됩니다! (1/24)\n\n📍 {city}\n📸 미션: {mission}\n\n사진을 찍어 보내주세요!',
    settings_msg: '{name}님, 설정을 변경합니다.\n📍 위치를 공유해주세요.',
    status_msg: '📊 내 정보\n\n👤 {name}\n📍 {city} (UTC{sign}{offset})\n⏰ 알림: 매일 {hour}:00\n🌏 진행 중인 정: {active}개',
    write: '✍️ 이어쓰기',
    skip: '⏭ 스킵',
    write_prompt: '✍️ {slot}/24\n\n이어서 적어주세요. ({max}자 이내)',
    story_prompt: '📖 {slot}/24 · {city}\n\n📍 이전 이야기:\n"{content}"\n\n이어서 써주세요. 마지막에 선택지 2개(A/B)도!\n({max}자 이내)',
    photo_prompt: '📸 {slot}/24 · {city}\n\n📍 이전 사진의 캡션:\n"{content}"\n\n미션: {mission}\n사진을 찍어 보내주세요!',
    photo_caption_ask: '📝 사진에 한 줄 캡션을 달아주세요!',
    photo_invalid: '⚠️ {reason}\n다시 보내주세요!',
    skipped: '⏭ 스킵했습니다.',
    too_long: '⚠️ {max}자 이내로 적어주세요! (현재 {len}자)',
    block_saved: '✅ {count}/24 · 당신의 글이 이어졌습니다!',
    block_saved_next: '✅ {count}/24 · 당신의 글이 이어졌습니다!\n🌏 정이 다음 타임존으로 이동합니다...',
    photo_saved: '✅ {count}/24 · 사진이 이어졌습니다!\n🌏 정이 다음 타임존으로 이동합니다...',
    arrived: '🌏 정이 도착했습니다! ({count}/24)\n\n📍 이전: {city}\n"{content}"\n\n⏰ 1시간 안에 이어쓰거나 스킵해주세요.',
    complete: '🏁 당신의 정이 지구를 돌아왔습니다!\n\n{count}명이 이어썼어요 · {cities}개 도시를 거쳤어요\n\n',
    chain_result: '🏁 정체인 완주!\n24개 도시, {count}명의 이야기.\n지구 한 바퀴를 돌아 다시 돌아왔어요.',
    onchain_recorded: '⛓️ 온체인 기록 완료!\n• 블록: {blocks}/24\n• 네트워크: Base Sepolia\n• tx: {url}',
    nft_minted: '🎖️ Soulbound NFT #{tokenId} 민팅 완료!\n"나는 이 정체인의 일부였다"\n{url}',
  },
  en: {
    welcome: '🌏 Welcome to 정(情), {name}!\n\nYour story will travel across 24 timezones and return to you.\n\n📍 Share your location to set your timezone automatically.',
    share_location: '📍 Share Location',
    checking_location: '📍 Checking location...',
    confirm_city: '{name}, is 📍 **{city}** (UTC{sign}{offset}) correct?',
    yes: '✅ Yes!',
    retry: '🔄 Try again',
    retry_msg: '📍 Please share your location again.',
    retry_btn: 'Press the button below:',
    pick_hour: '✅ {city} (UTC{sign}{offset})\n\nWhat time would you like to receive 정?\n(Local time)',
    pick_mode: 'What kind of 정 would you like to start?',
    mode_text: '✍️ Text',
    mode_story: '📖 Relay Novel',
    mode_photo: '📸 Photo Relay',
    setup_done: '🎉 Setup complete!\n\n👤 {name}\n📍 {city} (UTC{sign}{offset})\n⏰ 정 arrives daily at {hour}:00\n\nType /new to start a new chain.',
    setup_first: 'Please run /start first!',
    new_chain: '🌏 A new 정 begins! (1/24)\n\n📍 {city}\nWrite your story. ({max} chars max)',
    new_story: '🌏 A relay novel begins! (1/24)\n\n📍 {city}\nWrite the opening scene. End with 2 choices (A/B).\n({max} chars max)',
    new_photo: '🌏 A photo relay begins! (1/24)\n\n📍 {city}\n📸 Mission: {mission}\n\nTake a photo and send it!',
    settings_msg: '{name}, let\'s update your settings.\n📍 Please share your location.',
    status_msg: '📊 My Info\n\n👤 {name}\n📍 {city} (UTC{sign}{offset})\n⏰ Alert: daily at {hour}:00\n🌏 Active chains: {active}',
    write: '✍️ Write',
    skip: '⏭ Skip',
    write_prompt: '✍️ {slot}/24\n\nContinue the story. ({max} chars max)',
    story_prompt: '📖 {slot}/24 · {city}\n\n📍 Previous:\n"{content}"\n\nContinue the story. End with 2 choices (A/B)!\n({max} chars max)',
    photo_prompt: '📸 {slot}/24 · {city}\n\n📍 Previous caption:\n"{content}"\n\nMission: {mission}\nTake a photo and send it!',
    photo_caption_ask: '📝 Add a caption to your photo!',
    photo_invalid: '⚠️ {reason}\nPlease try again!',
    skipped: '⏭ Skipped.',
    too_long: '⚠️ Max {max} characters! (current: {len})',
    block_saved: '✅ {count}/24 · Your writing was added!',
    block_saved_next: '✅ {count}/24 · Your writing was added!\n🌏 정 moves to the next timezone...',
    photo_saved: '✅ {count}/24 · Photo added!\n🌏 정 moves to the next timezone...',
    arrived: '🌏 정 has arrived! ({count}/24)\n\n📍 From: {city}\n"{content}"\n\n⏰ Write or skip within 1 hour.',
    complete: '🏁 Your 정 has traveled the world!\n\n{count} people contributed · {cities} cities visited\n\n',
    chain_result: '🏁 Chain complete!\n24 cities, {count} stories.\nAround the world and back to you.',
    onchain_recorded: '⛓️ Recorded on-chain!\n• Blocks: {blocks}/24\n• Network: Base Sepolia\n• tx: {url}',
    nft_minted: '🎖️ Soulbound NFT #{tokenId} minted!\n"I was part of this 정 chain"\n{url}',
  },
};

// ─── Language name mapping for AI translation prompt ───
const LANG_NAMES: Record<string, string> = {
  ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese',
  th: 'Thai', ru: 'Russian', fr: 'French', es: 'Spanish',
  pt: 'Portuguese', ar: 'Arabic', de: 'German', it: 'Italian',
  hi: 'Hindi', bn: 'Bengali', ur: 'Urdu', tr: 'Turkish',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', uk: 'Ukrainian',
  pl: 'Polish', nl: 'Dutch', sv: 'Swedish', fi: 'Finnish',
  da: 'Danish', no: 'Norwegian', he: 'Hebrew', fa: 'Persian',
  sw: 'Swahili', fil: 'Filipino', my: 'Burmese', km: 'Khmer',
  lo: 'Lao', el: 'Greek', bg: 'Bulgarian', ro: 'Romanian',
  hr: 'Croatian', sr: 'Serbian', sk: 'Slovak', cs: 'Czech',
  hu: 'Hungarian', et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian',
  ka: 'Georgian', hy: 'Armenian', az: 'Azerbaijani', uz: 'Uzbek',
  kk: 'Kazakh', mn: 'Mongolian', ne: 'Nepali', si: 'Sinhala',
  am: 'Amharic',
};

function getLangName(code: string): string {
  return LANG_NAMES[code] ?? LANG_NAMES[code.split('-')[0]] ?? code;
}

// ─── AI Translation (Gemini Flash) ───
let translateFn: ((text: string, targetLang: string) => Promise<string>) | null = null;

async function aiTranslate(text: string, langCode: string): Promise<string> {
  if (!translateFn) {
    // Lazy load to avoid circular deps
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return text; // fallback to English
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    translateFn = async (t: string, lang: string) => {
      const result = await model.generateContent({
        systemInstruction: `You are a translator. Translate the following UI text to ${lang}.
- Keep all {placeholder} variables exactly as-is (e.g. {name}, {city}, {count})
- Keep all emoji exactly as-is
- Keep \\n line breaks exactly as-is
- Keep markdown formatting (**bold**, etc.) exactly as-is
- Output ONLY the translated text, nothing else.`,
        contents: [{ role: 'user', parts: [{ text: t }] }],
      });
      return result.response.text().trim();
    };
  }
  return translateFn(text, getLangName(langCode));
}

// ─── Main t() function ───
export function t(lang: string | undefined, key: string, vars: Record<string, any> = {}): string {
  const l = resolveLang(lang);

  // 1. Check base (ko/en)
  if (BASE[l]?.[key]) {
    return applyVars(BASE[l][key], vars);
  }

  // 2. Check DB cache
  const cached = getTranslation(l, key);
  if (cached) {
    return applyVars(cached, vars);
  }

  // 3. Fallback to English (always available)
  const enText = BASE.en[key] ?? key;

  // 4. If not ko/en, trigger async translation and return English for now
  if (l !== 'ko' && l !== 'en') {
    // Fire-and-forget: translate and cache for next time
    translateAndCache(l, key, enText).catch(() => {});
  }

  return applyVars(enText, vars);
}

// Async version — waits for translation (use for non-urgent messages)
export async function tAsync(lang: string | undefined, key: string, vars: Record<string, any> = {}): Promise<string> {
  const l = resolveLang(lang);

  // 1. Check base
  if (BASE[l]?.[key]) {
    return applyVars(BASE[l][key], vars);
  }

  // 2. Check DB cache
  const cached = getTranslation(l, key);
  if (cached) {
    return applyVars(cached, vars);
  }

  // 3. English base
  const enText = BASE.en[key] ?? key;

  // 4. Translate now
  if (l !== 'ko' && l !== 'en') {
    const translated = await translateAndCache(l, key, enText);
    return applyVars(translated, vars);
  }

  return applyVars(enText, vars);
}

async function translateAndCache(lang: string, key: string, enText: string): Promise<string> {
  try {
    const translated = await aiTranslate(enText, lang);
    setTranslation(lang, key, translated);
    console.log(`  🌐 Translated [${key}] → ${lang}`);
    return translated;
  } catch (err: any) {
    console.error(`  🌐 Translation failed [${key}] → ${lang}: ${err.message}`);
    return enText;
  }
}

function applyVars(text: string, vars: Record<string, any>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function resolveLang(langCode: string | undefined): string {
  if (!langCode) return 'en';
  // Exact match for base
  if (BASE[langCode]) return langCode;
  // zh-hans, zh-hant → zh (but we don't have zh base anymore, treat as foreign)
  const short = langCode.split('-')[0];
  if (BASE[short]) return short;
  // Return the code as-is — will trigger AI translation
  return short;
}
