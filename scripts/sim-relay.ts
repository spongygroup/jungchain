import 'dotenv/config';
import db from '../src/db/database.js';

// ─── Config ───
const SIM_USER_MIN = 7000000;
const SIM_USER_MAX = 9000000;

// ─── Helpers ───
function nextTzWest(tz: number): number {
  const next = tz - 1;
  return next < -11 ? 12 : next;
}

function participationProb(userCount: number): number {
  if (userCount === 0) return 0;
  if (userCount <= 1) return 0.50;
  if (userCount <= 2) return 0.65;
  if (userCount <= 4) return 0.75;
  return 0.85;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Template captions per language — short, atmospheric, 정-like
const CAPTIONS: Record<string, string[]> = {
  ko: [
    '이 밤의 정을 이어갑니다.',
    '고요한 새벽, 누군가와 연결되어 있다는 것.',
    '창밖에 비가 내려. 이 체인처럼 조용히.',
    '잠이 안 와서 봤는데, 세계가 깨어있네.',
    '따뜻한 차 한 잔의 정을 보냅니다.',
  ],
  en: [
    'The night is deep here. Passing this chain forward.',
    'Can\'t sleep. But knowing someone else is awake helps.',
    'Rain outside my window. This chain feels like company.',
    'Sending warmth from this side of the world.',
    'Connected across the globe at this quiet hour.',
  ],
  ja: [
    '夜が深まっていく。この鎖を次へつなぐ。',
    '眠れない夜。でも誰かが起きていると思うと。',
    '静かな夜、世界とつながっている気がする。',
    '窓の外は暗い。でもこのチェーンは温かい。',
    'ここから温もりを送ります。',
  ],
  zh: [
    '夜深了。把这条链传下去。',
    '睡不着。但知道有人醒着就好。',
    '安静的夜晚，感觉和世界相连。',
    '窗外下着雨。这条链让我不孤单。',
    '从这里送去一份温暖。',
  ],
  th: [
    'คืนนี้เงียบมาก ส่งต่อสายนี้ไป',
    'นอนไม่หลับ แต่รู้ว่ามีคนตื่นอยู่ด้วย',
    'ฝนตกอยู่ข้างนอก สายนี้เหมือนเพื่อน',
    'ส่งความอบอุ่นจากที่นี่',
    'เชื่อมต่อข้ามโลกในยามค่ำคืน',
  ],
  es: [
    'La noche es profunda aquí. Paso esta cadena.',
    'No puedo dormir. Pero saber que alguien está despierto ayuda.',
    'Llueve afuera. Esta cadena se siente como compañía.',
    'Enviando calidez desde este lado del mundo.',
    'Conectados a través del mundo en esta hora tranquila.',
  ],
  pt: [
    'A noite está profunda aqui. Passo esta corrente adiante.',
    'Não consigo dormir. Mas saber que alguém está acordado ajuda.',
    'Chuva lá fora. Esta corrente é como companhia.',
    'Enviando calor deste lado do mundo.',
    'Conectados pelo mundo nesta hora silenciosa.',
  ],
  fr: [
    'La nuit est profonde ici. Je passe cette chaîne.',
    'Je n\'arrive pas à dormir. Mais savoir que quelqu\'un veille aide.',
    'Il pleut dehors. Cette chaîne est comme une présence.',
    'J\'envoie de la chaleur depuis ici.',
    'Connectés à travers le monde à cette heure calme.',
  ],
  ar: [
    'الليل عميق هنا. أمرر هذه السلسلة.',
    'لا أستطيع النوم. لكن معرفة أن أحداً مستيقظ تساعد.',
    'مطر بالخارج. هذه السلسلة تشبه الرفقة.',
    'أرسل الدفء من هذا الجانب من العالم.',
    'متصلون عبر العالم في هذه الساعة الهادئة.',
  ],
  ru: [
    'Ночь глубока. Передаю эту цепочку дальше.',
    'Не могу уснуть. Но знать, что кто-то бодрствует — помогает.',
    'За окном дождь. Эта цепочка как компания.',
    'Отправляю тепло с этой стороны мира.',
    'Связаны через весь мир в этот тихий час.',
  ],
  de: [
    'Die Nacht ist tief hier. Ich gebe diese Kette weiter.',
    'Kann nicht schlafen. Aber zu wissen, dass jemand wach ist, hilft.',
    'Regen draußen. Diese Kette fühlt sich wie Gesellschaft an.',
    'Sende Wärme von dieser Seite der Welt.',
    'Verbunden über den Globus in dieser stillen Stunde.',
  ],
  it: [
    'La notte è profonda qui. Passo questa catena.',
    'Non riesco a dormire. Ma sapere che qualcuno è sveglio aiuta.',
    'Piove fuori. Questa catena sembra compagnia.',
    'Invio calore da questo lato del mondo.',
    'Connessi attraverso il mondo in quest\'ora tranquilla.',
  ],
  tr: [
    'Gece burada derin. Bu zinciri ileri taşıyorum.',
    'Uyuyamıyorum. Ama birinin uyanık olduğunu bilmek yardımcı oluyor.',
    'Dışarıda yağmur var. Bu zincir arkadaşlık gibi.',
    'Dünyanın bu tarafından sıcaklık gönderiyorum.',
    'Bu sessiz saatte dünya genelinde bağlıyız.',
  ],
  id: [
    'Malam ini sunyi. Meneruskan rantai ini.',
    'Tidak bisa tidur. Tapi tahu seseorang terjaga membantu.',
    'Hujan di luar. Rantai ini terasa seperti teman.',
    'Mengirim kehangatan dari sisi dunia ini.',
    'Terhubung di seluruh dunia pada jam yang tenang ini.',
  ],
  hi: [
    'रात गहरी है यहाँ। इस कड़ी को आगे बढ़ाता हूँ।',
    'नींद नहीं आ रही। पर कोई जागा है, यह जानकर अच्छा लगा।',
    'बाहर बारिश हो रही है। यह चेन साथ जैसी लगती है।',
    'दुनिया के इस कोने से गर्मजोशी भेज रहा हूँ।',
    'इस शांत घड़ी में दुनिया भर से जुड़े हैं।',
  ],
  vi: [
    'Đêm sâu lắm rồi. Chuyền tiếp chuỗi này.',
    'Không ngủ được. Nhưng biết ai đó đang thức giúp ích.',
    'Mưa bên ngoài. Chuỗi này như có bạn bên cạnh.',
    'Gửi hơi ấm từ phía này của thế giới.',
    'Kết nối khắp thế giới trong giờ yên tĩnh này.',
  ],
  uk: [
    'Ніч глибока тут. Передаю цей ланцюжок далі.',
    'Не можу заснути. Але знати, що хтось не спить — допомагає.',
    'За вікном дощ. Цей ланцюжок як компанія.',
    'Надсилаю тепло з цього боку світу.',
    'Пов\'язані через весь світ у цю тиху годину.',
  ],
};

function getCaption(lang: string): string {
  const pool = CAPTIONS[lang] ?? CAPTIONS['en'];
  return pickRandom(pool);
}

// City display helper
function cityLabel(tz: number): string {
  const map: Record<number, string> = {
    12: 'Auckland', 11: 'Noumea', 10: 'Sydney', 9: 'Seoul/Tokyo',
    8: 'Taipei/Singapore', 7: 'Bangkok/Jakarta', 6: 'Dhaka/Almaty',
    5: 'Karachi/Tashkent', 4: 'Dubai/Baku', 3: 'Moscow/Istanbul',
    2: 'Cairo/Johannesburg', 1: 'Paris/Berlin', 0: 'London/Lisbon',
    '-1': 'Cape Verde', '-2': 'Fernando de Noronha', '-3': 'São Paulo/BA',
    '-4': 'Santiago/La Paz', '-5': 'New York/Miami', '-6': 'Mexico/Chicago',
    '-7': 'Denver/Phoenix', '-8': 'LA/SF', '-9': 'Anchorage',
    '-10': 'Honolulu', '-11': 'Pago Pago',
  };
  return map[tz] ?? `UTC${tz >= 0 ? '+' : ''}${tz}`;
}

// ─── Main Simulation ───

interface SimBlock {
  slotIndex: number;
  tz: number;
  userId: number;
  userName: string;
  city: string;
  lang: string;
  caption: string;
}

interface SimChain {
  chainId: number;
  starterName: string;
  starterTz: number;
  starterCity: string;
  blocks: SimBlock[];
  skippedTzs: number[];
  startUtc: string;
}

// Clean old sim chains
console.log('🧹 Cleaning old sim chain data...');
const oldSimChains = db.prepare(`
  SELECT id FROM chains WHERE creator_id >= ? AND creator_id < ?
`).all(SIM_USER_MIN, SIM_USER_MAX) as any[];
for (const c of oldSimChains) {
  db.prepare('DELETE FROM assignments WHERE chain_id = ?').run(c.id);
  db.prepare('DELETE FROM blocks WHERE chain_id = ?').run(c.id);
  db.prepare('DELETE FROM chains WHERE id = ?').run(c.id);
}
console.log(`  Cleaned ${oldSimChains.length} old chains.\n`);

// Get sim users grouped by TZ
const simUsers = db.prepare(`
  SELECT * FROM users WHERE telegram_id >= ? AND telegram_id < ? ORDER BY tz_offset DESC
`).all(SIM_USER_MIN, SIM_USER_MAX) as any[];

const usersByTz = new Map<number, any[]>();
for (const u of simUsers) {
  if (!usersByTz.has(u.tz_offset)) usersByTz.set(u.tz_offset, []);
  usersByTz.get(u.tz_offset)!.push(u);
}

// Define 12 chain starters — pick from actual DB users
const starterDefs = [
  { tz: 9, localHour: 8 },   // Seoul/Tokyo morning
  { tz: 9, localHour: 10 },  // Seoul/Tokyo mid-morning
  { tz: 8, localHour: 9 },   // Taipei morning
  { tz: 7, localHour: 12 },  // Bangkok noon
  { tz: 4, localHour: 14 },  // Baku afternoon
  { tz: 1, localHour: 9 },   // Paris morning
  { tz: 0, localHour: 12 },  // London noon
  { tz: -5, localHour: 8 },  // NYC morning
  { tz: -6, localHour: 11 }, // Mexico late morning
  { tz: -8, localHour: 19 }, // LA evening
  { tz: -3, localHour: 15 }, // São Paulo afternoon
  { tz: -10, localHour: 18 },// Honolulu evening
];

// Track which users already started a chain (so second +9 chain uses different user)
const usedStarters = new Set<number>();

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  🌏 Phase 2: Linear Relay Simulation (no forks)  ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const results: SimChain[] = [];

for (let i = 0; i < starterDefs.length; i++) {
  const def = starterDefs[i];
  const tzUsers = usersByTz.get(def.tz) ?? [];
  const available = tzUsers.filter(u => !usedStarters.has(u.telegram_id));
  if (available.length === 0) {
    console.log(`⚠️ Chain #${i + 1}: No available starter at UTC${def.tz >= 0 ? '+' : ''}${def.tz}`);
    continue;
  }

  const starter = pickRandom(available);
  usedStarters.add(starter.telegram_id);

  // Calculate UTC start time
  const utcHour = ((def.localHour - def.tz) % 24 + 24) % 24;
  const startUtc = `2026-02-19T${String(utcHour).padStart(2, '0')}:00:00.000Z`;

  // Create chain in DB
  const chainId = (() => {
    const result = db.prepare(`
      INSERT INTO chains (creator_id, creator_tz, start_utc, mode, chain_hour, status)
      VALUES (?, ?, ?, 'photo', ?, 'active')
    `).run(starter.telegram_id, def.tz, startUtc, def.localHour);
    return Number(result.lastInsertRowid);
  })();

  const chain: SimChain = {
    chainId,
    starterName: starter.first_name,
    starterTz: def.tz,
    starterCity: starter.city,
    blocks: [],
    skippedTzs: [],
    startUtc,
  };

  // Block 1: starter
  const starterCaption = getCaption(starter.lang);
  db.prepare(`
    INSERT INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_type)
    VALUES (?, 1, ?, ?, ?, 'photo')
  `).run(chainId, starter.telegram_id, def.tz, starterCaption);
  db.prepare('UPDATE chains SET block_count = 1 WHERE id = ?').run(chainId);

  chain.blocks.push({
    slotIndex: 1,
    tz: def.tz,
    userId: starter.telegram_id,
    userName: starter.first_name,
    city: starter.city,
    lang: starter.lang,
    caption: starterCaption,
  });

  // Slots 2~24: westward relay
  let currentTz = def.tz;
  let slotIndex = 1;

  for (let slot = 2; slot <= 24; slot++) {
    currentTz = nextTzWest(currentTz);
    slotIndex = slot;

    const tzPool = (usersByTz.get(currentTz) ?? [])
      .filter(u => u.telegram_id !== starter.telegram_id); // exclude chain starter

    const prob = participationProb(tzPool.length);
    const participates = Math.random() < prob;

    if (!participates || tzPool.length === 0) {
      chain.skippedTzs.push(currentTz);
      continue;
    }

    // Pick one random user from this TZ
    const participant = pickRandom(tzPool);
    const caption = getCaption(participant.lang);

    db.prepare(`
      INSERT INTO blocks (chain_id, slot_index, user_id, tz_offset, content, media_type)
      VALUES (?, ?, ?, ?, ?, 'photo')
    `).run(chainId, slot, participant.telegram_id, currentTz, caption);
    db.prepare('UPDATE chains SET block_count = block_count + 1 WHERE id = ?').run(chainId);

    chain.blocks.push({
      slotIndex: slot,
      tz: currentTz,
      userId: participant.telegram_id,
      userName: participant.first_name,
      city: participant.city,
      lang: participant.lang,
      caption,
    });
  }

  // Complete chain
  db.prepare(`
    UPDATE chains SET status = 'completed', completed_at = datetime('now'),
    block_count = (SELECT COUNT(*) FROM blocks WHERE chain_id = ?) WHERE id = ?
  `).run(chainId, chainId);

  results.push(chain);
}

// ─── Print Results ───

console.log(`📊 Created ${results.length} chains\n`);

let totalBlocks = 0;
let totalSkips = 0;

for (const chain of results) {
  const sign = chain.starterTz >= 0 ? '+' : '';
  totalBlocks += chain.blocks.length;
  totalSkips += chain.skippedTzs.length;

  console.log(`━━━ Chain #${chain.chainId} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Starter: ${chain.starterName} @ ${chain.starterCity} (UTC${sign}${chain.starterTz})`);
  console.log(`  Start:   ${chain.startUtc}`);
  console.log(`  Blocks:  ${chain.blocks.length}/24  │  Skips: ${chain.skippedTzs.length}`);
  console.log(`  Route:`);

  // Build full 24-slot timeline
  let tz = chain.starterTz;
  for (let slot = 1; slot <= 24; slot++) {
    const block = chain.blocks.find(b => b.slotIndex === slot);
    const tzSign = tz >= 0 ? '+' : '';
    const tzLabel = `UTC${tzSign}${tz}`.padEnd(7);
    const city = cityLabel(tz).padEnd(22);

    if (block) {
      const shortCaption = block.caption.length > 40
        ? block.caption.slice(0, 37) + '...'
        : block.caption;
      console.log(`    ${String(slot).padStart(2)}/24 │ ${tzLabel} │ ${city} │ ✅ ${block.userName}(${block.lang}): "${shortCaption}"`);
    } else {
      console.log(`    ${String(slot).padStart(2)}/24 │ ${tzLabel} │ ${city} │ ⬜ skip`);
    }

    tz = nextTzWest(tz);
  }
  console.log('');
}

// ─── Summary ───

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  📊 Phase 2 Summary                              ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`  Chains:         ${results.length}`);
console.log(`  Total blocks:   ${totalBlocks}`);
console.log(`  Total skips:    ${totalSkips}`);
console.log(`  Avg blocks:     ${(totalBlocks / results.length).toFixed(1)}/24`);
console.log(`  Fill rate:      ${(totalBlocks / (results.length * 24) * 100).toFixed(1)}%`);

