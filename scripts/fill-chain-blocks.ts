import 'dotenv/config';
import { readFileSync } from 'fs';
import { config } from '../src/config.js';
import db, {
  upsertUser, createChain, addBlock, createAssignment, updateCityI18n,
} from '../src/db/database.js';

const BOT_TOKEN = config.jungBotToken;
const JAY_ID = 5023569703;

// Clean up all test data
console.log('🗑️ Cleaning...');
db.prepare("DELETE FROM assignments WHERE user_id = ?").run(JAY_ID);
db.prepare("DELETE FROM blocks WHERE user_id = ?").run(JAY_ID);
for (let i = 1; i <= 50; i++) {
  db.prepare('DELETE FROM assignments WHERE chain_id = ?').run(i);
  db.prepare('DELETE FROM blocks WHERE chain_id = ?').run(i);
  db.prepare('DELETE FROM chains WHERE id = ?').run(i);
}
// Clean virtual users
db.prepare('DELETE FROM users WHERE telegram_id >= 8000000 AND telegram_id < 9000000').run();
console.log('  ✅ Cleaned');

// City/caption data per TZ
const TZ_DATA: Record<number, { city: string; firstName: string; lang: string; captions: string[] }> = {
  12: { city: 'Auckland', firstName: 'Liam', lang: 'en', captions: ['Morning light in NZ 🌅', 'Flat white to start the day ☕'] },
  11: { city: 'Noumea', firstName: 'Marie', lang: 'fr', captions: ['Le lagon au lever du soleil 🌊'] },
  10: { city: 'Sydney', firstName: 'Emma', lang: 'en', captions: ['Sydney harbour vibes', 'Brekkie time 🦘'] },
  8: { city: 'Taipei', firstName: 'Ming', lang: 'zh', captions: ['夜市的味道太棒了 🧋', '台北的夜景真美'] },
  7: { city: 'Bangkok', firstName: 'Sora', lang: 'th', captions: ['ปาดไทยริมทาง กลิ่นหอมลอยมาแต่ไกล 🔥', 'กาแฟเย็นหนึ่งแก้ว ☕'] },
  6: { city: 'Dhaka', firstName: 'Rahim', lang: 'en', captions: ['Chai time in Dhaka ☕'] },
  5: { city: 'Karachi', firstName: 'Ali', lang: 'en', captions: ['Biryani for dinner 🍚'] },
  4: { city: 'Dubai', firstName: 'Omar', lang: 'ar', captions: ['مساء الخير من دبي 🌃', 'قهوة عربية'] },
  3: { city: 'Moscow', firstName: 'Dmitri', lang: 'ru', captions: ['Москва вечером ❄️', 'Чай после работы'] },
  2: { city: 'Cairo', firstName: 'Amira', lang: 'ar', captions: ['القاهرة ليلاً 🌙'] },
  1: { city: 'Paris', firstName: 'Claire', lang: 'fr', captions: ['Croissant du matin 🥐', 'Paris sous la pluie 🌧️'] },
  0: { city: 'London', firstName: 'James', lang: 'en', captions: ['Tea time ☕', 'Rainy afternoon 🌧️'] },
  '-1': { city: 'Cape Verde', firstName: 'João', lang: 'pt', captions: ['Pôr do sol 🌅'] },
  '-2': { city: 'Azores', firstName: 'Ana', lang: 'pt', captions: ['Vista do oceano 🌊'] },
  '-3': { city: 'São Paulo', firstName: 'Lucas', lang: 'pt', captions: ['Café da manhã no centro ☕', 'Pôr do sol na Paulista 🌇'] },
  '-4': { city: 'Santiago', firstName: 'Diego', lang: 'es', captions: ['Empanadas 🥟', 'Los Andes de fondo 🏔️'] },
  '-5': { city: 'New York', firstName: 'Mike', lang: 'en', captions: ['NYC hot dog at midnight 🌭', 'Central Park morning run 🏃'] },
  '-6': { city: 'Mexico City', firstName: 'Carlos', lang: 'es', captions: ['Tacos al pastor 🌮'] },
  '-7': { city: 'Denver', firstName: 'Sarah', lang: 'en', captions: ['Mountain views 🏔️'] },
  '-8': { city: 'LA', firstName: 'Chris', lang: 'en', captions: ['Venice Beach sunset 🌴'] },
  '-9': { city: 'Anchorage', firstName: 'Dave', lang: 'en', captions: ['Northern lights! 🌌'] },
  '-10': { city: 'Honolulu', firstName: 'Kai', lang: 'en', captions: ['Poke bowl 🐟', 'Aloha 🌺'] },
  '-11': { city: 'Pago Pago', firstName: 'Tui', lang: 'en', captions: ['Island vibes 🏝️'] },
};

