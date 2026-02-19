import 'dotenv/config';
import db, {
  createChain, addBlock, getBlockCount, blockExistsAtSlot,
  createForkChain, completeChain, getExpiredActiveChains,
  getAllBlocks, getAllForksOfRoot, getChain,
} from '../src/db/database.js';

// ─── Config ───
const SIM_USER_MIN = 7000000;
const SIM_USER_MAX = 9000000;

function nextTzWest(tz: number): number {
  return tz - 1 < -11 ? 12 : tz - 1;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CAPTIONS: Record<string, string[]> = {
  ko: ['이 밤의 정을 이어갑니다.', '고요한 새벽, 누군가와 연결되어 있다는 것.', '창밖에 비가 내려.'],
  en: ['Passing this chain forward.', 'Rain outside my window.', 'Sending warmth from here.'],
  ja: ['夜が深まっていく。', '静かな夜、世界とつながっている。', 'ここから温もりを送ります。'],
  zh: ['夜深了。把这条链传下去。', '安静的夜晚，感觉和世界相连。', '从这里送去一份温暖。'],
  th: ['คืนนี้เงียบมาก ส่งต่อสายนี้ไป', 'นอนไม่หลับ แต่รู้ว่ามีคนตื่นอยู่', 'ส่งความอบอุ่นจากที่นี่'],
  fr: ['La nuit est profonde ici.', 'Il pleut dehors.', 'J\'envoie de la chaleur.'],
  de: ['Die Nacht ist tief hier.', 'Regen draußen.', 'Sende Wärme von hier.'],
  es: ['La noche es profunda aquí.', 'Llueve afuera.', 'Enviando calidez desde aquí.'],
  pt: ['A noite está profunda aqui.', 'Chuva lá fora.', 'Enviando calor daqui.'],
  ru: ['Ночь глубока.', 'За окном дождь.', 'Отправляю тепло отсюда.'],
  tr: ['Gece burada derin.', 'Dışarıda yağmur var.', 'Buradan sıcaklık gönderiyorum.'],
  it: ['La notte è profonda qui.', 'Piove fuori.', 'Invio calore da qui.'],
  id: ['Malam ini sunyi.', 'Hujan di luar.', 'Mengirim kehangatan dari sini.'],
  ar: ['الليل عميق هنا.', 'مطر بالخارج.', 'أرسل الدفء من هنا.'],
};

function getCaption(lang: string): string {
  return pickRandom(CAPTIONS[lang] ?? CAPTIONS['en']);
}

function cityLabel(tz: number): string {
  const map: Record<number, string> = {
    12: 'Auckland', 11: 'Noumea', 10: 'Sydney', 9: 'Seoul/Tokyo',
    8: 'Taipei/Singapore', 7: 'Bangkok/Jakarta', 6: 'Dhaka/Almaty',
    5: 'Karachi/Tashkent', 4: 'Dubai/Baku', 3: 'Moscow/Istanbul',
    2: 'Cairo/Johannesburg', 1: 'Paris/Berlin', 0: 'London/Lisbon',
    '-1': 'Cape Verde', '-2': 'F. de Noronha', '-3': 'São Paulo/BA',
    '-4': 'Santiago/La Paz', '-5': 'New York/Miami', '-6': 'Mexico/Chicago',
    '-7': 'Denver/Phoenix', '-8': 'LA/SF', '-9': 'Anchorage',
    '-10': 'Honolulu', '-11': 'Pago Pago',
  };
  return map[tz] ?? `UTC${tz >= 0 ? '+' : ''}${tz}`;
}

// ─── Clean old sim chains ───
console.log('🧹 기존 시뮬레이션 체인 정리...');
const oldSimChains = db.prepare(`
  SELECT id FROM chains WHERE creator_id >= ? AND creator_id < ?
`).all(SIM_USER_MIN, SIM_USER_MAX) as any[];
for (const c of oldSimChains) {
  db.prepare('DELETE FROM assignments WHERE chain_id = ?').run(c.id);
  db.prepare('DELETE FROM blocks WHERE chain_id = ?').run(c.id);
  db.prepare('DELETE FROM chains WHERE id = ?').run(c.id);
}
console.log(`  ${oldSimChains.length}개 체인 정리 완료.\n`);

// ─── Get sim users by TZ ───
const simUsers = db.prepare(`
  SELECT * FROM users WHERE telegram_id >= ? AND telegram_id < ? ORDER BY tz_offset DESC
`).all(SIM_USER_MIN, SIM_USER_MAX) as any[];

const usersByTz = new Map<number, any[]>();
for (const u of simUsers) {
  if (!usersByTz.has(u.tz_offset)) usersByTz.set(u.tz_offset, []);
  usersByTz.get(u.tz_offset)!.push(u);
}

// ─── Chain definitions ───
const chainDefs = [
  { tz: 9,  localHour: 8,  label: 'Seoul morning' },
  { tz: 9,  localHour: 10, label: 'Seoul mid-morning' },
  { tz: 1,  localHour: 9,  label: 'Paris morning' },
  { tz: -5, localHour: 8,  label: 'NYC morning' },
  { tz: -8, localHour: 19, label: 'LA evening' },
];

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  🔀 포크 시뮬레이션 (Fork Simulation)             ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const usedStarters = new Set<number>();

interface ForkResult {
  rootChainId: number;
  chains: Map<number, { chainId: number; blocks: { slot: number; tz: number; user: string; lang: string; caption: string; forked: boolean }[] }>;
  forkCount: number;
}

const results: ForkResult[] = [];

for (const def of chainDefs) {
  const tzPool = usersByTz.get(def.tz) ?? [];
  const available = tzPool.filter(u => !usedStarters.has(u.telegram_id));
  if (available.length === 0) {
    console.log(`⚠️ UTC${def.tz >= 0 ? '+' : ''}${def.tz}에 가용 유저 없음`);
    continue;
  }

  const starter = pickRandom(available);
  usedStarters.add(starter.telegram_id);

  const utcHour = ((def.localHour - def.tz) % 24 + 24) % 24;
  const startUtc = `2026-02-19T${String(utcHour).padStart(2, '0')}:00:00.000Z`;

  // createChain (root_chain_id = self 자동 설정)
  const rootChainId = createChain(starter.telegram_id, def.tz, startUtc, 'photo', def.localHour);

  const result: ForkResult = {
    rootChainId,
    chains: new Map(),
    forkCount: 0,
  };

  // 블록 1: 시작자
  addBlock(rootChainId, 1, starter.telegram_id, def.tz, getCaption(starter.lang), null as any, 'photo');

  result.chains.set(rootChainId, {
    chainId: rootChainId,
    blocks: [{ slot: 1, tz: def.tz, user: starter.first_name, lang: starter.lang, caption: '', forked: false }],
  });

  // 슬롯 2~24: 서쪽으로 릴레이
  let currentTz = def.tz;

  for (let slot = 2; slot <= 24; slot++) {
    currentTz = nextTzWest(currentTz);
    const tzPool = (usersByTz.get(currentTz) ?? []).filter(u => u.telegram_id !== starter.telegram_id);
    if (tzPool.length === 0) continue;

    // 참여 확률: 80%
    const participants = tzPool.filter(() => Math.random() < 0.8);
    if (participants.length === 0) continue;

    // 첫 번째 유저: 원래 체인에 기록 (또는 이미 있으면 포크)
    // 여러 유저가 참여하면 각각 기록 → 두 번째부터 포크 발생
    for (let pi = 0; pi < participants.length; pi++) {
      const participant = participants[pi];
      const caption = getCaption(participant.lang);

      if (pi === 0) {
        // 첫 번째 유저: 원래 체인에 기록
        addBlock(rootChainId, slot, participant.telegram_id, currentTz, caption, null as any, 'photo');
        result.chains.get(rootChainId)!.blocks.push({
          slot, tz: currentTz, user: participant.first_name, lang: participant.lang, caption, forked: false,
        });
      } else {
        // 두 번째+ 유저: 포크!
        const forkChainId = createForkChain(rootChainId, slot, participant.telegram_id, currentTz);
        addBlock(forkChainId, slot, participant.telegram_id, currentTz, caption, null as any, 'photo');
        result.forkCount++;

        const copiedBlocks = getAllBlocks(forkChainId).filter(b => b.slot_index < slot);
        result.chains.set(forkChainId, {
          chainId: forkChainId,
          blocks: [
            ...copiedBlocks.map(b => {
              const u = simUsers.find(u => u.telegram_id === b.user_id);
              return { slot: b.slot_index, tz: b.tz_offset, user: u?.first_name ?? '?', lang: u?.lang ?? 'en', caption: '', forked: false };
            }),
            { slot, tz: currentTz, user: participant.first_name, lang: participant.lang, caption, forked: true },
          ],
        });
      }
    }
  }

  // 체인 완료
  for (const [chainId] of result.chains) {
    const count = getBlockCount(chainId);
    if (count >= 24) {
      completeChain(chainId);
    }
  }

  results.push(result);
}

// ─── 시간 기반 만료 테스트 ───
console.log('⏰ 시간 기반 만료 테스트 (24h 후 시점 시뮬)...');
const future = new Date('2026-02-20T12:00:00Z').toISOString();
const expiredChains = getExpiredActiveChains(future);
for (const chain of expiredChains) {
  completeChain(chain.id);
}
console.log(`  ${expiredChains.length}개 체인 시간 만료 완료\n`);

// ─── 결과 출력 ───
let totalForks = 0;
let totalBlocks = 0;

for (const result of results) {
  const rootChain = getChain(result.rootChainId);
  const allForks = getAllForksOfRoot(result.rootChainId);
  totalForks += result.forkCount;

  console.log(`━━━ Root Chain #${result.rootChainId} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  시작: UTC${rootChain.creator_tz >= 0 ? '+' : ''}${rootChain.creator_tz} ${cityLabel(rootChain.creator_tz)}`);
  console.log(`  상태: ${rootChain.status}`);
  console.log(`  포크 수: ${result.forkCount}`);
  console.log(`  체인 family: ${allForks.length}개 (root + ${allForks.length - 1} forks)\n`);

  // 각 체인 출력
  for (const [chainId, data] of result.chains) {
    const chain = getChain(chainId);
    const isRoot = chainId === result.rootChainId;
    const blocks = getAllBlocks(chainId);
    totalBlocks += blocks.length;

    const prefix = isRoot ? '📍 ROOT' : `  🔀 FORK(slot ${chain.fork_slot})`;
    console.log(`  ${prefix} Chain #${chainId} — ${blocks.length} blocks — ${chain.status}`);

    // 타임라인 출력
    let tz = rootChain.creator_tz;
    for (let slot = 1; slot <= 24; slot++) {
      const block = blocks.find((b: any) => b.slot_index === slot);
      const tzSign = tz >= 0 ? '+' : '';
      const tzLabel = `UTC${tzSign}${tz}`.padEnd(7);
      const city = cityLabel(tz).padEnd(18);

      if (block) {
        const u = simUsers.find(u => u.telegram_id === block.user_id);
        const name = u?.first_name ?? '?';
        const isForkPoint = !isRoot && slot === chain.fork_slot;
        const marker = isForkPoint ? '🔀' : '✅';
        console.log(`    ${String(slot).padStart(2)}/24 │ ${tzLabel} │ ${city} │ ${marker} ${name}(${u?.lang ?? '?'})`);
      } else {
        console.log(`    ${String(slot).padStart(2)}/24 │ ${tzLabel} │ ${city} │ ⬜`);
      }
      tz = nextTzWest(tz);
    }
    console.log('');
  }
}

// ─── Summary ───
console.log('╔══════════════════════════════════════════════════╗');
console.log('║  📊 포크 시뮬레이션 결과                          ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`  체인 수 (root):    ${results.length}`);
console.log(`  총 포크 수:        ${totalForks}`);
console.log(`  총 체인 수:        ${results.length + totalForks}`);
console.log(`  총 블록 수:        ${totalBlocks}`);
console.log(`  시간 만료 체인:    ${expiredChains.length}`);

// 포크가 많이 발생한 TZ
const forkByTz = new Map<number, number>();
for (const result of results) {
  for (const [chainId, data] of result.chains) {
    if (chainId === result.rootChainId) continue;
    const chain = getChain(chainId);
    // fork 지점의 TZ 계산
    let tz = getChain(result.rootChainId).creator_tz;
    for (let s = 1; s < chain.fork_slot; s++) tz = nextTzWest(tz);
    forkByTz.set(tz, (forkByTz.get(tz) ?? 0) + 1);
  }
}

if (forkByTz.size > 0) {
  console.log('\n  🔀 포크 발생 TZ:');
  for (const [tz, count] of Array.from(forkByTz.entries()).sort((a, b) => b[1] - a[1])) {
    const users = (usersByTz.get(tz) ?? []).length;
    console.log(`    UTC${tz >= 0 ? '+' : ''}${tz} ${cityLabel(tz).padEnd(18)} — ${count} forks (${users} users)`);
  }
}

console.log('\n╚══════════════════════════════════════════════════╝');
console.log('\n✅ 포크 시뮬레이션 완료. DB에 기록됨.');
