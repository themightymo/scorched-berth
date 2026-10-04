// Shared candidate-shot evaluator. Every commander uses the same search; only
// data parameters differ. The AI sees what a player sees (terrain, tanks,
// current wind, its own inventory). It never reads the battle RNG: what-if
// simulations stop before the turn ends, and aim noise uses its own stream.

import { trace } from '../core/physics.js';
import { simulateShot, legalCommand, defenseBlocked } from '../core/engine.js';
import { getDefense } from '../core/defenses.js';
import { WEAPONS, getWeapon, hasAmmo, damageAt } from '../core/weapons.js';
import { createRng } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { W, BEDROCK, BARREL_HEIGHT, TANK_MID, ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX } from '../core/constants.js';
import { NIGHT } from '../core/weather.js';
import { getCommander, DIFFICULTY } from './commanders.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const REFERENCE = getWeapon('heavy');

function recentDamageTo(state, idx, turns) {
  const out = new Map();
  if (turns <= 0) return out;
  const since = state.turn - turns;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.turn < since) break;
    if (e.t === 'damage' && e.to === idx && e.by != null && e.by !== idx) out.set(e.by, (out.get(e.by) ?? 0) + e.amount);
  }
  return out;
}

export function targetWeights(state, actorIdx, profile, diff, rng) {
  const me = state.tanks[actorIdx];
  const grudges = recentDamageTo(state, actorIdx, diff.memoryTurns);
  const tw = profile.targeting;
  const weights = new Map();
  state.tanks.forEach((t, i) => {
    if (i === actorIdx || !t.alive) return;
    const hpFrac = t.hp / t.maxHp;
    let w = 1
      + tw.weakest * (1 - hpFrac)
      + tw.nearest * (1 - Math.abs(t.x - me.x) / W)
      + tw.strongest * hpFrac
      + tw.grudge * Math.min(1, (grudges.get(i) ?? 0) / 40)
      + tw.focus * (me.memo.lastTarget === i ? (diff.memoryTurns > 0 ? 1 : 0.3) : 0);
    // Squaring widens the gap between preferred and ignored targets so each
    // doctrine's priorities show up clearly in target choice.
    w = Math.max(0.3, w) ** 2;
    w *= 1 + rng.range(-0.3, 0.3) * Math.min(1, diff.variance / 4);
    weights.set(i, Math.max(0.1, w));
  });
  return weights;
}

function quickValue(state, actorIdx, r, weights, selfWeight) {
  if (r.kind !== 'ground' && r.kind !== 'tank') return -1;
  let v = 0;
  for (const [i, w] of weights) {
    const t = state.tanks[i];
    const dx = t.x - r.x, dy = t.y - TANK_MID - r.y;
    v += w * damageAt(REFERENCE, Math.sqrt(dx * dx + dy * dy));
  }
  const me = state.tanks[actorIdx];
  const sx = me.x - r.x, sy = me.y - TANK_MID - r.y;
  v -= selfWeight * damageAt(REFERENCE, Math.sqrt(sx * sx + sy * sy));
  return v;
}

function scoreOutcome(state, sim, actorIdx, weaponId, weights, ctx) {
  const { profile, selfWeight, rally } = ctx;
  const me = state.tanks[actorIdx];
  const simMe = sim.tanks[actorIdx];
  if (me.alive && !simMe.alive) return { score: -9999, target: null, damage: 0, self: me.hp };
  let enemy = 0, bestTarget = null, bestTargetValue = 0, damage = 0;
  for (const [i, w] of weights) {
    const before = state.tanks[i], after = sim.tanks[i];
    const dmg = before.hp - after.hp;
    const killed = before.alive && !after.alive;
    let value = w * (dmg + (killed ? 35 * (profile.killBonus ?? 1) : 0));
    for (let f = state.fires.length; f < sim.fires.length; f++) {
      const fire = sim.fires[f];
      if (after.alive && after.x >= fire.x0 && after.x <= fire.x1) value += w * fire.burn * fire.turns * 0.6 * (0.4 + profile.terrain);
    }
    if (after.y - before.y > 25) value += w * (after.y - before.y) * 0.08 * profile.terrain;
    enemy += value;
    damage += dmg;
    if (value > bestTargetValue) { bestTargetValue = value; bestTarget = i; }
  }
  let self = me.hp - simMe.hp;
  for (let f = state.fires.length; f < sim.fires.length; f++) {
    const fire = sim.fires[f];
    if (simMe.x >= fire.x0 && simMe.x <= fire.x1) self += fire.burn * fire.turns * 0.6;
  }
  const w = getWeapon(weaponId);
  const early = Math.max(0, 1 - state.turn / (state.tanks.length * 4));
  enemy *= (profile.weapons[weaponId] ?? 1) * (1 + profile.aggression * 0.5 * early);
  let cost = w.ai.cost * (0.3 + 1.7 * profile.conservation * (1 - rally));
  if (!w.ammo.unlimited && (me.inventory[weaponId] ?? 0) <= 1) cost *= 1.3;
  if (state.config.rules.unlimitedAmmo) cost *= 0.2;
  return { score: enemy - selfWeight * self - cost, target: bestTarget, damage, self };
}

