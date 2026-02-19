#!/usr/bin/env npx tsx
/**
 * 정봇 v7 — 타임존 릴레이
 * 모드: text | story | photo
 */
import 'dotenv/config';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import cron from 'node-cron';
import { config, getCity, getFlag } from './config.js';
import { t, resolveLang } from './services/i18n.js';
import { locationToOffset, reverseGeocode } from './services/geo.js';
import { validatePhoto as aiValidatePhoto, validateText, translateContent } from './services/ai.js';
import { sendText, deleteMessage, getPhotoBase64, getLargestPhotoId } from './services/telegram.js';
import { makeChainId, recordBlock, mintSoulbound, createOnchainChain, explorerUrl } from './services/onchain.js';
import { createWallet } from './services/wallet.js';
import { ethers } from 'ethers';
import db, {
  upsertUser, getUser, getUsersByNotifyHour, setUserWallet, updateCityI18n,
  createChain, getChain, getActiveChains, completeChain,
  addBlock, getLastBlock, getBlockCount, getAllBlocks,
  createAssignment, getPendingAssignment, updateAssignment,
  getExpiredAssignments, findNextChainForUser,
  findAllChainsForUser, getChainsForTzAtHour, getUsersByTzOffset,
  getChainsToDeliver, markDelivered,
  getUserNotifyHours, setUserNotifyHours, canChangeNotifyHours,
  incrementDailyStarts, getDailyStarts,
  blockExistsAtSlot, createForkChain, getExpiredActiveChains, getAllForksOfRoot,
} from './db/database.js';

// ─── Bot Init ───
if (!config.jungBotToken) {
  console.error('❌ JUNG_BOT_TOKEN not set');
  process.exit(1);
}
const bot = new Bot(config.jungBotToken);

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err.message ?? err);
});

// On-chain toggle
const ENABLE_ONCHAIN = process.env.ENABLE_ONCHAIN === 'true';

// Pending mission input (photo mode)
const pendingMission = new Map<number, { mode: string; city: string; localHour: number; now: string }>();
// Pending photo: waiting for description text after photo upload
const pendingPhoto = new Map<number, { photoId: string; chatId: number; assignmentId?: number; isNewChain: boolean }>();
// Track arrival message IDs per user (structured for selective cleanup)
const pendingArrivalMessages = new Map<number, { msg2Id: number | null; msg3Id: number | null; msg4Id: number | null }>();
// Track write-flow auxiliary message IDs (write prompt, caption prompt)
const pendingWriteMessages = new Map<number, number[]>();

function storeArrivalMessages(userId: number, msgIds: { msg2Id: number | null; msg3Id: number | null; msg4Id: number | null }) {
  pendingArrivalMessages.set(userId, msgIds);
}

function trackWriteMessage(userId: number, msgId: number) {
  const ids = pendingWriteMessages.get(userId) ?? [];
  ids.push(msgId);
  pendingWriteMessages.set(userId, ids);
}

// Skip: delete ALL arrival messages (photo included)
async function deleteArrivalMessages(userId: number) {
  const msgs = pendingArrivalMessages.get(userId);
  if (!msgs) return;
  pendingArrivalMessages.delete(userId);
  for (const msgId of [msgs.msg2Id, msgs.msg3Id, msgs.msg4Id]) {
    if (msgId) try { await bot.api.deleteMessage(userId, msgId); } catch { /* already deleted */ }
  }
}

// Write complete: keep sender info (msg2) + photo (msg3), remove buttons; delete msg4, write-flow messages
async function cleanupAfterWrite(userId: number) {
  const msgs = pendingArrivalMessages.get(userId);
  if (msgs) {
    pendingArrivalMessages.delete(userId);
    // Delete skip warning only (keep msg2 sender info)
    if (msgs.msg4Id) try { await bot.api.deleteMessage(userId, msgs.msg4Id); } catch {}
    // Remove buttons from photo message (keep photo + caption)
    if (msgs.msg3Id) try { await bot.api.editMessageReplyMarkup(userId, msgs.msg3Id, { reply_markup: { inline_keyboard: [] } }); } catch {}
  }
  // Delete write prompt + caption prompt
  const writeIds = pendingWriteMessages.get(userId);
  if (writeIds) {
    pendingWriteMessages.delete(userId);
    for (const msgId of writeIds) {
      try { await bot.api.deleteMessage(userId, msgId); } catch {}
    }
  }
}
// Track prevBlockHash per chain (in-memory, resets on restart)
const chainBlockHashes = new Map<number, string>();

function getLang(ctx: any): string {
  return resolveLang(ctx.from?.language_code);
}

// 17 target languages for city name pre-translation
const CITY_I18N_LANGS = ['ko', 'en', 'ja', 'zh', 'th', 'es', 'pt', 'fr', 'ar', 'ru', 'de', 'it', 'tr', 'hi', 'id', 'vi', 'uk'] as const;

// Language code → display name for translation API
const LANG_NAMES: Record<string, string> = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
  th: 'ภาษาไทย', es: 'Español', pt: 'Português', fr: 'Français',
  ar: 'العربية', ru: 'Русский', de: 'Deutsch', it: 'Italiano',
  tr: 'Türkçe', hi: 'हिन्दी', id: 'Bahasa Indonesia', vi: 'Tiếng Việt',
  uk: 'Українська',
};

// Pre-translate city name into 10 languages using reverseGeocode (lat/lon known)
async function buildCityI18nFromGeo(lat: number, lon: number): Promise<Record<string, string>> {
  const results = await Promise.all(
    CITY_I18N_LANGS.map(async (lang) => {
      const city = await reverseGeocode(lat, lon, lang);
      return [lang, city] as const;
    })
  );
  return Object.fromEntries(results);
}

