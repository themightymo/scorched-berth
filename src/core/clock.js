// Fixed-step driver: converts variable frame time into whole simulation
// ticks so results never depend on frame rate.

import { TICK } from './constants.js';
import { step } from './engine.js';

export function createStepper({ maxTicksPerFrame = 120 } = {}) {
  let acc = 0;
  return {
    /** Advance by real seconds × speed. Returns the number of ticks run. */
    advance(state, seconds, speed = 1, onTick) {
      acc += Math.min(Math.max(seconds, 0), 0.1) * speed;
      let n = 0;
      while (acc >= TICK && n < maxTicksPerFrame) {
        acc -= TICK;
        const before = state.phase;
        step(state);
        n++;
        onTick?.(state, before);
        if (state.phase === 'aiming' || state.phase === 'battleOver') { acc = 0; break; }
      }
      if (n >= maxTicksPerFrame) acc = 0; // never try to "catch up" a backlog
      return n;
    },
    reset() { acc = 0; },
  };
}
