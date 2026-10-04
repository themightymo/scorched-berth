import { validateRatings } from '../core/ratings.js';

// Historical commander roster. These are playful, fictionalised gameplay
// interpretations, not claims about the figures' real tactics, beliefs, or
// character. Bark lines are original in-game chatter, never quotations.
//
// Parameters (all data-driven, read by src/ai/ai.js):
//   targeting   – weights for choosing whom to shoot
//                 weakest: finish damaged tanks · nearest: closest threat
//                 strongest: healthiest tank · grudge: whoever hurt me recently
//                 focus: stay on the previous target
//   weapons     – multiplier on each weapon's appeal (1 = neutral)
//   risk        – 0..1 tolerance for self-damage
//   terrain     – value of lasting terrain effects (fire, undermining, disruption)
//   aim         – base aim variance (degrees / power points)
//   patience    – how quickly repeated shots at one target tighten aim (0..1)
//   conservation– reluctance to spend scarce ammunition (0..1)
//   aggression  – bonus for raw damage early in the battle (0..1)
//   rally       – how much a low-health commander sharpens and spends (0..1)
//   robustness  – preference for firing solutions that tolerate error (0..1)
//   ratings     – stat card (src/core/ratings.js): firepower, armor, velocity,
//                 hull, stability; 2–10 each, 30 points total. These change the
//                 tank's real mechanics, independent of AI difficulty.

