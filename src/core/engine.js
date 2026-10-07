// Deterministic battle engine. No DOM, Canvas, timers, or Math.random.
// State is plain JSON. The presentation layer calls step() on a fixed tick
// and reads state; it never writes simulation fields.

import {
  W, TICK, GRAVITY, BEDROCK, MAX_FLIGHT_TICKS, RESOLVE_HOLD_TICKS, MISS_HOLD_TICKS,
  FALL_SAFE_DISTANCE, FALL_DAMAGE_PER_PX, ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX, DEFAULT_MAX_TURNS, PAD_HALF_WIDTH,
  SKY_LIMIT, TANK_HALF_WIDTH, TANK_HEIGHT, TANK_MID,
} from './constants.js';
import { clamp, dist, hashValue, dsin, dcos } from './math.js';
import { createRng, rngState, normalizeSeedCode } from './rng.js';
import { getDefense } from './defenses.js';
import { getWeapon, defaultInventory, sanitizeInventory, hasAmmo, damageAt, WEAPON_IDS } from './weapons.js';
import { groundAt, supportY, carve, flowExtent, flattenPad, sanitizeTerrain } from './terrain.js';
import { launch, stepBallistic, tankHit, applyWalls, SHOOTER_GRACE_TICKS } from './physics.js';
import { generateMap, PROFILE_IDS } from './mapgen.js';
import { WEATHER } from './weather.js';
import { sanitizeRatings, ratingMods } from './ratings.js';

export const PHASES = ['aiming', 'projectile', 'resolving', 'battleOver'];
export const VENT_BURN = 8;
export const KINDS = ['human', 'ai', 'dummy'];

const DEFAULT_RULES = { gravity: 1, windMax: null, windStep: null, startHp: 100, unlimitedAmmo: false, walls: 'open', maxTurns: DEFAULT_MAX_TURNS, fixedWind: null };

