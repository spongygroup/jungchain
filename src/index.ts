import { config } from './config.js';
import { initDb } from './db/database.js';
import { createBot } from './bot.js';
import { createClock } from './clock.js';
import { Scheduler } from './modules/scheduler.js';
import { createDailyChains } from './modules/chain-manager.js';
import { DateTime } from 'luxon';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

async function main() {
  console.log('🌏 정(Jung) starting...');

  // Init DB
  mkdirSync(dirname(config.dbPath), { recursive: true });
  initDb(config.dbPath);
  console.log('✅ Database ready');

  // Create today's chains
  const today = DateTime.now().toISODate()!;
  createDailyChains(today);
  console.log(`✅ Created chains for ${today}`);

  // Setup clock & scheduler
  const clock = createClock(config.simMode, config.simSpeed);
  const scheduler = new Scheduler(clock);

  if (!config.simMode) {
    // Production: start Telegram bot
    const bot = createBot();
    scheduler.start();
    await bot.start();
  } else {
    console.log('🧪 Simulation mode — use npm run sim instead');
  }
}

main().catch(console.error);