// Pre-translate a fixed city name into 10 languages using AI translation
async function buildCityI18nFromName(cityName: string): Promise<Record<string, string>> {
  const results = await Promise.all(
    CITY_I18N_LANGS.map(async (lang) => {
      try {
        const translated = await translateContent([cityName], LANG_NAMES[lang]);
        return [lang, translated] as const;
      } catch {
        return [lang, cityName] as const;
      }
    })
  );
  return Object.fromEntries(results);
}

// getFlag imported from config.ts

// ─── Block timestamp helper (e.g. "2026.02.18 23:34 (UTC+9)") ───
function formatBlockTimestamp(createdAt: string, tzOffset: number): string {
  const utcTime = new Date(createdAt + (createdAt.endsWith('Z') ? '' : 'Z'));
  const localTime = new Date(utcTime.getTime() + tzOffset * 60 * 60 * 1000);
  const y = localTime.getUTCFullYear();
  const m = String(localTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(localTime.getUTCDate()).padStart(2, '0');
  const h = String(localTime.getUTCHours()).padStart(2, '0');
  const min = String(localTime.getUTCMinutes()).padStart(2, '0');
  const sign = tzOffset >= 0 ? '+' : '';
  return `${y}.${m}.${d} ${h}:${min} (UTC${sign}${tzOffset})`;
}

// ─── 12-hour time helper ───
function formatHour12(hour24: number): { ampm: string; hour12: number } {
  const h = ((hour24 % 24) + 24) % 24;
  const ampm = h < 12 ? '오전' : '오후';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { ampm, hour12 };
}

// ═══════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════

bot.command('start', async (ctx) => {
  const lang = getLang(ctx);
  const name = ctx.from?.first_name ?? 'Friend';
  await showMenu(ctx, lang, name);
});

// /menu command
bot.command('menu', async (ctx) => {
  const lang = getLang(ctx);
  const name = ctx.from?.first_name ?? 'Friend';
  await showMenu(ctx, lang, name);
});

async function showMenu(ctx: any, lang: string, name: string) {
  const kb = new InlineKeyboard()
    .text(t(lang, 'btn_new_chain'), 'menu:new')
    .row()
    .text(t(lang, 'btn_arrived'), 'menu:arrived')
    .row()
    .text(t(lang, 'btn_notify_settings'), 'menu:notify')
    .row()
    .text(t(lang, 'btn_my_chains'), 'menu:mychains');
  await ctx.reply(t(lang, 'start_menu', { name }), { reply_markup: kb });
}

// Track pending action before setup
const pendingAction = new Map<number, string>();
// Track lat/lon for city i18n after location confirm
const pendingLatLon = new Map<number, { lat: number; lon: number }>();

// Helper: require location setup, returns true if user needs setup
async function requireSetup(ctx: any, lang: string, action?: string): Promise<boolean> {
  const user = getUser(ctx.from!.id);
  if (user) return false;
  if (action) pendingAction.set(ctx.from!.id, action);
  const btnText = t(lang, 'share_location');
  const kb = new Keyboard().requestLocation(btnText).resized().oneTime();
  await ctx.reply(t(lang, 'setup_first'), { reply_markup: kb });
  return true;
}

// Location received → confirm city
bot.on('message:location', async (ctx) => {
  const { latitude, longitude } = ctx.message.location;
  const name = ctx.from?.first_name ?? 'Friend';
  const lang = getLang(ctx);
  const offset = locationToOffset(latitude, longitude);
  const city = await reverseGeocode(latitude, longitude, lang === 'ko' ? 'ko' : 'en');
  const sign = offset >= 0 ? '+' : '';
  pendingLatLon.set(ctx.from!.id, { lat: latitude, lon: longitude });

  const kb = new InlineKeyboard()
    .text(t(lang, 'yes'), `confirm_loc:${offset}:${encodeURIComponent(city)}`)
    .row()
    .text(t(lang, 'retry'), 'retry_loc');

  await ctx.reply(t(lang, 'checking_location'), { reply_markup: { remove_keyboard: true } });
  await ctx.reply(t(lang, 'confirm_city', { name, city, sign, offset }), { reply_markup: kb, parse_mode: 'Markdown' });
});

// Retry location
bot.callbackQuery('retry_loc', async (ctx) => {
  const lang = getLang(ctx);
  const kb = new Keyboard()
    .requestLocation(t(lang, 'share_location'))
    .resized().oneTime();
  await ctx.editMessageText(t(lang, 'retry_msg'));
  await ctx.reply(t(lang, 'retry_btn'), { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// Location confirmed → save user & show menu
bot.callbackQuery(/^confirm_loc:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const tzOffset = Number(parts[1]);
  const city = decodeURIComponent(parts.slice(2).join(':'));
  const from = ctx.from!;
  const lang = getLang(ctx);
  const defaultNotifyHour = 9;

  upsertUser(from.id, from.username, from.first_name, tzOffset, defaultNotifyHour, from.language_code, city);

  createWallet(from.id).then(({ address, isNew }) => {
    setUserWallet(from.id, address);
    console.log(`  🔑 Wallet ${isNew ? 'created' : 'restored'} for ${from.id}: ${address.slice(0, 10)}...`);
  }).catch(err => {
    console.error(`  🔑 Wallet failed for ${from.id}: ${err.message}`);
  });

  // Pre-translate city into 10 languages (async, non-blocking)
  const latLon = pendingLatLon.get(from.id);
  pendingLatLon.delete(from.id);
  if (latLon) {
    buildCityI18nFromGeo(latLon.lat, latLon.lon).then(cityI18n => {
      updateCityI18n(from.id, cityI18n);
      console.log(`  🌐 City i18n saved for ${from.id}: ${Object.keys(cityI18n).length} langs`);
    }).catch(err => {
      console.error(`  🌐 City i18n failed for ${from.id}: ${err.message}`);
    });
  }

  const sign = tzOffset >= 0 ? '+' : '';
  await ctx.editMessageText(
    t(lang, 'setup_done', { name: from.first_name, city, sign, offset: tzOffset, hour: defaultNotifyHour })
  );
  await ctx.answerCallbackQuery('🎉');

  // Show menu after setup
  await showMenu(ctx, lang, from.first_name);
});

// (hour picker removed — notify hour defaults to 9, changeable from menu)

// ═══════════════════════════════════════
// DEV: TEST ONBOARDING (skip location)
// ═══════════════════════════════════════

bot.command('devstart', async (ctx) => {
  const lang = getLang(ctx);
  const kb = new InlineKeyboard();
  // Show popular TZ options in rows of 4
  const tzList = [
    { label: '🇳🇿 +12 Auckland', offset: 12 },
    { label: '🇦🇺 +10 Sydney', offset: 10 },
    { label: '🇰🇷 +9 Seoul', offset: 9 },
    { label: '🇹🇼 +8 Taipei', offset: 8 },
    { label: '🇹🇭 +7 Bangkok', offset: 7 },
    { label: '🇦🇪 +4 Dubai', offset: 4 },
    { label: '🇷🇺 +3 Moscow', offset: 3 },
    { label: '🇫🇷 +1 Paris', offset: 1 },
    { label: '🇬🇧 0 London', offset: 0 },
    { label: '🇧🇷 -3 São Paulo', offset: -3 },
    { label: '🇺🇸 -5 Chicago', offset: -5 },
    { label: '🇺🇸 -8 LA', offset: -8 },
  ];
  for (let i = 0; i < tzList.length; i += 3) {
    for (const tz of tzList.slice(i, i + 3)) {
      kb.text(tz.label, `devtz:${tz.offset}`);
    }
    kb.row();
  }
  await ctx.reply('🧪 *Dev Mode* — Pick a timezone:', { reply_markup: kb, parse_mode: 'Markdown' });
});

bot.callbackQuery(/^devtz:/, async (ctx) => {
  const offset = Number(ctx.callbackQuery.data.split(':')[1]);
  const city = getCity(offset);
  const from = ctx.from!;
  const lang = getLang(ctx);
  const defaultNotifyHour = 9;

  upsertUser(from.id, from.username, from.first_name, offset, defaultNotifyHour, from.language_code, city);

  // Pre-translate city into 10 languages (async, non-blocking)
  buildCityI18nFromName(city).then(cityI18n => {
    updateCityI18n(from.id, cityI18n);
    console.log(`  🌐 City i18n saved for ${from.id}: ${Object.keys(cityI18n).length} langs`);
  }).catch(err => {
    console.error(`  🌐 City i18n failed for ${from.id}: ${err.message}`);
  });

  const sign = offset >= 0 ? '+' : '';
  await ctx.editMessageText(
    t(lang, 'setup_done', { name: from.first_name, city, sign, offset, hour: defaultNotifyHour })
  );
  await ctx.answerCallbackQuery('🎉');
  await showMenu(ctx, lang, from.first_name);
});

// ═══════════════════════════════════════
// START MENU CALLBACKS
// ═══════════════════════════════════════

// Track users waiting to create a new chain (content-first)
const pendingNewChain = new Set<number>();

bot.callbackQuery('menu:new', async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:new');

  // Daily start limit check (don't increment yet)
  const count = getDailyStarts(user.telegram_id);
  if (count >= config.maxDailyStarts) {
    return ctx.reply(t(lang, 'daily_limit_reached', { max: config.maxDailyStarts }));
  }

  const city = user.city || getCity(user.tz_offset);
  const name = ctx.from?.first_name ?? 'Friend';

  pendingNewChain.add(ctx.from!.id);
  await ctx.reply(t(lang, 'new_free', { city, name }));
});

bot.callbackQuery('menu:arrived', async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:arrived');

  // Get all pending assignments for this user (writing = already started, exclude)
  const assignments = db.prepare(
    "SELECT a.*, c.mode FROM assignments a JOIN chains c ON c.id = a.chain_id WHERE a.user_id = ? AND a.status = 'pending' ORDER BY a.assigned_at ASC"
  ).all(ctx.from!.id) as any[];

  if (assignments.length === 0) {
    return ctx.reply(t(lang, 'no_arrived'));
  }

  // Send header (same logic as rollNextChain)
  const now = new Date();
  const localNow = new Date(now.getTime() + user.tz_offset * 60 * 60 * 1000);
  const currentHour = localNow.getUTCHours();
  const { ampm, hour12 } = formatHour12(currentHour);
  const deadlineHour = (currentHour + 1) % 24;
  const dl = formatHour12(deadlineHour);
  const deadlineStr = `${dl.ampm} ${dl.hour12}시`;

  await ctx.reply(t(lang, 'arrival_header', {
    ampm, hour12, count: assignments.length, deadline: deadlineStr,
  }));

  // Send arrival UX for the first assignment
  const msgIds = await sendArrivalForAssignment(user, assignments[0], assignments.length, lang);
  storeArrivalMessages(ctx.from!.id, msgIds);
});

bot.callbackQuery('menu:notify', async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:notify');

  if (!canChangeNotifyHours(user.telegram_id)) {
    const currentHours = getUserNotifyHours(user.telegram_id);
    const hourStr = currentHours.length > 0
      ? currentHours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ')
      : '-';
    return ctx.reply(t(lang, 'notify_hours_cooldown_with_current', { hours: hourStr }));
  }

  await showNotifyHoursGrid(ctx, user.telegram_id, lang);
});

bot.callbackQuery('menu:mychains', async (ctx) => {
  await ctx.answerCallbackQuery();
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:mychains');

  // Get all chains created by this user (active + completed)
  const myChains = db.prepare(
    "SELECT * FROM chains WHERE creator_id = ? ORDER BY created_at DESC"
  ).all(user.telegram_id) as any[];

  if (myChains.length === 0) {
    return ctx.reply(t(lang, 'my_chains_empty', { name: user.first_name ?? ctx.from?.first_name }));
  }

  const activeChains = myChains.filter(c => c.status === 'active');
  const completedChains = myChains.filter(c => c.status === 'completed');

  let text = t(lang, 'my_chains_header');

  if (activeChains.length > 0) {
    text += t(lang, 'my_chains_active_section');
    for (const chain of activeChains) {
      const count = getBlockCount(chain.id);
      const createdAt = new Date(chain.created_at + 'Z');
      const localCreated = new Date(createdAt.getTime() + user.tz_offset * 60 * 60 * 1000);
      const m = localCreated.getUTCMonth() + 1;
      const d = localCreated.getUTCDate();
      const h = localCreated.getUTCHours();
      const { ampm, hour12 } = formatHour12(h);
      const date = `${m}/${d} ${ampm} ${hour12}시`;
      text += t(lang, 'my_chain_item_active', { id: chain.id, count, date }) + '\n';
    }
  }

  if (completedChains.length > 0) {
    text += t(lang, 'my_chains_completed_section');
    for (const chain of completedChains) {
      const count = getBlockCount(chain.id);
      // Start date
      const createdAt = new Date(chain.created_at + 'Z');
      const localCreated = new Date(createdAt.getTime() + user.tz_offset * 60 * 60 * 1000);
      const sm = localCreated.getUTCMonth() + 1;
      const sd = localCreated.getUTCDate();
      const sh = localCreated.getUTCHours();
      const sf = formatHour12(sh);
      const startDate = `${sm}/${sd} ${sf.ampm} ${sf.hour12}시`;

      // End date: last block's created_at
      const lastBlockRow = db.prepare(
        'SELECT MAX(created_at) as last_at FROM blocks WHERE chain_id = ?'
      ).get(chain.id) as any;
      let endDate = startDate;
      if (lastBlockRow?.last_at) {
        const lastAt = new Date(lastBlockRow.last_at + 'Z');
        const localLast = new Date(lastAt.getTime() + user.tz_offset * 60 * 60 * 1000);
        const em = localLast.getUTCMonth() + 1;
        const ed = localLast.getUTCDate();
        const eh = localLast.getUTCHours();
        const ef = formatHour12(eh);
        endDate = `${em}/${ed} ${ef.ampm} ${ef.hour12}시`;
      }

      text += t(lang, 'my_chain_item_completed', { id: chain.id, count, startDate, endDate }) + '\n';
    }
  }

  await ctx.reply(text);
});

// ═══════════════════════════════════════
// NOTIFY HOURS GRID
// ═══════════════════════════════════════

async function showNotifyHoursGrid(ctx: any, telegramId: number, lang: string) {
  const hours = getUserNotifyHours(telegramId);
  const kb = new InlineKeyboard();

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const h = row * 4 + col;
      const isOn = hours.includes(h);
      const label = isOn ? `✅ ${h}` : `${h}`;
      kb.text(label, `nhr:${h}`);
    }
    kb.row();
  }
  kb.text(t(lang, 'notify_hours_done'), 'nhr:done');

  const text = t(lang, 'notify_hours_title');
  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch {
    await ctx.reply(text, { reply_markup: kb });
  }
}

