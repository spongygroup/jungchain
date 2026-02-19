import 'dotenv/config';
import db, { upsertUser, updateCityI18n } from '../src/db/database.js';

// ─── TZ data: city pool per timezone ───
const TZ_POOL: Record<number, { cities: { city: string; lang: string; names: string[] }[] }> = {
  12:  { cities: [{ city: 'Auckland', lang: 'en', names: ['Liam', 'Olivia', 'Aroha', 'Tane'] }] },
  11:  { cities: [{ city: 'Noumea', lang: 'fr', names: ['Marie', 'Pierre', 'Luc'] }, { city: 'Solomon Islands', lang: 'en', names: ['Joseph'] }] },
  10:  { cities: [{ city: 'Sydney', lang: 'en', names: ['Emma', 'Jack', 'Mia', 'Noah'] }, { city: 'Melbourne', lang: 'en', names: ['Chloe', 'Oscar'] }] },
  9:   { cities: [{ city: 'Seoul', lang: 'ko', names: ['지민', '서연', '민준', '하은', '도윤'] }, { city: 'Tokyo', lang: 'ja', names: ['Yuki', 'Haruto', 'Sakura', 'Ren'] }] },
  8:   { cities: [{ city: 'Taipei', lang: 'zh', names: ['Ming', 'Wei', 'Mei'] }, { city: 'Singapore', lang: 'en', names: ['Aiden', 'Chloe'] }, { city: 'Shanghai', lang: 'zh', names: ['Xiao', 'Lin'] }] },
  7:   { cities: [{ city: 'Bangkok', lang: 'th', names: ['Sora', 'Nan', 'Ploy', 'Tong'] }, { city: 'Jakarta', lang: 'id', names: ['Budi', 'Siti'] }] },
  6:   { cities: [{ city: 'Dhaka', lang: 'en', names: ['Rahim', 'Fatima'] }, { city: 'Almaty', lang: 'ru', names: ['Arman', 'Dana'] }] },
  5:   { cities: [{ city: 'Karachi', lang: 'en', names: ['Ali', 'Zara'] }, { city: 'Tashkent', lang: 'ru', names: ['Rustam'] }] },
  4:   { cities: [{ city: 'Dubai', lang: 'ar', names: ['Omar', 'Fatima', 'Hassan'] }, { city: 'Baku', lang: 'ru', names: ['Eldar'] }] },
  3:   { cities: [{ city: 'Moscow', lang: 'ru', names: ['Dmitri', 'Anna', 'Sergei', 'Natasha'] }, { city: 'Istanbul', lang: 'tr', names: ['Emre', 'Elif'] }] },
  2:   { cities: [{ city: 'Cairo', lang: 'ar', names: ['Amira', 'Youssef', 'Nour'] }, { city: 'Johannesburg', lang: 'en', names: ['Thabo', 'Naledi'] }] },
  1:   { cities: [{ city: 'Paris', lang: 'fr', names: ['Claire', 'Hugo', 'Léa'] }, { city: 'Berlin', lang: 'de', names: ['Max', 'Lena'] }, { city: 'Rome', lang: 'it', names: ['Marco', 'Giulia'] }] },
  0:   { cities: [{ city: 'London', lang: 'en', names: ['James', 'Emily', 'George'] }, { city: 'Lisbon', lang: 'pt', names: ['João', 'Ana'] }] },
  '-1':  { cities: [{ city: 'Cape Verde', lang: 'pt', names: ['João', 'Maria'] }, { city: 'Azores', lang: 'pt', names: ['Pedro'] }] },
  '-2':  { cities: [{ city: 'Fernando de Noronha', lang: 'pt', names: ['Rafael'] }] },
  '-3':  { cities: [{ city: 'São Paulo', lang: 'pt', names: ['Lucas', 'Gabriela', 'Pedro', 'Julia'] }, { city: 'Buenos Aires', lang: 'es', names: ['Mateo', 'Valentina'] }] },
  '-4':  { cities: [{ city: 'Santiago', lang: 'es', names: ['Diego', 'Camila'] }, { city: 'La Paz', lang: 'es', names: ['Carlos'] }] },
  '-5':  { cities: [{ city: 'New York', lang: 'en', names: ['Mike', 'Sarah', 'David', 'Jessica'] }, { city: 'Miami', lang: 'en', names: ['Alex'] }, { city: 'Bogota', lang: 'es', names: ['Andres', 'Sofia'] }] },
  '-6':  { cities: [{ city: 'Mexico City', lang: 'es', names: ['Carlos', 'María', 'Diego'] }, { city: 'Chicago', lang: 'en', names: ['Ryan', 'Taylor'] }] },
  '-7':  { cities: [{ city: 'Denver', lang: 'en', names: ['Sarah', 'Brandon'] }, { city: 'Phoenix', lang: 'en', names: ['Jake'] }] },
  '-8':  { cities: [{ city: 'Los Angeles', lang: 'en', names: ['Chris', 'Ashley', 'Jordan'] }, { city: 'San Francisco', lang: 'en', names: ['Kevin', 'Lisa'] }] },
  '-9':  { cities: [{ city: 'Anchorage', lang: 'en', names: ['Dave', 'Molly'] }] },
  '-10': { cities: [{ city: 'Honolulu', lang: 'en', names: ['Kai', 'Leilani', 'Mana'] }] },
  '-11': { cities: [{ city: 'Pago Pago', lang: 'en', names: ['Tui', 'Sina'] }] },
};

