/**
 * 정체인 포크 시뮬레이션 — HTML 시각화 출력
 * fork-sim-local.ts 기반, JSON + HTML 생성
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// --- Types ---
interface User {
  name: string;
  timezone: number;
  city: string;
  tier: 'free' | 'paid';
  maxNext: number;
  participationType: number;
}

interface SimBlock {
  id: string;
  chainId: string;
  slotIndex: number;
  user: User | null;
  humanScore: number;
  maxNext: number;
  prevBlockId: string | null;
  children: SimBlock[];
  depth: number;
}

// --- Config (same as fork-sim-local.ts) ---
const TIMEZONES: { slot: number; city: string; flag: string }[] = [
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

const USER_DISTRIBUTION: { slot: number; count: number }[] = [
  { slot: 0, count: 2 }, { slot: 1, count: 3 }, { slot: 2, count: 5 },
  { slot: 3, count: 12 }, { slot: 4, count: 6 }, { slot: 5, count: 4 },
  { slot: 6, count: 3 }, { slot: 7, count: 8 }, { slot: 8, count: 2 },
  { slot: 9, count: 1 }, { slot: 10, count: 2 }, { slot: 11, count: 1 },
  { slot: 12, count: 3 }, { slot: 13, count: 4 }, { slot: 14, count: 0 },
  { slot: 15, count: 2 }, { slot: 16, count: 1 }, { slot: 17, count: 5 },
  { slot: 18, count: 2 }, { slot: 19, count: 1 }, { slot: 20, count: 3 },
  { slot: 21, count: 0 }, { slot: 22, count: 1 }, { slot: 23, count: 1 },
];

const NAMES_BY_CITY: Record<string, string[]> = {
  Auckland: ['Kiri', 'Aroha'], Sydney: ['Liam', 'Mia', 'Noah'],
  Tokyo: ['Yuki', 'Hana', 'Ren', 'Sora', 'Kai'],
  Seoul: ['민수', '유키', '지은', '현우', '수진', '태현', '서연', '준혁', '하은', '도윤', '예린', '시우'],
  Shanghai: ['小雨', '李明', '王芳', '张伟', '陈静', '刘洋'],
  Taipei: ['Wei', '美玲', '志明', '雅婷'], Bangkok: ['Somchai', 'Priya', 'Niran'],
  Mumbai: ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Vivek', 'Meera', 'Arjun', 'Kavya'],
  Dubai: ['Ahmed', 'Fatima'], Moscow: ['Dmitri'], Istanbul: ['Elif', 'Kemal'],
  Cairo: ['Amira'], Paris: ['Pierre', 'Amélie', 'Lucas'],
  London: ['James', 'Emma', 'Oliver', 'Sophie'], Azores: [],
  'São Paulo': ['Rafael', 'Ana'], 'Buenos Aires': ['Mateo'],
  'New York': ['Alex', 'Sarah', 'Mike', 'Jordan', 'Taylor'],
  Chicago: ['Chris', 'Pat'], Denver: ['Sam'],
  'Los Angeles': ['Dylan', 'Chloe', 'Jake'], Anchorage: [], Honolulu: ['Kai_HI'], Samoa: ['Tui'],
};

function weightedRandom(options: { value: number; weight: number }[]): number {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) { r -= o.weight; if (r <= 0) return o.value; }
  return options[options.length - 1].value;
}

function humanScoreFromType(type: number): number {
  return type === 1 ? 100 : type === 2 ? 60 : type === 3 ? 40 : 0;
}

function generateUsers(): User[] {
  const users: User[] = [];
  for (const { slot, count } of USER_DISTRIBUTION) {
    const tz = TIMEZONES[slot];
    const names = NAMES_BY_CITY[tz.city] || [];
    for (let i = 0; i < count; i++) {
      const name = names[i] || `User_${tz.city}_${i}`;
      const isPaid = Math.random() < 0.25;
      users.push({
        name, timezone: slot, city: tz.city,
        tier: isPaid ? 'paid' : 'free',
        maxNext: isPaid ? Math.floor(Math.random() * 2) + 2 : 1,
        participationType: weightedRandom([
          { value: 1, weight: 30 }, { value: 2, weight: 35 },
          { value: 3, weight: 25 }, { value: 4, weight: 10 },
        ]),
      });
    }
  }
  return users;
}

class PoolManager {
  private pools: Map<number, User[]> = new Map();
  private participated: Map<string, Set<string>> = new Map();

  constructor(users: User[]) {
    for (const u of users) {
      if (!this.pools.has(u.timezone)) this.pools.set(u.timezone, []);
      this.pools.get(u.timezone)!.push(u);
    }
    for (const [, pool] of this.pools) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
  }

  match(slot: number, chainId: string, count: number): (User | null)[] {
    const pool = this.pools.get(slot) || [];
    if (!this.participated.has(chainId)) this.participated.set(chainId, new Set());
    const used = this.participated.get(chainId)!;
    const available = pool.filter(u => !used.has(u.name));
    const matched: (User | null)[] = [];
    for (let i = 0; i < count; i++) {
      if (available.length > 0) { const u = available.shift()!; used.add(u.name); matched.push(u); }
      else matched.push(null);
    }
    return matched;
  }

  getPoolSize(slot: number, chainId: string): number {
    const pool = this.pools.get(slot) || [];
    const used = this.participated.get(chainId) || new Set();
    return pool.filter(u => !used.has(u.name)).length;
  }
}

let blockCounter = 0;

function simulateChain(chainId: string, pool: PoolManager, startSlot: number): SimBlock {
  const firstUsers = pool.match(startSlot, chainId, 1);
  const firstUser = firstUsers[0];
  const root: SimBlock = {
    id: `${chainId}-B${blockCounter++}`, chainId, slotIndex: startSlot,
    user: firstUser, humanScore: firstUser ? humanScoreFromType(firstUser.participationType) : 0,
    maxNext: firstUser ? firstUser.maxNext : 1, prevBlockId: null, children: [], depth: 0,
  };
  expandBlock(root, chainId, pool, startSlot);
  return root;
}

function expandBlock(block: SimBlock, chainId: string, pool: PoolManager, currentSlot: number) {
  const maxNext = block.maxNext;
  const nextSlot = (currentSlot + 1) % 24;
  const sameSlotAvailable = pool.getPoolSize(currentSlot, chainId);

  if (maxNext > 1 && sameSlotAvailable > 0) {
    const sameSlotCount = Math.min(maxNext - 1, sameSlotAvailable);
    if (sameSlotCount > 0) {
      const sameUsers = pool.match(currentSlot, chainId, sameSlotCount);
      for (const user of sameUsers) {
        const child = makeBlock(chainId, currentSlot, user, block.id, block.depth + 1);
        block.children.push(child);
        expandToNextSlot(child, chainId, pool, currentSlot);
      }
    }
    expandToNextSlot(block, chainId, pool, currentSlot, Math.max(1, maxNext - sameSlotCount));
  } else {
    expandToNextSlot(block, chainId, pool, currentSlot, maxNext);
  }
}

function expandToNextSlot(block: SimBlock, chainId: string, pool: PoolManager, currentSlot: number, count: number = 1) {
  const nextSlot = (currentSlot + 1) % 24;
  if (nextSlot === 0 && currentSlot !== 0) return;
  if (block.depth > 50) return;
  const users = pool.match(nextSlot, chainId, count);
  for (const user of users) {
    const child = makeBlock(chainId, nextSlot, user, block.id, block.depth + 1);
    block.children.push(child);
    if (nextSlot < 23) expandBlock(child, chainId, pool, nextSlot);
  }
}

function makeBlock(chainId: string, slot: number, user: User | null, prevId: string, depth: number): SimBlock {
  return {
    id: `${chainId}-B${blockCounter++}`, chainId, slotIndex: slot, user,
    humanScore: user ? humanScoreFromType(user.participationType) : 0,
    maxNext: user ? user.maxNext : 1, prevBlockId: prevId, children: [], depth,
  };
}

function findAllPaths(block: SimBlock, path: SimBlock[] = []): SimBlock[][] {
  const current = [...path, block];
  if (block.children.length === 0) return [current];
  const paths: SimBlock[][] = [];
  for (const child of block.children) paths.push(...findAllPaths(child, current));
  return paths;
}

function getMainChain(root: SimBlock): SimBlock[] {
  const paths = findAllPaths(root);
  paths.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const avgA = a.reduce((s, bl) => s + bl.humanScore, 0) / a.length;
    const avgB = b.reduce((s, bl) => s + bl.humanScore, 0) / b.length;
    return avgB - avgA;
  });
  return paths[0];
}

// --- HTML Generation ---
function generateHTML(chains: { root: SimBlock; mainChain: SimBlock[] }[], users: User[]): string {
  const chainDataJSON = JSON.stringify(chains.map(c => ({
    root: serializeBlock(c.root),
    mainChainIds: new Set(c.mainChain.map(b => b.id)),
  })), (key, value) => value instanceof Set ? [...value] : value);

  const tzJSON = JSON.stringify(TIMEZONES);
  const distJSON = JSON.stringify(USER_DISTRIBUTION);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>정체인 포크 시뮬레이션</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0a; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; padding: 20px; }
h1 { text-align: center; font-size: 24px; margin-bottom: 5px; color: #fff; }
.subtitle { text-align: center; color: #888; margin-bottom: 20px; font-size: 13px; }
.controls { display: flex; gap: 10px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
.controls button { background: #1a1a2e; border: 1px solid #333; color: #fff; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.controls button.active { background: #e94560; border-color: #e94560; }
.controls button:hover { background: #16213e; }
.stats { display: flex; gap: 20px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
.stat { background: #1a1a2e; padding: 12px 20px; border-radius: 8px; text-align: center; min-width: 120px; }
.stat .num { font-size: 28px; font-weight: bold; color: #e94560; }
.stat .label { font-size: 11px; color: #888; margin-top: 4px; }
.viz-container { overflow-x: auto; padding: 20px 0; }

/* Timeline visualization */
.timeline { position: relative; min-height: 600px; }
.tz-row { display: flex; align-items: flex-start; margin-bottom: 2px; min-height: 40px; position: relative; }
.tz-label { width: 140px; min-width: 140px; padding: 8px 10px; font-size: 12px; color: #aaa; text-align: right; border-right: 1px solid #222; position: sticky; left: 0; background: #0a0a0a; z-index: 2; }
.tz-label .flag { font-size: 16px; }
.tz-label .city { margin-left: 6px; }
.tz-label .count { color: #555; font-size: 10px; display: block; }
.tz-content { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px; flex: 1; align-items: center; }

.block-node { 
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 4px; font-size: 11px;
  border: 1px solid #333; position: relative; cursor: pointer;
  transition: all 0.2s;
}
.block-node:hover { transform: scale(1.05); z-index: 10; }
.block-node.human { background: #1a3a2a; border-color: #2d6a4f; }
.block-node.ai { background: #2a1a1a; border-color: #6a2d2d; }
.block-node.main-chain { box-shadow: 0 0 8px rgba(233, 69, 96, 0.5); border-color: #e94560; }
.block-node.fork { border-style: dashed; }
.block-node .score { 
  display: inline-block; width: 18px; height: 18px; border-radius: 50%; 
  text-align: center; line-height: 18px; font-size: 9px; font-weight: bold;
}
.score-100 { background: #2d6a4f; color: #fff; }
.score-60 { background: #52796f; color: #fff; }
.score-40 { background: #8a6d3b; color: #fff; }
.score-0 { background: #6a2d2d; color: #fff; }

.block-node .name { max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.block-node .n-badge { background: #e94560; color: #fff; font-size: 9px; padding: 1px 4px; border-radius: 3px; }
.block-node .tier-badge { font-size: 9px; }

/* Connection lines via SVG overlay */
svg.connections { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }

/* Tooltip */
.tooltip {
  display: none; position: fixed; background: #1a1a2e; border: 1px solid #444;
  padding: 12px; border-radius: 8px; font-size: 12px; z-index: 100;
  max-width: 250px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}
.tooltip.show { display: block; }
.tooltip .tt-name { font-size: 14px; font-weight: bold; color: #fff; }
.tooltip .tt-row { margin-top: 4px; color: #aaa; }
.tooltip .tt-row span { color: #fff; }

/* Legend */
.legend { display: flex; gap: 15px; justify-content: center; margin: 20px 0; flex-wrap: wrap; font-size: 12px; }
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #444; }

/* Pool status */
.pool-bar { height: 4px; background: #222; border-radius: 2px; margin-top: 2px; width: 80px; display: inline-block; }
.pool-fill { height: 100%; background: #2d6a4f; border-radius: 2px; transition: width 0.3s; }
</style>
</head>
<body>

<h1>정체인 포크 시뮬레이션</h1>
<p class="subtitle">1:N Fork Structure · Timezone Pool Matching · humanScore (0~100)</p>

<div class="controls" id="controls"></div>
<div class="stats" id="stats"></div>

<div class="legend">
  <div class="legend-item"><div class="legend-swatch" style="background:#1a3a2a;border-color:#2d6a4f"></div> Human</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#2a1a1a;border-color:#6a2d2d"></div> 정지기 (AI)</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#1a1a2e;border-color:#e94560;box-shadow:0 0 6px rgba(233,69,96,0.5)"></div> Main Chain</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#1a1a2e;border-style:dashed;border-color:#555"></div> Fork</div>
  <div class="legend-item"><div class="score score-100" style="display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-size:9px;font-weight:bold">💯</div> 100</div>
  <div class="legend-item"><div class="score score-60" style="display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-size:9px;font-weight:bold">60</div> Text</div>
  <div class="legend-item"><div class="score score-40" style="display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-size:9px;font-weight:bold">40</div> Choice</div>
  <div class="legend-item"><div class="score score-0" style="display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-size:9px;font-weight:bold">0</div> AI</div>
</div>

<div class="viz-container">
  <div class="timeline" id="timeline"></div>
</div>

<div class="tooltip" id="tooltip"></div>

<script>
const CHAINS = ${chainDataJSON};
const TZ = ${tzJSON};
const DIST = ${distJSON};

let currentChain = 0;

function init() {
  const ctrl = document.getElementById('controls');
  CHAINS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.textContent = 'Chain ' + c.root.chainId.charAt(0).toUpperCase() + c.root.chainId.slice(1) + ' (' + TZ[c.root.slotIndex].city + ' start)';
    btn.onclick = () => showChain(i);
    btn.id = 'btn-' + i;
    ctrl.appendChild(btn);
  });
  showChain(0);
}

function showChain(idx) {
  currentChain = idx;
  document.querySelectorAll('.controls button').forEach((b, i) => b.classList.toggle('active', i === idx));
  
  const chain = CHAINS[idx];
  const mainIds = new Set(chain.mainChainIds);
  
  // Collect all blocks by timezone
  const blocksByTz = {};
  TZ.forEach((_, i) => blocksByTz[i] = []);
  
  function collect(block, parentId, isFork) {
    if (!blocksByTz[block.slotIndex]) blocksByTz[block.slotIndex] = [];
    blocksByTz[block.slotIndex].push({ ...block, parentId, isFork, isMain: mainIds.has(block.id) });
    block.children.forEach((child, ci) => {
      collect(child, block.id, block.children.length > 1);
    });
  }
  collect(chain.root, null, false);
  
  // Count stats
  let totalBlocks = 0, humans = 0, ais = 0, forks = 0;
  Object.values(blocksByTz).forEach(blocks => {
    blocks.forEach(b => {
      totalBlocks++;
      if (b.humanScore > 0) humans++; else ais++;
      if (b.maxNext > 1) forks++;
    });
  });
  
  const mainPath = [];
  function findMain(block) {
    if (mainIds.has(block.id)) mainPath.push(block);
    block.children.forEach(findMain);
  }
  findMain(chain.root);
  const avgScore = mainPath.length ? (mainPath.reduce((s, b) => s + b.humanScore, 0) / mainPath.length).toFixed(1) : 0;
  
  document.getElementById('stats').innerHTML = 
    '<div class="stat"><div class="num">' + totalBlocks + '</div><div class="label">Total Blocks</div></div>' +
    '<div class="stat"><div class="num">' + humans + '</div><div class="label">Human</div></div>' +
    '<div class="stat"><div class="num">' + ais + '</div><div class="label">정지기</div></div>' +
    '<div class="stat"><div class="num">' + forks + '</div><div class="label">Fork Points</div></div>' +
    '<div class="stat"><div class="num">' + mainPath.length + '</div><div class="label">Main Chain</div></div>' +
    '<div class="stat"><div class="num">' + avgScore + '</div><div class="label">Avg Score</div></div>';
  
  // Render timeline
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';
  
  // Determine start slot
  const startSlot = chain.root.slotIndex;
  const slotOrder = [];
  for (let i = 0; i < 24; i++) slotOrder.push((startSlot + i) % 24);
  
  slotOrder.forEach(slot => {
    const tz = TZ[slot];
    const dist = DIST.find(d => d.slot === slot);
    const blocks = blocksByTz[slot] || [];
    
    const row = document.createElement('div');
    row.className = 'tz-row';
    
    const label = document.createElement('div');
    label.className = 'tz-label';
    label.innerHTML = '<span class="flag">' + tz.flag + '</span><span class="city"> ' + tz.city + '</span><span class="count">pool: ' + (dist ? dist.count : 0) + '</span>';
    row.appendChild(label);
    
    const content = document.createElement('div');
    content.className = 'tz-content';
    
    if (blocks.length === 0) {
      content.innerHTML = '<span style="color:#333;font-size:11px">—</span>';
    } else {
      blocks.forEach(block => {
        const node = document.createElement('div');
        const isHuman = block.humanScore > 0;
        const classes = ['block-node'];
        classes.push(isHuman ? 'human' : 'ai');
        if (block.isMain) classes.push('main-chain');
        if (block.isFork) classes.push('fork');
        node.className = classes.join(' ');
        
        const scoreClass = 'score-' + block.humanScore;
        const name = block.user ? block.user.name : '🤖';
        const nBadge = block.maxNext > 1 ? '<span class="n-badge">N=' + block.maxNext + '</span>' : '';
        const tierBadge = block.user && block.user.tier === 'paid' ? '<span class="tier-badge">💎</span>' : '';
        
        node.innerHTML = '<span class="score ' + scoreClass + '">' + block.humanScore + '</span>' +
          '<span class="name">' + name + '</span>' + tierBadge + nBadge;
        
        node.onmouseenter = (e) => showTooltip(e, block);
        node.onmouseleave = hideTooltip;
        
        content.appendChild(node);
      });
    }
    
    row.appendChild(content);
    timeline.appendChild(row);
  });
}

function showTooltip(e, block) {
  const tt = document.getElementById('tooltip');
  const name = block.user ? block.user.name : '🤖 정지기';
  const city = TZ[block.slotIndex].city;
  const flag = TZ[block.slotIndex].flag;
  const tier = block.user ? (block.user.tier === 'paid' ? '💎 Paid' : 'Free') : 'AI';
  const pType = block.humanScore === 100 ? '글+A/B (Full)' : block.humanScore === 60 ? '글만 (Text)' : block.humanScore === 40 ? '선택만 (Choice)' : '타임아웃 (AI)';
  
  tt.innerHTML = '<div class="tt-name">' + flag + ' ' + name + '</div>' +
    '<div class="tt-row">City: <span>' + city + '</span></div>' +
    '<div class="tt-row">Slot: <span>UTC+' + block.slotIndex + '</span></div>' +
    '<div class="tt-row">Tier: <span>' + tier + '</span></div>' +
    '<div class="tt-row">humanScore: <span>' + block.humanScore + '</span></div>' +
    '<div class="tt-row">Type: <span>' + pType + '</span></div>' +
    '<div class="tt-row">maxNext: <span>' + block.maxNext + '</span></div>' +
    '<div class="tt-row">Main Chain: <span>' + (block.isMain ? '✅' : '❌') + '</span></div>' +
    '<div class="tt-row">ID: <span style="font-size:10px">' + block.id + '</span></div>';
  
  tt.style.left = (e.clientX + 15) + 'px';
  tt.style.top = (e.clientY - 10) + 'px';
  tt.classList.add('show');
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('show');
}

init();
</script>
</body>
</html>`;
}

function serializeBlock(block: SimBlock): any {
  return {
    id: block.id, chainId: block.chainId, slotIndex: block.slotIndex,
    user: block.user, humanScore: block.humanScore, maxNext: block.maxNext,
    prevBlockId: block.prevBlockId, depth: block.depth,
    children: block.children.map(serializeBlock),
  };
}

// --- Main ---
function main() {
  const users = generateUsers();
  const pool = new PoolManager(users);

  const alpha = simulateChain('alpha', pool, 0);
  const alphaMain = getMainChain(alpha);

  const beta = simulateChain('beta', pool, 3);
  const betaMain = getMainChain(beta);

  const html = generateHTML([
    { root: alpha, mainChain: alphaMain },
    { root: beta, mainChain: betaMain },
  ], users);

  const outPath = join(process.cwd(), 'data', 'fork-sim-visual.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`✅ HTML 시각화 생성: ${outPath}`);
  
  // Also print summary
  const countBlocks = (b: SimBlock): number => 1 + b.children.reduce((s, c) => s + countBlocks(c), 0);
  console.log(`Chain Alpha: ${countBlocks(alpha)} blocks, main=${alphaMain.length}`);
  console.log(`Chain Beta: ${countBlocks(beta)} blocks, main=${betaMain.length}`);
}

main();