bot.callbackQuery(/^nhr:(\d+)$/, async (ctx) => {
  const hour = Number(ctx.match![1]);
  const lang = getLang(ctx);
  const telegramId = ctx.from!.id;

  if (!canChangeNotifyHours(telegramId)) {
    return ctx.answerCallbackQuery(t(lang, 'notify_hours_cooldown'));
  }

  const hours = pendingNotifyHours.get(telegramId) ?? [...getUserNotifyHours(telegramId)];
  const idx = hours.indexOf(hour);
  if (idx >= 0) {
    hours.splice(idx, 1);
  } else {
    hours.push(hour);
    hours.sort((a, b) => a - b);
  }
  pendingNotifyHours.set(telegramId, hours);

  // Re-render grid with updated state
  const kb = new InlineKeyboard();
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const h = row * 4 + col;
      const isOn = hours.includes(h);
      const label = isOn ? `✅ ${h}` : `${h}`;
      kb.text(label, `nhr:${h}`);
    }
    kb.row();
  }
  kb.text(t(lang, 'notify_hours_done'), 'nhr:done');

  try {
    await ctx.editMessageText(t(lang, 'notify_hours_title'), { reply_markup: kb });
  } catch { /* unchanged */ }
  await ctx.answerCallbackQuery();
});

const pendingNotifyHours = new Map<number, number[]>();

