// Tank stat ratings, shown like a trading card (1–10 per stat). Every
// commander and player chassis spends the same 30-point budget, so a strength
// always costs a weakness. Ratings change real mechanics in the engine; they
// are separate from AI difficulty, which never touches armour or damage.

export const RATING_KEYS = ['firepower', 'armor', 'velocity', 'hull', 'stability'];
export const RATING_MIN = 2;
export const RATING_MAX = 10;
export const RATING_BUDGET = 30;
const MID = 6;

export const RATING_INFO = {
  firepower: { label: 'Firepower', short: 'FPW', effect: 'Damage dealt by blasts and fire (±4% per point from 6).' },
  armor: { label: 'Armour', short: 'ARM', effect: 'Damage taken from blasts, fire, and vents (∓4% per point).' },
  velocity: { label: 'Muzzle velocity', short: 'VEL', effect: 'Shell launch speed: more range and less time for wind to push it (±2.5% per point).' },
  hull: { label: 'Hull', short: 'HUL', effect: 'Maximum armour points (±5% per point).' },
  stability: { label: 'Stability', short: 'STB', effect: 'Fall damage when the ground gives way (∓8% per point).' },
};

export const STANDARD_RATINGS = Object.freeze({ firepower: 6, armor: 6, velocity: 6, hull: 6, stability: 6 });

/** Player-selectable chassis. Commanders define their own in commanders.js. */
export const CHASSIS = [
  { id: 'standard', name: 'Standard', blurb: 'Even ratings with no weak spot.', ratings: { firepower: 6, armor: 6, velocity: 6, hull: 6, stability: 6 } },
  { id: 'striker', name: 'Striker', blurb: 'Hits hard, but thin armour and a light hull.', ratings: { firepower: 9, armor: 4, velocity: 6, hull: 5, stability: 6 } },
  { id: 'bulwark', name: 'Bulwark', blurb: 'Heavy armour and hull; slow shells and soft hits.', ratings: { firepower: 5, armor: 8, velocity: 4, hull: 8, stability: 5 } },
  { id: 'longshot', name: 'Longshot', blurb: 'Fast shells reach far and fight the wind, but each hit is lighter.', ratings: { firepower: 4, armor: 6, velocity: 9, hull: 5, stability: 6 } },
  { id: 'mountaineer', name: 'Mountaineer', blurb: 'Shrugs off falls; ideal on mesas and peaks.', ratings: { firepower: 6, armor: 5, velocity: 5, hull: 5, stability: 9 } },
];
export const getChassis = (id) => CHASSIS.find((c) => c.id === id) ?? CHASSIS[0];

export function validateRatings(r) {
  const problems = [];
  if (!r || typeof r !== 'object') return ['ratings must be an object'];
  let sum = 0;
  for (const k of RATING_KEYS) {
    const v = r[k];
    if (!Number.isInteger(v) || v < RATING_MIN || v > RATING_MAX) problems.push(`${k} must be an integer ${RATING_MIN}–${RATING_MAX}`);
    sum += v;
  }
  if (!problems.length && sum !== RATING_BUDGET) problems.push(`ratings must total ${RATING_BUDGET} (got ${sum})`);
  return problems;
}

/** Invalid ratings fall back to the even standard card. */
export const sanitizeRatings = (r) => (validateRatings(r).length ? { ...STANDARD_RATINGS } : { ...r });

/** Convert ratings to the multipliers the engine applies. */
export function ratingMods(r) {
  return {
    damage: 1 + (r.firepower - MID) * 0.04,
    defense: 1 - (r.armor - MID) * 0.04,
    muzzle: 1 + (r.velocity - MID) * 0.025,
    hull: 1 + (r.hull - MID) * 0.05,
    fall: 1 - (r.stability - MID) * 0.08,
  };
}