// Best/worst chains
const best = results.reduce((a, b) => a.blocks.length > b.blocks.length ? a : b);
const worst = results.reduce((a, b) => a.blocks.length < b.blocks.length ? a : b);
console.log(`  Best chain:     #${best.chainId} (${best.blocks.length}/24) — ${best.starterName}@${best.starterCity}`);
console.log(`  Worst chain:    #${worst.chainId} (${worst.blocks.length}/24) — ${worst.starterName}@${worst.starterCity}`);

// TZ heatmap
console.log('\n  🗺️ TZ Block Density (across all chains):');
const tzBlockCount = new Map<number, number>();
const tzTotalSlots = new Map<number, number>();
for (const chain of results) {
  let tz = chain.starterTz;
  for (let slot = 1; slot <= 24; slot++) {
    tzTotalSlots.set(tz, (tzTotalSlots.get(tz) ?? 0) + 1);
    if (chain.blocks.some(b => b.slotIndex === slot)) {
      tzBlockCount.set(tz, (tzBlockCount.get(tz) ?? 0) + 1);
    }
    tz = nextTzWest(tz);
  }
}

const sortedTzs = Array.from(new Set([...tzBlockCount.keys(), ...tzTotalSlots.keys()])).sort((a, b) => b - a);
for (const tz of sortedTzs) {
  const blocks = tzBlockCount.get(tz) ?? 0;
  const total = tzTotalSlots.get(tz) ?? 0;
  const pct = total > 0 ? Math.round(blocks / total * 100) : 0;
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const sign = tz >= 0 ? '+' : '';
  const users = (usersByTz.get(tz) ?? []).length;
  console.log(`    UTC${sign}${String(tz).padEnd(3)} ${bar} ${String(pct).padStart(3)}%  (${blocks}/${total} slots, ${users} users)`);
}

// Language participation
console.log('\n  🌐 Language Participation:');
const langBlocks = new Map<string, number>();
for (const chain of results) {
  for (const b of chain.blocks) {
    langBlocks.set(b.lang, (langBlocks.get(b.lang) ?? 0) + 1);
  }
}
for (const [lang, cnt] of Array.from(langBlocks.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${lang.padEnd(3)} ${String(cnt).padStart(3)} blocks`);
}

console.log('\n╚══════════════════════════════════════════════════╝');
console.log('\n✅ Phase 2 complete. Data written to DB.');
