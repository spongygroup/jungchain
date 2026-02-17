/**
 * 정체인 포크 시뮬레이션 — Phase A (로컬, 빠른 검증)
 * 풀 매칭 + 1:N 포크 + 같은 타임존 멀티턴 + humanScore
 * 메시지 생성 없이 구조만 검증
 */

// --- Types ---
interface User {
  name: string;
  timezone: number; // 0-23 (UTC offset mapped to slot)
  city: string;
  tier: 'free' | 'paid';
  maxNext: number;
  participationType: number; // 1=full(100), 2=text-only(60), 3=choice-only(40), 4=timeout(0)
}

interface SimBlock {
  id: string;
  chainId: string;
  slotIndex: number;
  user: User | null; // null = 정지기
  humanScore: number;
  maxNext: number;
  prevBlockId: string | null;
  children: SimBlock[];
  depth: number;
}

// --- Config ---
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

// Uneven user distribution
const USER_DISTRIBUTION: { slot: number; count: number }[] = [
  { slot: 0, count: 2 },   // Auckland
  { slot: 1, count: 3 },   // Sydney
  { slot: 2, count: 5 },   // Tokyo
  { slot: 3, count: 12 },  // Seoul — 가장 많음
  { slot: 4, count: 6 },   // Shanghai
  { slot: 5, count: 4 },   // Taipei
  { slot: 6, count: 3 },   // Bangkok
  { slot: 7, count: 8 },   // Mumbai
  { slot: 8, count: 2 },   // Dubai
  { slot: 9, count: 1 },   // Moscow
  { slot: 10, count: 2 },  // Istanbul
  { slot: 11, count: 1 },  // Cairo
  { slot: 12, count: 3 },  // Paris
  { slot: 13, count: 4 },  // London
  { slot: 14, count: 0 },  // Azores — 0명, 정지기
  { slot: 15, count: 2 },  // São Paulo
  { slot: 16, count: 1 },  // Buenos Aires
  { slot: 17, count: 5 },  // New York
  { slot: 18, count: 2 },  // Chicago
  { slot: 19, count: 1 },  // Denver
  { slot: 20, count: 3 },  // Los Angeles
  { slot: 21, count: 0 },  // Anchorage — 0명, 정지기
  { slot: 22, count: 1 },  // Honolulu
  { slot: 23, count: 1 },  // Samoa
];

const KOREAN_NAMES = ['민수', '유키', '지은', '현우', '수진', '태현', '서연', '준혁', '하은', '도윤', '예린', '시우'];
const NAMES_BY_CITY: Record<string, string[]> = {
  Auckland: ['Kiri', 'Aroha'],
  Sydney: ['Liam', 'Mia', 'Noah'],
  Tokyo: ['Yuki', 'Hana', 'Ren', 'Sora', 'Kai'],
  Seoul: KOREAN_NAMES,
  Shanghai: ['小雨', '李明', '王芳', '张伟', '陈静', '刘洋'],
  Taipei: ['Wei', '美玲', '志明', '雅婷'],
  Bangkok: ['Somchai', 'Priya', 'Niran'],
  Mumbai: ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Vivek', 'Meera', 'Arjun', 'Kavya'],
  Dubai: ['Ahmed', 'Fatima'],
  Moscow: ['Dmitri'],
  Istanbul: ['Elif', 'Kemal'],
  Cairo: ['Amira'],
  Paris: ['Pierre', 'Amélie', 'Lucas'],
  London: ['James', 'Emma', 'Oliver', 'Sophie'],
  Azores: [],
  'São Paulo': ['Rafael', 'Ana'],
  'Buenos Aires': ['Mateo'],
  'New York': ['Alex', 'Sarah', 'Mike', 'Jordan', 'Taylor'],
  Chicago: ['Chris', 'Pat'],
  Denver: ['Sam'],
  'Los Angeles': ['Dylan', 'Chloe', 'Jake'],
  Anchorage: [],
  Honolulu: ['Kai_HI'],
  Samoa: ['Tui'],
};

// --- Generate Users ---
function generateUsers(): User[] {
  const users: User[] = [];
  for (const { slot, count } of USER_DISTRIBUTION) {
    const tz = TIMEZONES[slot];
    const names = NAMES_BY_CITY[tz.city] || [];
    for (let i = 0; i < count; i++) {
      const name = names[i] || `User_${tz.city}_${i}`;
      const isPaid = Math.random() < 0.25; // 25% 유료
      const participationType = weightedRandom([
        { value: 1, weight: 30 }, // 글+A/B
        { value: 2, weight: 35 }, // 글만
        { value: 3, weight: 25 }, // 선택만
        { value: 4, weight: 10 }, // 타임아웃
      ]);
      users.push({
        name,
        timezone: slot,
        city: tz.city,
        tier: isPaid ? 'paid' : 'free',
        maxNext: isPaid ? Math.floor(Math.random() * 2) + 2 : 1, // paid: 2~3, free: 1
        participationType,
      });
    }
  }
  return users;
}