bot.callbackQuery('nhr:done', async (ctx) => {
  const lang = getLang(ctx);
  const telegramId = ctx.from!.id;

  const hours = pendingNotifyHours.get(telegramId);
  if (hours) {
    setUserNotifyHours(telegramId, hours);
    pendingNotifyHours.delete(telegramId);
  }

  await ctx.editMessageText(t(lang, 'notify_hours_saved'));
  await ctx.answerCallbackQuery();
});

// ═══════════════════════════════════════
// CHAIN CREATION
// ═══════════════════════════════════════

bot.command('new', async (ctx) => {
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:new');

  const count = getDailyStarts(user.telegram_id);
  if (count >= config.maxDailyStarts) {
    return ctx.reply(t(lang, 'daily_limit_reached', { max: config.maxDailyStarts }));
  }

  const city = user.city || getCity(user.tz_offset);
  const name = ctx.from?.first_name ?? 'Friend';

  pendingNewChain.add(ctx.from!.id);
  await ctx.reply(t(lang, 'new_free', { city, name }));
});

// Helper: create chain on first content
function createChainFromContent(userId: number): { chainId: number; assignId: number; sameHour?: boolean } | null {
  const user = getUser(userId);
  if (!user) return null;

  const now = new Date();
  const localHour = ((now.getUTCHours() + user.tz_offset) % 24 + 24) % 24;

  // Check if user already created a chain this hour
  const lastChain = db.prepare(
    'SELECT created_at FROM chains WHERE creator_id = ? ORDER BY id DESC LIMIT 1'
  ).get(userId) as any;
  if (lastChain) {
    const lastTime = new Date(lastChain.created_at);
    const lastLocalHour = ((lastTime.getUTCHours() + user.tz_offset) % 24 + 24) % 24;
    const lastDate = lastTime.toISOString().split('T')[0];
    const todayDate = now.toISOString().split('T')[0];
    if (lastDate === todayDate && lastLocalHour === localHour) {
      return { chainId: 0, assignId: 0, sameHour: true };
    }
  }

  const { allowed } = incrementDailyStarts(userId);
  if (!allowed) return null;
  const chainId = createChain(userId, user.tz_offset, now.toISOString(), 'free', localHour);
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const assignId = createAssignment(userId, chainId, 1, expiresAt);

  pendingNewChain.delete(userId);
  return { chainId, assignId };
}

