import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBattle, applyCommand, runUntilIdle, step, legalCommand, stateDigest, replayBattle, cloneForSim, simulateShot, detonate, evaluateOutcome,
} from '../src/core/engine.js';
import { createStepper } from '../src/core/clock.js';
import { trace } from '../src/core/physics.js';
import { groundAt } from '../src/core/terrain.js';
import { getWeapon, damageAt } from '../src/core/weapons.js';
import { BEDROCK, SKY_LIMIT, W, FALL_SAFE_DISTANCE, FALL_DAMAGE_PER_PX } from '../src/core/constants.js';
import { flatBattle, fire, flatTerrain } from './helpers.js';

const players = (n = 4) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, kind: i ? 'ai' : 'human', color: '#ffffff', commander: 'lincoln' }));
const envOf = (s) => ({ terrain: s.terrain, tanks: s.tanks, wind: s.wind, gravity: s.config.rules.gravity, walls: s.config.rules.walls });

/** Find a command whose real trajectory lands closest to a point. */
function aimAt(state, actor, x, { weapon = 'shell', wantTank = null } = {}) {
  let best = null;
  for (let a = 5; a <= 175; a++) for (let p = 10; p <= 100; p++) {
    const r = trace(envOf(state), actor, a, p);
    if (wantTank != null && r.kind === 'tank' && r.tank === wantTank) return fire(state, weapon, a, p, actor);
    if (r.kind !== 'ground' || wantTank != null) continue;
    const e = Math.abs(r.x - x);
    if (!best || e < best.e) best = { e, a, p };
  }
  return best && fire(state, weapon, best.a, best.p, actor);
}

test('same seed and commands produce identical state transitions', () => {
  const run = () => {
    const s = createBattle({ seed: 'DET-1', players: players() });
    for (const [w, a, p] of [['shell', 50, 60], ['heavy', 130, 55], ['cluster', 60, 70], ['napalm', 120, 60], ['burrow', 70, 50]]) {
      if (s.phase === 'battleOver') break;
      assert.equal(applyCommand(s, fire(s, w, a, p)).ok, true);
      runUntilIdle(s);
    }
    return s;
  };
  const a = run(), b = run();
  assert.equal(stateDigest(a), stateDigest(b));
  assert.deepEqual(a.events, b.events);
  const c = createBattle({ seed: 'DET-2', players: players() });
  assert.notDeepEqual(c.terrain, a.terrain);
});

test('a complete shot resolves headlessly and advances the turn', () => {
  const s = createBattle({ seed: 'SHOT', players: players() });
  const first = s.actor;
  assert.equal(applyCommand(s, fire(s, 'shell', 45, 60)).ok, true);
  assert.equal(s.phase, 'projectile');
  assert.equal(runUntilIdle(s), 'aiming');
  assert.notEqual(s.actor, first);
  assert.equal(s.turn, 2);
  assert.ok(s.events.some((e) => e.t === 'fire') && s.events.some((e) => e.t === 'explosion' || e.t === 'offscreen'));
});

test('players cannot fire twice, out of turn, or with illegal values', () => {
  const s = flatBattle();
  assert.equal(legalCommand(s, fire(s, 'shell', 45, 60, 1)), 'It is not that tank’s turn.');
  assert.ok(legalCommand(s, fire(s, 'shell', 45.5, 60)));
  assert.ok(legalCommand(s, fire(s, 'shell', 45, 101)));
  assert.ok(legalCommand(s, fire(s, 'laser', 45, 60)));
  assert.equal(applyCommand(s, fire(s, 'shell', 45, 60)).ok, true);
  assert.equal(applyCommand(s, fire(s, 'shell', 45, 60)).ok, false, 'second shot during flight is rejected');
  assert.equal(s.commands.length, 1);
});

test('damage falls off with distance and is zero at the blast edge', () => {
  const w = getWeapon('shell');
  assert.equal(damageAt(w, 0), w.damage.max);
  assert.ok(damageAt(w, 20) > damageAt(w, 40));
  assert.equal(damageAt(w, w.damage.radius), 0);
  assert.ok(damageAt(w, w.damage.radius - 3) <= 3);
});

