import { Bot } from 'grammy';
import { config } from './config.js';
import { registerUser, findByTelegramId } from './modules/user-manager.js';

export function createBot(): Bot {
  const bot = new Bot(config.jungBotToken);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🌏 정(Jung)에 오신 것을 환영합니다!\n\n' +
      '정은 24개 타임존을 잇는 메시지 릴레이입니다.\n' +
      '타임존을 설정하려면 /timezone 명령어를 사용하세요.\n\n' +
      '예: /timezone Asia/Seoul'
    );
  });

  bot.command('timezone', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('사용법: /timezone Asia/Seoul');
      return;
    }
    const tz = parts[1]!;
    // Simple offset calculation (in production, use luxon)
    const offsetMap: Record<string, number> = {
      'Asia/Seoul': 9, 'Asia/Tokyo': 9, 'Asia/Shanghai': 8,
      'Asia/Bangkok': 7, 'Asia/Kolkata': 5, 'Asia/Dubai': 4,
      'Europe/Moscow': 3, 'Europe/Paris': 1, 'Europe/London': 0,
      'America/New_York': -5, 'America/Chicago': -6,
      'America/Denver': -7, 'America/Los_Angeles': -8,
      'Pacific/Auckland': 12, 'Australia/Sydney': 10,
    };
    const offset = offsetMap[tz];
    if (offset === undefined) {
      await ctx.reply('지원하지 않는 타임존이에요. 예: Asia/Seoul, Europe/London');
      return;
    }
    const chatId = ctx.from?.id;
    if (!chatId) return;

    const existing = findByTelegramId(chatId);
    if (existing) {
      await ctx.reply(`이미 등록되어 있어요! (${existing.timezone})`);
      return;
    }

    registerUser(chatId, tz, offset);
    await ctx.reply(`✅ 등록 완료! 타임존: ${tz} (UTC${offset >= 0 ? '+' : ''}${offset})`);
  });

  bot.command('chain', async (ctx) => {
    await ctx.reply('현재 활성 체인 조회 기능은 준비 중이에요. 🚧');
  });

  return bot;
}
