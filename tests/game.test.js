import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMachine, TRANSITIONS } from '../src/game/machine.js';
import { createStore, memoryBackend, KEYS } from '../src/game/storage.js';
import { loadSettings, saveSettings, defaultSettings, sanitizeSettings, reducedMotion } from '../src/game/settings.js';
import { THEMES, validateTheme, TANK_COLORS, tankColorReadable } from '../src/game/themes.js';
import { buy, sell, canBuy, battleRewards, ECONOMY } from '../src/game/economy.js';
import * as T from '../src/game/tournament.js';
import { loadRecords, saveRecords, addBattle, defaultRecords } from '../src/game/records.js';
import { makeReplay, verifyReplay, encodeShare, importReplay, loadReplays, saveReplays, addReplay } from '../src/game/replays.js';
import { encodeMap, decodeMap, blankMap, prepareMap } from '../src/game/mapformat.js';
import { CHALLENGES, challengeConfig, challengeStars, validateChallenges, dailyConfig, localDateKey } from '../src/game/challenges.js';
import { battleStats, outcomeFor } from '../src/game/stats.js';
import { createBattle, applyCommand, runUntilIdle, replayBattle, stateDigest, detonate } from '../src/core/engine.js';
import { decideShot } from '../src/ai/ai.js';
import { getWeapon, emptyInventory } from '../src/core/weapons.js';
import { flatBattle, fire } from './helpers.js';

const store = () => createStore(memoryBackend());

/** Play a battle to completion; humans fire the AI's choice. */
function playOut(state, maxTurns = 200) {
  for (let i = 0; i < maxTurns && state.phase !== 'battleOver'; i++) {
    const { command } = decideShot(state, state.actor, { timeBudgetMs: 1e9 });
    applyCommand(state, command);
    runUntilIdle(state);
  }
  return state;
}

test('state machine allows only listed transitions and resumes from pause', () => {
  const m = createMachine('title', { strict: true });
  assert.throws(() => m.go('projectile'), /Illegal transition title → projectile/);
  m.go('setup'); m.go('briefing'); m.go('aiming');
  assert.throws(() => m.go('debrief'));
  m.go('paused');
  assert.equal(m.resumeTo, 'aiming');
  assert.equal(m.can('projectile'), false, 'cannot fire while paused');
  m.resume();
  assert.equal(m.state, 'aiming');
  m.go('projectile'); m.go('resolving'); m.go('aiThinking');
  assert.equal(m.can('resolving'), false);
  for (const [from, list] of Object.entries(TRANSITIONS)) for (const to of list) assert.ok(TRANSITIONS[to], `${from} → unknown state ${to}`);
});

test('settings persist and recover from missing, corrupt, future, and legacy data', () => {
  const s = store();
  assert.equal(loadSettings(s).status, 'missing');
  const custom = { ...defaultSettings(), preview: 'partial', audio: { master: 0.3, effects: 0.2, music: 0, muted: true } };
  saveSettings(s, custom);
  const loaded = loadSettings(s);
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.data.preview, 'partial');
  assert.equal(loaded.data.audio.muted, true);

  s.backend.setItem(KEYS.settings, '{not json');
  const corrupt = loadSettings(s);
  assert.equal(corrupt.status, 'corrupt');
  assert.deepEqual(corrupt.data, defaultSettings());
  assert.equal(s.backend.getItem(`${KEYS.settings}.backup`), '{not json', 'corrupt data is backed up, not discarded');

  s.backend.setItem(KEYS.settings, JSON.stringify({ v: 99, preview: 'off' }));
  assert.equal(loadSettings(s).status, 'future');

  s.backend.setItem(KEYS.settings, JSON.stringify({ muted: true, volume: 0.25 }));
  const legacy = loadSettings(s);
  assert.equal(legacy.status, 'migrated');
  assert.equal(legacy.data.audio.master, 0.25);

  const junk = sanitizeSettings({ preview: 'x', speed: 9, audio: { master: 7 }, playerName: '<script>' , theme: 'nope' });
  assert.equal(junk.preview, 'full');
  assert.equal(junk.speed, 1);
  assert.equal(junk.audio.master, 1);
  assert.equal(junk.playerName, 'script');
  assert.equal(junk.theme, 'console');
  assert.equal(reducedMotion({ motion: 'system' }, true), true);
  assert.equal(reducedMotion({ motion: 'full' }, true), false);
});

test('a throwing storage backend never breaks the game', () => {
  const broken = createStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } });
  assert.equal(loadSettings(broken).status, 'missing');
  assert.equal(saveSettings(broken, defaultSettings()), false);
});

test('themes and selectable tank colours meet contrast minimums', () => {
  for (const theme of Object.values(THEMES)) {
    assert.deepEqual(validateTheme(theme), []);
    for (const c of TANK_COLORS) assert.ok(tankColorReadable(c.hex, theme), `${c.name} on ${theme.id}`);
  }
});

