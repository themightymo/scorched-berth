import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, runUntilIdle, replayBattle, stateDigest, simulateShot } from '../src/core/engine.js';
import { emptyInventory, defaultInventory, getWeapon, WEAPONS } from '../src/core/weapons.js';
import { trace } from '../src/core/physics.js';
import { groundAt } from '../src/core/terrain.js';
import { decideShot } from '../src/ai/ai.js';
import { COMMANDERS } from '../src/ai/commanders.js';
import { defaultRecords, addBattle, sanitizeRecords } from '../src/game/records.js';
import { battleStats } from '../src/game/stats.js';
import { UNLOCKS, unlockStatus, unlockedWeapons, lockedWeapons, withKit, newlyUnlocked } from '../src/game/unlocks.js';
import { drawTankSprite, drawWreck, spriteTop } from '../src/ui/sprites.js';
import { flatBattle, fire, flatTerrain, W } from './helpers.js';

const stocked = (extra) => ({ ...emptyInventory(), ...extra });
const envOf = (s) => ({ terrain: s.terrain, tanks: s.tanks, wind: s.wind, gravity: 1, walls: 'open' });
const shoot = (s, weapon, a, p, actor = s.actor) => { const r = applyCommand(s, fire(s, weapon, a, p, actor)); assert.ok(r.ok, r.error); runUntilIdle(s); };
const count = (s, t) => s.events.filter((e) => e.t === t).length;

/** First angle/power whose ballistic arc lands on the ground near x. */
function landNear(s, x, actor = 0, tol = 6) {
  for (let a = 30; a <= 80; a++) for (let p = 30; p <= 100; p++) {
    const r = trace(envOf(s), actor, a, p);
    if (r.kind === 'ground' && Math.abs(r.x - x) < tol) return { a, p };
  }
  throw new Error(`no shot lands near ${x}`);
}

// ── Unlock rules ───────────────────────────────────────────────────────────
test('ten unlockable weapons, each with a clear goal, all locked for a new player', () => {
  assert.equal(UNLOCKS.length, 10);
  assert.equal(new Set(UNLOCKS.map((u) => u.weapon)).size, 10);
  const fresh = defaultRecords();
  assert.deepEqual(unlockedWeapons(fresh), []);
  assert.equal(lockedWeapons(fresh).length, 10);
  for (const u of UNLOCKS) {
    assert.ok(u.text && u.goal > 0 && u.kit > 0, u.weapon);
    assert.equal(getWeapon(u.weapon).ammo.start, 0, `${u.weapon} is never in a default inventory`);
  }
  assert.equal(unlockedWeapons(fresh, { all: true }).length, 10, 'dev mode opens everything');
});

test('records unlock weapons as goals are reached, and kits only add unlocked weapons', () => {
  let r = defaultRecords();
  const stat = { shots: 30, hits: 10, damage: 400, kills: 5, direct: 4, burns: 100 };
  for (let i = 0; i < 3; i++) r = addBattle(r, `b${i}`, stat, true);
  assert.equal(r.totals.wins, 3);
  assert.deepEqual(unlockedWeapons(r).sort(), ['laser', 'leapfrog', 'riot', 'hotnapalm', 'sandhog'].sort());
  assert.deepEqual(newlyUnlocked(defaultRecords(), r).sort(), unlockedWeapons(r).sort());
  const kit = withKit(defaultInventory(), r);
  assert.equal(kit.leapfrog, 2);
  assert.equal(kit.funky, 0);
  assert.deepEqual(unlockStatus(r, 'deathshead'), { done: false, have: 0, goal: 3200, text: UNLOCKS.find((u) => u.weapon === 'deathshead').text });
  r = { ...r, tournaments: 1, bestTournament: { score: 3300, rank: 'Major', date: '2026-10-03' }, daily: { '2026-10-03': { best: 10, attempts: 1, won: true } }, challenges: { a: { stars: 3, best: 3 }, b: { stars: 3, best: 3 } } };
  assert.equal(lockedWeapons(r).length, 1, 'only Ton of Dirt (10 battles) remains');
  assert.deepEqual(lockedWeapons(r), ['dirt']);
});