// ═══════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════

bot.command('settings', async (ctx) => {
  const lang = getLang(ctx);
  const name = ctx.from?.first_name ?? 'Friend';
  const kb = new Keyboard()
    .requestLocation(t(lang, 'share_location'))
    .resized().oneTime();
  await ctx.reply(t(lang, 'settings_msg', { name }), { reply_markup: kb });
});

bot.command('status', async (ctx) => {
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return requireSetup(ctx, lang, 'menu:status');
  const city = getCity(user.tz_offset);
  const sign = user.tz_offset >= 0 ? '+' : '';
  const activeChains = getActiveChains().length;
  await ctx.reply(t(lang, 'status_msg', {
    name: user.first_name ?? ctx.from?.first_name,
    city, sign, offset: user.tz_offset, hour: user.notify_hour, active: activeChains,
  }));
});

// ═══════════════════════════════════════
// INLINE BUTTONS: WRITE / SKIP
// ═══════════════════════════════════════

bot.callbackQuery(/^write:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const assignmentId = Number(parts[1]);
  const lang = getLang(ctx);
  const userId = ctx.from!.id;

  // Find the assignment by ID and mark as writing
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
  if (!assignment) return ctx.answerCallbackQuery('❌');
  updateAssignment(assignment.id, 'writing');

  const wpMsg = await ctx.reply(t(lang, 'write_prompt', { slot: assignment.slot_index, max: config.maxMessageLength }));
  trackWriteMessage(userId, wpMsg.message_id);
  await ctx.answerCallbackQuery();
});

// (fmt: callback removed — photo-only format)

bot.callbackQuery(/^skip:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const assignmentId = Number(parts[1]);
  const lang = getLang(ctx);
  const userId = ctx.from!.id;

  // Delete previous arrival messages
  await deleteArrivalMessages(userId);

  updateAssignment(assignmentId, 'skipped');
  await ctx.answerCallbackQuery('⏭');

  const user = getUser(userId);
  if (!user) return;

  // Check remaining pending assignments for this user
  const remaining = db.prepare(
    "SELECT a.*, c.mode FROM assignments a JOIN chains c ON c.id = a.chain_id WHERE a.user_id = ? AND a.status = 'pending' ORDER BY a.assigned_at ASC"
  ).all(userId) as any[];

  if (remaining.length === 0) {
    pendingArrivalMessages.delete(userId);
    await ctx.reply(t(lang, 'arrival_all_done'));
    return;
  }

  // Send messages 2,3,4 for the next assignment
  const nextAssign = remaining[0];
  const msgIds = await sendArrivalForAssignment(user, nextAssign, remaining.length, lang);
  storeArrivalMessages(userId, msgIds);
});

// ═══════════════════════════════════════
// TEXT / STORY INPUT
// ═══════════════════════════════════════

// /skip command — skip photo description
bot.command('skip', async (ctx) => {
  const userId = ctx.from!.id;
  const pending = pendingPhoto.get(userId);
  if (!pending) return;
  pendingPhoto.delete(userId);

  const lang = getLang(ctx);
  await processPhotoWithDescription(ctx, userId, pending, '', lang);
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  // Handle pending photo description
  const pending = pendingPhoto.get(userId);
  if (pending) {
    const lang = getLang(ctx);
    // Description length check
    if (text.length > 200) {
      return ctx.reply(t(lang, 'caption_too_long', { len: text.length }));
    }
    pendingPhoto.delete(userId);
    await processPhotoWithDescription(ctx, userId, pending, text, lang);
    return;
  }

  // Handle pending mission input (photo mode)
  const missionState = pendingMission.get(userId);
  if (missionState) {
    pendingMission.delete(userId);
    const lang = getLang(ctx);
    const user = getUser(userId);
    if (!user) return;

    const mission = text;
    const chainId = createChain(user.telegram_id, user.tz_offset, missionState.now, 'photo', missionState.localHour, mission);
    const expiresAt = new Date(new Date(missionState.now).getTime() + 60 * 60 * 1000).toISOString();
    const assignId = createAssignment(user.telegram_id, chainId, 1, expiresAt);

    await ctx.reply(t(lang, 'new_photo', { city: missionState.city, max: config.maxMessageLength, mission }));
    scheduleExpiry(assignId, userId, 60 * 60 * 1000);
    return;
  }

  // New chain: text-only not allowed, require photo
  if (pendingNewChain.has(userId)) {
    const lang = getLang(ctx);
    return ctx.reply(t(lang, 'photo_required'));
  }

  // Relay: text-only not allowed, require photo
  const assignment = getPendingAssignment(userId);
  if (!assignment) return;

  const lang = getLang(ctx);
  return ctx.reply(t(lang, 'photo_required'));
});

// ═══════════════════════════════════════
// PHOTO INPUT
// ═══════════════════════════════════════

