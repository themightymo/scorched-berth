import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, WEAPON_DATA, validateRegistry, defaultInventory, sanitizeInventory, getWeapon } from '../src/core/weapons.js';
import { generateMap, validateLayout, fallbackMap, MAP_PROFILES, PROFILE_IDS, MAX_ATTEMPTS, EDGE_MARGIN } from '../src/core/mapgen.js';
import { groundAt } from '../src/core/terrain.js';
import { createRng, hashString } from '../src/core/rng.js';
import { dsin, dcos } from '../src/core/math.js';
import { W, PAD_HALF_WIDTH } from '../src/core/constants.js';

test('registry holds seventeen validated weapons with distinct projectile behaviour', () => {
  assert.equal(WEAPONS.length, 17);
  assert.deepEqual(new Set(WEAPONS.map((w) => w.projectile.kind)), new Set(['ballistic', 'cluster', 'napalm', 'burrow', 'leapfrog', 'funky', 'roller', 'beam', 'plasma']));
  for (const w of WEAPONS) {
    assert.ok(w.role && w.description && w.counterplay, `${w.id} explains its role and counterplay`);
    assert.ok(Object.isFrozen(w));
  }
});

test('invalid weapon data fails clearly', () => {
  const bad = structuredClone(WEAPON_DATA);
  bad[1].damage.radius = -5;
  bad[2].projectile.kind = 'laser';
  assert.throws(() => validateRegistry(bad), /heavy.*damage\.radius[\s\S]*nuke.*projectile\.kind/);
  const dup = structuredClone(WEAPON_DATA);
  dup.push(structuredClone(WEAPON_DATA[0]));
  assert.throws(() => validateRegistry(dup), /duplicate weapon id "shell"/);
  assert.throws(() => validateRegistry(WEAPON_DATA.filter((w) => !w.ammo.unlimited)), /unlimited weapon/);
});

test('a new ballistic weapon needs only a registry entry', () => {
  const extra = { ...structuredClone(WEAPON_DATA[0]), id: 'sabot', name: 'Sabot', short: 'SABOT', ammo: { unlimited: false, start: 1, cap: 3, price: 90 } };
  const reg = validateRegistry([...structuredClone(WEAPON_DATA), extra]);
  assert.equal(reg.at(-1).id, 'sabot');
});

test('inventories sanitize bad data and respect caps', () => {
  const inv = sanitizeInventory({ heavy: -3, nuke: 'x', cluster: 2.7, napalm: 50 }, { capped: true });
  assert.equal(inv.heavy, 0);
  assert.equal(inv.nuke, 0);
  assert.equal(inv.cluster, 2);
  assert.equal(inv.napalm, getWeapon('napalm').ammo.cap);
  assert.equal(defaultInventory().heavy, getWeapon('heavy').ammo.start);
  assert.equal('shell' in defaultInventory(), false);
});

test('deterministic trig and RNG are stable', () => {
  assert.ok(Math.abs(dsin(30) - 0.5) < 1e-12);
  assert.ok(Math.abs(dcos(60) - 0.5) < 1e-12);
  assert.ok(Math.abs(dsin(135) - Math.SQRT1_2) < 1e-12);
  const a = createRng('seed'), b = createRng('seed');
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  assert.notEqual(hashString('a'), hashString('b'));
});

test('map generation is reproducible and fair across profiles and seeds', () => {
  let fallbacks = 0;
  for (const profile of PROFILE_IDS) {
    for (const count of [2, 4, 6]) {
      for (let i = 0; i < 12; i++) {
        const opts = { seed: `FAIR-${i}`, profile, count };
        const m = generateMap(opts);
        assert.deepEqual(generateMap(opts).terrain, m.terrain);
        assert.ok(m.attempts >= 1 && m.attempts <= MAX_ATTEMPTS);
        if (m.fallback) fallbacks++;
        assert.deepEqual(validateLayout(m), [], `${profile}/${count}/${i}`);
        for (const x of m.spawns) {
          assert.ok(x >= EDGE_MARGIN && x <= W - EDGE_MARGIN);
          for (let k = -PAD_HALF_WIDTH; k <= PAD_HALF_WIDTH; k++) assert.equal(groundAt(m.terrain, x + k), groundAt(m.terrain, x), 'stable flat pad');
        }
      }
    }
  }
  assert.equal(fallbacks, 0, 'fallback should be rare');
  assert.ok(Object.keys(MAP_PROFILES).length >= 5);
});