function fallbackCommand(state, actorIdx, weights) {
  const me = state.tanks[actorIdx];
  let target = null, best = -Infinity;
  for (const [i, w] of weights) if (w > best) { best = w; target = i; }
  const right = target == null ? me.x < W / 2 : state.tanks[target].x > me.x;
  return { type: 'fire', actor: actorIdx, weapon: 'shell', angle: right ? 45 : 135, power: 65, target: target ?? undefined };
}

/** Aim points for weapons that ignore the ballistic arc. */
function specialCandidates(state, actorIdx, weapons, weights) {
  const me = state.tanks[actorIdx];
  const out = [];
  for (const id of weapons) {
    const pr = getWeapon(id).projectile;
    if (pr.kind === 'plasma') {
      out.push({ weapon: id, a: me.angle, p: POWER_MAX }, { weapon: id, a: me.angle, p: 40 });
    } else if (pr.kind === 'beam') {
      for (const i of weights.keys()) {
        const t = state.tanks[i];
        const dx = t.x - me.x, dy = (me.y - BARREL_HEIGHT) - (t.y - TANK_MID);
        const a = clamp(Math.round((Math.atan2(dy, dx) * 180) / Math.PI), ANGLE_MIN, ANGLE_MAX);
        const p = clamp(Math.ceil(Math.sqrt(dx * dx + dy * dy) / pr.rangePerPower) + 4, POWER_MIN, POWER_MAX);
        out.push({ weapon: id, a, p });
      }
    }
  }
  return out;
}

/**
 * Pick an active defense to deploy with this shot, or null. Simple, readable
 * priorities: put out fires, patch heavy damage, run when nearly dead, then
 * keep a shield or deflector up. Cautious doctrines (low risk) dig in sooner.
 */
export function chooseDefense(state, actorIdx, profile) {
  const t = state.tanks[actorIdx];
  const can = (id) => !defenseBlocked(t, id);
  const frac = t.hp / t.maxHp;
  const enemies = state.tanks.filter((o, i) => i !== actorIdx && o.alive);
  if (!enemies.length) return null;
  const burning = state.fires.some((f) => t.x >= f.x0 && t.x <= f.x1) || state.vents.some((v) => t.x >= v.x0 - 6 && t.x <= v.x1 + 6);
  if (burning && !(t.fx?.fireproof > 0) && can('foam')) return 'foam';
  if (t.maxHp - t.hp >= getDefense('repair').params.heal * 0.85 && can('repair')) return 'repair';
  const nearest = Math.min(...enemies.map((o) => Math.abs(o.x - t.x)));
  if (frac < 0.35 && nearest < 260 && can('relocate')) return 'relocate';
  const caution = 1 - profile.risk;
  if (frac < 0.6 + caution * 0.4 && !(t.fx?.shield > 0) && can('shield')) return 'shield';
  if (frac < 0.5 + caution * 0.4 && can('deflector')) return 'deflector';
  if (BEDROCK - t.y > 150 && frac < 0.8 && can('anchor')) return 'anchor';
  if (state.turn <= state.tanks.length * 2 && caution > 0.4 && can('berm')) return 'berm';
  return null;
}

/**
 * Choose a legal command for the tank whose turn it is.
 * Returns { command, diagnostics }. Always returns a legal command.
 */
