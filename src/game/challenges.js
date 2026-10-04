// Data-defined challenge scenarios and the local daily seeded challenge.

import { emptyInventory } from '../core/weapons.js';
import { createRng } from '../core/rng.js';
import { PROFILE_IDS } from '../core/mapgen.js';
import { WEATHER_IDS } from '../core/weather.js';
import { COMMANDER_IDS, getCommander, commanderPlayer } from '../ai/commanders.js';
import { getChassis } from '../core/ratings.js';
import { battleStats, battleScore, outcomeFor } from './stats.js';

const dummy = (name, x, hp) => ({ name, kind: 'dummy', color: '#c8c8c8', x, hp, inventory: emptyInventory() });
const inv = (o) => ({ ...emptyInventory(), ...o });

export const CHALLENGES = [
  {
    id: 'range-finder', name: 'Range Finder', tag: 'Basics',
    brief: 'Three practice targets at increasing range, no wind. Destroy them all within eight shots.',
    tip: 'Fire, watch where the shell lands, then adjust power in small steps.',
    seed: 'CH-RANGE', map: { profile: 'plains', hazards: false }, rules: { fixedWind: 0 },
    objective: { type: 'maxShots', shots: 8 },
    player: { x: 140, inventory: inv({}) },
    others: [dummy('Target A', 520, 40), dummy('Target B', 880, 40), dummy('Target C', 1240, 40)],
    stars: { metric: 'shots', three: 4, two: 6 },
  },
  {
    id: 'crosswind', name: 'Crosswind', tag: 'Wind',
    brief: 'A fixed gale of 18 blows against you. Two targets, six shots, and two cluster charges.',
    tip: 'Cluster bomblets spread wide, so they forgive drift. Lob high so they separate.',
    seed: 'CH-WIND', map: { profile: 'rolling', hazards: false }, weather: 'gale', rules: { fixedWind: -18 },
    objective: { type: 'maxShots', shots: 6 },
    player: { x: 160, inventory: inv({ cluster: 2 }) },
    others: [dummy('Target A', 820, 60), dummy('Target B', 1180, 60)],
    stars: { metric: 'shots', three: 3, two: 4 },
  },
  {
    id: 'bunker-buster', name: 'Bunker Buster', tag: 'Burrowing',
    brief: 'Two targets sit on high mesas. Undermine them: the fall does the damage.',
    tip: 'A burrowing charge must land almost directly beneath its target.',
    seed: 'CH-BUNKER', map: { profile: 'badlands', hazards: false }, rules: { fixedWind: 3 },
    objective: { type: 'maxShots', shots: 7 },
    player: { x: 160, inventory: inv({ burrow: 4 }) },
    others: [dummy('Mesa A', 760, 70), dummy('Mesa B', 1160, 70)],
    stars: { metric: 'shots', three: 3, two: 5 },
  },
  {
    id: 'firebreak', name: 'Firebreak', tag: 'Napalm',
    brief: 'Three targets huddle together. Two napalm canisters and five shots to clear them.',
    tip: 'Fire burns at the end of every turn, but a later blast inside it puts it out.',
    seed: 'CH-FIRE', map: { profile: 'plains', hazards: false }, rules: { fixedWind: 2 },
    objective: { type: 'maxShots', shots: 5 },
    player: { x: 150, inventory: inv({ napalm: 2 }) },
    others: [dummy('Target A', 930, 45), dummy('Target B', 1020, 45), dummy('Target C', 1110, 45)],
    stars: { metric: 'shots', three: 3, two: 4 },
  },
  {
    id: 'last-stand', name: 'Last Stand', tag: 'Survival',
    brief: 'Two Ace commanders open fire. Survive until turn 12.',
    tip: 'Craters near you can drop you into cover, but falls hurt. Fire to break their aim, not to win.',
    seed: 'CH-STAND', map: { profile: 'peaks', hazards: false },
    objective: { type: 'surviveTurns', turns: 12 },
    player: { inventory: inv({ heavy: 2, burrow: 1 }) },
    others: [{ commander: 'attila', difficulty: 'ace' }, { commander: 'genghis', difficulty: 'ace' }],
    stars: { metric: 'hp', three: 60, two: 30 },
  },
  {
    id: 'night-duel', name: 'Night Duel', tag: 'Night',
    brief: 'One against one with Julius Caesar (Ace), at night. The preview shows only the start of the arc.',
    tip: 'Note the angle and power of each shot and correct from where it lands.',
    seed: 'CH-NIGHT', map: { profile: 'rolling', hazards: false }, night: true,
    objective: { type: 'eliminateAll' },
    player: { inventory: inv({ heavy: 2, cluster: 1, napalm: 1 }) },
    others: [{ commander: 'caesar', difficulty: 'ace' }],
    stars: { metric: 'hp', three: 60, two: 30 },
  },
];

