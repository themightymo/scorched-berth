// Projectile kinematics shared by live shots, the trajectory preview, the AI,
// and map validation, so every consumer sees exactly the same flight.

import { TICK, GRAVITY, WIND_ACCEL, SPEED_PER_POWER, BARREL_LENGTH, BARREL_HEIGHT, W, H, MAX_FLIGHT_TICKS, TANK_HALF_WIDTH, TANK_HEIGHT } from './constants.js';
import { dsin, dcos } from './math.js';
import { groundAt } from './terrain.js';

export function launch(tank, angle, power) {
  const c = dcos(angle), s = dsin(angle), speed = power * SPEED_PER_POWER * (tank.mods?.muzzle ?? 1);
  return {
    x: tank.x + c * BARREL_LENGTH,
    y: tank.y - BARREL_HEIGHT - s * BARREL_LENGTH,
    vx: c * speed,
    vy: -s * speed,
  };
}

/** Semi-implicit Euler step on a fixed tick. */
export function stepBallistic(p, wind, gravityScale = 1) {
  p.vx += wind * WIND_ACCEL * TICK;
  p.vy += GRAVITY * gravityScale * TICK;
  p.x += p.vx * TICK;
  p.y += p.vy * TICK;
}

export function tankHit(tanks, x, y, ignoreIndex = -1) {
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    if (!t.alive || i === ignoreIndex) continue;
    if (x >= t.x - TANK_HALF_WIDTH && x <= t.x + TANK_HALF_WIDTH && y >= t.y - TANK_HEIGHT && y <= t.y + 2) return i;
  }
  return -1;
}

export const SHOOTER_GRACE_TICKS = 14;

/** Apply side walls. Returns false when the projectile has left the field. */
export function applyWalls(p, walls) {
  if (p.x >= 0 && p.x <= W) return true;
  if (walls === 'rebound') {
    p.x = p.x < 0 ? -p.x : 2 * W - p.x;
    p.vx = -p.vx * 0.6;
    return true;
  }
  return false;
}

/**
 * Trace one ballistic flight until it touches terrain, a tank, or leaves the
 * field. `env` = { terrain, tanks, wind, gravity, walls }. Records the apex.
 * Optional `path` array receives sampled points for previews.
 */
export function trace(env, shooterIndex, angle, power, { path = null, sampleEvery = 8, maxTicks = MAX_FLIGHT_TICKS } = {}) {
  const shooter = env.tanks[shooterIndex];
  const p = launch(shooter, angle, power);
  let apex = null;
  for (let tick = 1; tick <= maxTicks; tick++) {
    const wasRising = p.vy < 0;
    stepBallistic(p, env.wind, env.gravity ?? 1);
    if (wasRising && p.vy >= 0 && !apex) apex = { x: p.x, y: p.y, tick, vx: p.vx, vy: p.vy };
    if (!applyWalls(p, env.walls)) return { kind: 'out', x: p.x, y: p.y, tick, apex };
    if (path && tick % sampleEvery === 0) path.push({ x: p.x, y: p.y });
    if (p.y > H + 40) return { kind: 'out', x: p.x, y: p.y, tick, apex };
    const hit = tankHit(env.tanks, p.x, p.y, tick <= SHOOTER_GRACE_TICKS ? shooterIndex : -1);
    if (hit >= 0) return { kind: 'tank', tank: hit, x: p.x, y: p.y, tick, apex, vx: p.vx, vy: p.vy };
    if (p.y >= groundAt(env.terrain, p.x)) return { kind: 'ground', x: p.x, y: groundAt(env.terrain, p.x), tick, apex, vx: p.vx, vy: p.vy };
  }
  return { kind: 'timeout', x: p.x, y: p.y, tick: maxTicks, apex };
}
