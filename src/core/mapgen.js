// Seeded, bounded, fair map generation with a guaranteed safe fallback.

import { W, BEDROCK, SKY_LIMIT, PAD_HALF_WIDTH } from './constants.js';
import { clamp, lerp } from './math.js';
import { createRng } from './rng.js';
import { flattenPad, groundAt } from './terrain.js';
import { trace } from './physics.js';

export const MAP_PROFILES = {
  rolling: { name: 'Rolling Dunes', blurb: 'Gentle hills. Long, readable arcs.', base: 375, octaves: [[230, 72], [95, 26], [36, 7]], vents: [0, 0] },
  badlands: { name: 'Badlands Mesas', blurb: 'Flat-topped mesas and sheer drops. Falls hurt here.', base: 372, octaves: [[260, 88], [110, 30]], terrace: 42, vents: [0, 1] },
  canyon: { name: 'Deep Canyon', blurb: 'A wide gorge splits the field. High lobs or nothing.', base: 330, octaves: [[210, 46], [70, 16]], valley: 155, vents: [0, 1] },
  peaks: { name: 'Sawtooth Peaks', blurb: 'Jagged ridges shelter tanks from flat shots.', base: 395, octaves: [[150, 105], [60, 32], [22, 7]], vents: [0, 0] },
  plains: { name: 'Open Plains', blurb: 'Little cover. Every tank is exposed.', base: 410, octaves: [[320, 36], [80, 10]], vents: [0, 0] },
  vents: { name: 'Thermal Vents', blurb: 'Scalding vents in the low ground burn tanks that fall in.', base: 388, octaves: [[200, 62], [72, 20]], vents: [2, 3] },
};
export const PROFILE_IDS = Object.keys(MAP_PROFILES);

export const MAX_ATTEMPTS = 8;
export const EDGE_MARGIN = 60;
export const VENT_CLEARANCE = 70;
export const MAX_PAD_GAP = 270;

function valueNoise(rng, wavelength) {
  const cells = Math.ceil(W / wavelength) + 3;
  const lattice = Array.from({ length: cells }, () => rng.range(-1, 1));
  return (x) => {
    const f = x / wavelength, i = Math.floor(f), t = f - i;
    const s = t * t * (3 - 2 * t);
    return lerp(lattice[i], lattice[i + 1], s);
  };
}

function buildTerrain(rng, profile) {
  const layers = profile.octaves.map(([wl, amp]) => [valueNoise(rng, wl), amp]);
  const terrain = new Array(W + 1);
  for (let x = 0; x <= W; x++) {
    let y = profile.base;
    for (const [n, amp] of layers) y -= n(x) * amp;
    if (profile.terrace) y = lerp(y, Math.round(y / profile.terrace) * profile.terrace, 0.82);
    if (profile.valley) {
      const u = (x - W / 2) / (W * 0.24);
      y += profile.valley * Math.max(0, 1 - u * u);
    }
    terrain[x] = clamp(y, SKY_LIMIT + 40, BEDROCK - 30);
  }
  return terrain;
}

function placeVents(rng, terrain, count, spawns) {
  const vents = [];
  const keepOut = PAD_HALF_WIDTH + VENT_CLEARANCE + 44;
  for (let n = 0; n < count; n++) {
    // Prefer low ground away from spawns: sample a few spots and keep the lowest.
    let best = null;
    for (let k = 0; k < 10; k++) {
      const x = rng.int(EDGE_MARGIN + 40, W - EDGE_MARGIN - 40);
      if (vents.some((v) => Math.abs((v.x0 + v.x1) / 2 - x) < 180)) continue;
      if (spawns.some((sx) => Math.abs(sx - x) < keepOut)) continue;
      if (!best || terrain[x] > terrain[best]) best = x;
    }
    if (best == null) continue;
    const half = rng.int(24, 40);
    vents.push({ x0: best - half, x1: best + half });
  }
  return vents.sort((a, b) => a.x0 - b.x0);
}

function pickSpawns(rng, count) {
  const span = (W - 2 * EDGE_MARGIN) / count;
  const xs = [];
  for (let i = 0; i < count; i++) {
    const lo = EDGE_MARGIN + span * i + span * 0.3, hi = EDGE_MARGIN + span * (i + 1) - span * 0.3;
    xs.push(Math.round(rng.range(lo, hi)));
  }
  return xs;
}

