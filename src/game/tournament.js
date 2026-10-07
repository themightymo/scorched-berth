// Tournament run: five escalating battles with an economy between rounds.
// Every transition is a pure function returning a new run object, and
// battle results are keyed by battle id so they can never apply twice.

import { createRng, makeSeedCode, normalizeSeedCode } from '../core/rng.js';
import { emptyInventory, sanitizeInventory } from '../core/weapons.js';
import { PROFILE_IDS } from '../core/mapgen.js';
import { COMMANDER_IDS, commanderPlayer } from '../ai/commanders.js';
import { getChassis, CHASSIS } from '../core/ratings.js';
import { battleRewards, clampWallet, ECONOMY } from './economy.js';
import { battleStats, battleScore, outcomeFor } from './stats.js';
import { KEYS, loadVersioned, saveVersioned } from './storage.js';

export const TOURNAMENT_VERSION = 1;
export const RETRY_PENALTY = 250;
export const START_CREDITS = 260;

export const ROUNDS = [
  { name: 'Border Skirmish', difficulty: ['recruit', 'recruit'], stock: { heavy: 1 }, weather: 'clear', night: false },
  { name: 'Ridge Contest', difficulty: ['recruit', 'veteran', 'recruit'], stock: { heavy: 1, cluster: 1, repair: 1 }, weather: 'clear', night: false },
  { name: 'Canyon Crossing', difficulty: ['veteran', 'veteran', 'recruit'], stock: { heavy: 2, napalm: 1, burrow: 1, repair: 1, parachute: 1, shield: 1 }, weather: 'rain', night: false },
  { name: 'Storm Front', difficulty: ['veteran', 'ace', 'veteran'], stock: { heavy: 2, cluster: 1, napalm: 1, burrow: 1, repair: 1, shield: 1, foam: 1, berm: 1, parachute: 1 }, weather: 'gale', night: false },
  { name: 'Grand Final', difficulty: ['ace', 'ace', 'veteran'], stock: { heavy: 3, nuke: 1, cluster: 1, napalm: 1, burrow: 1, repair: 1, shield: 2, deflector: 1, anchor: 1, parachute: 1, plating: 1 }, weather: 'clear', night: true },
];

export const RANKS = [
  [0, 'Cadet'], [1200, 'Lieutenant'], [2200, 'Captain'], [3200, 'Major'], [4200, 'Colonel'], [5200, 'General'],
];
export const rankFor = (score) => RANKS.filter(([min]) => score >= min).at(-1)[1];

function startInventory() {
  return { ...emptyInventory(), heavy: 2, cluster: 1, parachute: 1, repair: 1 };
}

export function createRun({ seed = makeSeedCode(), now = Date.now(), chassis = 'standard' } = {}) {
  const code = normalizeSeedCode(seed);
  const inventory = startInventory();
  return {
    v: TOURNAMENT_VERSION,
    runId: `${code}-${now.toString(36)}`,
    seed: code,
    chassis: getChassis(chassis).id, // locked for the whole run
    status: 'active',
    round: 0,
    stage: 'armory', // armory | briefing | battle | debrief | complete
    credits: START_CREDITS,
    inventory,
    roundStart: { credits: START_CREDITS, inventory: { ...inventory } },
    attempt: 0,
    retries: 0,
    score: 0,
    history: [],
    battle: null,
    pending: null,
    createdAt: now,
  };
}

export function opponentsFor(run, round) {
  const rng = createRng(`${run.seed}|lineup`);
  const order = rng.shuffle(COMMANDER_IDS);
  const spec = ROUNDS[round];
  return spec.difficulty.map((difficulty, i) => ({ commander: order[(round * 2 + i) % order.length], difficulty }));
}

export function battleId(run) {
  return `${run.runId}:${run.round}:${run.attempt}`;
}

export function roundConfig(run, { playerName = 'Commander', playerColor = '#9dff6a' } = {}) {
  const spec = ROUNDS[run.round];
  const rng = createRng(`${run.seed}|round|${run.round}`);
  const profile = run.round === 2 ? 'canyon' : rng.pick(PROFILE_IDS);
  const players = [
    { name: playerName, color: playerColor, kind: 'human', ratings: getChassis(run.chassis).ratings, inventory: { ...run.inventory } },
    ...opponentsFor(run, run.round).map(({ commander, difficulty }) => commanderPlayer(commander, difficulty, { inventory: { ...emptyInventory(), ...spec.stock } })),
  ];
  return {
    seed: `${run.seed}-R${run.round + 1}`,
    mode: 'tournament',
    label: `Round ${run.round + 1}/${ROUNDS.length} · ${spec.name}`,
    map: { profile, hazards: true },
    weather: spec.weather,
    night: spec.night,
    players,
  };
}

/** Begin (or resume) the battle for the current round. */
export function startBattle(run, config) {
  if (run.status !== 'active') return run;
  if (run.stage === 'battle' && run.battle?.id === battleId(run)) return run; // already started: resume
  return {
    ...run,
    stage: 'battle',
    roundStart: { credits: run.credits, inventory: { ...run.inventory } },
    battle: { id: battleId(run), config, commands: [] },
  };
}

export function recordCommand(run, id, command) {
  if (run.stage !== 'battle' || run.battle?.id !== id) return run;
  return { ...run, battle: { ...run.battle, commands: [...run.battle.commands, command] } };
}

