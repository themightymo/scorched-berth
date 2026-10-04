import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, runUntilIdle, legalCommand, detonate, replayBattle, stateDigest, createBattle } from '../src/core/engine.js';
import { DEFENSES, ACTIVE_DEFENSES, DEFENSE_DATA, validateDefenses, getDefense } from '../src/core/defenses.js';
import { emptyInventory, defaultInventory, sanitizeInventory, stockInfo } from '../src/core/weapons.js';
import { trace } from '../src/core/physics.js';
import { groundAt } from '../src/core/terrain.js';
import { buy, sell, canBuy } from '../src/game/economy.js';
import { decideShot, chooseDefense } from '../src/ai/ai.js';
import { getCommander, commanderPlayer } from '../src/ai/commanders.js';
import { flatBattle, fire, flatTerrain, W } from './helpers.js';

const stocked = (extra) => ({ ...emptyInventory(), ...extra });
const envOf = (s) => ({ terrain: s.terrain, tanks: s.tanks, wind: s.wind, gravity: s.config.rules.gravity, walls: s.config.rules.walls });

/** A harmless shot off the near edge of the map, optionally carrying a defense. */
function pass(s, use) {
  const t = s.tanks[s.actor];
  const cmd = fire(s, 'shell', t.x < W / 2 ? 178 : 2, 100);
  if (use) cmd.use = use;
  const res = applyCommand(s, cmd);
  assert.ok(res.ok, res.error);
  runUntilIdle(s);
}

/** Find an angle/power whose real trajectory strikes tank `to` directly. */
function shotAt(s, actor, to, weapon = 'shell') {
  for (let a = 20; a <= 160; a++) for (let p = 30; p <= 100; p++) {
    const r = trace(envOf(s), actor, a, p);
    if (r.kind === 'tank' && r.tank === to) return fire(s, weapon, a, p, actor);
  }
  throw new Error('no direct shot found');
}

test('registry holds ten validated defenses that share the inventory', () => {
  assert.equal(DEFENSES.length, 10);
  assert.equal(ACTIVE_DEFENSES.length, 7);
  assert.equal(DEFENSES.filter((d) => d.mode === 'passive').length, 3);
  assert.throws(() => validateDefenses([{ ...DEFENSE_DATA[0], mode: 'sometimes' }]), /mode must be/);
  assert.throws(() => validateDefenses([DEFENSE_DATA[0], DEFENSE_DATA[0]]), /duplicate/);
  for (const d of DEFENSES) {
    assert.equal(emptyInventory()[d.id], 0);
    assert.equal(defaultInventory()[d.id], d.stock.start);
    assert.equal(stockInfo(d.id).price, d.stock.price);
  }
  assert.equal(sanitizeInventory({ shield: 50 }, { capped: true }).shield, getDefense('shield').stock.cap);
});

test('defenses can be bought and sold in the armory within caps', () => {
  let wallet = { credits: 1000, inventory: emptyInventory() };
  wallet = buy(wallet, 'shield');
  assert.equal(wallet.credits, 1000 - getDefense('shield').stock.price);
  assert.equal(wallet.inventory.shield, 1);
  const full = { credits: 9999, inventory: stocked({ plating: getDefense('plating').stock.cap }) };
  assert.match(canBuy(full.credits, full.inventory, 'plating'), /Carry limit/);
  const sold = sell(wallet, 'shield');
  assert.equal(sold.inventory.shield, 0);
  assert.equal(sold.credits, wallet.credits + Math.floor(getDefense('shield').stock.price / 2));
});

test('active defenses are validated, deploy at end of turn, and consume stock', () => {
  const s = flatBattle({ xs: [200, 700, 1200], inventory: stocked({ shield: 1, repair: 1 }) });
  assert.match(legalCommand(s, { ...fire(s, 'shell', 45, 50), use: 'nope' }), /Unknown defense/);
  assert.match(legalCommand(s, { ...fire(s, 'shell', 45, 50), use: 'parachute' }), /Unknown defense/, 'passive items cannot be queued');
  assert.match(legalCommand(s, { ...fire(s, 'shell', 45, 50), use: 'deflector' }), /No Deflector/);
  assert.match(legalCommand(s, { ...fire(s, 'shell', 45, 50), use: 'repair' }), /already full/);
  const cmd = { ...fire(s, 'shell', 178, 100), use: 'shield' };
  applyCommand(s, cmd);
  assert.equal(s.tanks[0].fx.shield, 0, 'not raised until the turn ends');
  runUntilIdle(s);
  assert.equal(s.tanks[0].fx.shield, 60);
  assert.equal(s.tanks[0].inventory.shield, 0);
  assert.equal(s.commands[0].use, 'shield');
  assert.ok(s.events.some((e) => e.t === 'defense' && e.item === 'shield' && e.by === 0));
});