export const getChallenge = (id) => CHALLENGES.find((c) => c.id === id);

export function challengeConfig(ch, { playerName = 'Commander', playerColor = '#9dff6a', playerChassis = 'standard' } = {}) {
  const players = [
    { name: playerName, color: playerColor, kind: 'human', ratings: getChassis(playerChassis).ratings, ...ch.player },
    ...ch.others.map((o) => {
      if (o.kind === 'dummy') return o;
      const c = getCommander(o.commander);
      return commanderPlayer(c.id, o.difficulty, { inventory: inv({ heavy: 2, cluster: 1, napalm: 1 }) });
    }),
  ];
  return {
    seed: ch.seed, mode: 'challenge', label: `Challenge · ${ch.name}`, challengeId: ch.id,
    map: ch.map, weather: ch.weather ?? 'clear', night: !!ch.night, rules: ch.rules ?? {},
    objective: ch.objective, players, shufflePositions: false,
  };
}

/** 0–3 stars. 0 means the challenge was not completed. */
export function challengeStars(ch, state) {
  if (outcomeFor(state, 0) !== 'victory') return 0;
  const me = state.tanks[0];
  if (ch.stars.metric === 'shots') return me.shots <= ch.stars.three ? 3 : me.shots <= ch.stars.two ? 2 : 1;
  return me.hp >= ch.stars.three ? 3 : me.hp >= ch.stars.two ? 2 : 1;
}

export function validateChallenges(list = CHALLENGES) {
  const problems = [];
  const ids = new Set();
  for (const c of list) {
    if (ids.has(c.id)) problems.push(`duplicate challenge ${c.id}`);
    ids.add(c.id);
    if (!['eliminateAll', 'surviveTurns', 'maxShots'].includes(c.objective.type)) problems.push(`${c.id}: unknown objective`);
    if (!c.others.length) problems.push(`${c.id}: needs opponents`);
    if (!['shots', 'hp'].includes(c.stars.metric)) problems.push(`${c.id}: unknown star metric`);
  }
  return problems;
}

// ── Daily challenge (local only) ────────────────────────────────────────────

export function localDateKey(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyConfig(dateKey, { playerName = 'Commander', playerColor = '#9dff6a', playerChassis = 'standard' } = {}) {
  const seed = `DAILY-${dateKey.replace(/-/g, '')}`;
  const rng = createRng(seed);
  const lineup = rng.shuffle(COMMANDER_IDS).slice(0, 3);
  const diffs = ['veteran', 'veteran', 'ace'];
  return {
    seed, mode: 'daily', label: `Daily · ${dateKey}`, dailyKey: dateKey,
    map: { profile: rng.pick(PROFILE_IDS), hazards: true },
    weather: rng.pick(WEATHER_IDS), night: rng.chance(0.25),
    players: [
      { name: playerName, color: playerColor, kind: 'human', ratings: getChassis(playerChassis).ratings, inventory: { ...emptyInventory(), heavy: 2, cluster: 1, napalm: 1, burrow: 1 } },
      ...lineup.map((id, i) => commanderPlayer(id, diffs[i], { inventory: { ...emptyInventory(), heavy: 2, cluster: 1, napalm: 1, burrow: 1 } })),
    ],
  };
}

export function dailyScore(state) {
  const me = battleStats(state).tanks[0];
  return battleScore(me, outcomeFor(state, 0) === 'victory').total;
}