test('old records without the new counters load with zeros', () => {
  const r = sanitizeRecords({ v: 1, totals: { battles: 2, wins: 1, shots: 5, hits: 2, damage: 50, kills: 1 } });
  assert.equal(r.totals.direct, 0);
  assert.equal(r.totals.burns, 0);
});

test('battle stats count direct hits per tank', () => {
  const s = flatBattle({ xs: [300, 700], rules: { unlimitedAmmo: true } });
  for (let a = 20; a <= 80; a++) for (let p = 30; p <= 100; p++) {
    const r = trace(envOf(s), 0, a, p);
    if (r.kind === 'tank' && r.tank === 1) { shoot(s, 'shell', a, p); return assert.equal(battleStats(s).tanks[0].direct, 1); }
  }
  assert.fail('no direct shot');
});

// ── New weapon behaviour ───────────────────────────────────────────────────
test('leapfrog explodes three times, each hop weaker and further on', () => {
  const s = flatBattle({ xs: [200, 1300], inventory: stocked({ leapfrog: 1 }) });
  const { a, p } = landNear(s, 600);
  shoot(s, 'leapfrog', a, p);
  const booms = s.events.filter((e) => e.t === 'explosion');
  assert.equal(booms.length, 3);
  assert.ok(booms[1].x > booms[0].x && booms[2].x > booms[1].x, 'hops continue in the direction of travel');
  assert.ok(booms[1].radius < booms[0].radius && booms[2].radius < booms[1].radius, 'each hop is smaller');
  assert.equal(count(s, 'hop'), 2);
});

test('funky bomb scatters bomblets deterministically (same as the AI preview)', () => {
  const s = flatBattle({ xs: [200, 1300], inventory: stocked({ funky: 1 }) });
  const { a, p } = landNear(s, 700);
  const sim = simulateShot(s, fire(s, 'funky', a, p));
  shoot(s, 'funky', a, p);
  assert.equal(count(s, 'scatter'), 1);
  assert.equal(count(s, 'explosion'), 1 + getWeapon('funky').projectile.count);
  assert.deepEqual(sim.terrain, s.terrain, 'the what-if simulation predicts the exact same craters');
});

test("death's head splits into nine warheads at its apex", () => {
  const s = flatBattle({ xs: [200, 1300], inventory: stocked({ deathshead: 1 }) });
  shoot(s, 'deathshead', 60, 70);
  assert.equal(s.events.find((e) => e.t === 'split').count, 9);
  assert.equal(count(s, 'explosion'), 9);
});

test('heavy roller rolls downhill into the valley and explodes at the bottom', () => {
  // A V-shaped valley with its floor at x = 700.
  const terrain = flatTerrain().map((_, x) => 300 + Math.max(0, 160 - Math.abs(x - 700) * 0.5));
  const s = flatBattle({ xs: [150, 1250], terrain, inventory: stocked({ roller: 1 }) });
  const { a, p } = landNear(s, 560, 0, 10);
  shoot(s, 'roller', a, p);
  const roll = s.events.find((e) => e.t === 'roll');
  assert.equal(roll.dir, 1, 'rolls toward the low ground');
  const boom = s.events.find((e) => e.t === 'explosion');
  assert.ok(Math.abs(boom.x - 700) < 12, `explodes at the valley floor (x=${boom.x})`);
});

test('heavy roller stops at a tank in its path and deals a direct hit', () => {
  const terrain = flatTerrain().map((_, x) => 300 + Math.max(0, 160 - Math.abs(x - 700) * 0.5));
  const s = flatBattle({ xs: [150, 660, 1250], terrain, inventory: stocked({ roller: 1 }) });
  const { a, p } = landNear(s, 540, 0, 10);
  shoot(s, 'roller', a, p);
  assert.ok(s.events.some((e) => e.t === 'directHit' && e.to === 1));
  assert.ok(s.tanks[1].hp < s.tanks[1].maxHp);
});