function getUserId(tz: number): number { return 8000000 + ((tz + 12) % 24); }

function ensureUser(tz: number) {
  const data = TZ_DATA[tz];
  if (!data) return;
  upsertUser(getUserId(tz), `user_tz${tz}`, data.firstName, tz, 9, data.lang, data.city);
}

function randomCaption(tz: number): string {
  const data = TZ_DATA[tz];
  if (!data) return `Hello from UTC${tz >= 0 ? '+' : ''}${tz}`;
  return data.captions[Math.floor(Math.random() * data.captions.length)];
}

// Get existing photo file_ids to reuse
const existingPhotos = db.prepare(
  "SELECT DISTINCT media_url FROM blocks WHERE media_type = 'photo' AND media_url IS NOT NULL LIMIT 10"
).all() as any[];

// Upload photos if none exist yet
async function uploadPhoto(filePath: string): Promise<string> {
  const form = new FormData();
  form.append('chat_id', JAY_ID.toString());
  form.append('photo', new Blob([readFileSync(filePath)], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`Upload failed`);
  const fileId = data.result.photo[data.result.photo.length - 1].file_id;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: JAY_ID, message_id: data.result.message_id }),
  });
  return fileId;
}

// Westward TZ sequence from start (exclusive) to end (exclusive)
function westwardBetween(startTz: number, endTz: number): number[] {
  const path: number[] = [];
  let tz = startTz - 1;
  while (true) {
    if (tz < -11) tz = 12;
    if (tz === endTz) break;
    path.push(tz);
    tz--;
  }
  return path;
}

