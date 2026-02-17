#!/usr/bin/env npx tsx
/**
 * 정봇 v6 — 타임존 릴레이
 * 모드: text | story | photo
 */
import 'dotenv/config';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import cron from 'node-cron';
import { config, getCity } from './config.js';
import { t, tAsync, resolveLang } from './services/i18n.js';
import { locationToOffset, reverseGeocode } from './services/geo.js';
import { validatePhoto as aiValidatePhoto } from './services/ai.js';
import { sendText, sendPhoto, deleteMessage, getPhotoBase64, getLargestPhotoId } from './services/telegram.js';
import { makeChainId, recordBlock, mintSoulbound, createOnchainChain, explorerUrl } from './services/onchain.js';
import { createWallet } from './services/wallet.js';
import { ethers } from 'ethers';
import db, {
  upsertUser, getUser, getUsersByNotifyHour, setUserWallet,
  createChain, getChain, getActiveChains, completeChain,
  addBlock, getLastBlock, getBlockCount, getAllBlocks,
  createAssignment, getPendingAssignment, updateAssignment,
  getExpiredAssignments, findNextChainForUser,
  getChainsForTzAtHour, getUsersByTzOffset,
  getChainsToDeliver, markDelivered,
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
  const btnText = await tAsync(lang, 'share_location');
  const welcomeText = await tAsync(lang, 'welcome', { name });
  const kb = new Keyboard()
    .requestLocation(btnText)
    .resized().oneTime();
  await ctx.reply(welcomeText, { reply_markup: kb });
});

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

// Location confirmed → hour picker
bot.callbackQuery(/^confirm_loc:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const offset = Number(parts[1]);
  const city = decodeURIComponent(parts.slice(2).join(':'));
  await showHourPicker(ctx, offset, city);
  await ctx.answerCallbackQuery();
});

async function showHourPicker(ctx: any, offset: number, city: string) {
  const lang = getLang(ctx);
  const kb = new InlineKeyboard();
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  for (let i = 0; i < hours.length; i += 3) {
    for (const h of hours.slice(i, i + 3)) {
      kb.text(`${h}:00`, `hour:${offset}:${h}:${encodeURIComponent(city)}`);
    }
    kb.row();
  }
  const sign = offset >= 0 ? '+' : '';
  const text = t(lang, 'pick_hour', { city, sign, offset });
  try { await ctx.editMessageText(text, { reply_markup: kb }); } catch {
    await ctx.reply(text, { reply_markup: kb });
  }
}

// Hour selected → save user
bot.callbackQuery(/^hour:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const tzOffset = Number(parts[1]);
  const notifyHour = Number(parts[2]);
  const city = decodeURIComponent(parts.slice(3).join(':'));
  const from = ctx.from;
  const lang = getLang(ctx);

  upsertUser(from.id, from.username, from.first_name, tzOffset, notifyHour, from.language_code);

  // Create or restore CDP wallet
  createWallet(from.id).then(({ address, isNew }) => {
    setUserWallet(from.id, address);
    console.log(`  🔑 Wallet ${isNew ? 'created' : 'restored'} for ${from.id}: ${address.slice(0, 10)}...`);
  }).catch(err => {
    console.error(`  🔑 Wallet failed for ${from.id}: ${err.message}`);
  });

  const sign = tzOffset >= 0 ? '+' : '';
  await ctx.editMessageText(
    t(lang, 'setup_done', { name: from.first_name, city, sign, offset: tzOffset, hour: notifyHour })
  );
  await ctx.answerCallbackQuery('🎉');
});

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
  await showHourPicker(ctx, offset, city);
  await ctx.answerCallbackQuery();
});

// ═══════════════════════════════════════
// CHAIN CREATION
// ═══════════════════════════════════════

bot.command('new', async (ctx) => {
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return ctx.reply(t(lang, 'setup_first'));

  // Mode selection
  const kb = new InlineKeyboard()
    .text(t(lang, 'mode_text'), 'new_mode:text')
    .text(t(lang, 'mode_story'), 'new_mode:story')
    .text(t(lang, 'mode_photo'), 'new_mode:photo');

  await ctx.reply(t(lang, 'pick_mode'), { reply_markup: kb });
});

