/**
 * 정체인 시뮬레이션 v5 — 최종 규칙
 * 
 * 규칙:
 * 1. 정각 단위 열림/닫힘 (1시간)
 * 2. 롤링 배정 — 하나씩 뜨고, 이어쓰기 or 스킵
 * 3. 스킵하면 다음 체인, 전송하면 또 다음
 * 4. 1시간 지나면 사라짐 (작성 중이어도)
 * 5. 24개 정수 타임존 (UTC-11 ~ UTC+12)
 * 6. humanScore 없음, 정지기 없음, 타임아웃 없음
 * 7. 직전 슬롯 콘텐츠만 보여줌
 * 8. N/24 카운트 표시
 * 9. 24시간 후 시작점 복귀 = 완주
 * 
 * 시뮬: 체인 동시 진행, 유저가 롤링으로 스킵/이어쓰기 선택
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// --- Types ---
interface TzInfo {
  offset: number;
  city: string;
  flag: string;
  pool: number;
  avgWriteMin: number;
  activeStart: number; // 현지 활성 시작
  activeEnd: number;
}

interface Block {
  chainId: number;
  tzOffset: number;
  city: string;
  flag: string;
  userName: string;
  slotNumber: number;   // 1~24 (몇 번째 슬롯인지)
  writeMin: number;      // 작성 시간 (분)
}

interface SkipEvent {
  chainId: number;
  tzOffset: number;
  city: string;
  flag: string;
  slotNumber: number;
  userName?: string;     // 스킵한 유저 (있으면)
  reason: 'skipped' | 'no_users' | 'inactive' | 'timeout';
}

interface ChainResult {
  chainId: number;
  startOffset: number;
  startCity: string;
  blocks: Block[];
  skips: SkipEvent[];
  completed: boolean;
  blockCount: number;    // 실제 이어쓴 블록 수
}

interface HourLog {
  hour: number;          // 0~23 (체인 경과 시간)
  tzOffset: number;
  city: string;
  flag: string;
  chainsOpened: number;  // 이 TZ에서 열린 체인 수
  chainsAnswered: number;
  chainsSkipped: number;
  chainsMissed: number;
  activeUsers: number;
  userDetails: { name: string; wrote: number; skipped: number }[];
}

// --- Config ---
const NUM_CHAINS = 10;
const SKIP_RATE = 0.35;  // 콘텐츠 보고 스킵할 확률
const NUM_SIMS = 50;

const LOCAL_START_HOUR = 14; // 각 체인 시작 = 현지 14:00

const TIMEZONE_DATA: TzInfo[] = [
  { offset: 12, city: 'Auckland',      flag: '🇳🇿', pool: 3,  avgWriteMin: 8,  activeStart: 7, activeEnd: 23 },
  { offset: 11, city: 'Solomon Is.',   flag: '🇸🇧', pool: 0,  avgWriteMin: 0,  activeStart: 0, activeEnd: 0 },
  { offset: 10, city: 'Sydney',        flag: '🇦🇺', pool: 5,  avgWriteMin: 7,  activeStart: 7, activeEnd: 23 },
  { offset: 9,  city: 'Seoul',         flag: '🇰🇷', pool: 30, avgWriteMin: 5,  activeStart: 8, activeEnd: 24 },
  { offset: 8,  city: 'Shanghai',      flag: '🇨🇳', pool: 8,  avgWriteMin: 7,  activeStart: 8, activeEnd: 23 },
  { offset: 7,  city: 'Bangkok',       flag: '🇹🇭', pool: 4,  avgWriteMin: 9,  activeStart: 8, activeEnd: 22 },
  { offset: 6,  city: 'Dhaka',         flag: '🇧🇩', pool: 2,  avgWriteMin: 10, activeStart: 8, activeEnd: 22 },
  { offset: 5,  city: 'Karachi',       flag: '🇵🇰', pool: 3,  avgWriteMin: 9,  activeStart: 8, activeEnd: 22 },
  { offset: 4,  city: 'Dubai',         flag: '🇦🇪', pool: 2,  avgWriteMin: 8,  activeStart: 9, activeEnd: 23 },
  { offset: 3,  city: 'Moscow',        flag: '🇷🇺', pool: 4,  avgWriteMin: 8,  activeStart: 8, activeEnd: 23 },
  { offset: 2,  city: 'Istanbul',      flag: '🇹🇷', pool: 3,  avgWriteMin: 7,  activeStart: 8, activeEnd: 23 },
  { offset: 1,  city: 'Paris',         flag: '🇫🇷', pool: 5,  avgWriteMin: 6,  activeStart: 8, activeEnd: 23 },
  { offset: 0,  city: 'London',        flag: '🇬🇧', pool: 6,  avgWriteMin: 6,  activeStart: 7, activeEnd: 23 },
  { offset: -1, city: 'Azores',        flag: '🇵🇹', pool: 0,  avgWriteMin: 0,  activeStart: 0, activeEnd: 0 },
  { offset: -2, city: 'Fernando de N.',flag: '🇧🇷', pool: 0,  avgWriteMin: 0,  activeStart: 0, activeEnd: 0 },
  { offset: -3, city: 'São Paulo',     flag: '🇧🇷', pool: 3,  avgWriteMin: 8,  activeStart: 8, activeEnd: 23 },
  { offset: -4, city: 'Santiago',      flag: '🇨🇱', pool: 2,  avgWriteMin: 9,  activeStart: 8, activeEnd: 22 },
  { offset: -5, city: 'New York',      flag: '🇺🇸', pool: 8,  avgWriteMin: 6,  activeStart: 7, activeEnd: 23 },
  { offset: -6, city: 'Chicago',       flag: '🇺🇸', pool: 3,  avgWriteMin: 7,  activeStart: 7, activeEnd: 23 },
  { offset: -7, city: 'Denver',        flag: '🇺🇸', pool: 2,  avgWriteMin: 8,  activeStart: 7, activeEnd: 22 },
  { offset: -8, city: 'Los Angeles',   flag: '🇺🇸', pool: 5,  avgWriteMin: 6,  activeStart: 7, activeEnd: 23 },
  { offset: -9, city: 'Anchorage',     flag: '🇺🇸', pool: 0,  avgWriteMin: 0,  activeStart: 0, activeEnd: 0 },
  { offset: -10,city: 'Honolulu',      flag: '🇺🇸', pool: 1,  avgWriteMin: 10, activeStart: 7, activeEnd: 22 },
  { offset: -11,city: 'Samoa',         flag: '🇼🇸', pool: 1,  avgWriteMin: 12, activeStart: 7, activeEnd: 21 },
];

const NAMES: Record<string, string[]> = {
  'Auckland': ['Kiri', 'Aroha', 'Tane'],
  'Solomon Is.': [],
  'Sydney': ['Liam', 'Mia', 'Noah', 'Olivia', 'Jack'],
  'Seoul': ['민수','지은','현우','수진','태현','서연','준혁','하은','도윤','예린','시우','지호','민지','서준','유진','하준','소율','준서','다은','시연','건우','지유','은서','도현','채원','승현','수아','재이','하린','윤서'],
  'Shanghai': ['小雨','李明','王芳','张伟','陈静','刘洋','赵磊','黄丽'],
  'Bangkok': ['Somchai','Priya','Niran','Suda'],
  'Dhaka': ['Rahim','Fatema'],
  'Karachi': ['Ali','Ayesha','Usman'],
  'Dubai': ['Ahmed','Fatima'],
  'Moscow': ['Alexei','Natasha','Dmitri','Olga'],
  'Istanbul': ['Elif','Kemal','Zeynep'],
  'Paris': ['Pierre','Amélie','Lucas','Camille','Hugo'],
  'London': ['James','Emma','Oliver','Sophie','Harry','Lily'],
  'Azores': [],
  'Fernando de N.': [],
  'São Paulo': ['Rafael','Ana','Pedro'],
  'Santiago': ['Matías','Catalina'],
  'New York': ['Alex','Sarah','Mike','Jordan','Taylor','Avery','Casey','Morgan'],
  'Chicago': ['Chris','Pat','Riley'],
  'Denver': ['Sam','Dakota'],
  'Los Angeles': ['Dylan','Chloe','Jake','Luna','Kai'],
  'Anchorage': [],
  'Honolulu': ['Kai_HI'],
  'Samoa': ['Tui'],
};

// --- Helpers ---
function getTz(offset: number): TzInfo {
  return TIMEZONE_DATA.find(t => t.offset === offset)!;
}

function getNextOffset(current: number): number {
  return current === -11 ? 12 : current - 1;
}

function getSequence(start: number): number[] {
  const seq: number[] = [];
  let c = getNextOffset(start);
  while (c !== start) { seq.push(c); c = getNextOffset(c); }
  seq.push(start);
  return seq;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function getWriteTime(avg: number): number {
  return Math.max(2, avg * (0.3 + Math.random() * Math.random() * 2.5));
}

// chainHour: 체인 경과 시간 (0=시작)
// startOffset: 체인이 시작된 TZ offset
// targetOffset: 현재 슬롯의 TZ offset
// 체인 시작 = startOffset의 현지 14:00
// 다음 TZ는 1시간 후 열림 → 그 TZ의 현지 시각 = 14:00 + (경과시간) + (TZ차이)
function getLocalHour(chainHour: number, startOffset: number, targetOffset: number): number {
  // 시작 TZ에서 현지 14:00 → UTC = 14 - startOffset
  const startUTC = LOCAL_START_HOUR - startOffset;
  // 경과 시간 후 UTC = startUTC + chainHour
  // target의 현지 = UTC + targetOffset
  let h = (startUTC + chainHour + targetOffset) % 24;
  if (h < 0) h += 24;
  return h;
}

function isActive(chainHour: number, startOffset: number, tz: TzInfo): boolean {
  if (tz.pool === 0) return false;
  const lh = getLocalHour(chainHour, startOffset, tz.offset);
  return tz.activeEnd > 24
    ? (lh >= tz.activeStart || lh < tz.activeEnd - 24)
    : (lh >= tz.activeStart && lh < tz.activeEnd);
}

function willOpenApp(tz: TzInfo): boolean {
  return Math.random() > Math.pow(0.65, tz.pool);
}

// --- Simulation ---
function simulate(numChains: number): { chains: ChainResult[]; hourLogs: HourLog[] } {
  const startOffsets = shuffle(
    TIMEZONE_DATA.filter(t => t.pool > 0).map(t => t.offset)
  ).slice(0, numChains);

  // Chain state
  interface CState {
    chainId: number;
    startOffset: number;
    sequence: number[];
    blocks: Block[];
    skips: SkipEvent[];
    step: number; // current index in sequence
  }

  const chains: CState[] = startOffsets.map((so, i) => {
    const tz = getTz(so);
    const names = NAMES[tz.city] || [];
    return {
      chainId: i,
      startOffset: so,
      sequence: getSequence(so),
      blocks: [{
        chainId: i, tzOffset: so, city: tz.city, flag: tz.flag,
        userName: names[Math.floor(Math.random() * names.length)] || `User_${tz.city}`,
        slotNumber: 1, writeMin: getWriteTime(tz.avgWriteMin),
      }],
      skips: [],
      step: 0,
    };
  });

  const hourLogs: HourLog[] = [];

  // 24 hours
  for (let hour = 1; hour <= 24; hour++) {
    // Group chains by which TZ they're at this hour
    const tzQueues: Map<number, CState[]> = new Map();

    for (const c of chains) {
      if (c.step >= c.sequence.length) continue;
      const offset = c.sequence[c.step];
      if (!tzQueues.has(offset)) tzQueues.set(offset, []);
      tzQueues.get(offset)!.push(c);
    }

    for (const [offset, queue] of tzQueues) {
      const tz = getTz(offset);
      const slotNumber = hour + 1; // 시작이 1이니까

      // No users
      if (tz.pool === 0) {
        for (const c of queue) {
          c.skips.push({
            chainId: c.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
            slotNumber, reason: 'no_users',
          });
          c.step++;
        }
        hourLogs.push({
          hour, tzOffset: offset, city: tz.city, flag: tz.flag,
          chainsOpened: queue.length, chainsAnswered: 0, chainsSkipped: 0,
          chainsMissed: queue.length, activeUsers: 0, userDetails: [],
        });
        continue;
      }

      // Inactive time — need startOffset per chain, check if ANY chain's start makes this active
      // Since chains have different startOffsets, check per-chain
      // Split queue into active/inactive based on each chain's startOffset
      const activeQueue: CState[] = [];
      const inactiveQueue: CState[] = [];
      for (const c of queue) {
        if (isActive(hour, c.startOffset, tz)) {
          activeQueue.push(c);
        } else {
          inactiveQueue.push(c);
        }
      }
      for (const c of inactiveQueue) {
        c.skips.push({
          chainId: c.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
          slotNumber, reason: 'inactive',
        });
        c.step++;
      }

      if (false) {
        // already handled above
        if (activeQueue.length === 0) {
          hourLogs.push({
            hour, tzOffset: offset, city: tz.city, flag: tz.flag,
            chainsOpened: queue.length, chainsAnswered: 0, chainsSkipped: 0,
            chainsMissed: queue.length, activeUsers: 0, userDetails: [],
          });
          continue;
        }
      }

      // Replace queue with activeQueue for the rest
      const workQueue = activeQueue;

      // Active users who open the app
      const allNames = shuffle([...(NAMES[tz.city] || [])].slice(0, tz.pool));
      const activeNames = allNames.filter(() => willOpenApp(tz));

      if (activeNames.length === 0) {
        for (const c of workQueue) {
          c.skips.push({
            chainId: c.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
            slotNumber, reason: 'timeout',
          });
          c.step++;
        }
        hourLogs.push({
          hour, tzOffset: offset, city: tz.city, flag: tz.flag,
          chainsOpened: queue.length, chainsAnswered: 0, chainsSkipped: 0,
          chainsMissed: queue.length, activeUsers: 0, userDetails: [],
        });
        continue;
      }

      // Rolling assignment
      const chainQueue = shuffle([...workQueue]);
      const userTimeLeft: Map<string, number> = new Map();
      const userStats: Map<string, { wrote: number; skipped: number }> = new Map();
      activeNames.forEach(n => {
        userTimeLeft.set(n, 60);
        userStats.set(n, { wrote: 0, skipped: 0 });
      });

      let answered = 0;
      let skippedByUser = 0;
      let qIdx = 0;
      const userQueue = shuffle([...activeNames]);
      let uIdx = 0;

      // Round-robin: each user gets a chain, processes it, gets next
      const userChainIdx: Map<string, number> = new Map(); // current chain index per user

      // Simple approach: iterate chain queue, assign to next available user
      while (qIdx < chainQueue.length) {
        const chain = chainQueue[qIdx];
        let handled = false;

        // Try each user (round-robin)
        for (let attempt = 0; attempt < activeNames.length; attempt++) {
          const userName = userQueue[uIdx % userQueue.length];
          uIdx++;

          const timeLeft = userTimeLeft.get(userName) || 0;
          if (timeLeft <= 0) continue;

          // User sees this chain — skip or write?
          if (Math.random() < SKIP_RATE) {
            // Skip — chain goes to next user
            chain.skips.push({
              chainId: chain.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
              slotNumber, userName, reason: 'skipped',
            });
            const stats = userStats.get(userName)!;
            stats.skipped++;
            userTimeLeft.set(userName, timeLeft - 1); // 스킵도 시간 약간 소모
            skippedByUser++;
            continue; // try next user for this chain
          }

          // Write!
          const writeTime = getWriteTime(tz.avgWriteMin);
          if (writeTime > timeLeft) {
            // 시간 부족 — 작성 중 사라짐
            chain.skips.push({
              chainId: chain.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
              slotNumber, userName, reason: 'timeout',
            });
            userTimeLeft.set(userName, 0);
            continue;
          }

          // Success!
          chain.blocks.push({
            chainId: chain.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
            userName, slotNumber, writeMin: writeTime,
          });
          userTimeLeft.set(userName, timeLeft - writeTime);
          const stats = userStats.get(userName)!;
          stats.wrote++;
          answered++;
          handled = true;
          break;
        }

        if (!handled) {
          // No user could handle this chain
          chain.skips.push({
            chainId: chain.chainId, tzOffset: offset, city: tz.city, flag: tz.flag,
            slotNumber, reason: 'timeout',
          });
        }

        chain.step++;
        qIdx++;
      }

      hourLogs.push({
        hour, tzOffset: offset, city: tz.city, flag: tz.flag,
        chainsOpened: queue.length, chainsAnswered: answered,
        chainsSkipped: skippedByUser,
        chainsMissed: queue.length - answered,
        activeUsers: activeNames.length,
        userDetails: Array.from(userStats.entries()).map(([name, s]) => ({
          name, wrote: s.wrote, skipped: s.skipped,
        })),
      });
    }
  }

  // Build results
  const results: ChainResult[] = chains.map(c => {
    const completed = c.blocks.length >= 2 &&
      c.blocks[c.blocks.length - 1].tzOffset === c.startOffset;
    const startTz = getTz(c.startOffset);
    return {
      chainId: c.chainId,
      startOffset: c.startOffset,
      startCity: startTz.city,
      blocks: c.blocks,
      skips: c.skips,
      completed,
      blockCount: c.blocks.length,
    };
  });

  return { chains: results, hourLogs };
}

// --- Analysis ---
function analyze(sims: { chains: ChainResult[]; hourLogs: HourLog[] }[]) {
  const allChains = sims.flatMap(s => s.chains);
  const total = allChains.length;
  const completed = allChains.filter(c => c.completed);
  const rate = (completed.length / total * 100).toFixed(1);

  console.log('═'.repeat(70));
  console.log('  정체인 시뮬레이션 v5 — 최종 규칙');
  console.log('  정각 · 1시간 타이머 · 롤링(스킵/이어쓰기) · 1:1 · 24 TZ');
  console.log('═'.repeat(70));
  console.log(`\n설정: ${NUM_CHAINS}개 체인 동시 | 스킵율 ${(SKIP_RATE*100).toFixed(0)}% | ${sims.length}회 시뮬\n`);

  console.log(`📊 완주율: ${completed.length}/${total} (${rate}%)`);
  console.log(`평균 블록/체인: ${(allChains.reduce((s,c) => s + c.blockCount, 0) / total).toFixed(1)} / 25`);
  if (completed.length > 0) {
    console.log(`완주 체인 평균 블록: ${(completed.reduce((s,c) => s + c.blockCount, 0) / completed.length).toFixed(1)}`);
  }

  // Skip reasons
  const skipReasons: Record<string, number> = {};
  allChains.forEach(c => c.skips.forEach(s => {
    skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;
  }));
  console.log(`\n⏭ 스킵/미스 사유:`);
  Object.entries(skipReasons).sort(([,a],[,b]) => b-a).forEach(([r,c]) => {
    console.log(`  ${r}: ${c}회`);
  });

  // 유저 활동
  const userWrites: Record<string, number> = {};
  allChains.forEach(c => c.blocks.forEach(b => {
    userWrites[`${b.flag}${b.userName}`] = (userWrites[`${b.flag}${b.userName}`] || 0) + 1;
  }));
  console.log(`\n🏆 유저 리더보드 (총 이어쓰기):`);
  Object.entries(userWrites).sort(([,a],[,b]) => b-a).slice(0, 10).forEach(([u,c]) => {
    console.log(`  ${u}: ${c}회 (평균 ${(c/sims.length).toFixed(1)}/시뮬)`);
  });

  // TZ별 처리율
  console.log(`\n🌍 타임존별 체인 처리율:`);
  const tzStats: Record<number, { opened: number; answered: number }> = {};
  sims.forEach(s => s.hourLogs.forEach(h => {
    if (!tzStats[h.tzOffset]) tzStats[h.tzOffset] = { opened: 0, answered: 0 };
    tzStats[h.tzOffset].opened += h.chainsOpened;
    tzStats[h.tzOffset].answered += h.chainsAnswered;
  }));
  TIMEZONE_DATA.forEach(tz => {
    const s = tzStats[tz.offset];
    if (!s) return;
    const pct = s.opened > 0 ? (s.answered / s.opened * 100).toFixed(0) : '—';
    const bar = '█'.repeat(Math.round(s.answered / s.opened * 20));
    console.log(`  ${tz.flag} ${tz.city.padEnd(14)} ${bar.padEnd(20)} ${pct}% (${s.answered}/${s.opened})`);
  });

  // 샘플
  const sample = sims[0];
  console.log(`\n─── 샘플 (${sample.chains.filter(c=>c.completed).length}/${sample.chains.length} 완주) ───`);

  for (const c of sample.chains.slice(0, 3)) {
    const st = getTz(c.startOffset);
    console.log(`\n  Chain #${c.chainId} ${st.flag} ${st.city} → ${c.completed ? '✅ 완주' : '❌'} (${c.blockCount}블록)`);

    const events = [
      ...c.blocks.map(b => ({ t: 'b' as const, slot: b.slotNumber, d: b })),
      ...c.skips.map(s => ({ t: 's' as const, slot: s.slotNumber, d: s })),
    ].sort((a, b) => a.slot - b.slot);

    // Dedupe by slot (show block if exists, else skip)
    const slotMap: Map<number, typeof events[0]> = new Map();
    for (const ev of events) {
      if (ev.t === 'b' || !slotMap.has(ev.slot)) {
        slotMap.set(ev.slot, ev);
      }
    }

    for (const [slot, ev] of [...slotMap.entries()].sort(([a],[b]) => a-b)) {
      if (ev.t === 'b') {
        const b = ev.d as Block;
        console.log(`    ${String(slot).padStart(2)}/24 │ ${b.flag} ${b.city.padEnd(14)} │ ✍️ ${b.userName.padEnd(8)} (${Math.floor(b.writeMin)}min)`);
      } else {
        const s = ev.d as SkipEvent;
        const icon = s.reason === 'no_users' ? '👻' : s.reason === 'skipped' ? '⏭' : s.reason === 'inactive' ? '🌙' : '⏰';
        console.log(`    ${String(slot).padStart(2)}/24 │ ${s.flag} ${s.city.padEnd(14)} │ ${icon} ${s.reason}`);
      }
    }
  }
}

// --- HTML ---
function genHTML(sims: { chains: ChainResult[]; hourLogs: HourLog[] }[]): string {
  const allChains = sims.flatMap(s => s.chains);
  const total = allChains.length;
  const completed = allChains.filter(c => c.completed);
  const rate = (completed.length / total * 100).toFixed(0);
  const avgBlocks = (allChains.reduce((s,c) => s + c.blockCount, 0) / total).toFixed(1);

  const sample = sims[0];

  // TZ stats
  const tzStats: Record<number, { opened: number; answered: number }> = {};
  sims.forEach(s => s.hourLogs.forEach(h => {
    if (!tzStats[h.tzOffset]) tzStats[h.tzOffset] = { opened: 0, answered: 0 };
    tzStats[h.tzOffset].opened += h.chainsOpened;
    tzStats[h.tzOffset].answered += h.chainsAnswered;
  }));

  // User leaderboard
  const userWrites: Record<string, number> = {};
  allChains.forEach(c => c.blocks.forEach(b => {
    userWrites[`${b.flag}${b.userName}`] = (userWrites[`${b.flag}${b.userName}`] || 0) + 1;
  }));
  const leaderboard = Object.entries(userWrites)
    .map(([u, c]) => ({ user: u, total: c, avg: c / sims.length }))
    .sort((a, b) => b.total - a.total).slice(0, 15);

  function renderChain(c: ChainResult): string {
    const events = [
      ...c.blocks.map(b => ({ t: 'b' as const, slot: b.slotNumber, d: b })),
      ...c.skips.map(s => ({ t: 's' as const, slot: s.slotNumber, d: s })),
    ].sort((a, b) => a.slot - b.slot);

    const slotMap: Map<number, typeof events[0]> = new Map();
    for (const ev of events) {
      if (ev.t === 'b' || !slotMap.has(ev.slot)) slotMap.set(ev.slot, ev);
    }

    return [...slotMap.entries()].sort(([a],[b]) => a-b).map(([slot, ev]) => {
      if (ev.t === 'b') {
        const b = ev.d as Block;
        return `<div class="step"><span class="slot">${slot}/24</span><span class="flag">${b.flag}</span><span class="city">${b.city}</span><span class="ev ok">✍️ ${b.userName} <span class="m">${Math.floor(b.writeMin)}m</span></span></div>`;
      } else {
        const s = ev.d as SkipEvent;
        const ic = s.reason === 'no_users' ? '👻' : s.reason === 'skipped' ? '⏭' : s.reason === 'inactive' ? '🌙' : '⏰';
        return `<div class="step"><span class="slot">${slot}/24</span><span class="flag">${s.flag}</span><span class="city">${s.city}</span><span class="ev miss">${ic} ${s.reason}</span></div>`;
      }
    }).join('');
  }

  // TZ heatmap data
  const tzRows = TIMEZONE_DATA.map(tz => {
    const s = tzStats[tz.offset] || { opened: 0, answered: 0 };
    const pct = s.opened > 0 ? Math.round(s.answered / s.opened * 100) : 0;
    return { ...tz, pct, answered: s.answered, opened: s.opened };
  });

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>정체인 시뮬레이션 v5</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e0e0e0;font-family:'SF Mono',monospace;padding:20px;max-width:1400px;margin:0 auto}
h1{text-align:center;color:#fff;font-size:20px;margin-bottom:4px}
.sub{text-align:center;color:#777;font-size:11px;margin-bottom:25px;line-height:1.6}
.overview{display:flex;gap:10px;justify-content:center;margin-bottom:25px;flex-wrap:wrap}
.stat{background:#1a1a2e;padding:10px 16px;border-radius:8px;text-align:center}
.stat .n{font-size:20px;font-weight:bold;color:#e94560}
.stat .l{font-size:9px;color:#777}
.section{margin-bottom:25px}
.section h2{font-size:14px;margin-bottom:12px;color:#aaa}
.chains{display:flex;flex-wrap:wrap;gap:12px}
.card{background:#111;border-radius:8px;padding:10px;flex:1;min-width:260px;max-width:380px}
.card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px}
.badge{font-size:10px;padding:2px 8px;border-radius:4px}
.badge.ok{background:#1a2d1a;color:#45e960}
.badge.fail{background:#2d1a1a;color:#e94560}
.step{display:flex;align-items:center;margin-bottom:1px;font-size:10px;min-height:17px}
.slot{width:35px;text-align:right;color:#555;margin-right:6px;font-size:9px}
.flag{width:16px;font-size:11px}
.city{width:85px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px}
.ev{flex:1;font-size:10px}
.ev.ok{color:#4ecdc4}
.ev.miss{color:#444}
.m{color:#555;font-size:8px}
.tz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:4px}
.tz-bar{display:flex;align-items:center;gap:6px;padding:4px 8px;background:#111;border-radius:4px;font-size:10px}
.tz-bar .info{flex:1;color:#aaa}
.tz-bar .bar{height:10px;border-radius:2px;background:#333}
.tz-bar .fill{height:100%;border-radius:2px}
.tz-bar .pct{width:30px;text-align:right;color:#888;font-size:9px}
.lb{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:3px}
.lb-row{display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 8px;background:#111;border-radius:4px}
.lb-row .rank{width:18px;color:#555}
.lb-row .name{flex:1;color:#aaa}
.lb-row .bar{height:8px;flex:2;background:#1a1a2e;border-radius:2px;overflow:hidden}
.lb-row .bar .fill{height:100%;background:#e94560;border-radius:2px}
.lb-row .val{width:30px;text-align:right;color:#888;font-size:10px}
.rules{background:#111;border-radius:8px;padding:15px;font-size:11px;line-height:1.8;margin-top:20px}
.rules h3{margin-bottom:6px;font-size:13px}
.rules li{color:#999;margin-left:16px}
</style></head><body>
<h1>정체인 v5 — 최종 시뮬레이션</h1>
<p class="sub">정각 열림 · 1시간 타이머 · 롤링 스킵/이어쓰기 · 직전 콘텐츠만 · N/24 카운트<br>
${NUM_CHAINS}개 체인 동시 · 스킵율 ${(SKIP_RATE*100).toFixed(0)}% · ${sims.length}회 시뮬</p>

<div class="overview">
<div class="stat"><div class="n">${rate}%</div><div class="l">완주율</div></div>
<div class="stat"><div class="n">${avgBlocks}</div><div class="l">블록/체인</div></div>
<div class="stat"><div class="n">${completed.length}</div><div class="l">완주</div></div>
<div class="stat"><div class="n">${total - completed.length}</div><div class="l">미완주</div></div>
</div>

<div class="section">
<h2>🌍 타임존별 체인 처리율</h2>
<div class="tz-grid">
${tzRows.map(t => `<div class="tz-bar"><span class="flag">${t.flag}</span><span class="info">${t.city}</span><div class="bar" style="width:60px"><div class="fill" style="width:${t.pct}%;background:${t.pct > 70 ? '#45e960' : t.pct > 40 ? '#f0c040' : t.pct > 0 ? '#e94560' : '#333'}"></div></div><span class="pct">${t.pct}%</span></div>`).join('')}
</div>
</div>

<div class="section">
<h2>🔗 샘플 체인 (${sample.chains.filter(c=>c.completed).length}/${sample.chains.length} 완주)</h2>
<div class="chains">
${sample.chains.map(c => {
  const st = getTz(c.startOffset);
  return `<div class="card"><div class="card-h"><span>${st.flag} #${c.chainId} ${st.city}</span><span class="badge ${c.completed?'ok':'fail'}">${c.completed?'✅':'❌'} ${c.blockCount}블록</span></div>${renderChain(c)}</div>`;
}).join('')}
</div>
</div>

<div class="section">
<h2>🏆 유저 리더보드</h2>
<div class="lb">
${leaderboard.map((l, i) => {
  const maxT = leaderboard[0].total;
  return `<div class="lb-row"><span class="rank">${i+1}</span><span class="name">${l.user}</span><div class="bar"><div class="fill" style="width:${(l.total/maxT*100).toFixed(0)}%"></div></div><span class="val">${l.avg.toFixed(1)}</span></div>`;
}).join('')}
</div>
</div>

<div class="rules">
<h3>📋 정체인 규칙</h3>
<ol>
<li>체인 시작: 정시에 생성 → 다음 TZ 정시에 열림</li>
<li>매 정시 알림 → 앱 열면 체인 하나 <b>롤링</b>으로 뜸</li>
<li><b>이어쓰기</b> → 전송 → 다음 체인 뜸 (1시간 내 여러 개 가능)</li>
<li><b>스킵</b> → 다른 유저에게 돌아감 → 다음 체인 뜸</li>
<li>1시간 지나면 작성 중이어도 <b>사라짐</b></li>
<li>직전 슬롯 콘텐츠만 보여줌 + <b>N/24</b> 카운트</li>
<li>24개 TZ 돌아오면 <b>완주</b> → 전체 체인 공개</li>
<li>humanScore 없음 · 정지기 없음 · 사람만</li>
</ol>
</div>
</body></html>`;
}

// --- Main ---
console.log('🔗 정체인 시뮬레이션 v5\n');

const sims: { chains: ChainResult[]; hourLogs: HourLog[] }[] = [];
for (let i = 0; i < NUM_SIMS; i++) {
  sims.push(simulate(NUM_CHAINS));
}

analyze(sims);

const htmlPath = join(process.cwd(), 'data', 'time-relay-sim.html');
writeFileSync(htmlPath, genHTML(sims), 'utf-8');
console.log(`\n✅ HTML: ${htmlPath}`);
