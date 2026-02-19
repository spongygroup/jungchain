import 'dotenv/config';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { config } from '../src/config.js';
import db, {
  upsertUser, createChain, addBlock, createAssignment, updateCityI18n,
} from '../src/db/database.js';

const BOT_TOKEN = config.jungBotToken;
const JAY_ID = 5023569703;

// 1. Generate photo with Imagen 4
console.log('📸 Generating photo...');
const apiKey = config.googleApiKey;
const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${apiKey}`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instances: [{ prompt: 'A classic New York hot dog from a street cart, mustard and ketchup, Times Square lights blurred in background, evening, street food photography' }],
    parameters: { sampleCount: 1, aspectRatio: '9:16' },
  }),
});
const imgData = await res.json() as any;
const b64 = imgData.predictions?.[0]?.bytesBase64Encoded;
if (!b64) { console.error('Image generation failed'); process.exit(1); }
writeFileSync('/tmp/jung-nyc.jpg', Buffer.from(b64, 'base64'));
console.log('  ✅ Photo generated');

// 2. Create user
console.log('👤 Creating user...');
upsertUser(9999907, 'mike_nyc', 'Mike', -5, 9, 'en', 'New York');
updateCityI18n(9999907, {
  ko: '뉴욕', en: 'New York', ja: 'ニューヨーク', zh: '纽约', th: 'นิวยอร์ก',
  es: 'Nueva York', pt: 'Nova Iorque', fr: 'New York', ar: 'نيويورك', ru: 'Нью-Йорк',
  de: 'New York', it: 'New York', tr: 'New York', hi: 'न्यूयॉर्क', id: 'New York', vi: 'New York', uk: 'Нью-Йорк',
});
console.log('  ✅ Mike (New York, UTC-5)');

// 3. Upload photo
console.log('📤 Uploading...');
const form = new FormData();
form.append('chat_id', JAY_ID.toString());
form.append('photo', new Blob([readFileSync('/tmp/jung-nyc.jpg')], { type: 'image/jpeg' }), 'photo.jpg');
const sendRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
const sendData = await sendRes.json() as any;
const fileId = sendData.result.photo[sendData.result.photo.length - 1].file_id;
await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: JAY_ID, message_id: sendData.result.message_id }),
});
console.log('  ✅ Uploaded');

// 4. Create chain + assignment
const now = new Date();
const localHour = ((now.getUTCHours() + (-5)) % 24 + 24) % 24;
const chainId = createChain(9999907, -5, now.toISOString(), 'free', localHour);
addBlock(chainId, 1, 9999907, -5, 'Nothing beats a NYC hot dog after midnight. The city never sleeps and neither do I 🌭🗽', fileId, 'photo');
const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
createAssignment(JAY_ID, chainId, 2, expiresAt);

console.log(`\n✅ Chain #${chainId} — Mike @ New York (UTC-5)`);
console.log('   /menu → 도착한 정');
