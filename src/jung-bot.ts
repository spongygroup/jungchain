#!/usr/bin/env npx tsx
/**
 * 정봇 v7 — 타임존 릴레이
 * 모드: text | story | photo
 */
import 'dotenv/config';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import cron from 'node-cron';
import { config, getCity, TZ_LANGUAGES } from './config.js';
import { t, tAsync, resolveLang } from './services/i18n.js';
import { locationToOffset, reverseGeocode } from './services/geo.js';
import { validatePhoto as aiValidatePhoto, validateText, transcribeVoice, translateContent } from './services/ai.js';
import { sendText, sendPhoto, sendVoice, deleteMessage, getPhotoBase64, getFileBuffer, getLargestPhotoId } from './services/telegram.js';
import { makeChainId, recordBlock, mintSoulbound, createOnchainChain, explorerUrl } from './services/onchain.js';
import { createWallet } from './services/wallet.js';
import { ethers } from 'ethers';
import db, {
  upsertUser, getUser, getUsersByNotifyHour, setUserWallet,
  createChain, getChain, getActiveChains, completeChain,
  addBlock, getLastBlock, getBlockCount, getAllBlocks,
  createAssignment, getPendingAssignment, updateAssignment,
  getExpiredAssignments, findNextChainForUser,
  findAllChainsForUser, getChainsForTzAtHour, getUsersByTzOffset,
  getChainsToDeliver, markDelivered,
  getUserNotifyHours, setUserNotifyHours, canChangeNotifyHours,
  incrementDailyStarts, getDailyStarts,
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
// Track prevBlockHash per chain (in-memory, resets on restart)
const chainBlockHashes = new Map<number, string>();

function getLang(ctx: any): string {
  return resolveLang(ctx.from?.language_code);
}

// ─── TZ flags ───
const TZ_FLAGS: Record<number, string> = {
  12: '🇳🇿', 11: '🇸🇧', 10: '🇦🇺', 9: '🇰🇷', 8: '🇹🇼', 7: '🇹🇭',
  6: '🇧🇩', 5: '🇵🇰', 4: '🇦🇪', 3: '🇷🇺', 2: '🇪🇬', 1: '🇫🇷',
  0: '🇬🇧', '-1': '🇵🇹', '-2': '🌊', '-3': '🇧🇷', '-4': '🇺🇸',
  '-5': '🇺🇸', '-6': '🇺🇸', '-7': '🇺🇸', '-8': '🇺🇸', '-9': '🇺🇸',
  '-10': '🇺🇸', '-11': '🇼🇸',
};
function getFlag(offset: number): string {
  return TZ_FLAGS[offset] ?? '🌍';
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
    .text(t(lang, 'btn_notify_settings'), 'menu:notify')
    .row()
    .text(t(lang, 'btn_my_chains'), 'menu:mychains');
  await ctx.reply(t(lang, 'start_menu', { name }), { reply_markup: kb });
}

// Track pending action before setup
const pendingAction = new Map<number, string>();

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

  const chains = findAllChainsForUser(user.telegram_id, user.tz_offset);
  // Also get chains the user created or participated in
  const activeChains = getActiveChains().filter(c =>
    c.creator_id === user.telegram_id || getAllBlocks(c.id).some((b: any) => b.user_id === user.telegram_id)
  );

  if (activeChains.length === 0) {
    return ctx.reply(t(lang, 'my_chains_empty'));
  }

  let text = t(lang, 'my_chains_header');
  for (const chain of activeChains) {
    const count = getBlockCount(chain.id);
    text += t(lang, 'my_chain_item', { id: chain.id, count, status: chain.status }) + '\n';
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
  const chainId = Number(parts[1]);
  const slotIndex = Number(parts[2]);
  const lang = getLang(ctx);
  const chain = getChain(chainId);
  if (!chain) return ctx.answerCallbackQuery('❌');

  // Update assignment status to 'writing'
  const assignment = getPendingAssignment(ctx.from!.id);
  if (assignment) updateAssignment(assignment.id, 'writing');

  const lastBlock = getLastBlock(chainId);
  const content = lastBlock?.content ? (lastBlock.content.length > 150 ? lastBlock.content.slice(0, 150) + '...' : lastBlock.content) : '';
  const city = lastBlock ? getCity(lastBlock.tz_offset) : '';

  await ctx.reply(t(lang, 'write_prompt', { slot: slotIndex, max: config.maxMessageLength }));
  await ctx.answerCallbackQuery();
});