function weightedRandom(options: { value: number; weight: number }[]): number {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.value;
  }
  return options[options.length - 1].value;
}

function humanScoreFromType(type: number): number {
  switch (type) {
    case 1: return 100;
    case 2: return 60;
    case 3: return 40;
    case 4: return 0;
    default: return 0;
  }
}

// --- Pool Manager ---
class PoolManager {
  private pools: Map<number, User[]> = new Map();
  // track participation: chainId → Set<userName>
  private participated: Map<string, Set<string>> = new Map();

  constructor(users: User[]) {
    for (const u of users) {
      if (!this.pools.has(u.timezone)) this.pools.set(u.timezone, []);
      this.pools.get(u.timezone)!.push(u);
    }
    // Shuffle each pool
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
      if (available.length > 0) {
        const user = available.shift()!;
        used.add(user.name);
        matched.push(user);
      } else {
        matched.push(null); // 정지기
      }
    }
    return matched;
  }

  getPoolSize(slot: number, chainId: string): number {
    const pool = this.pools.get(slot) || [];
    const used = this.participated.get(chainId) || new Set();
    return pool.filter(u => !used.has(u.name)).length;
  }
}

// --- Simulation ---
let blockCounter = 0;

function simulateChain(chainId: string, pool: PoolManager, startSlot: number): SimBlock {
  // First block
  const firstUsers = pool.match(startSlot, chainId, 1);
  const firstUser = firstUsers[0];
  const tz = TIMEZONES[startSlot];

  const root: SimBlock = {
    id: `${chainId}-B${blockCounter++}`,
    chainId,
    slotIndex: startSlot,
    user: firstUser,
    humanScore: firstUser ? humanScoreFromType(firstUser.participationType) : 0,
    maxNext: firstUser ? firstUser.maxNext : 1,
    prevBlockId: null,
    children: [],
    depth: 0,
  };

  // Recursive: expand from a block to next slots
  expandBlock(root, chainId, pool, startSlot);
  return root;
}

function expandBlock(block: SimBlock, chainId: string, pool: PoolManager, currentSlot: number) {
  const maxNext = block.maxNext;
  const nextSlot = (currentSlot + 1) % 24;

  // Same-slot multi-turn: if maxNext > 1 and same timezone has users
  // First try same-slot expansion, then next-slot
  const sameSlotAvailable = pool.getPoolSize(currentSlot, chainId);

  if (maxNext > 1 && sameSlotAvailable > 0) {
    // Same-slot fork: match from same timezone
    const sameSlotCount = Math.min(maxNext - 1, sameSlotAvailable);
    const nextSlotCount = maxNext - sameSlotCount;

    // Same-slot children
    if (sameSlotCount > 0) {
      const sameUsers = pool.match(currentSlot, chainId, sameSlotCount);
      for (const user of sameUsers) {
        const child = makeBlock(chainId, currentSlot, user, block.id, block.depth + 1);
        block.children.push(child);
        // Same-slot children also expand to next slot
        expandToNextSlot(child, chainId, pool, currentSlot);
      }
    }

    // Next-slot children (at least 1 always goes forward)
    expandToNextSlot(block, chainId, pool, currentSlot, Math.max(1, nextSlotCount));
  } else {
    // Simple: all forks go to next slot
    expandToNextSlot(block, chainId, pool, currentSlot, maxNext);
  }
}

function expandToNextSlot(block: SimBlock, chainId: string, pool: PoolManager, currentSlot: number, count: number = 1) {
  const nextSlot = (currentSlot + 1) % 24;
  if (nextSlot === 0 && currentSlot !== 0) return; // Chain complete (wrapped around)
  if (block.depth > 50) return; // Safety limit

  const users = pool.match(nextSlot, chainId, count);
  for (const user of users) {
    const child = makeBlock(chainId, nextSlot, user, block.id, block.depth + 1);
    block.children.push(child);
    if (nextSlot < 23) {
      expandBlock(child, chainId, pool, nextSlot);
    }
  }
}

function makeBlock(chainId: string, slot: number, user: User | null, prevId: string, depth: number): SimBlock {
  return {
    id: `${chainId}-B${blockCounter++}`,
    chainId,
    slotIndex: slot,
    user,
    humanScore: user ? humanScoreFromType(user.participationType) : 0,
    maxNext: user ? user.maxNext : 1,
    prevBlockId: prevId,
    children: [],
    depth,
  };
}

