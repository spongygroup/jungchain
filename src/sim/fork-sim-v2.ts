/**
 * 정체인 포크 시뮬레이션 v2
 * - 타임존 전체 유저 참여 (대기자 0)
 * - 다음 타임존 전달: 유저수 × 3 = 생존 슬롯
 * - 브랜치 > 슬롯이면 humanScore 상위만 생존
 * - 생존 브랜치를 유저에게 3개씩 랜덤 배분
 * - 유저풀 0이면 1시간 대기 후 정지기 (humanScore=0)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// --- Types ---
interface User {
  name: string;
  timezone: number;
  city: string;
  participationType: number; // 1=full(100), 2=text(60), 3=choice(40), 4=timeout(0)
}

interface Branch {
  id: string;
  slotIndex: number;
  user: User | null; // null = 정지기
  humanScore: number;
  parentBranchId: string | null;
  selectedFrom: string | null; // which parent branch this user chose
}

interface SlotResult {
  slotIndex: number;
  city: string;
  flag: string;
  poolSize: number;
  incomingBranches: number;
  survivedBranches: number;
  newBranches: Branch[];
  jungzigiUsed: boolean;
}

// --- Config ---
const TIMEZONES = [
  { slot: 0, city: 'Auckland', flag: '🇳🇿' },
  { slot: 1, city: 'Sydney', flag: '🇦🇺' },
  { slot: 2, city: 'Tokyo', flag: '🇯🇵' },
  { slot: 3, city: 'Seoul', flag: '🇰🇷' },
  { slot: 4, city: 'Shanghai', flag: '🇨🇳' },
  { slot: 5, city: 'Taipei', flag: '🇹🇼' },
  { slot: 6, city: 'Bangkok', flag: '🇹🇭' },
  { slot: 7, city: 'Mumbai', flag: '🇮🇳' },
  { slot: 8, city: 'Dubai', flag: '🇦🇪' },
  { slot: 9, city: 'Moscow', flag: '🇷🇺' },
  { slot: 10, city: 'Istanbul', flag: '🇹🇷' },
  { slot: 11, city: 'Cairo', flag: '🇪🇬' },
  { slot: 12, city: 'Paris', flag: '🇫🇷' },
  { slot: 13, city: 'London', flag: '🇬🇧' },
  { slot: 14, city: 'Azores', flag: '🇵🇹' },
  { slot: 15, city: 'São Paulo', flag: '🇧🇷' },
  { slot: 16, city: 'Buenos Aires', flag: '🇦🇷' },
  { slot: 17, city: 'New York', flag: '🇺🇸' },
  { slot: 18, city: 'Chicago', flag: '🇺🇸' },
  { slot: 19, city: 'Denver', flag: '🇺🇸' },
  { slot: 20, city: 'Los Angeles', flag: '🇺🇸' },
  { slot: 21, city: 'Anchorage', flag: '🇺🇸' },
  { slot: 22, city: 'Honolulu', flag: '🇺🇸' },
  { slot: 23, city: 'Samoa', flag: '🇼🇸' },
];

const USER_POOLS: { slot: number; count: number }[] = [
  { slot: 0, count: 3 },
  { slot: 1, count: 5 },
  { slot: 2, count: 8 },
  { slot: 3, count: 30 },  // 서울 — 가장 많음
  { slot: 4, count: 6 },
  { slot: 5, count: 4 },
  { slot: 6, count: 3 },
  { slot: 7, count: 10 },
  { slot: 8, count: 2 },
  { slot: 9, count: 0 },   // 모스크바 — 0명
  { slot: 10, count: 2 },
  { slot: 11, count: 1 },
  { slot: 12, count: 4 },
  { slot: 13, count: 5 },
  { slot: 14, count: 0 },  // 아조레스 — 0명
  { slot: 15, count: 2 },
  { slot: 16, count: 1 },
  { slot: 17, count: 7 },
  { slot: 18, count: 2 },
  { slot: 19, count: 1 },
  { slot: 20, count: 4 },
  { slot: 21, count: 0 },  // 앵커리지 — 0명
  { slot: 22, count: 1 },
  { slot: 23, count: 1 },
];

const NAMES_BY_CITY: Record<string, string[]> = {
  Auckland: ['Kiri', 'Aroha', 'Tane'],
  Sydney: ['Liam', 'Mia', 'Noah', 'Olivia', 'Jack'],
  Tokyo: ['Yuki', 'Hana', 'Ren', 'Sora', 'Kai', 'Aoi', 'Mei', 'Riku'],
  Seoul: ['민수','유키','지은','현우','수진','태현','서연','준혁','하은','도윤','예린','시우','지호','민지','서준','유진','하준','소율','준서','다은','시연','건우','지유','은서','도현','채원','승현','수아','재이','하린'],
  Shanghai: ['小雨','李明','王芳','张伟','陈静','刘洋'],
  Taipei: ['Wei','美玲','志明','雅婷'],
  Bangkok: ['Somchai','Priya','Niran'],
  Mumbai: ['Aarav','Diya','Rohan','Ananya','Vivek','Meera','Arjun','Kavya','Ishaan','Zara'],
  Dubai: ['Ahmed','Fatima'],
  Moscow: [],
  Istanbul: ['Elif','Kemal'],
  Cairo: ['Amira'],
  Paris: ['Pierre','Amélie','Lucas','Camille'],
  London: ['James','Emma','Oliver','Sophie','Harry'],
  Azores: [],
  'São Paulo': ['Rafael','Ana'],
  'Buenos Aires': ['Mateo'],
  'New York': ['Alex','Sarah','Mike','Jordan','Taylor','Avery','Casey'],
  Chicago: ['Chris','Pat'],
  Denver: ['Sam'],
  'Los Angeles': ['Dylan','Chloe','Jake','Luna'],
  Anchorage: [],
  Honolulu: ['Kai_HI'],
  Samoa: ['Tui'],
};

const SLOTS_PER_USER = 3;

// --- Helpers ---
function weightedRandom(options: { value: number; weight: number }[]): number {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) { r -= o.weight; if (r <= 0) return o.value; }
  return options[options.length - 1].value;
}

function humanScore(type: number): number {
  return type === 1 ? 100 : type === 2 ? 60 : type === 3 ? 40 : 0;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateUsers(slot: number, count: number): User[] {
  const tz = TIMEZONES[slot];
  const names = NAMES_BY_CITY[tz.city] || [];
  const users: User[] = [];
  for (let i = 0; i < count; i++) {
    users.push({
      name: names[i] || `User_${tz.city}_${i}`,
      timezone: slot,
      city: tz.city,
      participationType: weightedRandom([
        { value: 1, weight: 30 },
        { value: 2, weight: 35 },
        { value: 3, weight: 25 },
        { value: 4, weight: 10 },
      ]),
    });
  }
  return users;
}

let branchCounter = 0;

// --- Simulation ---
function simulate(startSlot: number): SlotResult[] {
  const results: SlotResult[] = [];
  let currentBranches: Branch[] = [];

  for (let i = 0; i < 24; i++) {
    const slot = (startSlot + i) % 24;
    const tz = TIMEZONES[slot];
    const poolConfig = USER_POOLS.find(p => p.slot === slot)!;
    const poolSize = poolConfig.count;

    const incomingCount = currentBranches.length;

    // Case: 유저풀 0 → 정지기
    if (poolSize === 0) {
      if (currentBranches.length === 0) {
        // 체인 시작인데 유저 없음 → 정지기 1개
        const jb: Branch = {
          id: `B${branchCounter++}`,
          slotIndex: slot, user: null, humanScore: 0,
          parentBranchId: null, selectedFrom: null,
        };
        currentBranches = [jb];
        results.push({
          slotIndex: slot, city: tz.city, flag: tz.flag,
          poolSize: 0, incomingBranches: incomingCount,
          survivedBranches: 0, newBranches: [jb], jungzigiUsed: true,
        });
      } else {
        // 기존 브랜치 각각에 정지기 붙임 (최대 유지)
        // 실제로는 1시간 후 정지기가 1개만 채움
        const jb: Branch = {
          id: `B${branchCounter++}`,
          slotIndex: slot, user: null, humanScore: 0,
          parentBranchId: currentBranches[0].id, selectedFrom: currentBranches[0].id,
        };
        // 정지기는 스코어 가장 높은 브랜치 1개만 이어감
        const best = [...currentBranches].sort((a, b) => b.humanScore - a.humanScore)[0];
        jb.parentBranchId = best.id;
        jb.selectedFrom = best.id;
        currentBranches = [jb];
        results.push({
          slotIndex: slot, city: tz.city, flag: tz.flag,
          poolSize: 0, incomingBranches: incomingCount,
          survivedBranches: 1, newBranches: [jb], jungzigiUsed: true,
        });
      }
      continue;
    }

    const users = generateUsers(slot, poolSize);

    // 첫 슬롯 (체인 시작)
    if (currentBranches.length === 0) {
      const newBranches: Branch[] = users.map(u => ({
        id: `B${branchCounter++}`,
        slotIndex: slot, user: u,
        humanScore: humanScore(u.participationType),
        parentBranchId: null, selectedFrom: null,
      }));
      currentBranches = newBranches;
      results.push({
        slotIndex: slot, city: tz.city, flag: tz.flag,
        poolSize, incomingBranches: 0,
        survivedBranches: 0, newBranches, jungzigiUsed: false,
      });
      continue;
    }

    // --- 핵심 로직 ---
    // 생존 슬롯 = 유저 수 × 3
    const survivalSlots = poolSize * SLOTS_PER_USER;

    // 브랜치 > 슬롯이면 → humanScore 상위만 생존
    let survivedBranches: Branch[];
    if (currentBranches.length > survivalSlots) {
      survivedBranches = [...currentBranches]
        .sort((a, b) => b.humanScore - a.humanScore)
        .slice(0, survivalSlots);
    } else {
      survivedBranches = [...currentBranches];
    }

    // 생존 브랜치를 유저에게 3개씩 랜덤 배분
    const newBranches: Branch[] = [];
    for (const user of users) {
      const shuffled = shuffle(survivedBranches);
      const assigned = shuffled.slice(0, Math.min(SLOTS_PER_USER, shuffled.length));
      // 유저가 하나를 선택 (시뮬에서는 랜덤 선택)
      const chosen = assigned[Math.floor(Math.random() * assigned.length)];

      const branch: Branch = {
        id: `B${branchCounter++}`,
        slotIndex: slot, user,
        humanScore: humanScore(user.participationType),
        parentBranchId: chosen.id,
        selectedFrom: chosen.id,
      };
      newBranches.push(branch);
    }

    results.push({
      slotIndex: slot, city: tz.city, flag: tz.flag,
      poolSize, incomingBranches: incomingCount,
      survivedBranches: survivedBranches.length,
      newBranches, jungzigiUsed: false,
    });

    currentBranches = newBranches;
  }

  return results;
}

// --- Analysis ---
function analyze(results: SlotResult[]) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  정체인 포크 시뮬레이션 v2 — 전체 배분 + 생존 필터');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalBlocks = 0;
  let totalHumans = 0;
  let totalJungzigi = 0;
  let totalPruned = 0;

  console.log('TZ  Flag City           Pool  In→Survived→Out  정지기  상세');
  console.log('─'.repeat(100));

  for (const r of results) {
    const humans = r.newBranches.filter(b => b.humanScore > 0).length;
    const ais = r.newBranches.filter(b => b.humanScore === 0).length;
    const pruned = Math.max(0, r.incomingBranches - r.survivedBranches);

    totalBlocks += r.newBranches.length;
    totalHumans += humans;
    totalJungzigi += ais;
    totalPruned += pruned;

    const scoreBreakdown = r.newBranches.reduce((acc, b) => {
      acc[b.humanScore] = (acc[b.humanScore] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const scoreStr = Object.entries(scoreBreakdown)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([s, c]) => `${s}:${c}`)
      .join(' ');

    const jzMark = r.jungzigiUsed ? '🤖' : '  ';

    console.log(
      `${String(r.slotIndex).padStart(2)} ${r.flag}  ${r.city.padEnd(14)} ` +
      `${String(r.poolSize).padStart(3)}  ` +
      `${String(r.incomingBranches).padStart(3)}→${String(r.survivedBranches).padStart(3)}→${String(r.newBranches.length).padStart(3)}  ` +
      `${jzMark}  ` +
      `[${scoreStr}]`
    );
  }

  console.log('─'.repeat(100));
  console.log(`\n📊 요약`);
  console.log(`총 블록: ${totalBlocks}`);
  console.log(`사람: ${totalHumans} (${(totalHumans / totalBlocks * 100).toFixed(1)}%)`);
  console.log(`정지기: ${totalJungzigi}`);
  console.log(`가지치기 (pruned): ${totalPruned}개 브랜치 소멸`);

  // Score distribution
  const allScores = results.flatMap(r => r.newBranches.map(b => b.humanScore));
  const avgScore = allScores.reduce((s, v) => s + v, 0) / allScores.length;
  console.log(`평균 humanScore: ${avgScore.toFixed(1)}`);

  // Branch flow
  console.log(`\n📈 브랜치 흐름:`);
  for (const r of results) {
    const bar = '█'.repeat(Math.min(r.newBranches.length, 60));
    const pruneBar = r.incomingBranches > r.survivedBranches
      ? ' ✂️-' + (r.incomingBranches - r.survivedBranches)
      : '';
    console.log(`${r.flag} ${r.city.padEnd(14)} ${bar} ${r.newBranches.length}${pruneBar}`);
  }
}

// --- HTML ---
function generateHTML(results: SlotResult[]): string {
  const data = JSON.stringify(results);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>정체인 시뮬레이션 v2</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0a; color: #e0e0e0; font-family: 'SF Mono', monospace; padding: 20px; }
h1 { text-align: center; color: #fff; margin-bottom: 5px; }
.sub { text-align: center; color: #888; font-size: 13px; margin-bottom: 20px; }
.stats { display: flex; gap: 15px; justify-content: center; margin-bottom: 25px; flex-wrap: wrap; }
.stat { background: #1a1a2e; padding: 12px 20px; border-radius: 8px; text-align: center; }
.stat .n { font-size: 24px; font-weight: bold; color: #e94560; }
.stat .l { font-size: 11px; color: #888; }

.row { display: flex; align-items: center; margin-bottom: 3px; min-height: 36px; }
.tz { width: 160px; min-width: 160px; text-align: right; padding-right: 12px; font-size: 12px; color: #aaa; border-right: 1px solid #222; }
.tz .city { margin-left: 4px; }
.tz .pool { color: #555; font-size: 10px; }

.flow { display: flex; align-items: center; gap: 6px; padding-left: 12px; flex: 1; overflow-x: auto; }
.flow-in { color: #555; font-size: 11px; min-width: 40px; text-align: right; }
.flow-arrow { color: #333; }
.flow-survived { color: #e94560; font-size: 11px; min-width: 40px; }
.flow-arrow2 { color: #333; }

.blocks { display: flex; flex-wrap: wrap; gap: 2px; }
.block { width: 14px; height: 14px; border-radius: 2px; cursor: pointer; transition: transform 0.15s; }
.block:hover { transform: scale(1.8); z-index: 10; }
.s100 { background: #2d6a4f; }
.s60 { background: #52796f; }
.s40 { background: #8a6d3b; }
.s0 { background: #6a2d2d; }

.pruned { color: #e94560; font-size: 10px; margin-left: 6px; }

.legend { display: flex; gap: 15px; justify-content: center; margin: 15px 0; font-size: 12px; }
.legend-item { display: flex; align-items: center; gap: 4px; }
.swatch { width: 14px; height: 14px; border-radius: 2px; }

.tooltip { display: none; position: fixed; background: #1a1a2e; border: 1px solid #444; padding: 10px; border-radius: 6px; font-size: 12px; z-index: 100; pointer-events: none; }
.tooltip.show { display: block; }
</style>
</head>
<body>
<h1>정체인 시뮬레이션 v2</h1>
<p class="sub">전체 배분 · 유저×3 생존 필터 · humanScore 가지치기 · 정지기 폴백</p>

<div class="stats" id="stats"></div>
<div class="legend">
  <div class="legend-item"><div class="swatch s100"></div> 100 (Full)</div>
  <div class="legend-item"><div class="swatch s60"></div> 60 (Text)</div>
  <div class="legend-item"><div class="swatch s40"></div> 40 (Choice)</div>
  <div class="legend-item"><div class="swatch s0"></div> 0 (AI/정지기)</div>
</div>
<div id="timeline"></div>
<div class="tooltip" id="tt"></div>

<script>
const R = ${data};
const tt = document.getElementById('tt');

let total = 0, humans = 0, pruned = 0;
R.forEach(r => {
  total += r.newBranches.length;
  humans += r.newBranches.filter(b => b.humanScore > 0).length;
  pruned += Math.max(0, r.incomingBranches - r.survivedBranches);
});

document.getElementById('stats').innerHTML =
  '<div class="stat"><div class="n">' + total + '</div><div class="l">Total Blocks</div></div>' +
  '<div class="stat"><div class="n">' + humans + '</div><div class="l">Human</div></div>' +
  '<div class="stat"><div class="n">' + (total - humans) + '</div><div class="l">정지기</div></div>' +
  '<div class="stat"><div class="n">' + pruned + '</div><div class="l">Pruned</div></div>' +
  '<div class="stat"><div class="n">' + (humans / total * 100).toFixed(1) + '%</div><div class="l">Human Rate</div></div>';

const tl = document.getElementById('timeline');
R.forEach(r => {
  const row = document.createElement('div');
  row.className = 'row';

  const tz = document.createElement('div');
  tz.className = 'tz';
  tz.innerHTML = r.flag + '<span class="city">' + r.city + '</span><br><span class="pool">pool: ' + r.poolSize + '</span>';
  row.appendChild(tz);

  const flow = document.createElement('div');
  flow.className = 'flow';

  flow.innerHTML += '<span class="flow-in">' + r.incomingBranches + '</span>';
  flow.innerHTML += '<span class="flow-arrow">→</span>';
  flow.innerHTML += '<span class="flow-survived">' + r.survivedBranches + '</span>';
  flow.innerHTML += '<span class="flow-arrow2">→</span>';

  const blocks = document.createElement('div');
  blocks.className = 'blocks';
  r.newBranches.forEach(b => {
    const el = document.createElement('div');
    el.className = 'block s' + b.humanScore;
    el.onmouseenter = (e) => {
      tt.innerHTML = '<b>' + (b.user ? b.user.name : '🤖 정지기') + '</b><br>Score: ' + b.humanScore + '<br>Type: ' + (b.humanScore === 100 ? 'Full' : b.humanScore === 60 ? 'Text' : b.humanScore === 40 ? 'Choice' : 'AI') + (b.selectedFrom ? '<br>From: ' + b.selectedFrom : '');
      tt.style.left = (e.clientX + 10) + 'px';
      tt.style.top = (e.clientY - 10) + 'px';
      tt.classList.add('show');
    };
    el.onmouseleave = () => tt.classList.remove('show');
    blocks.appendChild(el);
  });
  flow.appendChild(blocks);

  const p = Math.max(0, r.incomingBranches - r.survivedBranches);
  if (p > 0) flow.innerHTML += '<span class="pruned">✂️ -' + p + '</span>';

  row.appendChild(flow);
  tl.appendChild(row);
});
</script>
</body>
</html>`;
}

// --- Main ---
const results = simulate(0); // Auckland 시작
analyze(results);

const htmlPath = join(process.cwd(), 'data', 'fork-sim-v2.html');
writeFileSync(htmlPath, generateHTML(results), 'utf-8');
console.log(`\n✅ HTML: ${htmlPath}`);
