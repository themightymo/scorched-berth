import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, applyCommand, runUntilIdle, legalCommand, stateDigest } from '../src/core/engine.js';
import { decideShot } from '../src/ai/ai.js';
import { COMMANDERS, DIFFICULTY, validateCommanders } from '../src/ai/commanders.js';
import { runBatch, summarizeCommander } from '../src/ai/batch.js';
import { emptyInventory } from '../src/core/weapons.js';
import { flatBattle } from './helpers.js';

test('roster: six public-domain historical commanders with complete doctrine data', () => {
  assert.deepEqual(COMMANDERS.map((c) => c.name), ['Abraham Lincoln', 'Genghis Khan', 'Attila the Hun', 'Julius Caesar', 'Napoleon Bonaparte', 'Queen Elizabeth I']);
  assert.equal(validateCommanders(), true);
  for (const c of COMMANDERS) {
    assert.ok(c.bio && c.doctrine && c.title);
    for (const lines of Object.values(c.barks)) for (const line of lines) assert.ok(!/["“”]/.test(line), 'barks are not presented as quotations');
  }
});

test('difficulty changes search, uncertainty, and memory only', () => {
  for (const d of Object.values(DIFFICULTY)) {
    assert.ok(d.summary);
    for (const k of Object.keys(d)) assert.ok(!/hp|health|damage|armor|armour/i.test(k), `difficulty must not touch ${k}`);
  }
  assert.ok(DIFFICULTY.recruit.variance > DIFFICULTY.veteran.variance && DIFFICULTY.veteran.variance > DIFFICULTY.ace.variance);
  assert.ok(DIFFICULTY.recruit.traceBudget < DIFFICULTY.ace.traceBudget);
  assert.ok(DIFFICULTY.recruit.memoryTurns < DIFFICULTY.ace.memoryTurns);
});

test('AI always returns a legal command and never touches battle state or RNG', () => {
  for (const commander of COMMANDERS.map((c) => c.id)) {
    const s = createBattle({ seed: `AI-${commander}`, players: [commander, 'caesar', 'attila'].map((c) => ({ name: c, kind: 'ai', commander: c, difficulty: 'ace', color: '#ffffff' })) });
    const digest = stateDigest(s), rng = s.rng.s;
    const { command, diagnostics } = decideShot(s, s.actor);
    assert.equal(legalCommand(s, command), null);
    assert.equal(stateDigest(s), digest);
    assert.equal(s.rng.s, rng);
    assert.ok(diagnostics.elapsedMs >= 0 && diagnostics.traces > 0);
  }
});

test('AI respects inventory and uses the unlimited fallback when empty', () => {
  const s = flatBattle({ xs: [200, 700], kinds: ['ai', 'ai'], inventory: emptyInventory() });
  for (let i = 0; i < 4 && s.phase !== 'battleOver'; i++) {
    const { command } = decideShot(s, s.actor);
    assert.equal(command.weapon, 'shell');
    assert.equal(applyCommand(s, command).ok, true);
    runUntilIdle(s);
  }
});

test('zero time budget still yields a deterministic legal fallback', () => {
  const s = createBattle({ seed: 'BUDGET', players: ['lincoln', 'napoleon'].map((c) => ({ name: c, kind: 'ai', commander: c, color: '#ffffff' })) });
  let t = 0;
  const now = () => (t += 1000);
  const a = decideShot(s, s.actor, { timeBudgetMs: 0, now });
  t = 0;
  const b = decideShot(s, s.actor, { timeBudgetMs: 0, now });
  assert.equal(legalCommand(s, a.command), null);
  assert.deepEqual(a.command, b.command);
  assert.equal(a.diagnostics.timedOut, true);
});

test('decisions are reproducible for the same battle state', () => {
  const s = createBattle({ seed: 'REPRO', players: ['genghis', 'elizabeth', 'caesar'].map((c) => ({ name: c, kind: 'ai', commander: c, difficulty: 'veteran', color: '#ffffff' })) });
  const big = { timeBudgetMs: 1e9 };
  assert.deepEqual(decideShot(s, s.actor, big).command, decideShot(s, s.actor, big).command);
});

test('seeded batches show measurably different commander behaviour', () => {
  const report = runBatch({ count: 36, seedPrefix: 'DOCTRINE', timeBudgetMs: 1e9 });
  assert.equal(report.exceptions.length, 0, report.exceptions.join('\n'));
  assert.equal(report.completed, 36);
  const s = Object.fromEntries(Object.entries(report.byCommander).map(([k, v]) => [k, summarizeCommander(v)]));
  // Weapon behaviour
  assert.ok(s.attila.heavyRate > s.elizabeth.heavyRate + 0.2, 'Attila leans on heavy payloads far more than Elizabeth');
  assert.ok(s.elizabeth.rareRate < s.napoleon.rareRate, 'Elizabeth conserves rare ammunition');
  assert.ok(s.genghis.areaRate > Math.max(s.caesar.areaRate, s.lincoln.areaRate, s.elizabeth.areaRate) + 0.08, 'Genghis favours area disruption');
  // Target behaviour
  assert.ok(s.napoleon.weakestRate > s.genghis.weakestRate, 'Napoleon hunts weakened tanks');
  // Risk behaviour
  assert.ok(s.elizabeth.selfDamagePerShot < s.genghis.selfDamagePerShot, 'Elizabeth avoids splash risk');
  assert.ok(s.caesar.selfDamagePerShot < s.attila.selfDamagePerShot, 'Caesar is more careful than Attila');
});