// Format selected for relay write
bot.callbackQuery(/^fmt:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const fmt = parts[1]; // text | photo | voice
  const lang = getLang(ctx);
  const messages: Record<string, Record<string, string>> = {
    ko: { text: '📝 텍스트를 입력해주세요!', photo: '📷 사진을 보내주세요!', voice: '🎙 음성 메시지를 보내주세요!' },
    en: { text: '📝 Send your text!', photo: '📷 Send a photo!', voice: '🎙 Send a voice message!' },
  };
  const l = lang === 'ko' ? 'ko' : 'en';
  await ctx.editMessageText(messages[l][fmt] || messages.en[fmt]);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^skip:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const assignmentId = Number(parts[2]);
  const lang = getLang(ctx);

  updateAssignment(assignmentId, 'skipped');
  await ctx.answerCallbackQuery('⏭');

  const user = getUser(ctx.from!.id);
  if (user) {
    await ctx.editMessageText(t(lang, 'skipped'));
    await rollNextChain(user);
  } else {
    await ctx.editMessageText(t(lang, 'skipped'));
  }
});

// ═══════════════════════════════════════
// TEXT / STORY INPUT
// ═══════════════════════════════════════

bot.on('message:text', async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

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

  // New chain: create on first content
  if (pendingNewChain.has(userId)) {
    const lang = getLang(ctx);
    if (text.length > config.maxMessageLength) {
      return ctx.reply(t(lang, 'too_long', { max: config.maxMessageLength, len: text.length }));
    }

    const user = getUser(userId);
    if (!user) return;

    const validation = await validateText(text);
    if (!validation.safe) {
      return ctx.reply(t(lang, 'content_blocked', { reason: validation.reason || '' }));
    }

    const result = createChainFromContent(userId);
    if (!result) return ctx.reply(t(lang, 'daily_limit_reached', { max: config.maxDailyStarts }));
    if (result.sameHour) return ctx.reply(t(lang, 'same_hour_limit'));

    addBlock(result.chainId, 1, userId, user.tz_offset, text);
    updateAssignment(result.assignId, 'written');
    recordBlockOnchain(result.chainId, text, user.tz_offset, userId).catch(() => {});

    const count = getBlockCount(result.chainId);
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: '정이 출발합니다! 🌏', count, fromCity: user.city || getCity(user.tz_offset), toCity }));
    await rollNextChain(user);
    return;
  }

  const assignment = getPendingAssignment(userId);
  if (!assignment) return;

  const lang = getLang(ctx);
  if (text.length > config.maxMessageLength) {
    return ctx.reply(t(lang, 'too_long', { max: config.maxMessageLength, len: text.length }));
  }

  const user = getUser(userId);
  if (!user) return;

  // Photo caption redirect removed — caption is now optional (v7)

  // Content validation
  const validation = await validateText(text);
  if (!validation.safe) {
    return ctx.reply(t(lang, 'content_blocked', { reason: validation.reason || '' }));
  }

  addBlock(assignment.chain_id, assignment.slot_index, userId, user.tz_offset, text);
  updateAssignment(assignment.id, 'written');

  // On-chain record (async, non-blocking)
  recordBlockOnchain(assignment.chain_id, text, user.tz_offset, userId).catch(() => {});

  const count = getBlockCount(assignment.chain_id);
  if (count >= 24) {
    completeChain(assignment.chain_id);
    await ctx.reply(t(lang, 'block_saved', { count }));
  } else {
    const chain = getChain(assignment.chain_id);
    const nextHour = chain?.chain_hour ?? user.notify_hour;
    await ctx.reply(t(lang, 'block_saved_next', { count, nextHour }));
  }
  await rollNextChain(user);
});

// ═══════════════════════════════════════
// PHOTO INPUT
// ═══════════════════════════════════════