test('vent profile places hazards away from spawns', () => {
  let seen = 0;
  for (let i = 0; i < 20; i++) {
    const m = generateMap({ seed: `V-${i}`, profile: 'vents', count: 4 });
    seen += m.vents.length;
    for (const v of m.vents) for (const x of m.spawns) assert.ok(x + PAD_HALF_WIDTH < v.x0 - 60 || x - PAD_HALF_WIDTH > v.x1 + 60);
  }
  assert.ok(seen > 0);
  assert.equal(generateMap({ seed: 'V-0', profile: 'vents', count: 4, hazards: false }).vents.length, 0);
});

test('fallback map is always valid', () => {
  for (const n of [2, 3, 4, 5, 6]) assert.deepEqual(validateLayout(fallbackMap(n)), []);
});

import { CHASSIS, validateRatings, ratingMods, RATING_KEYS, STANDARD_RATINGS, sanitizeRatings } from '../src/core/ratings.js';
import { COMMANDERS as ROSTER } from '../src/ai/commanders.js';
import { createBattle, detonate, applyCommand, runUntilIdle } from '../src/core/engine.js';
import { trace as traceShot } from '../src/core/physics.js';
import { carve } from '../src/core/terrain.js';

test('every commander and chassis has a valid, equal-budget stat card', () => {
  for (const c of [...ROSTER, ...CHASSIS]) assert.deepEqual(validateRatings(c.ratings), [], c.id);
  assert.ok(validateRatings({ ...STANDARD_RATINGS, firepower: 10 }).length, 'over budget is rejected');
  assert.deepEqual(sanitizeRatings({ firepower: 99 }), STANDARD_RATINGS);
  // The six commanders' cards are all different.
  assert.equal(new Set(ROSTER.map((c) => RATING_KEYS.map((k) => c.ratings[k]).join())).size, ROSTER.length);
});

function duel(ratingsA, ratingsB) {
  const flat = Array.from({ length: W + 1 }, () => 400);
  return createBattle({ seed: 'RATE', shufflePositions: false, rules: { fixedWind: 0 }, map: { custom: { terrain: flat, spawns: [300, 700] } },
    players: [{ name: 'A', kind: 'human', ratings: ratingsA }, { name: 'B', kind: 'ai', ratings: ratingsB }] });
}

test('stat ratings change real mechanics', () => {
  const strong = { firepower: 10, armor: 4, velocity: 6, hull: 4, stability: 6 };
  const tough = { firepower: 4, armor: 10, velocity: 4, hull: 6, stability: 6 };
  // Firepower and armour scale blast damage.
  let a = duel(strong, STANDARD_RATINGS); detonate(a, 'shell', 700, 400, 0);
  let b = duel(STANDARD_RATINGS, STANDARD_RATINGS); detonate(b, 'shell', 700, 400, 0);
  let c = duel(STANDARD_RATINGS, tough); detonate(c, 'shell', 700, 400, 0);
  const dmg = (s) => s.tanks[1].maxHp - s.tanks[1].hp;
  assert.ok(dmg(a) > dmg(b) && dmg(b) > dmg(c), `${dmg(a)} > ${dmg(b)} > ${dmg(c)}`);
  // Hull sets max armour.
  assert.equal(duel({ firepower: 6, armor: 6, velocity: 4, hull: 8, stability: 6 }, STANDARD_RATINGS).tanks[0].maxHp, Math.round(100 * ratingMods({ hull: 8, firepower: 6, armor: 6, velocity: 4, stability: 6 }).hull));
  // Velocity extends range, and the preview trace agrees with the live shot.
  const fast = duel({ firepower: 4, armor: 6, velocity: 10, hull: 5, stability: 5 }, STANDARD_RATINGS);
  const slow = duel({ firepower: 7, armor: 7, velocity: 2, hull: 7, stability: 7 }, STANDARD_RATINGS);
  const env = (s) => ({ terrain: s.terrain, tanks: s.tanks, wind: 0, gravity: 1, walls: 'open' });
  const rf = traceShot(env(fast), 0, 70, 45), rs = traceShot(env(slow), 0, 70, 45);
  assert.ok(Math.abs(rf.x - 300) > Math.abs(rs.x - 300), 'faster shells fly farther');
  applyCommand(fast, { type: 'fire', actor: 0, weapon: 'shell', angle: 70, power: 45 });
  runUntilIdle(fast);
  assert.ok(Math.abs(fast.events.find((e) => e.t === 'explosion').x - rf.x) < 1e-9);
  // Stability reduces fall damage.
  const fall = (st) => { const s = duel(STANDARD_RATINGS, st); carve(s.terrain, 700, 440, 60, 60); detonate(s, 'shell', 1300, 400, null); return s.tanks[1].maxHp - s.tanks[1].hp; };
  assert.ok(fall({ firepower: 5, armor: 5, velocity: 5, hull: 5, stability: 10 }) < fall({ firepower: 7, armor: 7, velocity: 7, hull: 7, stability: 2 }));
});
