import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';
import db from '../src/db/database.js';
import { t } from '../src/services/i18n.js';
import { config, getCity, getFlag } from '../src/config.js';
import { getAllBlocks, getChain, getUser, markNotified } from '../src/db/database.js';

const chainId = Number(process.argv[2] ?? 323);

// Reset chain to 'completed'
db.prepare("UPDATE chains SET status = 'completed' WHERE id = ?").run(chainId);
console.log(`✅ Chain #${chainId} status → completed`);

const chain = getChain(chainId) as any;
const blocks = getAllBlocks(chainId);
const creator = getUser(chain.creator_id) as any;
const lang = creator?.lang ?? 'ko';
const bot = new Bot(config.jungBotToken);

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

// 1) 완주 알림 (notifyChainComplete)
const userCities = new Map<number, string>();
for (const b of blocks) {
  if (!userCities.has(b.user_id)) {
    const u = getUser(b.user_id);
    userCities.set(b.user_id, u?.city || getCity(b.tz_offset));
  }
}

const uniqueCities = new Set(userCities.values());
const othersCount = new Set(blocks.map(b => b.user_id).filter((id: number) => id !== chain.creator_id)).size;

let summary = othersCount > 0
  ? t(lang, 'complete', { count: othersCount, cities: uniqueCities.size })
  : t(lang, 'complete_solo');

const route = blocks.map(b => {
  const flag = getFlag(b.tz_offset);
  const city = userCities.get(b.user_id) || getCity(b.tz_offset);
  return `${flag} ${city}`;
}).join(' → ');
summary += route;

await bot.api.sendMessage(chain.creator_id, summary);
console.log(`✅ 완주 알림 전송`);

// 2) NFT 스타일 선택 (sendNftStyleChoice)
const kb = new InlineKeyboard()
  .text('情 한자', `nft:${chainId}:0`)
  .text('정 한글', `nft:${chainId}:1`);

await bot.api.sendMessage(chain.creator_id,
  t(lang, 'nft_style_choice'),
  { reply_markup: kb }
);
markNotified(chainId);
console.log(`✅ NFT 선택 메시지 전송, status → notified`);
console.log(`\n👆 텔레그램에서 버튼을 눌러주세요!`);
process.exit(0);