/** Check fairness rules. Returns an array of problems (empty = fair). */
export function validateLayout({ terrain, spawns, vents = [] }, { checkReach = true } = {}) {
  const problems = [];
  const minSep = Math.min(300, (W - 2 * EDGE_MARGIN) / Math.max(2, spawns.length) * 0.55);
  spawns.forEach((x, i) => {
    if (x < EDGE_MARGIN || x > W - EDGE_MARGIN) problems.push(`spawn ${i} too close to edge`);
    for (let j = i + 1; j < spawns.length; j++) if (Math.abs(spawns[j] - x) < minSep) problems.push(`spawns ${i}/${j} too close`);
    for (const v of vents) if (x + PAD_HALF_WIDTH > v.x0 - VENT_CLEARANCE && x - PAD_HALF_WIDTH < v.x1 + VENT_CLEARANCE) problems.push(`spawn ${i} near hazard`);
    const y = groundAt(terrain, x);
    if (y < SKY_LIMIT + 60 || y > BEDROCK - 30) problems.push(`spawn ${i} at unsafe height`);
    for (let k = -PAD_HALF_WIDTH; k <= PAD_HALF_WIDTH; k++) if (Math.abs(groundAt(terrain, x + k) - y) > 0.5) { problems.push(`spawn ${i} pad not flat`); break; }
  });
  const ys = spawns.map((x) => groundAt(terrain, x));
  if (ys.length && Math.max(...ys) - Math.min(...ys) > MAX_PAD_GAP) problems.push('height gap between spawns too large');
  if (checkReach && !problems.length) {
    const tanks = spawns.map((x) => ({ x, y: groundAt(terrain, x), alive: true }));
    const env = { terrain, tanks, wind: 0, gravity: 1, walls: 'open' };
    tanks.forEach((t, i) => {
      let ok = false;
      for (let a = 10; a <= 170 && !ok; a += 8) {
        for (let p = 30; p <= 100 && !ok; p += 7) {
          const r = trace(env, i, a, p);
          if (r.kind === 'tank' && r.tank !== i) ok = true;
          else if (r.kind === 'ground' && tanks.some((o, j) => j !== i && Math.abs(o.x - r.x) < 55)) ok = true;
        }
      }
      if (!ok) problems.push(`spawn ${i} cannot reach any opponent`);
    });
  }
  return problems;
}

/** Deterministic map that always passes validation; used after failed retries. */
export function fallbackMap(count) {
  const terrain = new Array(W + 1);
  for (let x = 0; x <= W; x++) {
    const u = x / W;
    terrain[x] = 400 - 40 * (4 * u * (1 - u)) + 18 * ((u * 7) % 1 < 0.5 ? (u * 7) % 1 : 1 - ((u * 7) % 1));
  }
  const span = (W - 2 * EDGE_MARGIN) / count;
  const spawns = Array.from({ length: count }, (_, i) => Math.round(EDGE_MARGIN + span * (i + 0.5)));
  for (const x of spawns) flattenPad(terrain, x, PAD_HALF_WIDTH);
  return { terrain, spawns, vents: [] };
}

/**
 * Generate a fair map. Bounded to MAX_ATTEMPTS seeded retries, then falls
 * back to a known-good layout. Result is fully determined by the inputs.
 */
export function generateMap({ seed, profile = 'rolling', count = 4, hazards = true }) {
  const prof = MAP_PROFILES[profile] ?? MAP_PROFILES.rolling;
  const log = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = createRng(`${seed}|map|${profile}|${count}|${attempt}`);
    const terrain = buildTerrain(rng, prof);
    const ventCount = hazards ? rng.int(prof.vents[0], prof.vents[1]) : 0;
    const spawns = pickSpawns(rng, count);
    const vents = placeVents(rng, terrain, ventCount, spawns);
    for (const x of spawns) flattenPad(terrain, x, PAD_HALF_WIDTH);
    const problems = validateLayout({ terrain, spawns, vents });
    if (!problems.length) return { terrain, spawns, vents, profile, attempts: attempt + 1, fallback: false };
    log.push(problems[0]);
  }
  return { ...fallbackMap(count), profile, attempts: MAX_ATTEMPTS, fallback: true, problems: log };
}