/** Apply a finished battle exactly once. */
export function completeBattle(run, id, state, humanIndex = 0) {
  if (run.stage !== 'battle' || run.battle?.id !== id || run.history.some((h) => h.id === id)) return run;
  if (state.phase !== 'battleOver') return run;
  const stats = battleStats(state);
  const me = stats.tanks[humanIndex];
  const outcome = outcomeFor(state, humanIndex);
  const rewards = battleRewards(me, outcome);
  const score = battleScore(me, outcome === 'victory');
  const wallet = clampWallet(run.credits + rewards.total, state.tanks[humanIndex].inventory);
  return {
    ...run,
    stage: 'debrief',
    credits: wallet.credits,
    inventory: wallet.inventory,
    score: run.score + score.total,
    history: [...run.history, { id, round: run.round, attempt: run.attempt, outcome, score: score.total, credits: rewards.total, damage: me.damage, kills: me.kills, accuracy: me.accuracy }],
    pending: { id, outcome, rewards, score, stats: me, replay: { config: run.battle.config, commands: run.battle.commands } },
    battle: null,
  };
}

/** Accept the result and move to the armory (or the final summary). */
export function continueRun(run) {
  if (run.stage !== 'debrief' || !run.pending) return run;
  const round = run.round + 1;
  if (round >= ROUNDS.length) return { ...run, round: ROUNDS.length - 1, stage: 'complete', status: 'complete', pending: null };
  return { ...run, round, stage: 'armory', attempt: 0, pending: null };
}

export function finishArmory(run) {
  return run.stage === 'armory' ? { ...run, stage: 'briefing' } : run;
}

export function canRetry(run) {
  return run.status === 'active' && (run.stage === 'battle' || (run.stage === 'debrief' && run.pending && run.pending.outcome !== 'victory'));
}

/** Replay the current round from its starting credits and arsenal. */
export function retryRound(run) {
  if (!canRetry(run)) return run;
  let { score, history } = run;
  if (run.stage === 'debrief') {
    score -= run.pending.score.total;
    history = history.map((h) => (h.id === run.pending.id ? { ...h, retried: true, score: 0 } : h));
  }
  return {
    ...run,
    stage: 'briefing',
    credits: run.roundStart.credits,
    inventory: { ...run.roundStart.inventory },
    attempt: run.attempt + 1,
    retries: run.retries + 1,
    score: Math.max(0, score - RETRY_PENALTY),
    history,
    pending: null,
    battle: null,
  };
}

export function updateWallet(run, credits, inventory) {
  if (run.stage !== 'armory') return run;
  const w = clampWallet(credits, inventory);
  return { ...run, credits: w.credits, inventory: w.inventory };
}

const STAGES = ['briefing', 'battle', 'debrief', 'armory', 'complete'];

export function sanitizeRun(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not a run');
  if (typeof raw.runId !== 'string' || typeof raw.seed !== 'string') throw new Error('missing ids');
  if (!STAGES.includes(raw.stage)) throw new Error('bad stage');
  const round = Math.floor(Number(raw.round));
  if (!(round >= 0 && round < ROUNDS.length)) throw new Error('bad round');
  const wallet = clampWallet(raw.credits, raw.inventory);
  const start = clampWallet(raw.roundStart?.credits ?? wallet.credits, raw.roundStart?.inventory ?? wallet.inventory);
  const history = Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.id === 'string').slice(0, 50) : [];
  let battle = null;
  if (raw.stage === 'battle') {
    if (!raw.battle || typeof raw.battle.id !== 'string' || !raw.battle.config || !Array.isArray(raw.battle.commands)) throw new Error('bad battle');
    battle = { id: raw.battle.id, config: raw.battle.config, commands: raw.battle.commands.slice(0, 1000) };
  }
  if (raw.stage === 'debrief' && !raw.pending) throw new Error('debrief without result');
  return {
    v: TOURNAMENT_VERSION,
    runId: raw.runId.slice(0, 64),
    seed: normalizeSeedCode(raw.seed),
    chassis: CHASSIS.some((c) => c.id === raw.chassis) ? raw.chassis : 'standard',
    status: raw.stage === 'complete' ? 'complete' : 'active',
    round,
    stage: raw.stage,
    credits: wallet.credits,
    inventory: wallet.inventory,
    roundStart: start,
    attempt: Math.max(0, Math.floor(Number(raw.attempt) || 0)),
    retries: Math.max(0, Math.floor(Number(raw.retries) || 0)),
    score: Math.max(0, Math.floor(Number(raw.score) || 0)),
    history,
    battle,
    pending: raw.stage === 'debrief' ? raw.pending : null,
    createdAt: Number(raw.createdAt) || 0,
  };
}

export const TOURNAMENT_SPEC = {
  version: TOURNAMENT_VERSION,
  defaults: () => null,
  sanitize: (raw) => (raw && raw.runId ? sanitizeRun(raw) : null),
  migrations: {},
};

export const loadRun = (store) => loadVersioned(store, KEYS.tournament, TOURNAMENT_SPEC);
export function saveRun(store, run) {
  if (!run) { store.remove(KEYS.tournament); return true; }
  return saveVersioned(store, KEYS.tournament, TOURNAMENT_SPEC, run);
}

export { ECONOMY, sanitizeInventory };