bot.callbackQuery(/^new_mode:/, async (ctx) => {
  const mode = ctx.callbackQuery.data.split(':')[1] as 'text' | 'story' | 'photo';
  const lang = getLang(ctx);
  const user = getUser(ctx.from!.id);
  if (!user) return ctx.answerCallbackQuery(t(lang, 'setup_first'));

  const now = new Date();
  const city = getCity(user.tz_offset);
  const localHour = ((now.getUTCHours() + user.tz_offset) % 24 + 24) % 24;

  if (mode === 'photo') {
    // Ask for mission first
    pendingMission.set(ctx.from!.id, { mode, city, localHour, now: now.toISOString() });
    await ctx.editMessageText(t(lang, 'ask_mission'));
    await ctx.answerCallbackQuery();
    return;
  }

  const chainId = createChain(user.telegram_id, user.tz_offset, now.toISOString(), mode, localHour);
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const assignId = createAssignment(user.telegram_id, chainId, 1, expiresAt);

  let promptKey = 'new_chain';
  if (mode === 'story') promptKey = 'new_story';

  await ctx.editMessageText(t(lang, promptKey, { city, max: config.maxMessageLength }));
  scheduleExpiry(assignId, ctx.from!.id, 60 * 60 * 1000);
  await ctx.answerCallbackQuery();
});

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
  if (!user) return ctx.reply(t(lang, 'setup_first'));
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

  if (chain.mode === 'story') {
    await ctx.editMessageText(t(lang, 'story_prompt', { slot: slotIndex, city, content, max: config.maxMessageLength }));
  } else if (chain.mode === 'photo') {
    await ctx.editMessageText(t(lang, 'photo_prompt', { slot: slotIndex, city, content, mission: chain.mission ?? '' }));
  } else {
    await ctx.editMessageText(t(lang, 'write_prompt', { slot: slotIndex, max: config.maxMessageLength }));
  }
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

  const assignment = getPendingAssignment(userId);
  if (!assignment) return;

  const lang = getLang(ctx);
  if (text.length > config.maxMessageLength) {
    return ctx.reply(t(lang, 'too_long', { max: config.maxMessageLength, len: text.length }));
  }

  const user = getUser(userId);
  if (!user) return;

  // Photo mode waiting for caption — redirect to caption handler
  if (assignment.mode === 'photo' && assignment.status === 'writing') {
    const jungzigiComment = pendingJungzigiComment.get(userId) || '좋은 사진이네요! 📸';
    pendingJungzigiComment.delete(userId);

    db.prepare('UPDATE blocks SET content = ? WHERE chain_id = ? AND slot_index = ?')
      .run(text, assignment.chain_id, assignment.slot_index);
    updateAssignment(assignment.id, 'written');
    db.prepare('UPDATE chains SET block_count = block_count + 1 WHERE id = ?').run(assignment.chain_id);
    recordBlockOnchain(assignment.chain_id, text, user.tz_offset, userId).catch(() => {});

    const count = getBlockCount(assignment.chain_id);
    const fromCity = getCity(user.tz_offset);

    if (count >= 24) {
      completeChain(assignment.chain_id);
      await ctx.reply(t(lang, 'jungzigi_complete', { comment: jungzigiComment, count }));
    } else {
      let nextTz = user.tz_offset + 1;
      if (nextTz > 12) nextTz -= 24;
      const toCity = getCity(nextTz);
      await ctx.reply(t(lang, 'jungzigi_pass', { comment: jungzigiComment, count, fromCity, toCity }));
    }
    await rollNextChain(user);
    return;
  }

  addBlock(assignment.chain_id, assignment.slot_index, userId, user.tz_offset, text);
  updateAssignment(assignment.id, 'written');

  // On-chain record (async, non-blocking)
  recordBlockOnchain(assignment.chain_id, text, user.tz_offset, userId).catch(() => {});

  const count = getBlockCount(assignment.chain_id);
  if (count >= 24) {
    completeChain(assignment.chain_id);
    await ctx.reply(t(lang, 'block_saved', { count }));
    // Result delivered later at chain_hour + 24h via cron
  } else {
    await ctx.reply(t(lang, 'block_saved_next', { count }));
  }
  await rollNextChain(user);
});