bot.on('message:photo', async (ctx) => {
  const userId = ctx.from!.id;
  const lang = getLang(ctx);

  // New chain: store photo, ask for description
  if (pendingNewChain.has(userId)) {
    const photoId = getLargestPhotoId(ctx.message.photo);
    if (!photoId) return;

    pendingPhoto.set(userId, { photoId, chatId: ctx.chat.id, isNewChain: true });
    await ctx.reply(t(lang, 'photo_description_ask'));
    return;
  }

  // Relay: store photo, ask for description
  const assignment = getPendingAssignment(userId);
  if (!assignment) return;

  const photoId = getLargestPhotoId(ctx.message.photo);
  if (!photoId) return;

  pendingPhoto.set(userId, { photoId, chatId: ctx.chat.id, assignmentId: assignment.id, isNewChain: false });
  const capMsg = await ctx.reply(t(lang, 'photo_description_ask'));
  trackWriteMessage(userId, capMsg.message_id);
});

// Helper: process photo after description is received (or skipped)
async function processPhotoWithDescription(
  ctx: any, userId: number,
  pending: { photoId: string; chatId: number; assignmentId?: number; isNewChain: boolean },
  caption: string, lang: string,
) {
  const user = getUser(userId);
  if (!user) return;

  // Show validating message
  await ctx.reply(t(lang, 'validating_content'));

  // Validate photo
  const base64 = await getPhotoBase64(bot, pending.photoId);
  const mission = '';
  let jungzigiComment = '좋은 사진이네요! 📸';

  if (pending.isNewChain) {
    // New chain flow
    const validation = await aiValidatePhoto(base64, '');
    if (validation.status === 'safety_fail') {
      return ctx.reply(t(lang, 'content_blocked', { reason: validation.userMessage || '' }));
    }
    // Validate caption if present
    if (caption) {
      const textVal = await validateText(caption);
      if (!textVal.safe) {
        return ctx.reply(t(lang, 'content_blocked', { reason: textVal.reason || '' }));
      }
    }

    const result = createChainFromContent(userId);
    if (!result) return ctx.reply(t(lang, 'daily_limit_reached', { max: config.maxDailyStarts }));
    if (result.sameHour) return ctx.reply(t(lang, 'same_hour_limit'));

    addBlock(result.chainId, 1, userId, user.tz_offset, caption, pending.photoId, 'photo');
    updateAssignment(result.assignId, 'written');
    recordBlockOnchain(result.chainId, caption, user.tz_offset, userId).catch(() => {});

    const count = getBlockCount(result.chainId);
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: '정이 출발합니다! 🌏', count, fromCity: user.city || getCity(user.tz_offset), toCity }));
  } else {
    // Relay flow
    const assignment = pending.assignmentId
      ? db.prepare('SELECT * FROM assignments WHERE id = ?').get(pending.assignmentId) as any
      : getPendingAssignment(userId);
    if (!assignment) return;

    try {
      const validation = await aiValidatePhoto(base64, assignment.mission ?? '');
      jungzigiComment = validation.jungzigiComment || jungzigiComment;
      if (validation.status !== 'pass') {
        await ctx.reply(t(lang, 'jungzigi_fail', { comment: jungzigiComment }));
        return;
      }
    } catch (err: any) {
      console.error('Photo validation error:', err.message);
    }

    // Validate caption if present
    if (caption) {
      const textVal = await validateText(caption);
      if (!textVal.safe) {
        return ctx.reply(t(lang, 'content_blocked', { reason: textVal.reason || '' }));
      }
    }

    await savePhotoBlock(ctx, assignment, userId, user, pending.photoId, caption, lang, jungzigiComment);
  }
}

// Helper: save photo block + 정지기 response + progress (포크 감지 포함)
async function savePhotoBlock(
  ctx: any, assignment: any, userId: number, user: any,
  photoId: string, caption: string, lang: string, jungzigiComment: string,
) {
  let targetChainId = assignment.chain_id;

  // 포크 감지: 해당 슬롯에 이미 블록이 있으면 새 체인(포크) 생성
  if (blockExistsAtSlot(assignment.chain_id, assignment.slot_index)) {
    targetChainId = createForkChain(assignment.chain_id, assignment.slot_index, userId, user.tz_offset);
    console.log(`  🔀 Fork! chain #${assignment.chain_id} slot ${assignment.slot_index} → new chain #${targetChainId}`);
  }

  addBlock(targetChainId, assignment.slot_index, userId, user.tz_offset, caption, photoId, 'photo');
  updateAssignment(assignment.id, 'written');
  recordBlockOnchain(targetChainId, caption, user.tz_offset, userId).catch(() => {});

  const count = getBlockCount(targetChainId);
  const fromCity = getCity(user.tz_offset);

  if (count >= 24) {
    completeChain(targetChainId);
    await ctx.reply(t(lang, 'jungzigi_complete', { comment: jungzigiComment, count }));
  } else {
    // Calculate next TZ city
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: jungzigiComment, count, fromCity, toCity }));
  }

  // Clean up: keep photos, remove buttons, delete auxiliary messages
  await cleanupAfterWrite(userId);

  // Show next pending assignment (exclude writing/written/skipped)
  const remaining = db.prepare(
    "SELECT a.*, c.mode FROM assignments a JOIN chains c ON c.id = a.chain_id WHERE a.user_id = ? AND a.status = 'pending' ORDER BY a.assigned_at ASC"
  ).all(userId) as any[];

  if (remaining.length > 0) {
    const msgIds = await sendArrivalForAssignment(user, remaining[0], remaining.length, lang);
    storeArrivalMessages(userId, msgIds);
  }
}

// Caption after photo is now handled in the main text handler above (photo writing check)

// ═══════════════════════════════════════
// VOICE INPUT
// ═══════════════════════════════════════

bot.on('message:voice', async (ctx) => {
  const userId = ctx.from!.id;
  const lang = getLang(ctx);

  // Voice-only not allowed, require photo
  if (pendingNewChain.has(userId)) {
    return ctx.reply(t(lang, 'photo_required'));
  }

  const assignment = getPendingAssignment(userId);
  if (!assignment) {
    return ctx.reply(t(lang, 'photo_required'));
  }

  return ctx.reply(t(lang, 'photo_required'));
});