bot.on('message:photo', async (ctx) => {
  const userId = ctx.from!.id;

  // New chain: create on first photo
  if (pendingNewChain.has(userId)) {
    const lang = getLang(ctx);
    const user = getUser(userId);
    if (!user) return;

    const photoId = getLargestPhotoId(ctx.message.photo);
    if (!photoId) return;
    const caption = ctx.message.caption?.trim() || '';

    // Validate photo
    await ctx.reply(t(lang, 'validating_photo'));
    const base64 = await getPhotoBase64(bot, photoId);
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

    addBlock(result.chainId, 1, userId, user.tz_offset, caption, photoId, 'photo');
    updateAssignment(result.assignId, 'written');
    recordBlockOnchain(result.chainId, caption, user.tz_offset, userId).catch(() => {});

    const count = getBlockCount(result.chainId);
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: '정이 출발합니다! 🌏', count, fromCity: user.city || getCity(user.tz_offset), toCity }));
    await rollNextChain(user);
    return;
  }

  const assignment = getPendingAssignment(userId);
  if (!assignment) return;

  const lang = getLang(ctx);
  const user = getUser(userId);
  if (!user) return;

  const photoId = getLargestPhotoId(ctx.message.photo);
  if (!photoId) return;

  // Step 1: 정지기 검증 중 메시지
  await ctx.reply(t(lang, 'validating_photo'));

  // Step 2: Validate photo (mission + safety + 정지기 comment)
  let jungzigiComment = '좋은 사진이네요! 📸';
  try {
    const base64 = await getPhotoBase64(bot, photoId);
    const validation = await aiValidatePhoto(base64, assignment.mission ?? '');
    jungzigiComment = validation.jungzigiComment || jungzigiComment;

    if (validation.status !== 'pass') {
      await ctx.reply(t(lang, 'jungzigi_fail', { comment: jungzigiComment }));
      return;
    }
  } catch (err: any) {
    console.error('Photo validation error:', err.message);
  }

  // Step 3: Caption — use provided or ask
  const caption = ctx.message.caption?.trim() || '';
  await savePhotoBlock(ctx, assignment, userId, user, photoId, caption, lang, jungzigiComment);
});

// Store 정지기 comment between photo and caption
const pendingJungzigiComment = new Map<number, string>();

// Helper: save photo block + 정지기 response + progress
async function savePhotoBlock(
  ctx: any, assignment: any, userId: number, user: any,
  photoId: string, caption: string, lang: string, jungzigiComment: string,
) {
  addBlock(assignment.chain_id, assignment.slot_index, userId, user.tz_offset, caption, photoId, 'photo');
  updateAssignment(assignment.id, 'written');
  recordBlockOnchain(assignment.chain_id, caption, user.tz_offset, userId).catch(() => {});

  const count = getBlockCount(assignment.chain_id);
  const chain = getChain(assignment.chain_id);
  const fromCity = getCity(user.tz_offset);

  if (count >= 24) {
    completeChain(assignment.chain_id);
    await ctx.reply(t(lang, 'jungzigi_complete', { comment: jungzigiComment, count }));
  } else {
    // Calculate next TZ city
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: jungzigiComment, count, fromCity, toCity }));
  }
  await rollNextChain(user);
}

// Caption after photo is now handled in the main text handler above (photo writing check)

// ═══════════════════════════════════════
// VOICE INPUT
// ═══════════════════════════════════════

