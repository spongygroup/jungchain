import type { Clock } from '../clock.js';
import { getAllActiveChains, processChainTick } from './chain-manager.js';
import type { TickResult } from '../types.js';

export class Scheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  public onTick: ((results: TickResult[]) => void) | null = null;

  constructor(private clock: Clock) {}

  getIntervalMs(): number {
    if (this.clock.speed === 0) return 500; // instant mode: every 500ms
    return 3_600_000 / this.clock.speed; // e.g. speed=60 → 60s per tick
  }

  start(): void {
    const intervalMs = this.getIntervalMs();
    console.log(`⏰ Scheduler started (interval: ${intervalMs}ms, speed: ${this.clock.speed}x)`);

    // Run first tick immediately
    void this.tick();

    this.intervalId = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('⏰ Scheduler stopped');
  }

  async tick(): Promise<TickResult[]> {
    this.tickCount++;
    const chains = getAllActiveChains();
    const results: TickResult[] = [];

    for (const chain of chains) {
      const { action, message } = await processChainTick(chain);
      results.push({
        chainId: chain.id,
        action,
        blockNum: chain.blocks_count,
        isAi: message?.is_ai ?? false,
        message: message?.content ?? '(chain ended)',
      });
    }

    if (this.onTick) this.onTick(results);
    return results;
  }

  getTickCount(): number {
    return this.tickCount;
  }
}
