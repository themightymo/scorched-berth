// Weapon unlocks. Every unlockable weapon is earned from the service record
// (career totals, challenge stars, daily wins, tournaments), so unlock state is
// derived, never stored: it cannot drift out of sync with the record and needs
// no save migration. Sandbox and play-test battles do not add to the record, so
// they cannot be farmed for unlocks.
//
// `kit` is how many rounds of the weapon each human gets at the start of a
// quick battle, hot-seat series, or play-test once it is unlocked. Tournaments
// sell unlocked weapons in the armory instead. Daily and challenge battles keep
// their fixed arsenals so scores stay comparable.

import { getWeapon } from '../core/weapons.js';

const stars = (r) => Object.values(r.challenges ?? {}).reduce((n, c) => n + (c.stars ?? 0), 0);
const dailyWins = (r) => Object.values(r.daily ?? {}).filter((d) => d.won).length;

export const UNLOCKS = [
  { weapon: 'leapfrog', goal: 3, kit: 2, text: 'Win 3 battles', progress: (r) => r.totals.wins },
  { weapon: 'riot', goal: 75, kit: 2, text: 'Fire 75 shots', progress: (r) => r.totals.shots },
  { weapon: 'dirt', goal: 10, kit: 2, text: 'Fight 10 battles', progress: (r) => r.totals.battles },
  { weapon: 'hotnapalm', goal: 250, kit: 1, text: 'Deal 250 burn damage with fire', progress: (r) => r.totals.burns },
  { weapon: 'laser', goal: 10, kit: 2, text: 'Land 10 direct hits', progress: (r) => r.totals.direct },
  { weapon: 'roller', goal: 6, kit: 2, text: 'Earn 6 challenge stars', progress: stars },
  { weapon: 'sandhog', goal: 12, kit: 1, text: 'Destroy 12 enemy tanks', progress: (r) => r.totals.kills },
  { weapon: 'funky', goal: 1, kit: 1, text: 'Win a Daily Challenge', progress: dailyWins },
  { weapon: 'plasma', goal: 1, kit: 1, text: 'Complete a tournament', progress: (r) => r.tournaments },
  { weapon: 'deathshead', goal: 3200, kit: 1, text: 'Score 3,200 in one tournament (Major rank)', progress: (r) => r.bestTournament?.score ?? 0 },
];

for (const u of UNLOCKS) if (!getWeapon(u.weapon)) throw new Error(`Unlock refers to unknown weapon "${u.weapon}".`);

const BY_WEAPON = new Map(UNLOCKS.map((u) => [u.weapon, u]));
export const unlockFor = (id) => BY_WEAPON.get(id) ?? null;

/** { done, have, goal, text } for one weapon; always done for weapons with no unlock rule. */
export function unlockStatus(records, id, { all = false } = {}) {
  const u = unlockFor(id);
  if (!u) return { done: true, have: 0, goal: 0, text: '' };
  const have = Math.max(0, Math.floor(Number(u.progress(records)) || 0));
  return { done: all || have >= u.goal, have: Math.min(have, u.goal), goal: u.goal, text: u.text };
}

export const isUnlocked = (records, id, opts) => unlockStatus(records, id, opts).done;

/** Ids of unlockable weapons the record has earned (`all` unlocks everything, for ?dev). */
export function unlockedWeapons(records, opts) {
  return UNLOCKS.filter((u) => isUnlocked(records, u.weapon, opts)).map((u) => u.weapon);
}

/** Ids that are locked for this record. */
export function lockedWeapons(records, opts) {
  return UNLOCKS.filter((u) => !isUnlocked(records, u.weapon, opts)).map((u) => u.weapon);
}

/** Starting rounds of each unlocked weapon, merged over a base inventory. */
export function withKit(inventory, records, opts) {
  const out = { ...inventory };
  for (const u of UNLOCKS) if (isUnlocked(records, u.weapon, opts)) out[u.weapon] = Math.max(out[u.weapon] ?? 0, u.kit);
  return out;
}

/** Weapons unlocked by going from one record to the next. */
export function newlyUnlocked(before, after) {
  return UNLOCKS.filter((u) => !isUnlocked(before, u.weapon) && isUnlocked(after, u.weapon)).map((u) => u.weapon);
}
