import { DateTime } from 'luxon';

export interface Clock {
  now(): DateTime;
  speed: number;
  advance(minutes: number): void;
}

export class RealClock implements Clock {
  speed = 1;
  now(): DateTime {
    return DateTime.now();
  }
  advance(_minutes: number): void {
    // no-op in real mode
  }
}

export class SimClock implements Clock {
  private offsetMs = 0;
  speed: number;

  constructor(speed: number = 60) {
    this.speed = speed;
  }

  now(): DateTime {
    return DateTime.now().plus({ milliseconds: this.offsetMs });
  }

  advance(minutes: number): void {
    this.offsetMs += minutes * 60_000;
  }
}

export function createClock(simMode: boolean, speed: number): Clock {
  return simMode ? new SimClock(speed) : new RealClock();
}