export function decideShot(state, actorIdx = state.actor, options = {}) {
  const now = options.now ?? nowMs;
  const start = now();
  const tank = state.tanks[actorIdx];
  const profile = getCommander(tank.commander);
  const diff = DIFFICULTY[tank.difficulty] ?? DIFFICULTY.veteran;
  const budgetMs = options.timeBudgetMs ?? diff.timeBudgetMs;
  const rng = createRng(`${state.seed}|ai|${state.turn}|${actorIdx}`);
  const rally = tank.hp / tank.maxHp < 0.45 ? profile.rally : 0;
  const selfWeight = 0.6 + (1 - profile.risk) * 3.4;
  const weights = targetWeights(state, actorIdx, profile, diff, rng);
  const ctx = { profile, selfWeight, rally };
  const env = { terrain: state.terrain, tanks: state.tanks, wind: state.wind, gravity: state.config.rules.gravity, walls: state.config.rules.walls };
  const diag = { actor: actorIdx, commander: profile.id, difficulty: diff.id, traces: 0, sims: 0, timedOut: false, fallback: false };
  const overBudget = () => now() - start > budgetMs;

  const weapons = WEAPONS.filter((w) => state.config.rules.unlimitedAmmo || hasAmmo(tank.inventory, w.id)).map((w) => w.id);

  // Stage 1: coarse grid of real trajectories.
  const cells = [];
  const a0 = rng.int(0, diff.angleStep - 1), p0 = rng.int(0, diff.powerStep - 1);
  outer: for (let a = 4 + a0; a <= 176; a += diff.angleStep) {
    for (let p = 14 + p0; p <= POWER_MAX; p += diff.powerStep) {
      if (diag.traces >= diff.traceBudget || (diag.traces % 64 === 0 && now() - start > budgetMs * 0.5)) { diag.timedOut = diag.traces < diff.traceBudget; break outer; }
      diag.traces++;
      const r = trace(env, actorIdx, a, p);
      const quick = quickValue(state, actorIdx, r, weights, selfWeight);
      if (quick > 0) cells.push({ a, p, r, quick });
    }
  }
  cells.sort((x, y) => y.quick - x.quick);

  // Refinement around the best cells.
  if (diff.refine > 0 && !diag.timedOut) {
    const seen = new Set(cells.map((c) => `${c.a},${c.p}`));
    for (const c of cells.slice(0, 3)) {
      for (let da = -diff.refine; da <= diff.refine; da++) for (let dp = -diff.refine; dp <= diff.refine; dp++) {
        const a = clamp(c.a + da, ANGLE_MIN, ANGLE_MAX), p = clamp(c.p + dp, POWER_MIN, POWER_MAX);
        const key = `${a},${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diag.traces++;
        const r = trace(env, actorIdx, a, p);
        const quick = quickValue(state, actorIdx, r, weights, selfWeight);
        if (quick > 0) cells.push({ a, p, r, quick });
      }
    }
    cells.sort((x, y) => y.quick - x.quick);
  }

  // Keep finalists that land in different places so weapons get varied options.
  const finalists = [];
  for (const c of cells) {
    if (finalists.length >= diff.finalists) break;
    if (finalists.some((f) => Math.abs(f.r.x - c.r.x) < 6 && Math.abs(f.a - c.a) < 10)) continue;
    finalists.push(c);
  }

  // Stage 2: exact what-if resolution through the real engine.
  const scored = [];
  for (const c of finalists) {
    for (const weapon of weapons) {
      if (overBudget()) { diag.timedOut = true; break; }
      const cmd = { type: 'fire', actor: actorIdx, weapon, angle: c.a, power: c.p };
      const sim = simulateShot(state, cmd);
      diag.sims++;
      if (!sim) continue;
      const s = scoreOutcome(state, sim, actorIdx, weapon, weights, ctx);
      scored.push({ ...s, a: c.a, p: c.p, weapon, impact: c.r });
    }
    if (diag.timedOut) break;
  }
  // Laser and plasma do not follow the ballistic arc the grid searched, so
  // they get candidates of their own: line-of-sight angles and blast sizes.
  for (const c of specialCandidates(state, actorIdx, weapons, weights)) {
    if (overBudget()) { diag.timedOut = true; break; }
    const sim = simulateShot(state, { type: 'fire', actor: actorIdx, weapon: c.weapon, angle: c.a, power: c.p });
    diag.sims++;
    if (!sim) continue;
    scored.push({ ...scoreOutcome(state, sim, actorIdx, c.weapon, weights, ctx), a: c.a, p: c.p, weapon: c.weapon, impact: null, special: true });
  }
  scored.sort((x, y) => y.score - x.score);

  // Robustness: prefer solutions that still work if the aim drifts.
  const robustWeight = profile.robustness * (diff.robustSamples > 0 ? 1 : 0);
  if (robustWeight > 0 && scored.length) {
    const top = scored.slice(0, Math.min(6, scored.length));
    for (const s of top) {
      if (s.special) { s.robust = 1; continue; }
      if (overBudget()) { diag.timedOut = true; break; }
      const w = getWeapon(s.weapon);
      const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, -1], [2, 1]].slice(0, diff.robustSamples + 2);
      let hits = 0;
      for (const [da, dp] of offsets) {
        const r = trace(env, actorIdx, clamp(s.a + da, ANGLE_MIN, ANGLE_MAX), clamp(s.p + dp, POWER_MIN, POWER_MAX));
        diag.traces++;
        if ((r.kind === 'ground' || r.kind === 'tank') && s.target != null) {
          const t = state.tanks[s.target];
          if (damageAt(w, Math.sqrt((t.x - r.x) ** 2 + (t.y - TANK_MID - r.y) ** 2)) > 0 || r.tank === s.target) hits++;
        }
      }
      s.robust = hits / offsets.length;
      s.score *= 1 - robustWeight * (1 - s.robust) * 0.6;
    }
    scored.sort((x, y) => y.score - x.score);
  }

  let best = scored[0];
  let command;
  if (!best || best.score <= 0.5) {
    // Nothing worthwhile: take a ranging shot with the unlimited shell at the
    // highest-priority target, using the closest traced impact.
    diag.fallback = true;
    let target = null, tw = -Infinity;
    for (const [i, w] of weights) if (w > tw) { tw = w; target = i; }
    let pick = null, err = Infinity;
    if (target != null) {
      for (const c of cells.length ? cells : []) {
        const e = Math.abs(c.r.x - state.tanks[target].x);
        if (e < err) { err = e; pick = c; }
      }
    }
    command = pick ? { type: 'fire', actor: actorIdx, weapon: 'shell', angle: pick.a, power: pick.p, target } : fallbackCommand(state, actorIdx, weights);
    best = { score: 0, a: command.angle, p: command.power, weapon: 'shell', target: command.target ?? null, impact: pick?.r ?? null };
  } else {
    command = { type: 'fire', actor: actorIdx, weapon: best.weapon, angle: best.a, power: best.p, target: best.target ?? undefined };
  }

  // Aim variance: profile × difficulty × night, tightened by zeroing in.
  const streak = tank.memo.lastTarget === command.target ? tank.memo.streak + 1 : 0;
  let sigma = profile.aim * diff.variance * (state.config.night ? NIGHT.aimPenalty : 1) * (1 - rally * 0.4);
  sigma /= 1 + Math.min(streak, 4) * profile.patience * diff.zeroing * 0.6;
  const intended = { angle: command.angle, power: command.power };
  command.angle = clamp(Math.round(command.angle + rng.gauss() * sigma * 0.5), ANGLE_MIN, ANGLE_MAX);
  command.power = clamp(Math.round(command.power + rng.gauss() * sigma * 0.6), POWER_MIN, POWER_MAX);
  if (command.target == null) delete command.target;
  const use = chooseDefense(state, actorIdx, profile);
  if (use) command.use = use;

  if (legalCommand(state, command)) {
    command = fallbackCommand(state, actorIdx, weights);
    if (legalCommand(state, command)) command = { type: 'fire', actor: actorIdx, weapon: 'shell', angle: 45, power: 65 };
    diag.fallback = true;
  }

  diag.elapsedMs = now() - start;
  diag.budgetMs = budgetMs;
  diag.overrun = diag.elapsedMs > budgetMs * 1.5 + 25;
  diag.score = Math.round(best.score * 10) / 10;
  diag.target = command.target ?? null;
  diag.weapon = command.weapon;
  diag.use = command.use ?? null;
  diag.intended = intended;
  diag.sigma = Math.round(sigma * 100) / 100;
  diag.predicted = best.impact ? { x: Math.round(best.impact.x), y: Math.round(best.impact.y) } : null;
  diag.robust = best.robust ?? null;
  diag.candidates = scored.slice(0, 5).map((s) => ({ weapon: s.weapon, angle: s.a, power: s.p, score: Math.round(s.score), target: s.target }));
  return { command, diagnostics: diag };
}

export function pickBark(commanderId, kind, seedText) {
  const c = getCommander(commanderId);
  const list = c.barks[kind] ?? c.barks.fire;
  return list[createRng(seedText).int(0, list.length - 1)];
}
