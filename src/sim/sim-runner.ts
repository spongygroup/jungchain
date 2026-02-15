import { config, getCity } from '../config.js';
import { initDb } from '../db/database.js';
import { SimClock } from '../clock.js';
import { Scheduler } from '../modules/scheduler.js';
import { createDailyChains, getAllActiveChains } from '../modules/chain-manager.js';
import { createVirtualUsers } from './virtual-users.js';
import { TimeWarp } from './time-warp.js';
import { DateTime } from 'luxon';
import { mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';

async function runSimulation() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🌏 정(Jung) — Simulation Mode      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Speed: ${config.simSpeed}x | Users/TZ: ${config.simUsersPerTz}`);
  console.log('');

  // Use a temp DB for simulation
  const simDbPath = './data/jung-sim.db';
  mkdirSync(dirname(simDbPath), { recursive: true });
  try { rmSync(simDbPath); } catch { /* ignore */ }
  initDb(simDbPath);
  console.log('✅ Simulation DB initialized');

  // Create virtual users
  const users = createVirtualUsers();

  // Create only 1 chain for demo
  const today = DateTime.now().toISODate()!;
  // Only create the 14h chain
  const { insertChain } = await import('../db/database.js');
  const chainId = `${today}-14h`;
  insertChain({ id: chainId, date: today, hour: 14 });
  console.log(`\n🔗 Simulating chain: ${chainId}`);
  console.log('━'.repeat(50));

  // Setup clock & scheduler
  const clock = new SimClock(config.simSpeed);
  const scheduler = new Scheduler(clock);

  let completedChains = 0;
  let brokenChains = 0;
  let totalTicks = 0;

  scheduler.onTick = (results) => {
    for (const r of results) {
      if (r.chainId !== chainId) continue; // Only log our demo chain

      const offset = 12 - totalTicks;
      const city = getCity(offset);
      const icon = r.isAi ? '🤖' : '🧑';
      const statusIcon = r.action === 'completed' ? '✅' :
                         r.action === 'broken' ? '❌' : '→';

      console.log(
        `[Block ${String(r.blockNum).padStart(2, '0')}/24] ` +
        `${statusIcon} UTC${offset >= 0 ? '+' : ''}${offset} ${city.padEnd(18)} ` +
        `${icon} ${r.message.slice(0, 60)}${r.message.length > 60 ? '...' : ''}`
      );

      if (r.action === 'completed') completedChains++;
      if (r.action === 'broken') brokenChains++;
    }
    // Force flush for real-time monitoring
    process.stdout.write('');
  };

  // Run 24 ticks (one per timezone)
  console.log('');
  const startTime = Date.now();

  for (let tick = 0; tick < 24; tick++) {
    totalTicks = tick;
    const active = getAllActiveChains();
    if (active.length === 0) break;

    await scheduler.tick();

    // Wait between ticks — speed=1 means real-time (60s/tick), speed=60 means 1s/tick
    const delay = config.simSpeed === 0 ? 100 : 60000 / config.simSpeed;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('━'.repeat(50));
  console.log(`⏱  Simulation completed in ${elapsed}s`);
  console.log(`✅ Completed chains: ${completedChains}`);
  console.log(`❌ Broken chains: ${brokenChains}`);
  console.log('');
  console.log('🌏 "24분이면 지구를 한 바퀴 돌 수 있다."');

  // Cleanup
  try { rmSync(simDbPath); } catch { /* ignore */ }
  process.exit(0);
}

runSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
