import { config } from '../config.js';
import { initDb } from './database.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = initDb(config.dbPath);
console.log('✅ Database initialized at', config.dbPath);
db.close();