test('energy shield absorbs blast damage but not fire', () => {
  const s = flatBattle({ xs: [200, 700, 1200] });
  const t = s.tanks[1];
  t.fx.shield = 60;
  detonate(s, 'heavy', t.x, t.y - 8, 0); // 68 at the centre
  const blast = s.events.filter((e) => e.t === 'damage' && e.to === 1 && e.cause === 'blast');
  assert.deepEqual(blast.map((e) => e.amount), [68 - 60]);
  assert.equal(t.fx.shield, 0);
  assert.ok(s.events.some((e) => e.t === 'shieldHit' && e.to === 1 && e.absorbed === 60));
  t.fx.shield = 60;
  detonate(s, 'napalm', t.x, t.y, 0);
  const before = t.hp;
  t.fx.shield = 60;
  pass(s); // fire burns at the end of the turn
  assert.ok(t.hp < before, 'fire ignores the shield');
});

test('deflector bounces the first hostile projectile and then collapses', () => {
  const s = flatBattle({ xs: [300, 700] });
  const cmd = shotAt(s, 0, 1);
  s.tanks[1].fx.deflector = true;
  applyCommand(s, cmd);
  runUntilIdle(s);
  assert.equal(s.tanks[1].hp, 100, 'defender untouched');
  assert.equal(s.tanks[1].fx.deflector, false);
  const ev = s.events.find((e) => e.t === 'deflect');
  assert.ok(ev && ev.to === 1 && ev.by === 0);
});

test('point-defense gun destroys a hostile projectile and spends a charge', () => {
  const s = flatBattle({ xs: [300, 700], inventory: stocked({ interceptor: 1 }) });
  s.tanks[0].inventory.interceptor = 0;
  assert.ok(applyCommand(s, shotAt(s, 0, 1)).ok);
  runUntilIdle(s);
  assert.equal(s.tanks[1].hp, 100);
  assert.equal(s.tanks[1].inventory.interceptor, 0);
  assert.ok(s.events.some((e) => e.t === 'intercept' && e.to === 1));
  assert.ok(!s.events.some((e) => e.t === 'explosion'), 'nothing detonated');
});

test('repair kit restores armour up to the maximum', () => {
  const s = flatBattle({ xs: [200, 700, 1200], hp: [50, 100, 100], inventory: stocked({ repair: 2 }) });
  s.tanks[0].maxHp = 100;
  pass(s, 'repair');
  assert.equal(s.tanks[0].hp, 85);
  assert.equal(s.tanks[0].inventory.repair, 1);
});

test('parachute prevents fall damage once', () => {
  const pillar = flatTerrain(400);
  for (let x = 560; x <= 640; x++) pillar[x] = 200;
  const run = (inv) => {
    const s = createBattle({
      seed: 'CHUTE', shufflePositions: false, rules: { fixedWind: 0 },
      map: { custom: { terrain: pillar.slice(), spawns: [200, 600, 1100] } },
      players: [0, 1, 2].map((i) => ({ name: `T${i}`, kind: i ? 'ai' : 'human', color: '#ffffff', inventory: inv })),
    });
    for (let x = 560; x <= 640; x++) s.terrain[x] = 400;
    detonate(s, 'shell', 1350, 400); // settles tanks
    return s;
  };
  const without = run(stocked({}));
  assert.ok(without.tanks[1].hp < 100, 'control tank takes fall damage');
  const withChute = run(stocked({ parachute: 2 }));
  assert.equal(withChute.tanks[1].hp, 100);
  assert.equal(withChute.tanks[1].inventory.parachute, 1);
  assert.ok(withChute.events.some((e) => e.t === 'parachute' && e.to === 1));
});

