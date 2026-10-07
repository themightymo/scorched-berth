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
    id: 'lincoln', ratings: { firepower: 5, armor: 6, velocity: 5, hull: 8, stability: 6 }, short: 'Lincoln', name: 'Abraham Lincoln', title: 'Patient Resolve', insignia: 'L', color: '#aaaaaa',
    bio: 'Abraham Lincoln (1809–1865) was the 16th President of the United States.',
    doctrine: 'Values survival and measured shots. Avoids risky close fire and grows sharper and bolder when badly damaged.',
    tells: ['Avoids shots that splash back', 'Rallies when low on armour', 'Saves heavy rounds for the late game'],
    targeting: { weakest: 0.4, nearest: 0.3, strongest: 0.1, grudge: 0.6, focus: 0.5 },
    weapons: { shell: 1.15, heavy: 1.0, nuke: 0.8, cluster: 0.85, napalm: 0.8, burrow: 0.9, riotcharge: 1.0, leapfrog: 0.9, funky: 0.6, deathshead: 0.7, roller: 1.0, hotnapalm: 0.7, laser: 1.3, plasma: 1.1, sandhog: 0.9, dirt: 0.9, riot: 1.0 },
    risk: 0.12, terrain: 0.35, aim: 2.6, patience: 0.75, conservation: 0.75, aggression: 0.15, rally: 0.9, robustness: 0.6,
    barks: { fire: ["Four score and seven pounds of powder.", "With malice toward none. Mostly.", "Honest aim. Honestly.", "Hold my hat. Actually, don't.", "A government of the shells, by the shells.", "Splitting rails, splitting hulls.", "I cannot tell a lie. Wait, that was George.", "This one's for the Union."], lastWords: ["Four score and... ow.", "Tell them I went down honestly.", "Save the hat. It was load-bearing.", "I should have stayed a rail-splitter.", "A tank divided against itself cannot stand.", "Still on the penny. I'll be fine.", "Malice toward none... except whoever did that.", "This beard deserved better.", "I'd like to log a complaint. From my log cabin.", "Remember me as a fair shot. Not that one.", "Tell Mary I'll be late for supper."], hit: ['A fair hit.', 'That will do.'], hurt: ['Still standing.', 'We endure.'], win: ['The field is quiet again.'] },
  },
  {
    id: 'genghis', ratings: { firepower: 5, armor: 5, velocity: 9, hull: 5, stability: 6 }, short: 'Genghis', name: 'Genghis Khan', title: 'Relentless Pressure', insignia: 'G', color: '#00aaaa',
    bio: 'Genghis Khan (c. 1162–1227) founded the Mongol Empire.',
    doctrine: 'Opens fast and keeps pressure on the whole field. Accepts wide shot spread and favours weapons that disrupt large areas.',
    tells: ['Fires area weapons early', 'Spreads damage across several tanks', 'Shrugs off a little splash'],
    targeting: { weakest: 0.2, nearest: 0.5, strongest: 0.3, grudge: 0.2, focus: 0.1 },
    weapons: { shell: 0.85, heavy: 1.1, nuke: 1.15, cluster: 1.6, napalm: 1.45, burrow: 0.9, riotcharge: 0.8, leapfrog: 1.4, funky: 1.6, deathshead: 1.5, roller: 1.1, hotnapalm: 1.5, laser: 0.8, plasma: 1.0, sandhog: 0.9, dirt: 0.6, riot: 0.8 },
    risk: 0.6, terrain: 0.9, aim: 3.6, patience: 0.3, conservation: 0.2, aggression: 0.9, rally: 0.3, robustness: 0.2,
    barks: { fire: ["Surrender now and I only burn half your stuff.", "Arrows were slower. I like this better.", "Your hill is now my hill.", "Mount up! Wait, this is a tank.", "Hold still. I'm conquering you.", "Next stop: the rest of the map.", "It's pillage o'clock.", "The steppe sends its regards."], lastWords: ["Tell my sixteen million descendants I tried.", "The horse would have dodged that.", "Half the world, and I lose to THAT?", "Bury me somewhere secret. Again.", "This never happened on the steppe.", "Someone tell the yurt I won't be home.", "Should have brought more arrows.", "The Great Khan is now the Great Crater.", "Cheap shot. I respect it.", "Divide my stuff evenly. No fighting. Ha!", "Who put a tank where my horse goes?"], hit: ['Again!', 'Press on.'], hurt: ['Nothing slows us.'], win: ['The plain is ours.'] },
  },
  {
    id: 'attila', ratings: { firepower: 9, armor: 5, velocity: 6, hull: 6, stability: 4 }, short: 'Attila', name: 'Attila the Hun', title: 'Shock Assault', insignia: 'A', color: '#ff5555',
    bio: 'Attila (died 453) ruled the Hunnic Empire in the fifth century.',
    doctrine: 'Leads with the heaviest payload available and spends ammunition freely for immediate impact.',
    tells: ['Fires heavy rounds and nukes early', 'Barely conserves ammunition', 'Tolerates splash damage'],
    targeting: { weakest: 0.2, nearest: 0.6, strongest: 0.4, grudge: 0.3, focus: 0.3 },
    weapons: { shell: 0.7, heavy: 1.7, nuke: 1.9, cluster: 1.0, napalm: 0.9, burrow: 1.0, riotcharge: 0.9, leapfrog: 1.1, funky: 1.2, deathshead: 1.9, roller: 1.2, hotnapalm: 1.0, laser: 0.8, plasma: 1.6, sandhog: 1.0, dirt: 0.5, riot: 0.9 },
    risk: 0.75, terrain: 0.4, aim: 3.2, patience: 0.35, conservation: 0.05, aggression: 1.0, rally: 0.2, robustness: 0.15,
    barks: { fire: ["SMASH!", "Subtlety is for Romans.", "Bigger boom. BIGGER.", "Knock knock. It's the Huns.", "Pillage first, aim later.", "Ammunition is for spending!", "Scourge delivery!", "Is it loud enough? Make it louder."], lastWords: ["Bury me in gold, silver, and scrap metal.", "Tell Rome they got lucky.", "I was promised more plunder.", "Huns don't retreat. We explode.", "That's not how sieges work!", "Ow. Ow. Barbarically ow.", "My wolf helmet is ruined.", "I should have stayed at the wedding.", "I demand to see the manager of this battlefield.", "Tell the horde I went out loud.", "Scourge of God, scourged by artillery."], hit: ['Shaken loose!'], hurt: ['Hit back harder.'], win: ['Nothing left standing.'] },
  },
  {
    id: 'caesar', ratings: { firepower: 6, armor: 6, velocity: 6, hull: 5, stability: 7 }, short: 'Caesar', name: 'Julius Caesar', title: 'Disciplined Precision', insignia: 'C', color: '#ffff55',
    bio: 'Gaius Julius Caesar (100–44 BC) was a Roman general and statesman.',
    doctrine: 'Chooses reliable firing solutions that still land if the aim drifts, and uses fire to deny ground in a controlled way.',
    tells: ['Tightest aim on the roster', 'Prefers forgiving solutions', 'Uses napalm to pin tanks'],
    targeting: { weakest: 0.5, nearest: 0.2, strongest: 0.2, grudge: 0.2, focus: 0.8 },
    weapons: { shell: 1.25, heavy: 1.1, nuke: 0.7, cluster: 0.75, napalm: 1.3, burrow: 0.9, riotcharge: 0.9, leapfrog: 1.0, funky: 0.5, deathshead: 0.7, roller: 1.0, hotnapalm: 1.35, laser: 1.5, plasma: 0.9, sandhog: 0.9, dirt: 1.0, riot: 0.9 },
    risk: 0.3, terrain: 0.6, aim: 1.5, patience: 0.85, conservation: 0.5, aggression: 0.35, rally: 0.4, robustness: 1.0,
    barks: { fire: ["Veni, vidi... firing.", "The die is cast. So is this shell.", "Caesar aims. Caesar fires. Caesar narrates.", "All roads lead to your crater.", "In triplicate, as the Senate requires.", "This is going straight into my memoirs.", "Formation! ...of one.", "Render unto Caesar what is Caesar's: your hit points."], lastWords: ["Et tu, artillery?", "Beware the turns of March.", "I came, I saw, I got blown up.", "Render unto Caesar... a repair kit.", "Veni, vidi, kaboom.", "Still fewer holes than the Senate gave me.", "Write it in the third person: Caesar was robbed.", "Should have crossed a different river.", "SPQR: Somewhat Perforated, Quite Ruined.", "Tell Brutus this one wasn't him. Probably.", "The die is cast. And scattered across the hill."], hit: ['As calculated.'], hurt: ['Reform and continue.'], win: ['Order restored.'] },
  },
  {
    id: 'napoleon', ratings: { firepower: 7, armor: 5, velocity: 7, hull: 6, stability: 5 }, short: 'Napoleon', name: 'Napoleon Bonaparte', title: 'Bold Opportunism', insignia: 'N', color: '#ffffff',
    bio: 'Napoleon Bonaparte (1769–1821) was a French military leader and emperor.',
    doctrine: 'Hunts the most valuable opening on the field and switches targets readily to finish weakened tanks.',
    tells: ['Goes for eliminations', 'Changes targets often', 'Takes bold, risky angles'],
    targeting: { weakest: 1.0, nearest: 0.1, strongest: 0.0, grudge: 0.1, focus: -0.2 },
    weapons: { shell: 1.0, heavy: 1.2, nuke: 1.2, cluster: 1.1, napalm: 0.9, burrow: 1.25, riotcharge: 1.2, leapfrog: 1.25, funky: 1.1, deathshead: 1.2, roller: 1.3, hotnapalm: 0.9, laser: 1.1, plasma: 1.0, sandhog: 1.35, dirt: 0.8, riot: 1.2 },
    risk: 0.5, terrain: 0.5, aim: 2.4, patience: 0.4, conservation: 0.35, aggression: 0.6, rally: 0.4, robustness: 0.3, killBonus: 2.2,
    barks: { fire: ["Vive l'Empereur! That's me.", "Height is irrelevant. Range is everything.", "Je ne regrette rien. Yet.", "Seize the high ground! Or any ground.", "Opportunity knocks. With artillery.", "This hat has seen worse.", "Ah, smells like Austerlitz.", "Frankly, I'm a big deal."], lastWords: ["I'm not short. I'm in a crater.", "This is my Waterloo. Literally.", "Exile me somewhere with a view, at least.", "Not tonight, Josephine. Or ever, apparently.", "Tell Wellington nothing.", "Able was I ere I saw that shell.", "Back to Elba. Third time's the charm.", "The hat survived. That's what matters.", "Retreat! Retreat! ...Too late.", "An army marches on its stomach. Mine's on fire.", "History will be kind. I'm writing it."], hit: ['Exactly where it hurts.'], hurt: ['A setback, nothing more.'], win: ['A decisive day.'] },
  },
  {
    id: 'elizabeth', ratings: { firepower: 5, armor: 9, velocity: 5, hull: 6, stability: 5 }, short: 'Elizabeth', name: 'Queen Elizabeth I', title: 'Strategic Patience', insignia: 'E', color: '#ff55ff',
    bio: 'Elizabeth I (1533–1603) was Queen of England and Ireland.',
    doctrine: 'Conserves rare weapons, avoids risk, and answers whoever attacked her with careful counterfire.',
    tells: ['Rarely spends rare ammunition', 'Counter-attacks her attackers', 'Lowest self-damage risk'],
    targeting: { weakest: 0.3, nearest: 0.1, strongest: 0.1, grudge: 1.2, focus: 0.4 },
    weapons: { shell: 1.3, heavy: 0.9, nuke: 0.6, cluster: 0.8, napalm: 0.85, burrow: 1.05, riotcharge: 1.0, leapfrog: 0.9, funky: 0.6, deathshead: 0.6, roller: 1.0, hotnapalm: 0.8, laser: 1.35, plasma: 1.25, sandhog: 1.05, dirt: 1.2, riot: 1.0 },
    risk: 0.05, terrain: 0.45, aim: 2.2, patience: 0.8, conservation: 1.0, aggression: 0.1, rally: 0.6, robustness: 0.7,
    barks: { fire: ["One is not amused. Fire.", "Fetch the Armada-grade munitions.", "God save me. Not you.", "By royal decree: duck.", "A lady never misses. Rarely.", "Pearls, ruff, ordnance.", "Mind the ruff.", "Spain tried this. Ask Spain how it went."], lastWords: ["I have the hull of a weak and feeble tank.", "Tell Spain this doesn't count.", "Fetch my good ruff. I shall perish fancy.", "Off with their... wait, wrong monarch.", "The Virgin Queen, the vanquished tank.", "Sir Walter, your cloak. There is a puddle of me.", "Long live... somebody else, I suppose.", "One does not explode. One is merely indisposed.", "My portrait painter will fix this.", "Golden Age? More like golden crater.", "Never married, never lost. Well, one of those."], hit: ['Noted, and answered.'], hurt: ['We will remember that.'], win: ['Patience prevails.'] },
  },
];

/** Lines for human-driven tanks, which have no commander personality. */
export const HUMAN_BARKS = {
  fire: ["Fire in the hole!", "Special delivery!", "Calculated. Mostly.", "Here comes the boom.", "Trust me, I'm a professional.", "Duck!", "This one has your name on it.", "Physics, don't fail me now."],
  lastWords: ["I meant to do that.", "Was that... the wind?", "Lag! That was lag!", "Tell my mom I'll respawn.", "I'd like to file a formal complaint.", "Avenge me! Or don't. I'm not your boss.", "Is this covered by the warranty?", "Should have bought the shield.", "Worth it.", "Remember me as I was: slightly less on fire.", "Ow."],
};

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
    if (!(c.barks?.lastWords?.length >= 10)) errors.push(`${c.id} needs at least 10 last words`);
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