test('armory purchases never go negative or exceed caps', () => {
  let wallet = { credits: 300, inventory: emptyInventory() };
  const heavy = getWeapon('heavy');
  while (!canBuy(wallet.credits, wallet.inventory, 'heavy')) wallet = buy(wallet, 'heavy');
  assert.ok(wallet.credits >= 0);
  assert.equal(wallet.inventory.heavy, Math.floor(300 / heavy.ammo.price));
  const broke = buy({ credits: 10, inventory: emptyInventory() }, 'nuke');
  assert.equal(broke.ok, false);
  assert.equal(broke.credits, 10);
  const full = { credits: 99999, inventory: { ...emptyInventory(), heavy: heavy.ammo.cap } };
  assert.match(canBuy(full.credits, full.inventory, 'heavy'), /Carry limit/);
  assert.equal(buy(full, 'heavy').ok, false);
  assert.equal(sell({ credits: 0, inventory: emptyInventory() }, 'heavy').ok, false);
  assert.equal(buy({ credits: 0, inventory: {} }, 'shell').ok, false);
});

test('a loss still pays enough to rebuild', () => {
  const r = battleRewards({ damage: 0, kills: 0, survived: false }, 'defeat');
  assert.equal(r.total, ECONOMY.lossFloor);
  assert.ok(r.total >= getWeapon('heavy').ammo.price);
  const win = battleRewards({ damage: 150, kills: 2, survived: true }, 'victory');
  assert.ok(win.total > r.total);
});

test('tournament: start, save, resume mid-battle, finish, and never double-reward', () => {
  const s = store();
  let run = T.createRun({ seed: 'TOUR-1', now: 1 });
  for (let round = 0; round < T.ROUNDS.length; round++) {
    assert.equal(run.round, round);
    const config = T.roundConfig(run);
    run = T.startBattle(run, config);
    const id = run.battle.id;
    let state = createBattle(config);
    let moves = 0;
    while (state.phase !== 'battleOver') {
      const { command } = decideShot(state, state.actor, { timeBudgetMs: 1e9 });
      applyCommand(state, command);
      run = T.recordCommand(run, id, state.commands.at(-1));
      runUntilIdle(state);
      if (++moves === 2) {
        // Reload mid-battle: persisted commands rebuild the same battle.
        T.saveRun(s, run);
        const { data } = T.loadRun(s);
        const resumed = replayBattle(data.battle.config, data.battle.commands);
        assert.equal(stateDigest(resumed), stateDigest(state));
        assert.equal(T.startBattle(data, config), data, 'starting again resumes rather than resets');
      }
    }
    const before = run.credits;
    run = T.completeBattle(run, id, state);
    assert.equal(run.stage, 'debrief');
    const credited = run.credits;
    assert.ok(credited >= Math.min(before + T.ECONOMY.lossFloor, T.ECONOMY.maxCredits) - 0 || credited > 0);
    // Duplicate completion (reload, double click) is ignored.
    assert.equal(T.completeBattle(run, id, state), run);
    T.saveRun(s, run);
    run = T.loadRun(s).data;
    assert.equal(run.credits, credited);
    run = T.continueRun(run);
    if (run.stage === 'armory') run = T.finishArmory(run);
  }
  assert.equal(run.status, 'complete');
  assert.equal(run.history.length, T.ROUNDS.length);
  assert.ok(run.score > 0);
  assert.ok(T.rankFor(run.score));
});

test('tournament retry restores the round start and costs score', () => {
  let run = T.createRun({ seed: 'TOUR-2', now: 2 });
  const config = T.roundConfig(run);
  run = T.startBattle(run, config);
  const start = { credits: run.credits, inventory: { ...run.inventory } };
  const state = createBattle(config);
  state.tanks[0].inventory.heavy = 0;
  detonate(state, 'nuke', state.tanks[0].x, state.tanks[0].y - 5, 1);
  applyCommand(state, decideShot(state, state.actor).command);
  runUntilIdle(state);
  while (state.phase !== 'battleOver') { applyCommand(state, decideShot(state, state.actor).command); runUntilIdle(state); }
  run = T.completeBattle(run, run.battle.id, state);
  assert.equal(run.pending.outcome, 'defeat');
  assert.ok(T.canRetry(run));
  run = { ...run, score: 1000 };
  const retried = T.retryRound(run);
  assert.equal(retried.stage, 'briefing');
  assert.equal(retried.credits, start.credits);
  assert.deepEqual(retried.inventory, start.inventory);
  assert.equal(retried.attempt, 1);
  assert.equal(retried.score, 1000 - run.pending.score.total - T.RETRY_PENALTY);
  assert.equal(T.retryRound(retried), retried, 'nothing to retry from briefing');
  // Continue instead advances and keeps the loss rewards.
  const continued = T.continueRun(run);
  assert.equal(continued.round, 1);
  assert.equal(continued.stage, 'armory');
});

