import 'dotenv/config';
import db from '../src/db/database.js';

// Count sim users (7000000~8999999)
const total = (db.prepare('SELECT COUNT(*) as cnt FROM users WHERE telegram_id >= 7000000 AND telegram_id < 9000000').get() as any).cnt;
console.log(`Total sim users: ${total}\n`);

// Distribution by TZ
const tzDist = db.prepare(`
  SELECT tz_offset, COUNT(*) as cnt
  FROM users WHERE telegram_id >= 7000000 AND telegram_id < 9000000
  GROUP BY tz_offset ORDER BY tz_offset DESC
`).all() as any[];

console.log('TZ  │ Users │ Cities & Names');
console.log('────┼───────┼─────────────────────────────────────────────');

let totalCheck = 0;
for (const tz of tzDist) {
  totalCheck += tz.cnt;
  const sign = tz.tz_offset >= 0 ? '+' : '';
  const users = db.prepare(`
    SELECT first_name, city, lang FROM users
    WHERE telegram_id >= 7000000 AND telegram_id < 9000000 AND tz_offset = ?
    ORDER BY telegram_id
  `).all(tz.tz_offset) as any[];

  // Group by city
  const cityGroups = new Map<string, string[]>();
  for (const u of users) {
    const key = `${u.city}`;
    if (!cityGroups.has(key)) cityGroups.set(key, []);
    cityGroups.get(key)!.push(`${u.first_name}(${u.lang})`);
  }

  const cityStr = Array.from(cityGroups.entries())
    .map(([city, names]) => `${city}: ${names.join(', ')}`)
    .join(' │ ');

  console.log(`${(`UTC${sign}${tz.tz_offset}`).padEnd(4)} │  ${String(tz.cnt).padStart(2)}   │ ${cityStr}`);
}

console.log(`────┼───────┼`);
console.log(`합계 │ ${String(totalCheck).padStart(3)}   │\n`);

// Language distribution
const langDist = db.prepare(`
  SELECT lang, COUNT(*) as cnt
  FROM users WHERE telegram_id >= 7000000 AND telegram_id < 9000000
  GROUP BY lang ORDER BY cnt DESC
`).all() as any[];

console.log('Language distribution:');
for (const r of langDist) {
  const bar = '█'.repeat(r.cnt);
  console.log(`  ${r.lang.padEnd(3)} ${String(r.cnt).padStart(2)} ${bar}`);
}

// City count
const cityCount = db.prepare(`
  SELECT COUNT(DISTINCT city) as cnt FROM users
  WHERE telegram_id >= 7000000 AND telegram_id < 9000000
`).get() as any;
console.log(`\nTotal cities: ${cityCount.cnt}`);
console.log(`Total TZs with users: ${tzDist.length}/24`);