test('hull plating adds armour at the start of the battle', () => {
  const s = flatBattle({ inventory: stocked({ plating: 2 }) });
  assert.equal(s.tanks[0].hp, 125);
  assert.equal(s.tanks[0].maxHp, 125);
  assert.equal(s.tanks[0].inventory.plating, 1, 'one plate per battle');
});

test('fire suppressant puts out nearby fire and grants fire immunity', () => {
  const s = flatBattle({ xs: [300, 800, 1200], inventory: stocked({ foam: 1 }) });
  detonate(s, 'napalm', 300, 400, 1);
  assert.ok(s.fires.some((f) => 300 >= f.x0 && 300 <= f.x1));
  const hp = s.tanks[0].hp; // after the canister's own small blast
  pass(s, 'foam');
  assert.equal(s.tanks[0].hp, hp, 'no burn on the turn it was used');
  assert.ok(!s.fires.some((f) => f.x1 > 200 && f.x0 < 400));
  assert.equal(s.tanks[0].fx.fireproof, 2);
  detonate(s, 'napalm', 300, 400, 1); // fresh fire while immune
  const hp2 = s.tanks[0].hp;
  pass(s); pass(s);
  assert.equal(s.tanks[0].hp, hp2, 'immune while the effect lasts');
});

test('earthworks raise ground on both sides but not under other tanks', () => {
  const s = flatBattle({ xs: [300, 700, 1200], inventory: stocked({ berm: 1 }) });
  pass(s, 'berm');
  assert.ok(groundAt(s.terrain, 300 - 39) < 400 - 30);
  assert.ok(groundAt(s.terrain, 300 + 39) < 400 - 30);
  assert.equal(groundAt(s.terrain, 300), 400, 'tank pad unchanged');
  assert.equal(groundAt(s.terrain, 700), 400);
});

test('bedrock anchor stops craters from dropping the tank', () => {
  const s = flatBattle({ xs: [300, 800, 1200], inventory: stocked({ anchor: 1 }) });
  pass(s, 'anchor');
  const t = s.tanks[0];
  const y = t.y;
  detonate(s, 'burrow', t.x, t.y + 30, 1);
  assert.equal(t.y, y, 'still standing');
  assert.equal(t.fx.anchor, 2);
  const control = flatBattle({ xs: [300, 800, 1200] });
  detonate(control, 'burrow', 300, 430, 1);
  assert.ok(control.tanks[0].y > y, 'unanchored tank drops');
});

test('relocator moves the tank clear of others and replays deterministically', () => {
  const s = flatBattle({ xs: [300, 700, 1100], inventory: stocked({ relocate: 1 }) });
  pass(s, 'relocate');
  const t = s.tanks[0];
  assert.notEqual(t.x, 300);
  for (const o of s.tanks.slice(1)) assert.ok(Math.abs(o.x - t.x) >= getDefense('relocate').params.clearance);
  assert.equal(t.inventory.relocate, 0);
  const again = replayBattle(s.config, s.commands);
  assert.equal(stateDigest(again), stateDigest(s));
});

test('AI deploys sensible defenses and stays legal through whole battles', () => {
  const s = flatBattle({ xs: [200, 700, 1200], kinds: ['ai', 'ai', 'ai'], hp: [40, 100, 100], inventory: stocked({ repair: 1 }) });
  s.tanks[0].maxHp = 100;
  assert.equal(chooseDefense(s, 0, getCommander('caesar')), 'repair');
  assert.equal(decideShot(s, 0, { timeBudgetMs: 40 }).command.use, 'repair');

  const full = Object.fromEntries(DEFENSES.map((d) => [d.id, d.stock.cap]));
  const b = createBattle({
    seed: 'AIDEF', mode: 'sim', rules: { maxTurns: 40 },
    players: ['lincoln', 'khan', 'elizabeth'].map((c) => commanderPlayer(c, 'recruit', { inventory: stocked(full) })),
  });
  let guard = 0;
  while (b.phase !== 'battleOver' && guard++ < 45) {
    const { command } = decideShot(b, b.actor, { timeBudgetMs: 30 });
    const res = applyCommand(b, command);
    assert.ok(res.ok, res.error);
    runUntilIdle(b);
  }
  assert.ok(b.events.some((e) => e.t === 'defense' && e.item !== 'plating'), 'AI used at least one active defense');
  assert.equal(stateDigest(replayBattle(b.config, b.commands)), stateDigest(b));
});