export const COMMANDERS = [
  {
    id: 'lincoln', ratings: { firepower: 5, armor: 6, velocity: 5, hull: 8, stability: 6 }, short: 'Lincoln', name: 'Abraham Lincoln', title: 'Patient Resolve', insignia: 'L', color: '#8fb8ff',
    bio: 'Abraham Lincoln (1809–1865) was the 16th President of the United States.',
    doctrine: 'Values survival and measured shots. Avoids risky close fire and grows sharper and bolder when badly damaged.',
    tells: ['Avoids shots that splash back', 'Rallies when low on armour', 'Saves heavy rounds for the late game'],
    targeting: { weakest: 0.4, nearest: 0.3, strongest: 0.1, grudge: 0.6, focus: 0.5 },
    weapons: { shell: 1.15, heavy: 1.0, nuke: 0.8, cluster: 0.85, napalm: 0.8, burrow: 0.9 },
    risk: 0.12, terrain: 0.35, aim: 2.6, patience: 0.75, conservation: 0.75, aggression: 0.15, rally: 0.9, robustness: 0.6,
    barks: { fire: ['Steady. Hold the line.', 'One careful round.', 'Measure twice, fire once.'], hit: ['A fair hit.', 'That will do.'], hurt: ['Still standing.', 'We endure.'], win: ['The field is quiet again.'] },
  },
  {
    id: 'genghis', ratings: { firepower: 5, armor: 5, velocity: 9, hull: 5, stability: 6 }, short: 'Genghis', name: 'Genghis Khan', title: 'Relentless Pressure', insignia: 'G', color: '#ffb36b',
    bio: 'Genghis Khan (c. 1162–1227) founded the Mongol Empire.',
    doctrine: 'Opens fast and keeps pressure on the whole field. Accepts wide shot spread and favours weapons that disrupt large areas.',
    tells: ['Fires area weapons early', 'Spreads damage across several tanks', 'Shrugs off a little splash'],
    targeting: { weakest: 0.2, nearest: 0.5, strongest: 0.3, grudge: 0.2, focus: 0.1 },
    weapons: { shell: 0.85, heavy: 1.1, nuke: 1.15, cluster: 1.6, napalm: 1.45, burrow: 0.9 },
    risk: 0.6, terrain: 0.9, aim: 3.6, patience: 0.3, conservation: 0.2, aggression: 0.9, rally: 0.3, robustness: 0.2,
    barks: { fire: ['Keep moving. Keep firing.', 'Cover the whole ridge.', 'No pause.'], hit: ['Again!', 'Press on.'], hurt: ['Nothing slows us.'], win: ['The plain is ours.'] },
  },
  {
    id: 'attila', ratings: { firepower: 9, armor: 5, velocity: 6, hull: 6, stability: 4 }, short: 'Attila', name: 'Attila the Hun', title: 'Shock Assault', insignia: 'A', color: '#ff7a7a',
    bio: 'Attila (died 453) ruled the Hunnic Empire in the fifth century.',
    doctrine: 'Leads with the heaviest payload available and spends ammunition freely for immediate impact.',
    tells: ['Fires heavy rounds and nukes early', 'Barely conserves ammunition', 'Tolerates splash damage'],
    targeting: { weakest: 0.2, nearest: 0.6, strongest: 0.4, grudge: 0.3, focus: 0.3 },
    weapons: { shell: 0.7, heavy: 1.7, nuke: 1.9, cluster: 1.0, napalm: 0.9, burrow: 1.0 },
    risk: 0.75, terrain: 0.4, aim: 3.2, patience: 0.35, conservation: 0.05, aggression: 1.0, rally: 0.2, robustness: 0.15,
    barks: { fire: ['Everything at once.', 'Full charge!', 'Make it loud.'], hit: ['Shaken loose!'], hurt: ['Hit back harder.'], win: ['Nothing left standing.'] },
  },
  {
    id: 'caesar', ratings: { firepower: 6, armor: 6, velocity: 6, hull: 5, stability: 7 }, short: 'Caesar', name: 'Julius Caesar', title: 'Disciplined Precision', insignia: 'C', color: '#ffe06b',
    bio: 'Gaius Julius Caesar (100–44 BC) was a Roman general and statesman.',
    doctrine: 'Chooses reliable firing solutions that still land if the aim drifts, and uses fire to deny ground in a controlled way.',
    tells: ['Tightest aim on the roster', 'Prefers forgiving solutions', 'Uses napalm to pin tanks'],
    targeting: { weakest: 0.5, nearest: 0.2, strongest: 0.2, grudge: 0.2, focus: 0.8 },
    weapons: { shell: 1.25, heavy: 1.1, nuke: 0.7, cluster: 0.75, napalm: 1.3, burrow: 0.9 },
    risk: 0.3, terrain: 0.6, aim: 1.5, patience: 0.85, conservation: 0.5, aggression: 0.35, rally: 0.4, robustness: 1.0,
    barks: { fire: ['In order. Fire.', 'By the numbers.', 'Exactly as planned.'], hit: ['As calculated.'], hurt: ['Reform and continue.'], win: ['Order restored.'] },
  },
  {
    id: 'napoleon', ratings: { firepower: 7, armor: 5, velocity: 7, hull: 6, stability: 5 }, short: 'Napoleon', name: 'Napoleon Bonaparte', title: 'Bold Opportunism', insignia: 'N', color: '#7fe0c4',
    bio: 'Napoleon Bonaparte (1769–1821) was a French military leader and emperor.',
    doctrine: 'Hunts the most valuable opening on the field and switches targets readily to finish weakened tanks.',
    tells: ['Goes for eliminations', 'Changes targets often', 'Takes bold, risky angles'],
    targeting: { weakest: 1.0, nearest: 0.1, strongest: 0.0, grudge: 0.1, focus: -0.2 },
    weapons: { shell: 1.0, heavy: 1.2, nuke: 1.2, cluster: 1.1, napalm: 0.9, burrow: 1.25 },
    risk: 0.5, terrain: 0.5, aim: 2.4, patience: 0.4, conservation: 0.35, aggression: 0.6, rally: 0.4, robustness: 0.3, killBonus: 2.2,
    barks: { fire: ['There, an opening!', 'Seize it.', 'Now, while they waver.'], hit: ['Exactly where it hurts.'], hurt: ['A setback, nothing more.'], win: ['A decisive day.'] },
  },
  {
    id: 'elizabeth', ratings: { firepower: 5, armor: 9, velocity: 5, hull: 6, stability: 5 }, short: 'Elizabeth', name: 'Queen Elizabeth I', title: 'Strategic Patience', insignia: 'E', color: '#d6a8ff',
    bio: 'Elizabeth I (1533–1603) was Queen of England and Ireland.',
    doctrine: 'Conserves rare weapons, avoids risk, and answers whoever attacked her with careful counterfire.',
    tells: ['Rarely spends rare ammunition', 'Counter-attacks her attackers', 'Lowest self-damage risk'],
    targeting: { weakest: 0.3, nearest: 0.1, strongest: 0.1, grudge: 1.2, focus: 0.4 },
    weapons: { shell: 1.3, heavy: 0.9, nuke: 0.6, cluster: 0.8, napalm: 0.85, burrow: 1.05 },
    risk: 0.05, terrain: 0.45, aim: 2.2, patience: 0.8, conservation: 1.0, aggression: 0.1, rally: 0.6, robustness: 0.7,
    barks: { fire: ['A measured reply.', 'Patience, then precision.', 'We answer in kind.'], hit: ['Noted, and answered.'], hurt: ['We will remember that.'], win: ['Patience prevails.'] },
  },
];