test('ton of dirt deals no damage and buries a tank in a pit', () => {
  const s = flatBattle({ xs: [200, 800], inventory: stocked({ dirt: 1 }) });
  const before = s.tanks[1].hp;
  for (let a = 30; a <= 80; a++) for (let p = 30; p <= 100; p++) {
    const r = trace(envOf(s), 0, a, p);
    if ((r.kind === 'tank' && r.tank === 1) || (r.kind === 'ground' && Math.abs(r.x - 800) < 6)) {
      shoot(s, 'dirt', a, p);
      assert.equal(s.tanks[1].hp, before);
      assert.ok(s.events.some((e) => e.t === 'buried' && e.to === 1));
      assert.equal(groundAt(s.terrain, 800), 400, 'the tank itself is not lifted');
      assert.ok(groundAt(s.terrain, 800 + 30) < 400 - 20, 'walls of dirt rise beside it');
      return;
    }
  }
  assert.fail('no shot found');
});

test('riot bomb blows a huge crater without harming anyone, but the fall still hurts', () => {
  const s = flatBattle({ xs: [200, 800], inventory: stocked({ riot: 1 }) });
  let shot = null;
  for (let a = 30; a <= 80 && !shot; a++) for (let p = 30; p <= 100 && !shot; p++) {
    const r = trace(envOf(s), 0, a, p);
    if (r.kind === 'tank' && r.tank === 1) shot = { a, p };
  }
  shoot(s, 'riot', shot.a, shot.p);
  assert.equal(s.events.filter((e) => e.t === 'damage' && e.cause === 'blast').length, 0);
  assert.ok(s.tanks[1].y > 400 + 60, 'the target dropped into the pit');
  assert.ok(s.events.some((e) => e.t === 'damage' && e.cause === 'fall' && e.to === 1));
});

test('riot charge clears a smaller safe pocket than the heavy riot bomb', () => {
  const charge = getWeapon('riotcharge');
  const heavy = getWeapon('riot');
  assert.equal(charge.name, 'Riot Charge');
  assert.equal(heavy.name, 'Heavy Riot Bomb');
  assert.equal(charge.damage.max, 0);
  assert.equal(heavy.damage.max, 0);
  assert.ok(charge.crater.radius < heavy.crater.radius);
});

test('hot napalm burns wider, hotter, and longer than napalm', () => {
  const a = flatBattle({ xs: [200, 1300], inventory: stocked({ napalm: 1, hotnapalm: 1 }) });
  const b = flatBattle({ xs: [200, 1300], inventory: stocked({ napalm: 1, hotnapalm: 1 }) });
  const { a: ang, p } = landNear(a, 700);
  shoot(a, 'napalm', ang, p);
  shoot(b, 'hotnapalm', ang, p);
  const n = a.events.find((e) => e.t === 'ignite'), h = b.events.find((e) => e.t === 'ignite');
  assert.ok(h.x1 - h.x0 > n.x1 - n.x0);
  assert.ok(h.burn > n.burn && h.turns > n.turns);
});

test('laser flies in a straight line, ignores wind, and is blocked by hills', () => {
  const s = flatBattle({ xs: [300, 700], rules: { fixedWind: 30 }, inventory: stocked({ laser: 1 }) });
  // Aim straight at the target's hull: (700, 392) from the barrel pivot (300, 386).
  shoot(s, 'laser', 0, 60);
  assert.ok(s.events.some((e) => e.t === 'directHit' && e.to === 1), 'a flat beam hits despite strong wind');
  const hill = flatTerrain().map((_, x) => (Math.abs(x - 500) < 30 ? 300 : 400));
  const h = flatBattle({ xs: [300, 700], terrain: hill, inventory: stocked({ laser: 1 }) });
  shoot(h, 'laser', 0, 60);
  const boom = h.events.find((e) => e.t === 'explosion');
  assert.ok(boom && Math.abs(boom.x - 470) < 8, 'the hill takes the hit');
  assert.equal(h.tanks[1].hp, h.tanks[1].maxHp);
});

test('laser range is set by power', () => {
  const s = flatBattle({ xs: [300, 1200], inventory: stocked({ laser: 1 }) });
  shoot(s, 'laser', 0, 20); // 20 × 14 = 280 px: falls well short of 900 px
  assert.ok(s.events.some((e) => e.t === 'beamEnd'));
  assert.equal(s.tanks[1].hp, s.tanks[1].maxHp);
});