test('direct hit, edge-of-blast, self, overlapping blasts, and destroyed tanks', () => {
  // Direct hit
  let s = flatBattle({ xs: [200, 600] });
  const cmd = aimAt(s, 0, 600, { wantTank: 1 });
  assert.ok(cmd, 'a direct-hit solution exists');
  applyCommand(s, cmd);
  runUntilIdle(s);
  assert.ok(s.events.some((e) => e.t === 'directHit' && e.to === 1));
  assert.equal(s.events.find((e) => e.t === 'damage' && e.to === 1 && e.cause === 'blast').amount, getWeapon('shell').damage.max);

  // Edge of blast: detonate near the damage radius.
  s = flatBattle({ xs: [200, 600] });
  detonate(s, 'shell', 600 + 66, 400, 0);
  assert.ok(s.tanks[1].hp >= 97 && s.tanks[1].hp < 100, `edge damage small, hp=${s.tanks[1].hp}`);

  // Self damage
  s = flatBattle({ xs: [200, 600] });
  detonate(s, 'shell', 205, 400, 0);
  const selfHit = s.events.find((e) => e.t === 'damage' && e.to === 0);
  assert.equal(selfHit.by, 0);

  // Overlapping blasts stack, floor at zero, and eliminate exactly once.
  s = flatBattle({ xs: [200, 600] });
  detonate(s, 'heavy', 600, 392, 0);
  detonate(s, 'heavy', 600, 392, 0);
  assert.equal(s.tanks[1].hp, 0);
  assert.equal(s.tanks[1].alive, false);
  assert.equal(s.events.filter((e) => e.t === 'eliminated' && e.to === 1).length, 1);
  // A destroyed tank takes no further damage.
  const before = s.events.length;
  detonate(s, 'shell', 600, groundAt(s.terrain, 600), 0);
  assert.equal(s.events.slice(before).filter((e) => e.t === 'damage' && e.to === 1).length, 0);
});

test('craters never create invalid terrain or trap resolution', () => {
  const s = flatBattle({ xs: [200, 1100], y: 460 });
  for (let i = 0; i < 12; i++) detonate(s, i % 2 ? 'nuke' : 'burrow', 650, groundAt(s.terrain, 650) + 10, null);
  detonate(s, 'nuke', 0, 300, null);
  detonate(s, 'nuke', W, 300, null);
  for (const y of s.terrain) {
    assert.ok(Number.isFinite(y));
    assert.ok(y >= SKY_LIMIT && y <= BEDROCK);
  }
  // A shot into the pit still resolves.
  applyCommand(s, fire(s, 'shell', 60, 60));
  assert.ok(['aiming', 'battleOver'].includes(runUntilIdle(s)));
});

test('tanks settle after deformation and take distance-based fall damage once per fall', () => {
  const s = flatBattle({ xs: [200, 600] });
  const startY = s.tanks[1].y;
  detonate(s, 'burrow', 600, 470, null);
  const t = s.tanks[1];
  assert.equal(t.y, groundAt(s.terrain, 600) > startY ? Math.min(groundAt(s.terrain, 588), groundAt(s.terrain, 600), groundAt(s.terrain, 612)) : t.y);
  const falls = s.events.filter((e) => e.t === 'fall' && e.to === 1);
  assert.equal(falls.length, 1);
  const drop = t.y - startY;
  const fallDamage = s.events.filter((e) => e.t === 'damage' && e.to === 1 && e.cause === 'fall');
  assert.equal(fallDamage.length, drop > FALL_SAFE_DISTANCE ? 1 : 0);
  if (fallDamage.length) assert.equal(fallDamage[0].amount, Math.round((drop - FALL_SAFE_DISTANCE) * FALL_DAMAGE_PER_PX));
});