const BY_ID = new Map(COMMANDERS.map((c) => [c.id, c]));
export const getCommander = (id) => BY_ID.get(id) ?? COMMANDERS[0];
export const COMMANDER_IDS = COMMANDERS.map((c) => c.id);

/** Battle-config entry for an AI commander, carrying its stat ratings. */
export function commanderPlayer(id, difficulty = 'veteran', extra = {}) {
  const c = getCommander(id);
  return { name: c.name, color: c.color, kind: 'ai', commander: c.id, difficulty, ratings: { ...c.ratings }, ...extra };
}

export function validateCommanders(list = COMMANDERS) {
  const errors = [];
  const num01 = ['risk', 'terrain', 'patience', 'conservation', 'aggression', 'rally', 'robustness'];
  for (const c of list) {
    for (const k of num01) if (!(c[k] >= 0 && c[k] <= 1)) errors.push(`${c.id}.${k} must be 0..1`);
    if (!(c.aim > 0 && c.aim < 10)) errors.push(`${c.id}.aim out of range`);
    for (const k of ['weakest', 'nearest', 'strongest', 'grudge', 'focus']) if (typeof c.targeting?.[k] !== 'number') errors.push(`${c.id}.targeting.${k} missing`);
    if (!c.barks?.fire?.length) errors.push(`${c.id} needs fire barks`);
    for (const p of validateRatings(c.ratings)) errors.push(`${c.id}: ${p}`);
  }
  if (errors.length) throw new Error(`Invalid commander data:\n- ${errors.join('\n- ')}`);
  return true;
}
validateCommanders();

export const DIFFICULTY = {
  recruit: {
    id: 'recruit', name: 'Recruit',
    summary: 'Searches a coarse grid, aims loosely, and forgets who attacked it.',
    angleStep: 6, powerStep: 6, finalists: 4, refine: 0, variance: 7.5, memoryTurns: 0, zeroing: 0.15, robustSamples: 0, timeBudgetMs: 60, traceBudget: 1400,
  },
  veteran: {
    id: 'veteran', name: 'Veteran',
    summary: 'Searches a finer grid, refines its best idea, and remembers recent attackers.',
    angleStep: 3, powerStep: 3, finalists: 8, refine: 1, variance: 3.8, memoryTurns: 6, zeroing: 0.6, robustSamples: 2, timeBudgetMs: 110, traceBudget: 5200,
  },
  ace: {
    id: 'ace', name: 'Ace',
    summary: 'Searches densely, tests how forgiving each shot is, aims tightly, and holds long grudges.',
    angleStep: 2, powerStep: 2, finalists: 12, refine: 2, variance: 1.7, memoryTurns: 14, zeroing: 1.0, robustSamples: 4, timeBudgetMs: 180, traceBudget: 9000,
  },
};
export const DIFFICULTY_IDS = Object.keys(DIFFICULTY);