bot.on('message:voice', async (ctx) => {
  const userId = ctx.from!.id;
  const lang = getLang(ctx);

  // New chain: create on first voice
  if (pendingNewChain.has(userId)) {
    const user = getUser(userId);
    if (!user) return;
    const duration = ctx.message.voice.duration;
    if (duration > config.maxVoiceDuration) {
      return ctx.reply(t(lang, 'voice_too_long', { max: config.maxVoiceDuration }));
    }

    const fileId = ctx.message.voice.file_id;

    // STT + validate
    await ctx.reply(t(lang, 'validating_voice'));
    const buf = await getFileBuffer(bot, fileId);
    const transcript = await transcribeVoice(buf);
    if (transcript) {
      const validation = await validateText(transcript);
      if (!validation.safe) {
        return ctx.reply(t(lang, 'content_blocked', { reason: validation.reason || '' }));
      }
    }

    const result = createChainFromContent(userId);
    if (!result) return ctx.reply(t(lang, 'daily_limit_reached', { max: config.maxDailyStarts }));
    if (result.sameHour) return ctx.reply(t(lang, 'same_hour_limit'));

    addBlock(result.chainId, 1, userId, user.tz_offset, transcript || '', fileId, 'voice');
    updateAssignment(result.assignId, 'written');
    recordBlockOnchain(result.chainId, transcript || '', user.tz_offset, userId).catch(() => {});

    const count = getBlockCount(result.chainId);
    let nextTz = user.tz_offset - 1;
    if (nextTz < -11) nextTz += 24;
    const toCity = `UTC${nextTz >= 0 ? '+' : ''}${nextTz}`;
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: '정이 출발합니다! 🌏', count, fromCity: user.city || getCity(user.tz_offset), toCity }));
    await rollNextChain(user);
    return;
  }

  const assignment = getPendingAssignment(userId);

  if (!assignment) {
    return ctx.reply(t(lang, 'voice_no_assignment'));
  }

  const user = getUser(userId);
  if (!user) return;

  // Voice duration limit
  const duration = ctx.message.voice.duration;
  if (duration > config.maxVoiceDuration) {
    return ctx.reply(t(lang, 'voice_too_long', { max: config.maxVoiceDuration, len: duration }));
  }

  const voiceFileId = ctx.message.voice.file_id;

  // Step 1: Transcribing indicator
  await ctx.reply(t(lang, 'voice_transcribing'));

  // Step 2: Download voice file + Whisper STT
  let transcript: string;
  try {
    const buffer = await getFileBuffer(bot, voiceFileId);
    transcript = await transcribeVoice(buffer);
  } catch (err: any) {
    console.error('Voice transcription error:', err.message);
    return ctx.reply(t(lang, 'voice_transcribe_fail'));
  }

  if (!transcript) {
    return ctx.reply(t(lang, 'voice_transcribe_fail'));
  }

  // Step 3: Validate content
  const validation = await validateText(transcript);
  if (!validation.safe) {
    return ctx.reply(t(lang, 'content_blocked', { reason: validation.reason || '' }));
  }

  // Step 4: Translate via existing pattern (Gemini)
  const nextTz = user.tz_offset - 1 < -11 ? user.tz_offset - 1 + 24 : user.tz_offset - 1;
  const targetLang = TZ_LANGUAGES[nextTz] ?? 'English';
  let translated: string;
  try {
    translated = await translateContent([transcript], targetLang);
  } catch {
    translated = transcript;
  }

  // Step 5: Save block (voice): media_url = file_id, content = transcript, media_type = 'voice'
  addBlock(assignment.chain_id, assignment.slot_index, userId, user.tz_offset, transcript, voiceFileId, 'voice');
  updateAssignment(assignment.id, 'written');

  // On-chain record (async, non-blocking)
  recordBlockOnchain(assignment.chain_id, transcript, user.tz_offset, userId).catch(() => {});

  const count = getBlockCount(assignment.chain_id);

  if (count >= 24) {
    completeChain(assignment.chain_id);
    await ctx.reply(t(lang, 'block_saved', { count }));
  } else {
    const chain = getChain(assignment.chain_id);
    const nextHour = chain?.chain_hour ?? user.notify_hour;
    await ctx.reply(
      t(lang, 'voice_saved', { count, nextHour }) + `\n\n🎙️ "${transcript}"\n🌐 ${translated}`
    );
  }
  await rollNextChain(user);
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

function scheduleCountdown(assignmentId: number, chatId: number, messageId: number, originalText: string, kb: any) {
  const intervalMs = 5 * 60 * 1000; // 5분마다
  const startTime = Date.now();
  const totalMs = 60 * 60 * 1000; // 1시간

  const timer = setInterval(async () => {
    const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
    if (!a || !['pending', 'writing'].includes(a.status)) {
      clearInterval(timer);
      return;
    }

    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, totalMs - elapsed);
    const mins = Math.ceil(remaining / 60000);

    if (mins <= 0) {
      clearInterval(timer);
      return;
    }

    const warning = mins <= 10 ? ' ⚠️' : '';
    const updatedText = originalText.replace(/⏰.*/, `⏰ 남은 시간: ${mins}분${warning}`);

    try {
      await bot.api.editMessageText(chatId, messageId, updatedText, { reply_markup: kb });
    } catch { /* message might be deleted or unchanged */ }
  }, intervalMs);
}