test('ammunition is consumed, enforced, and shells are unlimited', () => {
  const s = flatBattle({ xs: [200, 900], inventory: { nuke: 1, heavy: 0 } });
  assert.equal(s.tanks[0].inventory.nuke, 1);
  applyCommand(s, fire(s, 'nuke', 45, 30));
  assert.equal(s.tanks[0].inventory.nuke, 0);
  runUntilIdle(s);
  applyCommand(s, fire(s, 'shell', 135, 30));
  runUntilIdle(s);
  if (s.phase === 'battleOver') return;
  assert.equal(legalCommand(s, fire(s, 'nuke', 45, 30)), 'Out of that ammunition.');
  assert.equal(legalCommand(s, fire(s, 'heavy', 45, 30)), 'Out of that ammunition.');
  assert.equal(legalCommand(s, fire(s, 'shell', 45, 30)), null);
});

test('turn order cycles through living tanks and skips the destroyed', () => {
  const s = flatBattle({ xs: [200, 600, 1000] });
  assert.equal(s.actor, 0);
  detonate(s, 'heavy', 600, 392, null);
  detonate(s, 'heavy', 600, 392, null);
  assert.equal(s.tanks[1].alive, false);
  applyCommand(s, fire(s, 'shell', 90, 10));
  runUntilIdle(s);
  assert.equal(s.actor, 2);
});

test('battle completion: victory, defeat, mutual destruction, ceasefire', () => {
  let s = flatBattle({ xs: [200, 600, 1000] });
  s.tanks[1].alive = false; s.tanks[1].hp = 0;
  s.tanks[2].alive = false; s.tanks[2].hp = 0;
  assert.deepEqual(evaluateOutcome(s), { winner: 0, reason: 'lastStanding' });
  s = flatBattle({ xs: [200, 600, 1000] });
  s.tanks[0].alive = false; s.tanks[0].hp = 0;
  assert.equal(evaluateOutcome(s).reason, 'humansDestroyed');
  s = flatBattle({ xs: [200, 600] });
  s.tanks.forEach((t) => { t.alive = false; t.hp = 0; });
  assert.equal(evaluateOutcome(s).reason, 'mutualDestruction');
  s = flatBattle({ xs: [200, 600], rules: { maxTurns: 4 } });
  for (let i = 0; i < 4 && s.phase !== 'battleOver'; i++) { applyCommand(s, fire(s, 'shell', 90, 10)); runUntilIdle(s); }
  assert.equal(s.phase, 'battleOver');
  assert.equal(s.result.reason, 'ceasefire');
});

test('frame rate does not change results', () => {
  const run = (frame) => {
    const s = createBattle({ seed: 'FPS', players: players(3) });
    const stepper = createStepper();
    for (const [w, a, p] of [['cluster', 55, 70], ['napalm', 125, 60], ['heavy', 60, 62]]) {
      if (s.phase === 'battleOver') break;
      applyCommand(s, fire(s, w, a, p));
      for (let i = 0; i < 100000 && s.phase !== 'aiming' && s.phase !== 'battleOver'; i++) stepper.advance(s, frame);
    }
    return stateDigest(s);
  };
  assert.equal(run(1 / 30), run(1 / 144));
  assert.equal(run(1 / 60), run(0.25));
});

test('wind bends live shots exactly like the preview trace', () => {
  for (const wind of [-14, 0, 9]) {
    const s = flatBattle({ xs: [200, 1100], rules: { fixedWind: wind } });
    const predicted = trace(envOf(s), 0, 52, 66);
    applyCommand(s, fire(s, 'shell', 52, 66));
    runUntilIdle(s);
    const boom = s.events.find((e) => e.t === 'explosion');
    if (predicted.kind === 'out') assert.ok(s.events.some((e) => e.t === 'offscreen'));
    else assert.ok(Math.abs(boom.x - predicted.x) < 1e-9 && Math.abs(boom.y - predicted.y) < 1e-9);
  }
});

test('cluster splits into bomblets near the apex; a flat shot releases one', () => {
  let s = flatBattle({ xs: [200, 1100] });
  applyCommand(s, fire(s, 'cluster', 60, 70));
  runUntilIdle(s);
  const split = s.events.find((e) => e.t === 'split');
  assert.ok(split);
  assert.equal(s.events.filter((e) => e.t === 'explosion').length, getWeapon('cluster').projectile.count);
  s = flatBattle({ xs: [200, 1100], terrain: flatTerrain(400).map((y, x) => (x > 240 && x < 300 ? 250 : y)) });
  applyCommand(s, fire(s, 'cluster', 10, 60));
  runUntilIdle(s);
  assert.equal(s.events.filter((e) => e.t === 'split').length, 0);
  assert.equal(s.events.filter((e) => e.t === 'explosion').length, 1);
});