/** Validate and fill defaults so every battle config is safe to run. */
export function normalizeConfig(input = {}) {
  const r = { ...DEFAULT_RULES, ...(input.rules ?? {}) };
  const rules = {
    gravity: clamp(Number(r.gravity) || 1, 0.4, 2),
    windMax: r.windMax == null ? null : clamp(Math.round(Number(r.windMax) || 0), 0, 40),
    windStep: r.windStep == null ? null : clamp(Math.round(Number(r.windStep) || 0), 0, 12),
    startHp: clamp(Math.round(Number(r.startHp) || 100), 10, 400),
    unlimitedAmmo: !!r.unlimitedAmmo,
    walls: r.walls === 'rebound' ? 'rebound' : 'open',
    maxTurns: clamp(Math.round(Number(r.maxTurns) || DEFAULT_MAX_TURNS), 4, 400),
    fixedWind: r.fixedWind == null ? null : clamp(Math.round(Number(r.fixedWind)), -40, 40),
  };
  const players = (input.players ?? []).slice(0, 8).map((p, i) => ({
    name: String(p.name ?? `Tank ${i + 1}`).slice(0, 18) || `Tank ${i + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color : '#cccccc',
    kind: KINDS.includes(p.kind) ? p.kind : 'ai',
    commander: p.commander ?? null,
    difficulty: ['recruit', 'veteran', 'ace'].includes(p.difficulty) ? p.difficulty : 'veteran',
    inventory: p.inventory ? sanitizeInventory(p.inventory) : defaultInventory(),
    hp: p.hp == null ? null : clamp(Math.round(p.hp), 1, 400),
    ratings: sanitizeRatings(p.ratings),
    x: p.x == null ? null : clamp(Math.round(p.x), 40, W - 40),
  }));
  if (players.length < 2) throw new Error('A battle needs at least two tanks.');
  const custom = input.map?.custom;
  return {
    seed: normalizeSeedCode(input.seed),
    mode: input.mode ?? 'quick',
    label: input.label ?? null,
    map: custom
      ? { custom: { terrain: sanitizeTerrain(custom.terrain), spawns: (custom.spawns ?? []).map((x) => clamp(Math.round(x), 40, W - 40)), vents: (custom.vents ?? []).map((v) => ({ x0: clamp(Math.round(v.x0), 0, W), x1: clamp(Math.round(v.x1), 0, W) })).filter((v) => v.x1 > v.x0) }, name: String(input.map.name ?? 'Custom map').slice(0, 30) }
      : { profile: PROFILE_IDS.includes(input.map?.profile) ? input.map.profile : 'rolling', hazards: input.map?.hazards !== false },
    weather: WEATHER[input.weather] ? input.weather : 'clear',
    night: !!input.night,
    rules,
    players,
    shufflePositions: input.shufflePositions !== false,
    objective: input.objective ?? { type: 'eliminateAll' },
  };
}

function evenlySpaced(n) {
  return Array.from({ length: n }, (_, i) => Math.round(80 + ((W - 160) / Math.max(1, n - 1)) * i));
}

export function createBattle(input) {
  const config = normalizeConfig(input);
  const rng = rngState(`${config.seed}|battle`);
  const R = createRng(rng);
  let map;
  if (config.map.custom) {
    const c = config.map.custom;
    let spawns = c.spawns.length >= config.players.length ? c.spawns.slice(0, config.players.length) : evenlySpaced(config.players.length);
    map = { terrain: c.terrain.slice(), spawns, vents: c.vents, profile: 'custom', attempts: 1, fallback: false };
  } else {
    map = generateMap({ seed: config.seed, profile: config.map.profile, count: config.players.length, hazards: config.map.hazards });
  }
  const terrain = map.terrain;
  const order = config.shufflePositions ? R.shuffle(map.spawns) : map.spawns.slice();
  const maxHp = config.rules.startHp;
  const tanks = config.players.map((p, i) => {
    const x = p.x ?? order[i];
    if (p.x != null) flattenPad(terrain, x, PAD_HALF_WIDTH);
    const mods = ratingMods(p.ratings);
    const hullHp = Math.round(maxHp * mods.hull);
    const hp = p.hp ?? hullHp;
    return {
      id: i, name: p.name, color: p.color, kind: p.kind, commander: p.commander, difficulty: p.difficulty,
      x, y: groundAt(terrain, x), hp, maxHp: Math.max(hp, hullHp), alive: true,
      ratings: { ...p.ratings }, mods,
      inventory: { ...p.inventory },
      angle: x < W / 2 ? 45 : 135, power: 65, weapon: 'shell',
      falling: null, memo: { lastTarget: null, streak: 0 }, shots: 0,
      fx: { shield: 0, deflector: false, fireproof: 0, anchor: 0 }, pending: null,
    };
  });
  const weather = WEATHER[config.weather];
  const windMax = config.rules.windMax ?? weather.windMax;
  const wind = config.rules.fixedWind ?? R.int(-Math.round(windMax * 0.66), Math.round(windMax * 0.66));
  const state = {
    v: 1, config, seed: config.seed, terrain, tanks, rng,
    vents: map.vents ?? [], fires: [], projectiles: [],
    mapInfo: { profile: map.profile, attempts: map.attempts, fallback: map.fallback },
    wind, phase: 'aiming', actor: 0, turn: 1, tick: 0, hold: 0,
    shot: null, events: [], commands: [], result: null,
  };
  state.actor = firstActor(state);
  emit(state, { t: 'battleStart', seed: config.seed });
  // Hull plating is bolted on as the battle starts (one plate per battle).
  const plating = getDefense('plating');
  for (const t of tanks) {
    if ((t.inventory.plating ?? 0) <= 0) continue;
    t.inventory.plating--;
    t.hp += plating.params.armour;
    t.maxHp += plating.params.armour;
    emit(state, { t: 'defense', by: t.id, item: 'plating', amount: plating.params.armour });
  }
  emit(state, { t: 'turn', actor: state.actor, wind: state.wind });
  return state;
}

function firstActor(state) {
  const i = state.tanks.findIndex((t) => t.alive && t.kind !== 'dummy');
  return i < 0 ? 0 : i;
}

function emit(state, event) {
  event.tick = state.tick;
  event.turn = state.turn;
  state.events.push(event);
  return event;
}

export const currentTank = (state) => state.tanks[state.actor];

export function windLimits(state) {
  const weather = WEATHER[state.config.weather];
  return { max: state.config.rules.windMax ?? weather.windMax, step: state.config.rules.windStep ?? weather.windStep };
}

/**
 * Why a tank cannot queue an active defense right now, or null when it can.
 * Defenses always consume stock, even under the unlimited-ammo rule.
 */
export function defenseBlocked(tank, id) {
  const d = getDefense(id);
  if (!d || d.mode !== 'active') return 'Unknown defense.';
  if ((tank.inventory?.[id] ?? 0) <= 0) return `No ${d.name} left.`;
  const fx = tank.fx ?? {};
  if (id === 'shield' && fx.shield >= d.params.absorb) return 'Shield already at full strength.';
  if (id === 'deflector' && fx.deflector) return 'Deflector field already up.';
  if (id === 'repair' && tank.hp >= tank.maxHp) return 'Armour is already full.';
  if (id === 'anchor' && fx.anchor >= d.params.rounds) return 'Anchor already set.';
  return null;
}

/** Returns null when legal, otherwise a human-readable reason. */
export function legalCommand(state, cmd) {
  if (!cmd || cmd.type !== 'fire') return 'Unknown command.';
  if (state.phase !== 'aiming') return 'Not ready to fire.';
  if (cmd.actor !== state.actor) return 'It is not that tank’s turn.';
  const t = state.tanks[cmd.actor];
  if (!t || !t.alive || t.kind === 'dummy') return 'That tank cannot fire.';
  if (!WEAPON_IDS.includes(cmd.weapon)) return 'Unknown weapon.';
  if (!state.config.rules.unlimitedAmmo && !hasAmmo(t.inventory, cmd.weapon)) return 'Out of that ammunition.';
  if (!Number.isInteger(cmd.angle) || cmd.angle < ANGLE_MIN || cmd.angle > ANGLE_MAX) return 'Angle out of range.';
  if (!Number.isInteger(cmd.power) || cmd.power < POWER_MIN || cmd.power > POWER_MAX) return 'Power out of range.';
  if (cmd.use != null) return defenseBlocked(t, cmd.use);
  return null;
}

export function applyCommand(state, cmd) {
  const error = legalCommand(state, cmd);
  if (error) return { ok: false, error };
  const t = state.tanks[cmd.actor];
  const weapon = getWeapon(cmd.weapon);
  if (!weapon.ammo.unlimited && !state.config.rules.unlimitedAmmo) t.inventory[cmd.weapon]--;
  t.angle = cmd.angle; t.power = cmd.power; t.weapon = cmd.weapon; t.shots++;
  if (Number.isInteger(cmd.target)) {
    t.memo.streak = t.memo.lastTarget === cmd.target ? t.memo.streak + 1 : 0;
    t.memo.lastTarget = cmd.target;
  }
  const record = { type: 'fire', actor: cmd.actor, weapon: cmd.weapon, angle: cmd.angle, power: cmd.power };
  if (Number.isInteger(cmd.target)) record.target = cmd.target;
  // An active defense rides along with the shot and deploys when the turn ends.
  t.pending = cmd.use ?? null;
  if (cmd.use != null) record.use = cmd.use;
  state.commands.push(record);
  emit(state, { t: 'fire', by: cmd.actor, weapon: cmd.weapon, angle: cmd.angle, power: cmd.power, use: cmd.use ?? null });
  state.projectiles = [launchPayload(t, weapon, cmd)];
  state.shot = { owner: cmd.actor, weapon: weapon.id, explosions: 0, offscreen: false, enemyDamage: 0 };
  state.phase = 'projectile';
  return { ok: true };
}

/** The first projectile of a shot. Beams fly straight; plasma never leaves the tank. */
function launchPayload(t, weapon, cmd) {
  const base = { kind: weapon.projectile.kind, weapon: weapon.id, owner: cmd.actor, age: 0 };
  const pr = weapon.projectile;
  if (pr.kind === 'plasma') {
    const u = (cmd.power - POWER_MIN) / (POWER_MAX - POWER_MIN);
    return { ...base, x: t.x, y: t.y - 10, vx: 0, vy: 0, charge: pr.charge, radiusScale: pr.minScale + (1 - pr.minScale) * u, scale: 1 + pr.focus * (1 - u) };
  }
  const p = { ...base, ...launch(t, cmd.angle, cmd.power) };
  if (pr.kind === 'beam') {
    p.vx = dcos(cmd.angle) * pr.speed;
    p.vy = -dsin(cmd.angle) * pr.speed;
    p.travel = 0;
    p.range = cmd.power * pr.rangePerPower;
  }
  return p;
}

/** Apply the attacker's firepower and the target's armour ratings. */
function scaled(state, base, by, to) {
  const attack = by == null ? 1 : state.tanks[by]?.mods?.damage ?? 1;
  const defense = state.tanks[to]?.mods?.defense ?? 1;
  return Math.max(1, Math.round(base * attack * defense));
}

function damageTank(state, idx, amount, by, cause) {
  const t = state.tanks[idx];
  if (!t.alive || amount <= 0) return 0;
  if (cause === 'blast' && t.fx?.shield > 0) {
    const absorbed = Math.min(t.fx.shield, amount);
    t.fx.shield -= absorbed;
    amount -= absorbed;
    emit(state, { t: 'shieldHit', by, to: idx, absorbed, left: t.fx.shield });
    if (amount <= 0) return 0;
  }
  const dealt = Math.min(t.hp, amount);
  t.hp -= dealt;
  emit(state, { t: 'damage', by, to: idx, amount: dealt, cause });
  if (state.shot && by === state.shot.owner && idx !== by) state.shot.enemyDamage += dealt;
  if (t.hp <= 0) {
    t.alive = false;
    t.hp = 0;
    emit(state, { t: 'eliminated', by, to: idx, cause });
  }
  return dealt;
}

/**
 * Detonate projectile p at (x, y). Returns follow-on projectiles (leapfrog
 * hops, funky bomblets) for the caller to keep flying.
 * p.scale weakens damage and crater (hops, bomblets); p.radiusScale widens or
 * narrows the damage radius (plasma). A plasma blast spares its firer.
 */
function explode(state, p, x, y, directHit = -1) {
  const w = getWeapon(p.weapon);
  const k = p.scale ?? 1;
  const blastRadius = w.damage.radius * (p.radiusScale ?? 1);
  const spare = w.projectile.kind === 'plasma' ? p.owner : -1;
  if (state.shot) state.shot.explosions++;
  const r = Math.max(4, Math.round(w.crater.radius * k));
  const shown = w.crater.shape === 'none' ? blastRadius : r;
  emit(state, { t: 'explosion', x, y, weapon: w.id, radius: Math.round(shown), by: p.owner, kind: p.kind });
  // Damage first, measured against tank centres before the crater moves them.
  if (w.damage.max > 0) {
    for (let i = 0; i < state.tanks.length; i++) {
      const t = state.tanks[i];
      if (!t.alive || i === spare) continue;
      // A direct hit always deals the weapon's full (scaled) damage to the tank struck.
      const base = Math.round((i === directHit ? w.damage.max : damageAt(w, dist(x, y, t.x, t.y - TANK_MID), blastRadius)) * k);
      if (base > 0) damageTank(state, i, scaled(state, base, p.owner, i), p.owner, 'blast');
    }
  }
  if (w.crater.shape === 'mound') {
    raiseMound(state, x, y, r, p.owner);
    extinguish(state, x - r, x + r, 'dirt');
  } else if (w.crater.shape !== 'none') {
    const held = anchoredGround(state);
    if (w.crater.shape === 'shaft') carve(state.terrain, x, y, r, w.crater.depth * k);
    else carve(state.terrain, x, y, r, r);
    for (const [col, y0] of held) state.terrain[col] = Math.min(state.terrain[col], y0);
    extinguish(state, x - r, x + r);
  }
  if (w.projectile.kind === 'napalm') ignite(state, w, x, p.owner);
  if (p.kind === 'leapfrog') return leapfrogHop(state, p, w, x);
  if (p.kind === 'funky') return funkyScatter(state, p, w, x);
  return [];
}

/** Integer hash → [0, 1). Deterministic stand-in for randomness inside a shot. */
function hash01(n) {
  let a = n | 0;
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

function leapfrogHop(state, p, w, x) {
  const left = p.hops ?? w.projectile.hops;
  if (left <= 0) return [];
  const { hopSpeed, carry, decay } = w.projectile;
  const dir = Math.sign(p.vx) || 1;
  const vx = dir * Math.max(70, Math.abs(p.vx) * carry);
  const cx = clamp(x, 0, W);
  emit(state, { t: 'hop', x: cx, y: groundAt(state.terrain, cx), by: p.owner, left: left - 1 });
  // Past the shooter's grace window: a hop can come back and hit its firer.
  return [{ x: cx, y: groundAt(state.terrain, cx) - 3, vx, vy: -hopSpeed * (p.scale ?? 1), kind: 'leapfrog', weapon: p.weapon, owner: p.owner, age: SHOOTER_GRACE_TICKS + 1, hops: left - 1, scale: (p.scale ?? 1) * decay }];
}

function funkyScatter(state, p, w, x) {
  const { count, scale } = w.projectile;
  const cx = clamp(x, 0, W);
  const y = groundAt(state.terrain, cx) - 3;
  const seed = Math.round(cx) * 31 + state.tick * 131 + (p.owner ?? 7) * 977;
  const out = [];
  for (let k = 0; k < count; k++) {
    const u = hash01(seed + k * 7919), v = hash01(seed + k * 104729 + 1);
    out.push({ x: cx, y, vx: (u * 2 - 1) * 230, vy: -(150 + v * 260), kind: 'funkylet', hue: k, weapon: p.weapon, owner: p.owner, age: SHOOTER_GRACE_TICKS + 1, scale });
  }
  emit(state, { t: 'scatter', x: cx, y, count, by: p.owner });
  return out;
}

/**
 * Drop a ball of earth centred on (x, y). Where the ball would float over a
 * deeper hole the dirt falls in instead. Columns under a tank stay put, so a
 * tank caught in it ends up in a pit with walls of dirt around it.
 */
function raiseMound(state, x, y, r, owner) {
  const t = state.terrain;
  const keep = state.tanks.filter((o) => o.alive).map((o) => o.x);
  const x0 = Math.max(0, Math.ceil(x - r)), x1 = Math.min(W, Math.floor(x + r));
  for (let col = x0; col <= x1; col++) {
    if (keep.some((tx) => Math.abs(tx - col) <= TANK_HALF_WIDTH)) continue;
    const u = (col - x) / r;
    const h = r * Math.sqrt(Math.max(0, 1 - u * u));
    const top = y + h >= t[col] ? Math.min(t[col], y - h) : t[col] - 2 * h;
    t[col] = Math.max(SKY_LIMIT, top);
  }
  state.tanks.forEach((o, i) => {
    if (!o.alive || Math.abs(o.x - x) > r + TANK_HALF_WIDTH) return;
    const reach = TANK_HALF_WIDTH + 4;
    const l = groundAt(t, o.x - reach), rr = groundAt(t, o.x + reach);
    if (Math.max(l, rr) < o.y - TANK_HEIGHT) emit(state, { t: 'buried', to: i, by: owner });
  });
}

/** Ground columns under anchored tanks, saved so a crater cannot lower them. */
function anchoredGround(state) {
  const held = [];
  for (const t of state.tanks) {
    if (!t.alive || !(t.fx?.anchor > 0)) continue;
    const a = Math.max(0, Math.round(t.x - TANK_HALF_WIDTH)), b = Math.min(W, Math.round(t.x + TANK_HALF_WIDTH));
    for (let c = a; c <= b; c++) held.push([c, state.terrain[c]]);
  }
  return held;
}

function extinguish(state, a, b, cause = 'blast') {
  const next = [];
  for (const f of state.fires) {
    if (f.x1 < a || f.x0 > b) { next.push(f); continue; }
    if (f.x0 < a - 8) next.push({ ...f, x1: Math.floor(a) });
    if (f.x1 > b + 8) next.push({ ...f, x0: Math.ceil(b) });
    emit(state, { t: 'extinguish', x0: Math.max(f.x0, a), x1: Math.min(f.x1, b), cause });
  }
  state.fires = next;
}

function ignite(state, w, x, owner) {
  const weather = WEATHER[state.config.weather];
  const { spread, climb, turns, burn } = w.projectile;
  const x0 = flowExtent(state.terrain, x, -1, spread, climb);
  const x1 = flowExtent(state.terrain, x, 1, spread, climb);
  const fire = { x0, x1, turns: Math.max(1, turns + weather.fireTurns), burn: Math.max(1, Math.round(burn * weather.burnScale)), by: owner };
  state.fires.push(fire);
  emit(state, { t: 'ignite', x0, x1, turns: fire.turns, burn: fire.burn, by: owner });
}

function splitCluster(state, p) {
  const w = getWeapon(p.weapon);
  const { count, spreadVx, spreadVy = 0 } = w.projectile;
  const mid = (count - 1) / 2;
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = k - mid;
    out.push({ x: p.x, y: p.y, vx: p.vx + o * spreadVx, vy: p.vy - Math.abs(o) * spreadVy * 0.3 + spreadVy * 0.2, kind: 'bomblet', weapon: p.weapon, owner: p.owner, age: p.age });
  }
  emit(state, { t: 'split', x: p.x, y: p.y, count, by: p.owner });
  return out;
}

function stepProjectile(state, p, out) {
  const terrain = state.terrain;
  if (p.kind === 'drill') {
    const w = getWeapon(p.weapon);
    const d = w.projectile.drillSpeed * TICK;
    p.x += p.dx * d; p.y += p.dy * d; p.drilled += d; p.age++;
    const outside = p.x < 0 || p.x > W;
    if (outside || p.drilled >= w.projectile.depth || p.y >= BEDROCK - 2 || p.y < groundAt(terrain, p.x) - 1) {
      explode(state, p, clamp(p.x, 0, W), Math.min(p.y, BEDROCK - 2));
      return;
    }
    out.push(p);
    return;
  }
  if (p.kind === 'plasma') {
    p.age++;
    if (p.age >= p.charge) explode(state, p, p.x, p.y);
    else out.push(p);
    return;
  }
  if (p.kind === 'rolling') return stepRoller(state, p, out);
  if (p.kind === 'beam') return stepBeam(state, p, out);
  const wasRising = p.vy < 0;
  stepBallistic(p, state.wind, state.config.rules.gravity);
  p.age++;
  if (p.kind === 'cluster' && wasRising && p.vy >= 0) {
    for (const b of splitCluster(state, p)) out.push(b);
    return;
  }
  if (!applyWalls(p, state.config.rules.walls) || p.y > BEDROCK + 60) {
    leaveField(state, p);
    return;
  }
  if (p.age > MAX_FLIGHT_TICKS) { emit(state, { t: 'fizzle', by: p.owner }); return; }
  if (screenProjectile(state, p)) return;
  const hit = tankHit(state.tanks, p.x, p.y, p.age <= SHOOTER_GRACE_TICKS ? p.owner : -1);
  if (hit >= 0) {
    emit(state, { t: 'directHit', by: p.owner, to: hit });
    for (const c of explode(state, p, p.x, p.y, hit)) out.push(c);
    return;
  }
  const g = groundAt(terrain, p.x);
  if (p.y >= g) {
    if (p.kind === 'burrow') {
      const w = getWeapon(p.weapon);
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      emit(state, { t: 'burrow', x: p.x, y: g, by: p.owner, forks: w.projectile.forks ?? 1 });
      // Drill steeply downward: at least 0.7 of the motion is vertical.
      let dx = p.vx / speed, dy = p.vy / speed;
      if (dy < 0.7) { dy = 0.7; dx = Math.sign(dx || 1) * 0.714142842854285; }
      const forks = w.projectile.forks ?? 1;
      for (let k = 0; k < forks; k++) {
        // Fan the warheads out sideways; renormalise without trig so it stays deterministic.
        const fx = dx + (k - (forks - 1) / 2) * (w.projectile.forkSpread ?? 0);
        const n = Math.sqrt(fx * fx + dy * dy);
        out.push({ x: p.x, y: g, dx: fx / n, dy: dy / n, kind: 'drill', weapon: p.weapon, owner: p.owner, age: p.age, drilled: 0 });
      }
      return;
    }
    if (p.kind === 'roller') {
      const w = getWeapon(p.weapon);
      const l = groundAt(terrain, p.x - 6), r = groundAt(terrain, p.x + 6);
      const dir = Math.abs(r - l) < 2 ? (Math.sign(p.vx) || 1) : r > l ? 1 : -1;
      emit(state, { t: 'roll', x: p.x, y: g, by: p.owner, dir });
      out.push({ x: p.x, y: g, kind: 'rolling', dir, rolled: 0, low: { x: p.x, y: g }, weapon: p.weapon, owner: p.owner, age: p.age, vx: dir * w.projectile.speed, vy: 0 });
      return;
    }
    for (const c of explode(state, p, p.x, g)) out.push(c);
    return;
  }
  out.push(p);
}

function leaveField(state, p) {
  if (state.shot && !state.shot.offscreen) {
    state.shot.offscreen = true;
    emit(state, { t: 'offscreen', by: p.owner, x: clamp(p.x, 0, W) });
  }
}

/**
 * A heavy roller follows the surface downhill. It explodes on reaching a tank,
 * the bottom of a valley (the ground ahead climbs more than a few pixels above
 * the lowest point it has passed), or the end of its range.
 */
function stepRoller(state, p, out) {
  const w = getWeapon(p.weapon);
  const d = w.projectile.speed * TICK;
  p.age++;
  const nx = p.x + p.dir * d;
  if (nx < 0 || nx > W) { leaveField(state, p); return; }
  p.x = nx;
  p.y = groundAt(state.terrain, nx);
  p.rolled += d;
  if (p.y >= p.low.y) p.low = { x: p.x, y: p.y };
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    if (t.alive && Math.abs(t.x - p.x) < TANK_HALF_WIDTH && Math.abs(t.y - p.y) < TANK_HEIGHT + 2) {
      emit(state, { t: 'directHit', by: p.owner, to: i });
      explode(state, p, p.x, p.y, i);
      return;
    }
  }
  if (p.y < p.low.y - 5) { explode(state, p, p.low.x, p.low.y); return; }
  if (p.rolled >= w.projectile.range) { explode(state, p, p.x, p.y); return; }
  out.push(p);
}

/** A laser beam: straight line, no gravity or wind, stepped in short hops so it cannot skip a tank. */
function stepBeam(state, p, out) {
  const SUB = 3;
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
  const steps = Math.max(1, Math.round((speed * TICK) / SUB));
  p.age++;
  for (let k = 0; k < steps; k++) {
    const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
    p.x += (p.vx / len) * SUB; p.y += (p.vy / len) * SUB;
    p.travel += SUB;
    if (p.x < 0 || p.x > W || p.y > BEDROCK + 60) { leaveField(state, p); return; }
    if (p.travel >= p.range) { emit(state, { t: 'beamEnd', x: p.x, y: p.y, by: p.owner }); return; }
    if (screenProjectile(state, p)) return;
    const hit = tankHit(state.tanks, p.x, p.y, p.age <= 3 ? p.owner : -1);
    if (hit >= 0) { emit(state, { t: 'directHit', by: p.owner, to: hit }); explode(state, p, p.x, p.y, hit); return; }
    const g = groundAt(state.terrain, p.x);
    if (p.y >= g) { explode(state, p, p.x, g); return; }
  }
  out.push(p);
}

/**
 * Deflector fields and point-defense guns react to a hostile projectile that is
 * approaching them. Returns true when the projectile was destroyed.
 */
function screenProjectile(state, p) {
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    if (!t.alive || i === p.owner) continue;
    const deflect = t.fx?.deflector;
    const guns = p.kind !== 'beam' && (t.inventory.interceptor ?? 0) > 0;
    if (!deflect && !guns) continue;
    const cx = t.x, cy = t.y - 10;
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const radius = deflect ? getDefense('deflector').params.radius : getDefense('interceptor').params.radius;
    if (d >= radius || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const dot = p.vx * nx + p.vy * ny;
    if (dot >= 0) continue; // moving away: not a threat
    if (deflect) {
      // Mirror the velocity about the field's surface; the round now belongs to the defender.
      p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny;
      p.x = cx + nx * radius; p.y = cy + ny * radius;
      emit(state, { t: 'deflect', to: i, by: p.owner, x: p.x, y: p.y });
      p.owner = i;
      p.age = 0;
      t.fx.deflector = false;
      return false;
    }
    t.inventory.interceptor--;
    emit(state, { t: 'intercept', to: i, by: p.owner, x: p.x, y: p.y, weapon: p.weapon, left: t.inventory.interceptor });
    return true;
  }
  return false;
}

/** Advance falling tanks one tick. Returns true while any tank is falling. */
function settleTanks(state) {
  let falling = false;
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    const sup = supportY(state.terrain, t.x);
    if (t.y < sup - 0.001) {
      if (!t.falling) t.falling = { from: t.y, vy: 0 };
      if (t.alive && !t.falling.chute && t.y - t.falling.from > FALL_SAFE_DISTANCE && (t.inventory.parachute ?? 0) > 0) {
        t.inventory.parachute--;
        t.falling.chute = true;
        emit(state, { t: 'parachute', to: i });
      }
      const terminal = t.falling.chute ? getDefense('parachute').params.drift : 600;
      t.falling.vy = Math.min(t.falling.vy + GRAVITY * 1.4 * TICK, terminal);
      t.y = Math.min(sup, t.y + t.falling.vy * TICK);
      if (t.y >= sup - 0.001) land(state, i, sup);
      else falling = true;
    } else if (t.falling) {
      land(state, i, sup);
    } else if (t.y > sup) {
      t.y = sup;
    }
  }
  return falling;
}

function land(state, i, y) {
  const t = state.tanks[i];
  const drop = y - t.falling.from;
  const chute = !!t.falling.chute;
  t.y = y;
  t.falling = null;
  if (!t.alive) return;
  const amount = chute ? 0 : Math.round(Math.max(0, drop - FALL_SAFE_DISTANCE) * FALL_DAMAGE_PER_PX * (t.mods?.fall ?? 1));
  emit(state, { t: 'fall', to: i, distance: Math.round(drop) });
  if (amount > 0) damageTank(state, i, amount, state.shot?.owner ?? null, 'fall');
}

/** One fixed simulation tick. opts.stopAtRest makes AI previews stop before the turn ends. */
export function step(state, opts = {}) {
  if (state.phase === 'aiming' || state.phase === 'battleOver' || state.phase === 'rest') return state.phase;
  state.tick++;
  if (state.phase === 'projectile') {
    const next = [];
    for (const p of state.projectiles) stepProjectile(state, p, next);
    state.projectiles = next;
    settleTanks(state);
    if (!next.length) {
      state.phase = 'resolving';
      state.hold = opts.stopAtRest ? 0 : state.shot?.explosions ? RESOLVE_HOLD_TICKS : MISS_HOLD_TICKS;
    }
    return state.phase;
  }
  if (state.phase === 'resolving') {
    const falling = settleTanks(state);
    if (state.hold > 0) state.hold--;
    if (!falling && state.hold <= 0) {
      if (opts.stopAtRest) state.phase = 'rest';
      else endTurn(state);
    }
  }
  return state.phase;
}

function burnTanks(state) {
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    if (!t.alive) continue;
    let fire = null;
    for (const f of state.fires) if (t.x >= f.x0 && t.x <= f.x1 && (!fire || f.burn > fire.burn)) fire = f;
    if (t.fx?.fireproof > 0) continue;
    if (fire) damageTank(state, i, scaled(state, fire.burn, fire.by, i), fire.by, 'fire');
    if (t.alive && state.vents.some((v) => t.x >= v.x0 - 6 && t.x <= v.x1 + 6)) damageTank(state, i, scaled(state, VENT_BURN, null, i), null, 'vent');
  }
  for (const f of state.fires) f.turns--;
  const before = state.fires.length;
  state.fires = state.fires.filter((f) => f.turns > 0);
  if (state.fires.length < before) emit(state, { t: 'fireOut' });
}

export function evaluateOutcome(state) {
  const { tanks, config } = state;
  const alive = tanks.filter((t) => t.alive);
  const fighters = alive.filter((t) => t.kind !== 'dummy');
  const humans = tanks.filter((t) => t.kind === 'human');
  const humansAlive = humans.filter((t) => t.alive);
  const obj = config.objective ?? { type: 'eliminateAll' };
  const humanShots = humans.reduce((n, t) => n + t.shots, 0);

  if (humans.length && !humansAlive.length) return { winner: alive.length === 1 ? alive[0].id : null, reason: alive.length ? 'humansDestroyed' : 'mutualDestruction' };
  if (obj.type === 'surviveTurns' && humansAlive.length && state.turn >= obj.turns) return { winner: humansAlive[0].id, reason: 'survived' };
  if (alive.length <= 1) return { winner: alive[0]?.id ?? null, reason: alive.length ? 'lastStanding' : 'mutualDestruction' };
  if (obj.type !== 'surviveTurns' && humansAlive.length && alive.every((t) => t.kind === 'human')) {
    if (humansAlive.length === 1) return { winner: humansAlive[0].id, reason: 'lastStanding' };
  }
  if (obj.type === 'maxShots' && humanShots >= obj.shots) return { winner: null, reason: 'outOfShots', enemiesLeft: alive.length - humansAlive.length };
  if (!fighters.length) return { winner: null, reason: 'noFighters' };
  if (state.turn >= config.rules.maxTurns) {
    const top = alive.slice().sort((a, b) => b.hp - a.hp);
    return { winner: top.length > 1 && top[0].hp === top[1].hp ? null : top[0].id, reason: 'ceasefire' };
  }
  return null;
}

/** Tick the actor's timed effects, then deploy the defense queued with its shot. */
function deployDefense(state) {
  const i = state.actor;
  const t = state.tanks[i];
  const id = t.pending;
  t.pending = null;
  if (t.fx.fireproof > 0) t.fx.fireproof--;
  if (t.fx.anchor > 0) t.fx.anchor--;
  if (!id || !t.alive) return;
  const d = getDefense(id);
  const p = d.params;
  const event = { t: 'defense', by: i, item: id };
  switch (id) {
    case 'shield': t.fx.shield = p.absorb; break;
    case 'deflector': t.fx.deflector = true; break;
    case 'repair': {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + p.heal);
      event.amount = t.hp - before;
      break;
    }
    case 'fuel': {
      const dir = t.angle <= 90 ? 1 : -1;
      const from = t.x;
      let x = from;
      for (let step = 1; step <= p.distance; step++) {
        const next = Math.round(from + dir * step);
        if (next < 18 || next >= state.terrain.length - 18) break;
        if (state.tanks.some((other) => other !== t && other.alive && Math.abs(other.x - next) < p.clearance)) break;
        x = next;
      }
      t.x = x;
      t.y = supportY(state.terrain, x);
      t.falling = null;
      event.from = from;
      event.x = x;
      break;
    }
    case 'foam':
      extinguish(state, t.x - p.reach, t.x + p.reach, 'foam');
      t.fx.fireproof = p.rounds;
      break;
    case 'berm': raiseBerm(state, t, p); break;
    case 'anchor': t.fx.anchor = p.rounds; break;
    case 'relocate': {
      const x = relocationSpot(state, i, p);
      if (x == null) { emit(state, { t: 'defenseFailed', by: i, item: id }); return; }
      event.from = t.x;
      t.x = x;
      t.y = supportY(state.terrain, x);
      t.falling = null;
      event.x = x;
      break;
    }
    default: return;
  }
  t.inventory[id]--;
  emit(state, event);
}

/** Two parabolic dirt mounds either side of the tank; never on top of another tank. */
function raiseBerm(state, t, { inner, outer, height }) {
  const span = outer - inner;
  for (const dir of [-1, 1]) {
    for (let k = 0; k <= span; k++) {
      const col = Math.round(t.x + dir * (inner + k));
      if (col < 0 || col > W) continue;
      if (state.tanks.some((o) => o !== t && o.alive && Math.abs(o.x - col) < TANK_HALF_WIDTH + 6)) continue;
      const u = k / span;
      const h = height * 4 * u * (1 - u);
      state.terrain[col] = Math.max(SKY_LIMIT, state.terrain[col] - h);
    }
  }
}

/** A random spot clear of every other tank and hazard, drawn from the battle RNG. */
function relocationSpot(state, idx, { clearance, tries }) {
  const R = createRng(state.rng);
  for (let k = 0; k < tries; k++) {
    const x = R.int(60, W - 60);
    if (state.tanks.some((o, j) => j !== idx && o.alive && Math.abs(o.x - x) < clearance)) continue;
    if (state.vents.some((v) => x >= v.x0 - 30 && x <= v.x1 + 30)) continue;
    if (state.fires.some((f) => x >= f.x0 - 10 && x <= f.x1 + 10)) continue;
    return x;
  }
  return null;
}

function endTurn(state) {
  deployDefense(state);
  burnTanks(state);
  state.shot = null;
  const outcome = evaluateOutcome(state);
  if (outcome) {
    state.phase = 'battleOver';
    state.result = outcome;
    emit(state, { t: 'battleOver', ...outcome });
    return;
  }
  advanceActor(state);
}

function advanceActor(state) {
  const n = state.tanks.length;
  let next = state.actor;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    const t = state.tanks[next];
    if (t.alive && t.kind !== 'dummy') break;
  }
  state.actor = next;
  state.turn++;
  const { max, step: windStep } = windLimits(state);
  if (state.config.rules.fixedWind == null) {
    const R = createRng(state.rng);
    state.wind = clamp(state.wind + R.int(-windStep, windStep), -max, max);
  }
  state.phase = 'aiming';
  emit(state, { t: 'turn', actor: state.actor, wind: state.wind });
}

/** Run until the engine needs a command (or the battle ends). */
export function runUntilIdle(state, maxTicks = 20000) {
  for (let i = 0; i < maxTicks; i++) {
    const phase = step(state);
    if (phase === 'aiming' || phase === 'battleOver') return phase;
  }
  throw new Error('Battle failed to resolve within the tick limit.');
}

/** Lightweight copy for what-if simulation; it shares no mutable state. */
export function cloneForSim(state) {
  return {
    ...state,
    terrain: state.terrain.slice(),
    tanks: state.tanks.map((t) => ({ ...t, inventory: { ...t.inventory }, memo: { ...t.memo }, fx: { ...t.fx }, falling: t.falling ? { ...t.falling } : null })),
    fires: state.fires.map((f) => ({ ...f })),
    projectiles: [],
    events: [],
    commands: [],
    rng: { s: 0 }, // never consulted: what-if runs stop before the turn ends
    shot: null,
  };
}

/** Resolve a shot on a copy and stop before the turn ends (no future randomness). */
export function simulateShot(state, cmd, maxTicks = MAX_FLIGHT_TICKS + 1200) {
  const sim = cloneForSim(state);
  const res = applyCommand(sim, cmd);
  if (!res.ok) return null;
  for (let i = 0; i < maxTicks && sim.phase !== 'rest'; i++) step(sim, { stopAtRest: true });
  return sim;
}

/** Digest of the outcome-relevant state, for replay verification. */
export function stateDigest(state) {
  return hashValue({
    t: state.terrain.map((y) => Math.round(y * 16)),
    k: state.tanks.map((t) => [Math.round(t.x), Math.round(t.y * 16), t.hp, t.alive]),
    w: state.wind, n: state.turn, r: state.result,
  });
}

/** Rebuild a battle from its config and command list (replays, resume). */
export function replayBattle(config, commands, { untilCommand = commands.length } = {}) {
  const state = createBattle(config);
  for (let i = 0; i < untilCommand; i++) {
    if (state.phase === 'battleOver') break;
    const res = applyCommand(state, commands[i]);
    if (!res.ok) throw new Error(`Replay desync at command ${i + 1}: ${res.error}`);
    runUntilIdle(state);
  }
  return state;
}

/** Detonate a weapon at a point (sandbox tools and tests). Settles tanks afterwards. */
export function detonate(state, weaponId, x, y, owner = null) {
  const w = getWeapon(weaponId);
  if (!w) throw new Error(`Unknown weapon ${weaponId}`);
  explode(state, { weapon: w.id, owner, kind: w.projectile.kind }, x, y);
  for (let i = 0; i < 4000 && settleTanks(state); i++) state.tick++;
  if (state.phase !== 'aiming') return;
  const outcome = evaluateOutcome(state);
  if (outcome) {
    state.phase = 'battleOver';
    state.result = outcome;
    emit(state, { t: 'battleOver', ...outcome });
  } else if (!state.tanks[state.actor].alive) {
    advanceActor(state);
  }
}