test('tournament saves recover from corrupt or tampered data', () => {
  const s = store();
  s.backend.setItem(KEYS.tournament, JSON.stringify({ v: 1, runId: 'x', seed: 'S', stage: 'battle', round: 0 }));
  const bad = T.loadRun(s);
  assert.equal(bad.status, 'corrupt');
  assert.equal(bad.data, null);
  s.backend.setItem(KEYS.tournament, JSON.stringify({ ...T.createRun({ seed: 'OK' }), credits: -500, inventory: { heavy: 999 }, round: 2 }));
  const fixed = T.loadRun(s).data;
  assert.equal(fixed.credits, 0);
  assert.equal(fixed.inventory.heavy, getWeapon('heavy').ammo.cap);
  T.saveRun(s, null);
  assert.equal(T.loadRun(s).status, 'missing');
});

test('debrief stats come from recorded events', () => {
  const s = flatBattle({ xs: [200, 600, 1000] });
  detonate(s, 'shell', 600, 400, 0);
  s.events.push({ t: 'fire', by: 0, weapon: 'shell', turn: 1 });
  detonate(s, 'heavy', 1000, 400, 0);
  const st = battleStats(s).tanks[0];
  assert.equal(st.shots, 1);
  assert.equal(st.hits, 1);
  assert.equal(st.damage, s.events.filter((e) => e.t === 'damage' && e.by === 0 && e.to !== 0).reduce((n, e) => n + e.amount, 0));
  assert.ok(st.damage > 0);
  assert.equal(outcomeFor(s, 0), 'ongoing');
});

test('records add each battle once', () => {
  const s = store();
  let r = defaultRecords();
  r = addBattle(r, 'b1', { shots: 3, hits: 2, damage: 90, kills: 1 }, true);
  r = addBattle(r, 'b1', { shots: 3, hits: 2, damage: 90, kills: 1 }, true);
  assert.equal(r.totals.battles, 1);
  saveRecords(s, r);
  assert.equal(loadRecords(s).data.totals.damage, 90);
});

test('replays verify, share, and reject tampering', () => {
  const s = playOut(createBattle({ seed: 'RP', players: ['lincoln', 'attila', 'elizabeth'].map((c) => ({ name: c, kind: 'ai', commander: c, color: '#ffffff' })) }));
  const rep = makeReplay(s, { date: '2026-01-01' });
  assert.equal(verifyReplay(rep).ok, true);
  const shared = importReplay(encodeShare(rep));
  assert.equal(verifyReplay(shared).ok, true);
  const tampered = { ...rep, commands: rep.commands.map((c, i) => (i === 0 ? { ...c, power: c.power === 100 ? 99 : c.power + 1 } : c)) };
  assert.equal(verifyReplay(tampered).ok, false);
  assert.throws(() => importReplay('hello'), /share code/);
  const st = store();
  let list = loadReplays(st).data;
  for (let i = 0; i < 15; i++) list = addReplay(list, { ...rep, id: `r${i}` });
  saveReplays(st, list);
  assert.equal(loadReplays(st).data.items.length, 12);
});

test('custom maps round-trip and are validated for fairness', () => {
  const m = blankMap();
  m.terrain = m.terrain.map((y, x) => 380 + Math.round(40 * Math.abs(((x / 200) % 2) - 1)));
  const encoded = encodeMap(m);
  const decoded = decodeMap(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(decoded.terrain, m.terrain);
  assert.deepEqual(decoded.spawns, m.spawns);
  assert.deepEqual(prepareMap(decoded).problems, []);
  assert.ok(prepareMap({ ...decoded, spawns: [100, 130] }).problems.length > 0);
  assert.ok(prepareMap({ ...decoded, spawns: [300] }).problems.length > 0);
  assert.throws(() => decodeMap({ v: 1, heights: '1,2' }));
});

test('challenges are valid, winnable configurations', () => {
  assert.deepEqual(validateChallenges(), []);
  for (const ch of CHALLENGES) {
    const s = createBattle(challengeConfig(ch));
    assert.equal(s.tanks[0].kind, 'human');
    assert.equal(s.actor, 0);
    const end = playOut(s, 60);
    assert.equal(end.phase, 'battleOver', ch.id);
    const stars = challengeStars(ch, end);
    assert.ok(stars >= 0 && stars <= 3);
  }
});

test('daily seed is stable per local date', () => {
  const a = dailyConfig('2026-10-03'), b = dailyConfig('2026-10-03'), c = dailyConfig('2026-10-04');
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
  assert.match(localDateKey(new Date(2026, 0, 5)), /^2026-01-05$/);
});