test('napalm burns tanks each turn, expires, and is put out by blasts', () => {
  const s = flatBattle({ xs: [200, 600, 1100] });
  detonate(s, 'napalm', 640, 400, 0);
  assert.equal(s.fires.length, 1);
  const fireZone = s.fires[0];
  assert.ok(fireZone.x0 <= 600 && fireZone.x1 >= 600);
  const hp = s.tanks[1].hp;
  applyCommand(s, fire(s, 'shell', 90, 10));
  runUntilIdle(s);
  assert.equal(s.tanks[1].hp, hp - getWeapon('napalm').projectile.burn);
  assert.ok(s.events.some((e) => e.t === 'damage' && e.cause === 'fire' && e.by === 0));
  // An explosion inside the zone extinguishes that stretch.
  detonate(s, 'shell', 600, groundAt(s.terrain, 600), null);
  assert.ok(s.fires.every((f) => f.x1 < 600 - 30 || f.x0 > 600 + 30));
  // Fires always expire.
  const t = flatBattle({ xs: [200, 1100] });
  detonate(t, 'napalm', 650, 400, 0);
  for (let i = 0; i < 6 && t.phase !== 'battleOver'; i++) { applyCommand(t, fire(t, 'shell', 90, 10)); runUntilIdle(t); }
  assert.equal(t.fires.length, 0);
});

test('rain shortens and weakens napalm', () => {
  const s = flatBattle({ xs: [200, 1100], weather: 'rain' });
  detonate(s, 'napalm', 650, 400, 0);
  const w = getWeapon('napalm').projectile;
  assert.equal(s.fires[0].turns, w.turns - 1);
  assert.equal(s.fires[0].burn, Math.round(w.burn * 0.5));
});

test('burrowing charge drills before detonating and digs a deep shaft', () => {
  const s = flatBattle({ xs: [200, 1100] });
  const cmd = aimAt(s, 0, 700, { weapon: 'burrow' });
  applyCommand(s, cmd);
  runUntilIdle(s);
  const entry = s.events.find((e) => e.t === 'burrow');
  const boom = s.events.find((e) => e.t === 'explosion');
  assert.ok(entry && boom);
  assert.ok(boom.y > entry.y + 30, 'detonates below the surface');
  const depth = Math.max(...s.terrain) - 400;
  assert.ok(depth > getWeapon('shell').crater.radius, `shaft depth ${depth}`);
});

test('replays rebuild the identical battle from config and commands', () => {
  const s = createBattle({ seed: 'REPLAY', players: players() });
  for (const [w, a, p] of [['heavy', 40, 70], ['shell', 140, 66], ['napalm', 50, 58], ['shell', 130, 61]]) {
    if (s.phase === 'battleOver') break;
    applyCommand(s, fire(s, w, a, p));
    runUntilIdle(s);
  }
  const rebuilt = replayBattle(s.config, s.commands);
  assert.equal(stateDigest(rebuilt), stateDigest(s));
});

test('what-if simulation leaves the real battle and its RNG untouched', () => {
  const s = createBattle({ seed: 'CLONE', players: players() });
  const digest = stateDigest(s), rng = s.rng.s, events = s.events.length;
  const sim = simulateShot(s, fire(s, 'nuke', 50, 60));
  assert.equal(sim.phase, 'rest');
  assert.equal(stateDigest(s), digest);
  assert.equal(s.rng.s, rng);
  assert.equal(s.events.length, events);
  const c = cloneForSim(s);
  c.terrain[5] = 1; c.tanks[0].hp = 1;
  assert.notEqual(s.terrain[5], 1);
  assert.notEqual(s.tanks[0].hp, 1);
});

test('step is inert while aiming or after the battle ends', () => {
  const s = flatBattle();
  const tick = s.tick;
  step(s);
  assert.equal(s.tick, tick);
});