// ─── Random distribution: 100 users across 24 TZs ───
function distributeUsers(total: number): Map<number, number> {
  const tzs = Object.keys(TZ_POOL).map(Number);
  const dist = new Map<number, number>();

  // Give each TZ at least 1 user
  for (const tz of tzs) dist.set(tz, 1);
  let remaining = total - tzs.length; // 100 - 24 = 76

  // Weight by real-world population density (rough)
  const weights: Record<number, number> = {
    9: 8, 8: 8, 7: 6, 5: 5, 4: 4, 3: 5, 2: 4, 1: 6, 0: 4,
    '-3': 5, '-5': 7, '-6': 5, '-8': 5, 10: 3, 12: 2, '-4': 3,
    6: 3, '-7': 2, '-9': 1, '-10': 2, '-11': 1, '-1': 1, '-2': 1, 11: 1,
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  // Distribute proportionally + randomness
  for (const tz of tzs) {
    const w = weights[tz] ?? 1;
    const base = Math.floor(remaining * w / totalWeight);
    const extra = Math.random() < (remaining * w / totalWeight - base) ? 1 : 0;
    dist.set(tz, (dist.get(tz) ?? 0) + base + extra);
  }

  // Adjust to exactly 100
  let currentTotal = Array.from(dist.values()).reduce((a, b) => a + b, 0);
  while (currentTotal < total) {
    const tz = tzs[Math.floor(Math.random() * tzs.length)];
    dist.set(tz, (dist.get(tz) ?? 0) + 1);
    currentTotal++;
  }
  while (currentTotal > total) {
    const candidates = tzs.filter(tz => (dist.get(tz) ?? 0) > 1);
    const tz = candidates[Math.floor(Math.random() * candidates.length)];
    dist.set(tz, (dist.get(tz) ?? 0) - 1);
    currentTotal--;
  }

  return dist;
}

// ─── Create users ───
function createUsers(dist: Map<number, number>) {
  const JAY_ID = 5023569703;
  let userId = 7000000;
  const allUsers: { id: number; tz: number; city: string; firstName: string; lang: string }[] = [];

  // Clean old sim users + their chain data (keep jay and original virtual users 9999xxx)
  db.prepare('DELETE FROM assignments WHERE user_id >= 7000000 AND user_id < 9000000').run();
  db.prepare('DELETE FROM blocks WHERE user_id >= 7000000 AND user_id < 9000000').run();
  // Clean chains created by sim users
  const simChains = db.prepare('SELECT id FROM chains WHERE creator_id >= 7000000 AND creator_id < 9000000').all() as any[];
  for (const c of simChains) {
    db.prepare('DELETE FROM assignments WHERE chain_id = ?').run(c.id);
    db.prepare('DELETE FROM blocks WHERE chain_id = ?').run(c.id);
    db.prepare('DELETE FROM chains WHERE id = ?').run(c.id);
  }
  db.prepare('DELETE FROM users WHERE telegram_id >= 7000000 AND telegram_id < 9000000').run();

  const sortedTzs = Array.from(dist.keys()).sort((a, b) => b - a); // +12 → -11

  for (const tz of sortedTzs) {
    const count = dist.get(tz) ?? 0;
    const pool = TZ_POOL[tz];
    if (!pool) continue;

    for (let i = 0; i < count; i++) {
      // Pick random city from pool
      const cityData = pool.cities[Math.floor(Math.random() * pool.cities.length)];
      // Pick or generate name
      const nameIdx = i % cityData.names.length;
      const firstName = cityData.names[nameIdx] + (i >= cityData.names.length ? `${i + 1}` : '');
      const username = `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}_tz${tz >= 0 ? '+' : ''}${tz}`;

      userId++;
      upsertUser(userId, username, firstName, tz, 9, cityData.lang, cityData.city);
      allUsers.push({ id: userId, tz, city: cityData.city, firstName, lang: cityData.lang });
    }
  }

  return allUsers;
}

// ─── Main ───
console.log('╔══════════════════════════════════════════╗');
console.log('║  🌏 100 Users × 24 Timezones Simulation  ║');
console.log('╚══════════════════════════════════════════╝\n');

const dist = distributeUsers(100);

// Display distribution
const sortedTzs = Array.from(dist.keys()).sort((a, b) => b - a);
console.log('📊 User Distribution:\n');
console.log('  TZ    │ Users │ City                  │ Bar');
console.log('  ──────┼───────┼───────────────────────┼' + '─'.repeat(30));

let totalCheck = 0;
for (const tz of sortedTzs) {
  const count = dist.get(tz) ?? 0;
  totalCheck += count;
  const sign = tz >= 0 ? '+' : '';
  const tzStr = `UTC${sign}${tz}`.padEnd(7);
  const countStr = String(count).padStart(3);
  const pool = TZ_POOL[tz];
  const cities = pool?.cities.map(c => c.city).join('/') ?? '?';
  const cityStr = cities.length > 21 ? cities.slice(0, 18) + '...' : cities.padEnd(21);
  const bar = '█'.repeat(count);
  console.log(`  ${tzStr} │ ${countStr}   │ ${cityStr} │ ${bar}`);
}
console.log(`\n  Total: ${totalCheck} users\n`);

// Create users
console.log('👤 Creating users...');
const users = createUsers(dist);
console.log(`  ✅ ${users.length} users created\n`);

// Summary by language
const langCounts = new Map<string, number>();
for (const u of users) {
  langCounts.set(u.lang, (langCounts.get(u.lang) ?? 0) + 1);
}
console.log('🌐 Language distribution:');
for (const [lang, count] of Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${lang.padEnd(4)} ${count}`);
}

console.log('\n✅ Setup complete. Ready for chain simulation.');
