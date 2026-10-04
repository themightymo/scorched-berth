// Heightmap terrain: terrain[x] is the y of the surface at column x (larger
// y is lower). Pure functions with no DOM access.

import { W, BEDROCK, SKY_LIMIT, TANK_HALF_WIDTH } from './constants.js';
import { clamp } from './math.js';

export const groundAt = (terrain, x) => terrain[clamp(Math.round(x), 0, W)];

/** Highest supporting ground under a tank footprint (smallest y). */
export function supportY(terrain, x) {
  const span = TANK_HALF_WIDTH - 3;
  return Math.min(groundAt(terrain, x - span), groundAt(terrain, x), groundAt(terrain, x + span));
}

export function sanitizeTerrain(terrain) {
  const out = new Array(W + 1);
  for (let x = 0; x <= W; x++) {
    const v = Number(terrain?.[x]);
    out[x] = Number.isFinite(v) ? clamp(v, SKY_LIMIT, BEDROCK) : BEDROCK - 120;
  }
  return out;
}

/**
 * Remove an elliptical volume (rx × ry) centred at (cx, cy). Material above a
 * fully buried cavity collapses into it, so the heightmap stays valid.
 * Returns total removed area (used for terrain-disruption scoring).
 */
export function carve(terrain, cx, cy, rx, ry) {
  let removed = 0;
  const x0 = Math.max(0, Math.ceil(cx - rx)), x1 = Math.min(W, Math.floor(cx + rx));
  for (let x = x0; x <= x1; x++) {
    const u = (x - cx) / rx;
    const h = ry * Math.sqrt(Math.max(0, 1 - u * u));
    const top = cy - h, bottom = cy + h;
    const cavity = bottom - Math.max(top, terrain[x]);
    if (cavity > 0) {
      const next = Math.min(BEDROCK, terrain[x] + cavity);
      removed += next - terrain[x];
      terrain[x] = next;
    }
  }
  return removed;
}

/** Flatten a pad for a tank at x so it starts on stable ground. */
export function flattenPad(terrain, x, halfWidth, y = groundAt(terrain, x)) {
  for (let i = Math.max(0, Math.round(x - halfWidth)); i <= Math.min(W, Math.round(x + halfWidth)); i++) terrain[i] = y;
}

/**
 * Walk along the surface from x in direction dir until the ground climbs more
 * than `climb` px within a 4px step or `limit` px is covered. Used by napalm.
 */
export function flowExtent(terrain, x, dir, limit, climb) {
  let cx = Math.round(x);
  let travelled = 0;
  while (travelled < limit) {
    const nx = cx + dir * 4;
    if (nx < 0 || nx > W) break;
    if (terrain[cx] - terrain[nx] > climb) break; // steep wall upward
    cx = nx;
    travelled += 4;
  }
  return clamp(cx, 0, W);
}