// ═══════════════════════════════════════
// HOURLY CRON
// ═══════════════════════════════════════

cron.schedule('0 * * * *', async () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  console.log(`⏰ Hourly cron: UTC ${utcHour}:00`);

  // 1) Expire old assignments
  const expired = getExpiredAssignments(now.toISOString());
  for (const a of expired) {
    updateAssignment(a.id, 'expired');
    if (a.message_id && a.chat_id) {
      await deleteMessage(bot, a.chat_id, a.message_id);
    }
  }

  // 1.5) 시간 기반 체인 완료: root의 start_utc + 24h 경과한 active 체인 종료
  const expiredChains = getExpiredActiveChains(now.toISOString());
  for (const chain of expiredChains) {
    completeChain(chain.id);
    console.log(`  ⏰ Time-expired chain #${chain.id} (${getBlockCount(chain.id)} blocks)`);
  }

  // 2) 완주된 체인 결과 전달 (chain_hour + 24h 지난 것)
  const toDeliver = getChainsToDeliver(now.toISOString());
  for (const chain of toDeliver) {
    try {
      await notifyChainComplete(chain.id);
      mintCompletionNFT(chain.id).catch(() => {});
      markDelivered(chain.id);
      console.log(`  📬 Delivered chain #${chain.id} result to creator`);
    } catch (e) {
      console.error(`  ❌ Failed to deliver chain #${chain.id}:`, e);
    }
  }

  // 3) notify_hour 기준: 유저가 설정한 시간에 대기 중인 체인 롤링 배정
  const users = getUsersByNotifyHour(utcHour);
  console.log(`  → ${users.length} users at notify_hour`);

  for (const user of users) {
    try {
      await rollNextChain(user);
    } catch (e) {
      console.error(`  ❌ Failed to notify user ${user.telegram_id}:`, e);
    }
  }
});

// ═══════════════════════════════════════
// EXPIRY / ROLLING / COMPLETION
// ═══════════════════════════════════════

function scheduleExpiry(assignmentId: number, chatId: number, delayMs: number) {
  setTimeout(async () => {
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
    if (!a || !['pending', 'writing'].includes(a.status)) return;
    updateAssignment(assignmentId, 'expired');
    if (a.message_id && a.chat_id) {
      await deleteMessage(bot, a.chat_id, a.message_id);
    }
  }, delayMs);
}

// ─── Arrival UX: send messages 2,3,4 for a single assignment ───
async function sendArrivalForAssignment(user: any, assignment: any, remaining: number, lang: string): Promise<{ msg2Id: number | null; msg3Id: number | null; msg4Id: number | null }> {
  const chain = getChain(assignment.chain_id);
  if (!chain) return { msg2Id: null, msg3Id: null, msg4Id: null };

  const lastBlock = getLastBlock(assignment.chain_id);
  const prevUserId = lastBlock ? lastBlock.user_id : chain.creator_id;
  const prevUser = getUser(prevUserId);
  const prevName = prevUser?.first_name ?? prevUser?.username ?? 'someone';
  const prevTzOffset = lastBlock ? lastBlock.tz_offset : chain.creator_tz;
  const prevFlag = getFlag(prevTzOffset);
  const rawCity = prevUser?.city ?? getCity(prevTzOffset);
  const rawCaption = lastBlock?.content ?? '';
  const targetLang = LANG_NAMES[lang] ?? (lang === 'ko' ? '한국어' : 'English');
  const slot = getBlockCount(assignment.chain_id);
  const chatId = user.telegram_id;

  // Use cached city_i18n if available, fallback to AI translation
  let cityI18nCache: Record<string, string> | null = null;
  if (prevUser?.city_i18n) {
    try { cityI18nCache = JSON.parse(prevUser.city_i18n); } catch {}
  }
  const cachedCity = cityI18nCache?.[lang];

  const [translatedCity, translatedCaption] = await Promise.all([
    cachedCity ? Promise.resolve(cachedCity) : translateContent([rawCity], targetLang).catch(() => rawCity),
    rawCaption ? translateContent([rawCaption], targetLang).catch(() => '') : Promise.resolve(''),
  ]);

  // Backfill city_i18n if cache miss (existing user without pre-translation)
  if (!cachedCity && translatedCity && prevUser) {
    const updated = cityI18nCache ?? {};
    updated[lang] = translatedCity;
    updateCityI18n(prevUser.telegram_id, updated);
  }

  const prevCity = `${prevFlag} ${translatedCity || rawCity}`;

  // Build caption with timestamp
  const timestamp = lastBlock ? `📷 ${formatBlockTimestamp(lastBlock.created_at, lastBlock.tz_offset)}` : '';
  let caption = rawCaption && translatedCaption && translatedCaption !== rawCaption
    ? `${rawCaption}\n\n${translatedCaption}`
    : rawCaption;
  if (timestamp) {
    caption = caption ? `${caption}\n\n${timestamp}` : timestamp;
  }

  // Message 2: sender info
  const msg2Id = await sendText(bot, chatId, t(lang, 'arrival_sender', { city: prevCity, name: prevName, slot }));

  const kb = new InlineKeyboard()
    .text('✍️ 정 이어가기', `write:${assignment.id}`)
    .text(`⏭ 스킵 (${remaining - 1})`, `skip:${assignment.id}`);

  let msg3Id: number | null = null;
  if (lastBlock?.media_type === 'photo' && lastBlock?.media_url) {
    try {
      const sent = await bot.api.sendPhoto(chatId, lastBlock.media_url, {
        caption: caption || undefined,
        reply_markup: kb,
      });
      msg3Id = sent.message_id;
    } catch (e) {
      // Fallback to text if photo send fails
      msg3Id = await sendText(bot, chatId, caption || '(no caption)', { reply_markup: kb });
    }
  } else {
    msg3Id = await sendText(bot, chatId, caption || '(no content)', { reply_markup: kb });
  }

  // Message 4: skip warning
  const msg4Id = await sendText(bot, chatId, t(lang, 'arrival_skip_warning'));

  scheduleExpiry(assignment.id, chatId, 60 * 60 * 1000);

  return { msg2Id, msg3Id, msg4Id };
}

