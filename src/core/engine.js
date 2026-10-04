// Deterministic battle engine. No DOM, Canvas, timers, or Math.random.
// State is plain JSON. The presentation layer calls step() on a fixed tick
// and reads state; it never writes simulation fields.

import {
  W, TICK, GRAVITY, BEDROCK, MAX_FLIGHT_TICKS, RESOLVE_HOLD_TICKS, MISS_HOLD_TICKS,
  FALL_SAFE_DISTANCE, FALL_DAMAGE_PER_PX, ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX, DEFAULT_MAX_TURNS, PAD_HALF_WIDTH,
} from './constants.js';
import { clamp, dist, hashValue } from './math.js';
import { createRng, rngState, normalizeSeedCode } from './rng.js';
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
  state.commands.push(record);
  emit(state, { t: 'fire', by: cmd.actor, weapon: cmd.weapon, angle: cmd.angle, power: cmd.power });
  state.projectiles = [{ ...launch(t, cmd.angle, cmd.power), kind: weapon.projectile.kind, weapon: weapon.id, owner: cmd.actor, age: 0 }];
  state.shot = { owner: cmd.actor, weapon: weapon.id, explosions: 0, offscreen: false, enemyDamage: 0 };
  state.phase = 'projectile';
  return { ok: true };
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

function explode(state, p, x, y, directHit = -1) {
  const w = getWeapon(p.weapon);
  if (state.shot) state.shot.explosions++;
  emit(state, { t: 'explosion', x, y, weapon: w.id, radius: w.crater.radius, by: p.owner, kind: p.kind });
  // Damage first, measured against tank centres before the crater moves them.
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    if (!t.alive) continue;
    // A direct hit always deals the weapon's full damage to the tank struck.
    const base = i === directHit ? w.damage.max : damageAt(w, dist(x, y, t.x, t.y - 8));
    if (base > 0) damageTank(state, i, scaled(state, base, p.owner, i), p.owner, 'blast');
  }
  const r = w.crater.radius;
  if (w.crater.shape === 'shaft') carve(state.terrain, x, y, r, w.crater.depth);
  else carve(state.terrain, x, y, r, r);
  extinguish(state, x - r, x + r);
  if (w.projectile.kind === 'napalm') ignite(state, w, x, p.owner);
}

function extinguish(state, a, b) {
  const next = [];
  for (const f of state.fires) {
    if (f.x1 < a || f.x0 > b) { next.push(f); continue; }
    if (f.x0 < a - 8) next.push({ ...f, x1: Math.floor(a) });
    if (f.x1 > b + 8) next.push({ ...f, x0: Math.ceil(b) });
    emit(state, { t: 'extinguish', x0: Math.max(f.x0, a), x1: Math.min(f.x1, b) });
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
  const wasRising = p.vy < 0;
  stepBallistic(p, state.wind, state.config.rules.gravity);
  p.age++;
  if (p.kind === 'cluster' && wasRising && p.vy >= 0) {
    for (const b of splitCluster(state, p)) out.push(b);
    return;
  }
  if (!applyWalls(p, state.config.rules.walls) || p.y > BEDROCK + 60) {
    if (state.shot && !state.shot.offscreen) {
      state.shot.offscreen = true;
      emit(state, { t: 'offscreen', by: p.owner, x: clamp(p.x, 0, W) });
    }
    return;
  }
  if (p.age > MAX_FLIGHT_TICKS) { emit(state, { t: 'fizzle', by: p.owner }); return; }
  const hit = tankHit(state.tanks, p.x, p.y, p.age <= SHOOTER_GRACE_TICKS ? p.owner : -1);
  if (hit >= 0) { emit(state, { t: 'directHit', by: p.owner, to: hit }); explode(state, p, p.x, p.y, hit); return; }
  const g = groundAt(terrain, p.x);
  if (p.y >= g) {
    if (p.kind === 'burrow') {
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      emit(state, { t: 'burrow', x: p.x, y: g, by: p.owner });
      // Drill steeply downward: at least 0.7 of the motion is vertical.
      let dx = p.vx / speed, dy = p.vy / speed;
      if (dy < 0.7) { dy = 0.7; dx = Math.sign(dx || 1) * 0.714142842854285; }
      out.push({ x: p.x, y: g, dx, dy, kind: 'drill', weapon: p.weapon, owner: p.owner, age: p.age, drilled: 0 });
      return;
    }
    explode(state, p, p.x, g);
    return;
  }
  out.push(p);
}

/** Advance falling tanks one tick. Returns true while any tank is falling. */
function settleTanks(state) {
  let falling = false;
  for (let i = 0; i < state.tanks.length; i++) {
    const t = state.tanks[i];
    const sup = supportY(state.terrain, t.x);
    if (t.y < sup - 0.001) {
      if (!t.falling) t.falling = { from: t.y, vy: 0 };
      t.falling.vy = Math.min(t.falling.vy + GRAVITY * 1.4 * TICK, 600);
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
  t.y = y;
  t.falling = null;
  if (!t.alive) return;
  const amount = Math.round(Math.max(0, drop - FALL_SAFE_DISTANCE) * FALL_DAMAGE_PER_PX * (t.mods?.fall ?? 1));
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

function endTurn(state) {
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
    tanks: state.tanks.map((t) => ({ ...t, inventory: { ...t.inventory }, memo: { ...t.memo }, falling: t.falling ? { ...t.falling } : null })),
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
