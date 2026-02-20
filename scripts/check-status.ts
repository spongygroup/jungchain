import 'dotenv/config';
import db from '../src/db/database.js';

const chains = db.prepare('SELECT * FROM chains ORDER BY id DESC').all();
console.log('=== 체인 목록 ===');
console.table(chains);

const blocks = db.prepare('SELECT * FROM blocks ORDER BY chain_id, slot_index').all();
console.log(`\n=== 블록 (${blocks.length}개) ===`);
console.table(blocks);

const assignments = db.prepare("SELECT * FROM assignments WHERE status NOT IN ('expired') ORDER BY id DESC LIMIT 10").all();
console.log('\n=== 최근 어사인먼트 ===');
console.table(assignments);

const users = db.prepare('SELECT telegram_id, first_name, tz_offset, city, wallet_address FROM users').all();
console.log('\n=== 유저 ===');
console.table(users);