async function rollNextChain(user: any) {
  const allChains = findAllChainsForUser(user.telegram_id, user.tz_offset);
  if (allChains.length === 0) return;

  const lang = user.lang ?? 'en';
  const chatId = user.telegram_id;
  const now = new Date();

  // Create assignments for all available chains
  const assignments: any[] = [];
  for (const chain of allChains) {
    const lastBlock = getLastBlock(chain.id);
    const nextSlot = (lastBlock?.slot_index ?? 0) + 1;
    if (nextSlot > 24) continue;

    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const assignId = createAssignment(user.telegram_id, chain.id, nextSlot, expiresAt);
    assignments.push({ id: assignId, chain_id: chain.id, slot_index: nextSlot });
  }

  if (assignments.length === 0) return;

  try {
    // Message 1: header with time + count + deadline
    const localNow = new Date(now.getTime() + user.tz_offset * 60 * 60 * 1000);
    const currentHour = localNow.getUTCHours();
    const { ampm, hour12 } = formatHour12(currentHour);
    const deadlineHour = (currentHour + 1) % 24;
    const dl = formatHour12(deadlineHour);
    const deadlineStr = `${dl.ampm} ${dl.hour12}시`;

    await sendText(bot, chatId, t(lang, 'arrival_header', {
      ampm, hour12, count: assignments.length, deadline: deadlineStr,
    }));

    // Send messages 2,3,4 for the first assignment only
    const msgIds = await sendArrivalForAssignment(user, assignments[0], assignments.length, lang);
    storeArrivalMessages(user.telegram_id, msgIds);
  } catch (e) {
    console.error(`Failed to send arrival to ${user.telegram_id}:`, e);
  }
}

// (navigation callbacks removed — replaced by skip/write sequential flow)

async function notifyChainComplete(chainId: number) {
  const chain = getChain(chainId);
  if (!chain) return;

  const blocks = getAllBlocks(chainId);
  const cities = new Set(blocks.map(b => getCity(b.tz_offset)));
  const creator = getUser(chain.creator_id);
  const lang = creator?.lang ?? 'en';

  let summary = t(lang, 'complete', { count: blocks.length, cities: cities.size });

  for (const b of blocks) {
    const flag = getFlag(b.tz_offset);
    const city = getCity(b.tz_offset);
    const short = b.content.length > 80 ? b.content.slice(0, 80) + '...' : b.content;
    const ts = formatBlockTimestamp(b.created_at, b.tz_offset);
    summary += `${b.slot_index}/24 ${flag} ${city} · ${ts}\n"${short}"\n\n`;
  }

  try {
    await sendText(bot, chain.creator_id, summary);
  } catch (e) {
    console.error(`Failed to notify creator ${chain.creator_id}:`, e);
  }
}

// ═══════════════════════════════════════
// ON-CHAIN RECORDING
// ═══════════════════════════════════════

async function recordBlockOnchain(chainId: number, content: string, tzOffset: number, userId?: number) {
  if (!ENABLE_ONCHAIN) return;
  try {
    const chain = getChain(chainId);
    if (!chain) return;
    const onchainId = makeChainId(`jung-${chainId}`);
    const prevHash = chainBlockHashes.get(chainId) ?? ethers.ZeroHash;

    // Get user's wallet address
    let participantAddr = ethers.ZeroAddress;
    if (userId) {
      const user = getUser(userId);
      if (user?.wallet_address) participantAddr = user.wallet_address;
    }

    // Create chain on first block
    if (!chainBlockHashes.has(chainId)) {
      try {
        const creatorAddr = participantAddr !== ethers.ZeroAddress ? participantAddr : (process.env.DEPLOYER_ADDRESS || ethers.ZeroAddress);
        await createOnchainChain(onchainId, creatorAddr, chain.creator_tz);
      } catch (e: any) {
        if (!e.message?.includes('already')) console.error('  ⛓️ createChain error:', e.message?.slice(0, 80));
      }
    }

    const result = await recordBlock(onchainId, content, prevHash, participantAddr, tzOffset);
    chainBlockHashes.set(chainId, result.blockHash);
    return result;
  } catch (e: any) {
    console.error(`  ⛓️ On-chain error: ${e.message?.slice(0, 80)}`);
  }
}

async function mintCompletionNFT(chainId: number) {
  if (!ENABLE_ONCHAIN) return;
  try {
    const chain = getChain(chainId);
    if (!chain) return;
    const onchainId = makeChainId(`jung-${chainId}`);
    const blocks = getAllBlocks(chainId);
    const creator = getUser(chain.creator_id);

    // Mint to creator's wallet, fallback to deployer
    const mintTo = creator?.wallet_address || process.env.DEPLOYER_ADDRESS || ethers.ZeroAddress;

    const { tokenId, txHash } = await mintSoulbound(
      mintTo, onchainId, chain.creator_tz, blocks.length, 1
    );

    const lang = creator?.lang ?? 'en';
    await sendText(bot, chain.creator_id,
      t(lang, 'nft_minted', { tokenId, url: explorerUrl(txHash) })
    );
  } catch (e: any) {
    console.error(`  🎖️ NFT mint error: ${e.message?.slice(0, 80)}`);
  }
}

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════

bot.api.setMyCommands([
  { command: 'start', description: '시작하기 / Start' },
  { command: 'menu', description: '메뉴 열기 / Open menu' },
  { command: 'new', description: '새 정 시작 / Start new chain' },
  { command: 'settings', description: '설정 / Settings' },
  { command: 'status', description: '내 상태 / My status' },
]).catch(() => {});

bot.start({
  onStart: () => console.log('🌏 정봇 v7 started!'),
});
