import 'dotenv/config';
import db from '../src/db/database.js';

// Sim chains
const chains = db.prepare(`
  SELECT c.*, u.first_name, u.city
  FROM chains c JOIN users u ON c.creator_id = u.telegram_id
  WHERE c.creator_id >= 7000000 AND c.creator_id < 9000000
  ORDER BY c.id
`).all() as any[];

console.log(`📦 DB에 저장된 시뮬 체인: ${chains.length}개\n`);
for (const c of chains) {
  const blocks = db.prepare('SELECT b.*, u.first_name, u.city, u.lang FROM blocks b JOIN users u ON b.user_id = u.telegram_id WHERE b.chain_id = ? ORDER BY b.slot_index').all(c.id) as any[];
  console.log(`Chain #${c.id} | ${c.first_name}@${c.city} | ${blocks.length} blocks | ${c.status}`);
  for (const b of blocks) {
    const sign = b.tz_offset >= 0 ? '+' : '';
    const caption = b.content.length > 35 ? b.content.slice(0, 32) + '...' : b.content;
    console.log(`  slot ${String(b.slot_index).padStart(2)} | UTC${sign}${b.tz_offset} | ${b.first_name}@${b.city}(${b.lang}) | "${caption}"`);
  }
  console.log('');
}

// Total counts
const totalBlocks = db.prepare('SELECT COUNT(*) as cnt FROM blocks b JOIN chains c ON b.chain_id = c.id WHERE c.creator_id >= 7000000 AND c.creator_id < 9000000').get() as any;
console.log(`Total blocks in DB: ${totalBlocks.cnt}`);