// ═══════════════════════════════════════
// PHOTO INPUT
// ═══════════════════════════════════════

bot.on('message:photo', async (ctx) => {
  const userId = ctx.from!.id;
  const assignment = getPendingAssignment(userId);
  if (!assignment || assignment.mode !== 'photo') return;

  const lang = getLang(ctx);
  const user = getUser(userId);
  if (!user) return;

  const photoId = getLargestPhotoId(ctx.message.photo);
  if (!photoId) return;

  // Step 1: 정지기 검증 중 메시지
  await ctx.reply(t(lang, 'validating'));

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
  const caption = ctx.message.caption?.trim();
  if (caption) {
    await savePhotoBlock(ctx, assignment, userId, user, photoId, caption, lang, jungzigiComment);
  } else {
    // Store photo temporarily, ask for caption
    db.prepare('UPDATE assignments SET status = ? WHERE id = ?').run('writing', assignment.id);
    db.prepare(`INSERT OR REPLACE INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_url, media_type)
      VALUES (?, ?, ?, ?, '', ?, 'photo')`)
      .run(assignment.chain_id, assignment.slot_index, userId, user.tz_offset, photoId);
    // Store jungzigi comment for after caption
    pendingJungzigiComment.set(userId, jungzigiComment);
    await ctx.reply(t(lang, 'photo_caption_ask'));
  }
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
    let nextTz = user.tz_offset + 1;
    if (nextTz > 12) nextTz -= 24;
    const toCity = getCity(nextTz);
    await ctx.reply(t(lang, 'jungzigi_pass', { comment: jungzigiComment, count, fromCity, toCity }));
  }
  await rollNextChain(user);
}

// Caption after photo is now handled in the main text handler above (photo writing check)

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

async function rollNextChain(user: any) {
  const nextChain = findNextChainForUser(user.telegram_id, user.tz_offset);
  if (!nextChain) return;

  const lastBlock = getLastBlock(nextChain.id);
  const nextSlot = (lastBlock?.slot_index ?? 0) + 1;
  if (nextSlot > 24) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const assignId = createAssignment(user.telegram_id, nextChain.id, nextSlot, expiresAt);

  const lang = user.lang ?? 'en';
  const prevContent = lastBlock?.content ?? '';
  const prevCity = lastBlock ? getCity(lastBlock.tz_offset) : getCity(nextChain.creator_tz);
  const count = getBlockCount(nextChain.id);
  const content = prevContent.length > 150 ? prevContent.slice(0, 150) + '...' : prevContent;

  const kb = new InlineKeyboard()
    .text(t(lang, 'write'), `write:${nextChain.id}:${nextSlot}`)
    .text(t(lang, 'skip'), `skip:${nextChain.id}:${assignId}`);

  // Mode-specific arrival message
  let text: string;
  if (nextChain.mode === 'photo' && lastBlock?.media_url) {
    // Send previous photo + prompt
    text = t(lang, 'photo_prompt', { slot: nextSlot, city: prevCity, content, mission: nextChain.mission ?? '' });
  } else if (nextChain.mode === 'story') {
    text = t(lang, 'story_prompt', { slot: nextSlot, city: prevCity, content, max: config.maxMessageLength });
  } else {
    text = t(lang, 'arrived', { count, city: prevCity, content });
  }

  try {
    const chatId = user.telegram_id;

    // If photo mode and previous block has photo, send photo first
    if (nextChain.mode === 'photo' && lastBlock?.media_url) {
      await sendPhoto(bot, chatId, lastBlock.media_url, `📍 ${prevCity}: ${content}`);
    }

    const msgId = await sendText(bot, chatId, text, { reply_markup: kb });
    if (msgId) {
      updateAssignment(assignId, 'pending', msgId, chatId);
    }
    scheduleExpiry(assignId, chatId, 60 * 60 * 1000);
  } catch (e) {
    console.error(`Failed to send to ${user.telegram_id}:`, e);
  }
}

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

bot.start({
  onStart: () => console.log('🌏 정봇 v6 started!'),
});
