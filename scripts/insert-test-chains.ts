import 'dotenv/config';
import { readFileSync } from 'fs';
import { config } from '../src/config.js';
import db, {
  upsertUser, createChain, addBlock, createAssignment, getUser,
} from '../src/db/database.js';

const BOT_TOKEN = config.jungBotToken;
const JAY_ID = 5023569703;

// Step 1: Re-register jay as Seoul (UTC+9)
console.log('1️⃣ Registering user...');
upsertUser(JAY_ID, 'blacksp0nge', 'jay', 9, 9, 'ko', 'Seoul');
console.log('  ✅ jay registered (Seoul, UTC+9)');

// Step 2: Upload photos via bot API to get file_ids
async function uploadPhoto(filePath: string, caption: string): Promise<string> {
  const form = new FormData();
  const photoData = readFileSync(filePath);
  form.append('chat_id', JAY_ID.toString());
  form.append('photo', new Blob([photoData], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('caption', caption);

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Upload failed: ${JSON.stringify(data)}`);

  // Get largest photo file_id
  const photos = data.result.photo;
  const largest = photos[photos.length - 1];
  console.log(`  ✅ Uploaded: file_id=${largest.file_id.slice(0, 30)}...`);

  // Delete the sent message (we just needed the file_id)
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: JAY_ID, message_id: data.result.message_id }),
  });

  return largest.file_id;
}

// Chain data: 3 chains from different virtual users, different languages
const chains = [
  {
    creator: { id: 9999902, tz: 7, city: 'Bangkok' },  // Sora, Bangkok
    photo: '/tmp/jung-bangkok.jpg',
    caption: 'ปาดไทยริมทาง กลิ่นหอมลอยมาแต่ไกล ใครเห็นแล้วต้องหยุด 🔥',
    lang: 'th',
  },
  {
    creator: { id: 9999901, tz: 10, city: 'Sydney' },  // Emma, Sydney → Tokyo ramen
    photo: '/tmp/jung-tokyo.jpg',
    caption: '仕事帰りの一杯。この湯気を見ると、一日の疲れが全部飛んでいく 🍜',
    lang: 'ja',
  },
  {
    creator: { id: 9999904, tz: -3, city: 'São Paulo' },  // Liam → São Paulo coffee
    photo: '/tmp/jung-saopaulo.jpg',
    caption: 'Café da manhã no centro. Não tem nada melhor que esse aroma pra começar o dia ☕',
    lang: 'pt',
  },
];

async function main() {
  console.log('\n2️⃣ Uploading photos to Telegram...');

  const now = new Date();

  for (let i = 0; i < chains.length; i++) {
    const c = chains[i];
    console.log(`\n── Chain ${i + 1}: ${c.lang} (${c.creator.city}) ──`);

    // Upload photo
    const fileId = await uploadPhoto(c.photo, c.caption);

    // Create chain
    const localHour = ((now.getUTCHours() + c.creator.tz) % 24 + 24) % 24;
    const chainId = createChain(c.creator.id, c.creator.tz, now.toISOString(), 'free', localHour);
    console.log(`  ✅ Chain #${chainId} created`);

    // Add block (slot 1 = creator's block)
    addBlock(chainId, 1, c.creator.id, c.creator.tz, c.caption, fileId, 'photo');
    console.log(`  ✅ Block added: "${c.caption.slice(0, 40)}..."`);

    // Create assignment for jay (slot 2)
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const assignId = createAssignment(JAY_ID, chainId, 2, expiresAt);
    console.log(`  ✅ Assignment #${assignId} for jay (slot 2)`);
  }

  console.log('\n3️⃣ Done! jay now has 3 pending chains.');
  console.log('   → Go to Telegram and tap "도착한 정" or /menu');
}

main().catch(console.error);