// Build arrival message for a specific chain
function buildArrivalMessage(chain: any, user: any, index: number, total: number) {
  const lastBlock = getLastBlock(chain.id);
  const nextSlot = (lastBlock?.slot_index ?? 0) + 1;
  const lang = user.lang ?? 'en';
  const prevContent = lastBlock?.content ?? '';
  const prevUserId = lastBlock ? lastBlock.user_id : chain.creator_id;
  const prevUser = getUser(prevUserId);
  const prevName = prevUser?.first_name ?? prevUser?.username ?? 'someone';
  const prevTzOffset = lastBlock ? lastBlock.tz_offset : chain.creator_tz;
  const prevFlag = getFlag(prevTzOffset);
  const prevCity = prevUser?.city
    ? `${prevFlag} ${prevUser.city}`
    : `${prevFlag} ${getCity(prevTzOffset)}`;
  const count = getBlockCount(chain.id);

  const now = new Date();
  const localNow = new Date(now.getTime() + user.tz_offset * 60 * 60 * 1000);
  const currentHour = localNow.getUTCHours();
  const nextHour = (currentHour + 1) % 24;
  const ampm = nextHour < 12 ? '오전' : '오후';
  const h12 = nextHour === 0 ? 12 : nextHour > 12 ? nextHour - 12 : nextHour;
  const deadlineStr = `${ampm} ${h12}시`;
  const text = t(lang, 'arrived', { count, city: prevCity, name: prevName, content: prevContent, deadline: deadlineStr });

  const kb = new InlineKeyboard()
    .text(t(lang, 'write'), `write:${chain.id}:${nextSlot}`)
    .row();
  if (total > 1) {
    kb.text('◀️', `nav:prev:${user.telegram_id}:${index}`)
      .text(`${index + 1}/${total}`, 'nav:info')
      .text('▶️', `nav:next:${user.telegram_id}:${index}`);
  }

  return { text, kb, lastBlock, prevTzOffset, prevCity, prevContent, nextSlot };
}

async function rollNextChain(user: any) {
  const allChains = findAllChainsForUser(user.telegram_id, user.tz_offset);
  if (allChains.length === 0) return;

  const chain = allChains[0];
  const lastBlock = getLastBlock(chain.id);
  const nextSlot = (lastBlock?.slot_index ?? 0) + 1;
  if (nextSlot > 24) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const assignId = createAssignment(user.telegram_id, chain.id, nextSlot, expiresAt);

  const { text, kb, prevTzOffset, prevCity, prevContent } = buildArrivalMessage(chain, user, 0, allChains.length);

  try {
    const chatId = user.telegram_id;

    // If previous block has photo, send with timestamp caption
    if (lastBlock?.media_type === 'photo' && lastBlock?.media_url) {
      const blockCreated = new Date(lastBlock.created_at + 'Z');
      const localBlock = new Date(blockCreated.getTime() + (lastBlock.tz_offset) * 60 * 60 * 1000);
      const dateStr = `${localBlock.getUTCFullYear()}.${String(localBlock.getUTCMonth()+1).padStart(2,'0')}.${String(localBlock.getUTCDate()).padStart(2,'0')}`;
      const timeStr = `${String(localBlock.getUTCHours()).padStart(2,'0')}:${String(localBlock.getUTCMinutes()).padStart(2,'0')}`;
      const tzStr = `UTC${lastBlock.tz_offset >= 0 ? '+' : ''}${lastBlock.tz_offset}`;
      const photoCaption = `🕐 ${dateStr} ${timeStr} (${tzStr})`;
      await sendPhoto(bot, chatId, lastBlock.media_url, photoCaption);
    }

    // If previous block is voice, send original voice + translated transcript
    if (lastBlock?.media_type === 'voice' && lastBlock?.media_url) {
      const content = prevContent.length > 150 ? prevContent.slice(0, 150) + '...' : prevContent;
      let voiceCaption = `🎙️ ${prevCity}: "${content}"`;
      try {
        const targetLang = TZ_LANGUAGES[user.tz_offset] ?? 'English';
        const translated = await translateContent([prevContent], targetLang);
        voiceCaption += `\n🌐 ${translated}`;
      } catch { /* translation failed, send without */ }
      await sendVoice(bot, chatId, lastBlock.media_url, voiceCaption);
    }

    const msgId = await sendText(bot, chatId, text, { reply_markup: kb });
    if (msgId) {
      updateAssignment(assignId, 'pending', msgId, chatId);
      scheduleCountdown(assignId, chatId, msgId, text, kb);
    }
    scheduleExpiry(assignId, chatId, 60 * 60 * 1000);
  } catch (e) {
    console.error(`Failed to send to ${user.telegram_id}:`, e);
  }
}

