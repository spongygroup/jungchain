import { SimClock } from '../clock.js';

export class TimeWarp {
  constructor(private clock: SimClock) {}

  get speed(): number {
    return this.clock.speed;
  }

  advanceOneHour(): void {
    this.clock.advance(60);
  }

  advanceMinutes(min: number): void {
    this.clock.advance(min);
  }

  getTickIntervalMs(): number {
    if (this.clock.speed === 0) return 500;
    return 3_600_000 / this.clock.speed;
  }
}