test('plasma blast spares its firer, leaves no crater, and power trades size for punch', () => {
  const run = (power) => {
    const s = flatBattle({ xs: [400, 440, 550], inventory: stocked({ plasma: 1 }) });
    const ground = s.terrain.slice();
    shoot(s, 'plasma', 90, power);
    assert.equal(s.tanks[0].hp, s.tanks[0].maxHp, 'the firer is unharmed');
    assert.deepEqual(s.terrain, ground, 'no crater');
    return s.tanks.map((t) => t.maxHp - t.hp);
  };
  const small = run(10), big = run(100);
  assert.equal(small[2], 0, 'a small blast does not reach 150 px');
  assert.ok(big[2] > 0, 'a full-power blast does');
  assert.ok(small[1] > big[1], 'a tight blast hits a close tank harder');
});

test('heavy sandhog forks into three warheads', () => {
  const s = flatBattle({ xs: [200, 1300], inventory: stocked({ sandhog: 1 }) });
  const { a, p } = landNear(s, 700);
  shoot(s, 'sandhog', a, p);
  assert.equal(s.events.find((e) => e.t === 'burrow').forks, 3);
  assert.equal(count(s, 'explosion'), 3);
});

test('every new weapon replays exactly', () => {
  const ids = UNLOCKS.map((u) => u.weapon);
  const inventory = stocked(Object.fromEntries(ids.map((id) => [id, 1])));
  const config = { seed: 'UNLOCKRP', rules: { fixedWind: 4 }, players: [{ name: 'A', kind: 'human', inventory }, { name: 'B', kind: 'human', inventory }, { name: 'C', kind: 'human', inventory }] };
  const s = replayBattle(config, []);
  ids.forEach((weapon, i) => {
    if (s.phase === 'battleOver') return;
    const t = s.tanks[s.actor];
    const res = applyCommand(s, fire(s, weapon, t.x < W / 2 ? 50 + i : 130 - i, 55 + i * 3));
    assert.ok(res.ok, `${weapon}: ${res.error}`);
    runUntilIdle(s);
  });
  const again = replayBattle(s.config, s.commands);
  assert.equal(stateDigest(again), stateDigest(s));
});

test('the AI can find and use the laser and plasma blast', () => {
  const laser = flatBattle({ xs: [300, 550], inventory: stocked({ laser: 2 }) });
  laser.tanks[0].kind = 'ai';
  laser.tanks[0].commander = 'caesar';
  const one = decideShot(laser, 0, { timeBudgetMs: 2000, now: () => 0 });
  assert.equal(one.command.weapon, 'laser', 'a clear sightline makes the laser the best shot');
  const close = flatBattle({ xs: [400, 455, 1300], inventory: stocked({ plasma: 2 }) });
  close.tanks[0].kind = 'ai';
  close.tanks[0].commander = 'attila';
  const two = decideShot(close, 0, { timeBudgetMs: 2000, now: () => 0 });
  assert.equal(two.command.weapon, 'plasma', 'an enemy at point-blank range invites a plasma blast');
});

test('every commander rates every weapon', () => {
  for (const c of COMMANDERS) for (const w of WEAPONS) assert.ok(c.weapons[w.id] > 0, `${c.id} → ${w.id}`);
});

// ── Commander tank sprites ─────────────────────────────────────────────────
test('each commander has a distinct tank sprite that stays inside its declared height', () => {
  const shapes = new Set();
  for (const c of [...COMMANDERS.map((k) => k.id), null]) {
    const px = [];
    const g = { rect: (x, y, w, h, color) => px.push([x, y, w, h, color]), line: () => {} };
    drawTankSprite(g, { lx: 50, ly: 50, color: '#ff0000', angle: 45, commander: c });
    const top = Math.min(...px.map(([, y]) => y));
    assert.ok(50 - top <= spriteTop(c), `${c} sprite reaches ${50 - top}, declared ${spriteTop(c)}`);
    shapes.add(JSON.stringify(px));
    drawWreck(g, { lx: 50, ly: 50, commander: c });
  }
  assert.equal(shapes.size, COMMANDERS.length + 1);
});