async function main() {
  // Upload showcase photos
  console.log('📸 Uploading showcase photos...');
  const bangkokPhoto = await uploadPhoto('/tmp/jung-bangkok.jpg');
  const nycPhoto = await uploadPhoto('/tmp/jung-nyc.jpg');
  const spPhoto = await uploadPhoto('/tmp/jung-saopaulo.jpg');
  console.log('  ✅ 3 photos uploaded');

  // Generic reuse photo (tokyo ramen for intermediate blocks)
  const genericPhoto = await uploadPhoto('/tmp/jung-tokyo.jpg');

  const now = new Date();

  // ═══════════════════════════════════════
  // Chain A: Started in Sydney (UTC+10), last block = Bangkok (UTC+7)
  //   Path: +10(creator) → +9(skip, same as jay) → +8 → +7(Bangkok) → ... wait
  //   Actually westward: +10 → +9 would be jay. So jay should be at slot 2 or later.
  //   Let's start from Auckland (+12) → westward → +11 → +10 → +9? No, +9 is jay.
  //   We need the chain to arrive at +9 with Bangkok as the LAST block.
  //   Bangkok is +7. After Bangkok (+7), westward: +6 → +5 → ... that goes AWAY from +9.
  //
  //   For Bangkok (+7) to be the last block before jay (+9):
  //   The chain must go: ... → +8 → +7(Bangkok) and then somehow reach +9?
  //   No — westward means: ... → +8(Taipei) → +7(Bangkok) → +6 → +5 → ...
  //   Bangkok can't be "just before" Seoul going westward.
  //
  //   Actually, for the "last block" to be from Bangkok going westward to Seoul:
  //   Chain started at +8 (Taipei). +8 → +7(Bangkok) → +6 → ... → -11 → +12 → +11 → +10 → +9(Seoul)
  //   That means Bangkok is block 2 and there are 20 more blocks between Bangkok and Seoul.
  //
  //   OR: the chain started at UTC+10, going westward:
  //   +10(creator) → +9 is Seoul (slot 2). Too quick.
  //
  //   The simplest: last block from a nearby-but-different TZ.
  //   For Bangkok to be the LAST block before Seoul, the creator must be at +8:
  //   +8(creator) → +7(Bangkok) → +6 → +5 → ... → +9(Seoul) = Bangkok is slot 2, Seoul is slot ~23.
  //   Bangkok is NOT the last - there are many blocks between.
  //
  //   OK I think the user just wants realistic chains with blocks accumulated.
  //   The LAST block (what jay sees) = the most recent contributor.
  //   So:
  //     Chain A: origin=Paris(+1), traveled westward, last block from Taipei(+8)=nearby Seoul.
  //       +1 → 0(London) → -1 → ... → -11 → +12 → +11 → +10 → +9(Seoul)
  //       That's 17 hops. Last block before Seoul could be +10(Sydney).
  //
  //   Actually, let me simplify: the LAST block is always from the TZ just before +9 in the westward direction, which is +10. So the last person before jay is always from UTC+10 (Sydney area).
  //
  //   Unless some TZs are skipped! If +10 is skipped, then the last block could be from +11 (Noumea) or +12 (Auckland) etc.
  //
  //   Wait no. The westward direction from the creator goes: creator → creator-1 → creator-2 → ...
  //   Eventually it wraps around to +9 (Seoul). The slot JUST BEFORE Seoul is +10.
  //   If +10 is skipped, the previous filled slot becomes the "last block."
  //
  //   But in the current bot code, `getLastBlock(chainId)` just gets the most recent block by slot_index.
  //   The arrival message shows the LAST BLOCK's content, not necessarily from +10.
  //
  //   So for the test to show Bangkok/NYC/SP photos, those need to be the LAST blocks added.
  //
  //   Let me just structure it as:
  //   - Chain starts somewhere
  //   - Various intermediate blocks get added (some skipped)
  //   - The FINAL block is the showcase (Bangkok/NYC/SP photo)
  //   - Then jay's assignment is the next slot
  // ═══════════════════════════════════════

  const chainConfigs = [
    {
      name: 'Chain A',
      originTz: 1,        // Started in Paris
      originUser: { id: 9999910, username: 'claire_fr', firstName: 'Claire', lang: 'fr', city: 'Paris' },
      // Path from Paris westward: 0, -1, -2, ..., -11, +12, +11, +10, +9(jay)
      // We want last block to be from Bangkok. Bangkok is +7.
      // Going westward from Paris: 0→-1→...→-11→+12→+11→+10→+9
      // Bangkok (+7) is NOT on this path before Seoul...
      // OK let me just pick the showcase block as the last one before jay.
      // Last slot before Seoul (+9) = UTC+10 (Sydney). Let's put Bangkok photo there.
      // Actually the showcase photo is just the last block's photo.
      // Let me build the path, fill intermediate, then put showcase as last.
      showcasePhoto: bangkokPhoto,
      showcaseCaption: 'ปาดไทยริมทาง กลิ่นหอมลอยมาแต่ไกล ใครเห็นแล้วต้องหยุด 🔥',
      showcaseTz: 10,  // The last TZ before Seoul
      showcaseUser: { id: 9999902, username: 'sora_th', firstName: 'Sora', lang: 'th', city: 'Bangkok' },
      skipRate: 0.35,
    },
    {
      name: 'Chain B',
      originTz: -3,       // Started in São Paulo
      originUser: { id: 9999906, username: 'lucas_br', firstName: 'Lucas', lang: 'pt', city: 'São Paulo' },
      // Path: -4→-5→...→-11→+12→+11→+10→+9
      showcasePhoto: nycPhoto,
      showcaseCaption: 'Nothing beats a NYC hot dog after midnight 🌭🗽',
      showcaseTz: 10,
      showcaseUser: { id: 9999907, username: 'mike_nyc', firstName: 'Mike', lang: 'en', city: 'New York' },
      skipRate: 0.3,
    },
    {
      name: 'Chain C',
      originTz: -8,       // Started in LA
      originUser: { id: 9999908, username: 'chris_la', firstName: 'Chris', lang: 'en', city: 'Los Angeles' },
      // Path: -9→-10→-11→+12→+11→+10→+9
      showcasePhoto: spPhoto,
      showcaseCaption: 'Café da manhã no centro. Não tem nada melhor que esse aroma ☕',
      showcaseTz: 10,
      showcaseUser: { id: 9999909, username: 'lucas_sp', firstName: 'Lucas', lang: 'pt', city: 'São Paulo' },
      skipRate: 0.25,
    },
  ];

  for (const cfg of chainConfigs) {
    console.log(`\n── ${cfg.name}: ${cfg.originUser.firstName} @ ${cfg.originUser.city} (UTC${cfg.originTz >= 0 ? '+' : ''}${cfg.originTz}) ──`);

    // Create origin user
    upsertUser(cfg.originUser.id, cfg.originUser.username, cfg.originUser.firstName, cfg.originTz, 9, cfg.originUser.lang, cfg.originUser.city);

    // Create chain
    const localHour = ((now.getUTCHours() + cfg.originTz) % 24 + 24) % 24;
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000); // started 12h ago
    const chainId = createChain(cfg.originUser.id, cfg.originTz, startTime.toISOString(), 'free', localHour);

    // Block 1: origin
    addBlock(chainId, 1, cfg.originUser.id, cfg.originTz, randomCaption(cfg.originTz) || `Starting from ${cfg.originUser.city}`, genericPhoto, 'photo');

    // Intermediate path (exclude last TZ before Seoul, that's the showcase)
    const fullPath = westwardBetween(cfg.originTz, 9); // all TZs between origin and Seoul
    const intermediatePath = fullPath.slice(0, -1); // exclude last (that'll be showcase)

    let slotIndex = 2;
    let filled = 1; // creator already filled

    for (const tz of intermediatePath) {
      if (tz === 9) { slotIndex++; continue; } // skip Seoul (that's jay)

      const skip = Math.random() < cfg.skipRate;
      if (skip) { slotIndex++; continue; }

      if (!TZ_DATA[tz]) { slotIndex++; continue; }

      ensureUser(tz);
      addBlock(chainId, slotIndex, getUserId(tz), tz, randomCaption(tz), genericPhoto, 'photo');
      filled++;
      slotIndex++;
    }

    // Showcase block (last before Seoul)
    upsertUser(cfg.showcaseUser.id, cfg.showcaseUser.username, cfg.showcaseUser.firstName, cfg.showcaseTz, 9, cfg.showcaseUser.lang, cfg.showcaseUser.city);
    addBlock(chainId, slotIndex, cfg.showcaseUser.id, cfg.showcaseTz, cfg.showcaseCaption, cfg.showcasePhoto, 'photo');
    filled++;
    const showcaseSlot = slotIndex;
    slotIndex++;

    // Update block_count
    db.prepare('UPDATE chains SET block_count = ? WHERE id = ?').run(filled, chainId);

    // Assignment for jay
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const assignId = createAssignment(JAY_ID, chainId, slotIndex, expiresAt);

    console.log(`  Chain #${chainId}: ${filled} blocks (${intermediatePath.length - (filled - 2)} skipped)`);
    console.log(`  Last block: ${cfg.showcaseUser.firstName} @ ${cfg.showcaseUser.city} (slot ${showcaseSlot})`);
    console.log(`  → jay's slot: ${slotIndex}`);
  }

  console.log('\n✅ Done! /menu → 도착한 정');
}

main().catch(console.error);