// --- Analysis ---
function findAllPaths(block: SimBlock, path: SimBlock[] = []): SimBlock[][] {
  const current = [...path, block];
  if (block.children.length === 0) return [current];
  const paths: SimBlock[][] = [];
  for (const child of block.children) {
    paths.push(...findAllPaths(child, current));
  }
  return paths;
}

function analyzePaths(root: SimBlock) {
  const paths = findAllPaths(root);

  console.log(`\n📊 Chain: ${root.chainId}`);
  console.log(`총 경로 수: ${paths.length}`);

  // Count total blocks
  const allBlocks = new Set<string>();
  const countBlocks = (b: SimBlock) => {
    allBlocks.add(b.id);
    b.children.forEach(countBlocks);
  };
  countBlocks(root);
  console.log(`총 블록 수: ${allBlocks.size}`);

  // Find longest path
  const sorted = paths.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    // Tiebreaker: average humanScore
    const avgA = a.reduce((s, bl) => s + bl.humanScore, 0) / a.length;
    const avgB = b.reduce((s, bl) => s + bl.humanScore, 0) / b.length;
    return avgB - avgA;
  });

  const mainChain = sorted[0];
  const avgScore = mainChain.reduce((s, b) => s + b.humanScore, 0) / mainChain.length;
  const humans = mainChain.filter(b => b.humanScore > 0).length;
  const jungzigi = mainChain.filter(b => b.humanScore === 0).length;

  console.log(`\n🏆 메인 체인 (longest path): ${mainChain.length} blocks`);
  console.log(`   평균 humanScore: ${avgScore.toFixed(1)}`);
  console.log(`   사람: ${humans} / 정지기: ${jungzigi}`);
  console.log('');

  // Print main chain
  for (const b of mainChain) {
    const tz = TIMEZONES[b.slotIndex];
    const name = b.user ? b.user.name : '🤖 정지기';
    const score = b.humanScore;
    const fork = b.maxNext > 1 ? ` (N=${b.maxNext}, 포크!)` : '';
    console.log(`   ${tz.flag} ${tz.city.padEnd(14)} ${name.padEnd(10)} score=${score}${fork}`);
  }

  // Print tree overview
  console.log(`\n🌳 전체 트리:`);
  printTree(root, '');

  return { paths, mainChain, totalBlocks: allBlocks.size };
}

function printTree(block: SimBlock, indent: string) {
  const tz = TIMEZONES[block.slotIndex];
  const name = block.user ? block.user.name : '🤖정지기';
  const score = block.humanScore;
  const fork = block.children.length > 1 ? ` ← ${block.children.length} forks` : '';
  console.log(`${indent}${tz.flag} [${tz.city}] ${name} (score=${score}, N=${block.maxNext})${fork}`);

  for (let i = 0; i < block.children.length; i++) {
    const isLast = i === block.children.length - 1;
    const prefix = isLast ? '└─ ' : '├─ ';
    const childIndent = indent + (isLast ? '   ' : '│  ');
    printTree(block.children[i], indent + prefix);
  }
}

// --- Main ---
function main() {
  console.log('═══════════════════════════════════════');
  console.log('  정체인 포크 시뮬레이션 — Phase A');
  console.log('  로컬 검증 (메시지 생성 없음)');
  console.log('═══════════════════════════════════════\n');

  const users = generateUsers();
  console.log(`총 유저: ${users.length}명`);

  // Print distribution
  for (const { slot } of USER_DISTRIBUTION) {
    const tz = TIMEZONES[slot];
    const count = users.filter(u => u.timezone === slot).length;
    const paid = users.filter(u => u.timezone === slot && u.tier === 'paid').length;
    if (count > 0 || slot === 14 || slot === 21) {
      console.log(`  ${tz.flag} ${tz.city.padEnd(14)} ${count}명 (유료 ${paid})`);
    }
  }

  const pool = new PoolManager(users);

  // Chain Alpha: starts at UTC+12 (Auckland, slot 0)
  console.log('\n━━━ Chain Alpha (Auckland 시작) ━━━');
  const alpha = simulateChain('alpha', pool, 0);
  const alphaResult = analyzePaths(alpha);

  // Chain Beta: starts at UTC+9 (Seoul, slot 3)
  console.log('\n━━━ Chain Beta (Seoul 시작) ━━━');
  const beta = simulateChain('beta', pool, 3);
  const betaResult = analyzePaths(beta);

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('📋 최종 요약');
  console.log('═══════════════════════════════════════');
  console.log(`Chain Alpha: ${alphaResult.totalBlocks} blocks, ${alphaResult.paths.length} paths, main=${alphaResult.mainChain.length}`);
  console.log(`Chain Beta:  ${betaResult.totalBlocks} blocks, ${betaResult.paths.length} paths, main=${betaResult.mainChain.length}`);
  console.log(`총 블록: ${alphaResult.totalBlocks + betaResult.totalBlocks}`);
}

main();