// Navigation callback handler for browsing chains
// Demo nav handler (text-only) — temporary test
const demoSamples = [
  { city: '🇰🇷 성남시', name: 'jay', count: '5/24' },
  { city: '🇹🇭 방콕', name: 'mali', count: '12/24' },
  { city: '🇦🇪 두바이', name: 'omar', count: '18/24' },
  { city: '🇧🇷 상파울루', name: 'ana', count: '23/24' },
];

bot.callbackQuery(/^nav:demo:(prev|next):(\d+)$/, async (ctx) => {
  const direction = ctx.match![1];
  const currentIdx = Number(ctx.match![2]);
  let newIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
  if (newIdx >= demoSamples.length) newIdx = 0;
  if (newIdx < 0) newIdx = demoSamples.length - 1;

  const s = demoSamples[newIdx];
  const deadline = '01:00';
  const text = `🌏 ${s.city}에서 ${s.name}님이 보낸 정이 도착했습니다! (${s.count})\n\n⏰ 남은 시간: 60분\n${deadline}까지 정을 이어붙이지 않으면 이 메시지는 자동 삭제됩니다.`;

  const kb = new InlineKeyboard()
    .text('✍️ 이어쓰기', `write:demo:${newIdx}`)
    .row()
    .text('◀️', `nav:demo:prev:${newIdx}`)
    .text(`${newIdx + 1}/${demoSamples.length}`, 'nav:info')
    .text('▶️', `nav:demo:next:${newIdx}`);

  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch {}

  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^nav:(prev|next):(\d+):(\d+)$/, async (ctx) => {
  const direction = ctx.match![1];
  const userId = Number(ctx.match![2]);
  const currentIdx = Number(ctx.match![3]);
  const user = getUser(userId);
  if (!user) return ctx.answerCallbackQuery();

  // Find chains with pending/writing assignments for this user
  const allChains = db.prepare(`
    SELECT c.* FROM chains c
    JOIN assignments a ON a.chain_id = c.id
    WHERE a.user_id = ? AND a.status IN ('pending', 'writing')
    ORDER BY c.created_at ASC
  `).all(userId) as any[];
  if (allChains.length === 0) return ctx.answerCallbackQuery();

  let newIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
  if (newIdx >= allChains.length) newIdx = 0;
  if (newIdx < 0) newIdx = allChains.length - 1;

  const chain = allChains[newIdx];
  const { text, kb, lastBlock: lb } = buildArrivalMessage(chain, user, newIdx, allChains.length);

  try {
    // Update text message
    await ctx.editMessageText(text, { reply_markup: kb });

    // If chain has photo, send new photo (can't edit photo in existing message)
    if (lb?.media_type === 'photo' && lb?.media_url) {
      const blockCreated = new Date(lb.created_at + 'Z');
      const localBlock = new Date(blockCreated.getTime() + lb.tz_offset * 60 * 60 * 1000);
      const dateStr = `${localBlock.getUTCFullYear()}.${String(localBlock.getUTCMonth()+1).padStart(2,'0')}.${String(localBlock.getUTCDate()).padStart(2,'0')}`;
      const timeStr = `${String(localBlock.getUTCHours()).padStart(2,'0')}:${String(localBlock.getUTCMinutes()).padStart(2,'0')}`;
      const tzStr = `UTC${lb.tz_offset >= 0 ? '+' : ''}${lb.tz_offset}`;
      await sendPhoto(bot, user.telegram_id, lb.media_url, `🕐 ${dateStr} ${timeStr} (${tzStr})`);
    }
  } catch { /* edit might fail if message unchanged */ }

  await ctx.answerCallbackQuery();
});

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
    summary += `${b.slot_index}/24 ${flag} ${city}\n"${short}"\n\n`;
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
