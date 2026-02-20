import 'dotenv/config';
import { Bot, InputFile } from 'grammy';
import { config } from '../src/config.js';

const bot = new Bot(config.jungBotToken!);
const chatId = 5023569703;

const file = new InputFile('data/red-chain-relay-webp.html', 'jung-album-323.html');
bot.api.sendDocument(chatId, file, {
  caption: '🏁 정체인 완주 앨범 (WebP)\n960px 원본 해상도 · 1.4MB',
}).then(() => {
  console.log('Sent!');
  process.exit(0);
}).catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
