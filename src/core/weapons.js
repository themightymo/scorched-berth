// The single weapon registry. UI, help text, player firing, the armory, and
// the AI all read from here. Data is validated at import time so mistakes
// fail loudly during development.

import { DEFENSES, getDefense } from './defenses.js';

const PROJECTILE_KINDS = ['ballistic', 'cluster', 'napalm', 'burrow', 'leapfrog', 'funky', 'roller', 'beam', 'plasma'];
const CRATER_SHAPES = ['circle', 'shaft', 'mound', 'none'];
const FALLOFFS = ['linear', 'quadratic'];

export const WEAPON_DATA = [
  {
    id: 'shell', name: 'Missile', short: 'MISSILE', glyph: '•',
    role: 'Ranging and finishing',
    description: 'Unlimited, predictable round. Use it to range a target and finish damaged tanks.',
    counterplay: 'Small blast: a miss of one tank-width deals little damage.',
    ammo: { unlimited: true, start: 0, cap: 0, price: 0 },
    projectile: { kind: 'ballistic' },
    damage: { max: 48, radius: 69, falloff: 'linear' },
    crater: { shape: 'circle', radius: 43 },
    presentation: { color: '#f6e7b8', trail: 'line', sound: 'shell' },
    ai: { tags: ['precision'], cost: 0 },
  },
  {
    id: 'heavy', name: 'Heavy Shell', short: 'HEAVY', glyph: '●',
    role: 'Forgiving heavy hitter',
    description: 'Wide blast that tolerates aiming error and digs a deep crater that can topple tanks.',
    counterplay: 'Scarce and costly. Its big crater can drop the firer if fired at close range.',
    ammo: { unlimited: false, start: 3, cap: 6, price: 110 },
    projectile: { kind: 'ballistic' },
    damage: { max: 68, radius: 112, falloff: 'linear' },
    crater: { shape: 'circle', radius: 70 },
    presentation: { color: '#ffcf6b', trail: 'line', sound: 'heavy' },
    ai: { tags: ['heavy'], cost: 14 },
  },
  {
    id: 'nuke', name: 'Nuke', short: 'NUKE', glyph: '☢',
    role: 'Battlefield reset',
    description: 'Huge blast that reshapes the field and can hit several tanks at once.',
    counterplay: 'One per battle, very expensive, and dangerous to the firer at medium range.',
    ammo: { unlimited: false, start: 1, cap: 2, price: 420 },
    projectile: { kind: 'ballistic' },
    damage: { max: 100, radius: 184, falloff: 'linear' },
    crater: { shape: 'circle', radius: 115 },
    presentation: { color: '#ff8a5c', trail: 'line', sound: 'nuke' },
    ai: { tags: ['heavy', 'area'], cost: 45 },
  },
  {
    id: 'cluster', name: 'Cluster Charge', short: 'CLUSTER', glyph: '⁂',
    role: 'Area coverage in uncertain wind',
    description: 'Splits into five bomblets at the top of its arc. Lob it high to blanket a wide area.',
    counterplay: 'Low per-bomblet damage, and a flat shot that lands before its apex releases only one bomblet.',
    ammo: { unlimited: false, start: 1, cap: 4, price: 170 },
    projectile: { kind: 'cluster', count: 5, spreadVx: 34, spreadVy: 18 },
    damage: { max: 24, radius: 46, falloff: 'linear' },
    crater: { shape: 'circle', radius: 22 },
    presentation: { color: '#9fe8ff', trail: 'dots', sound: 'cluster' },
    ai: { tags: ['area'], cost: 12 },
  },
  {
    id: 'napalm', name: 'Napalm Canister', short: 'NAPALM', glyph: '♨',
    role: 'Area denial',
    description: 'Splashes fire across exposed ground. Tanks in the fire burn at the end of every turn until it dies out.',
    counterplay: 'Fire stops at steep ridges and any later explosion inside it puts that stretch out. Rain shortens it.',
    ammo: { unlimited: false, start: 1, cap: 4, price: 150 },
    projectile: { kind: 'napalm', spread: 92, climb: 10, turns: 3, burn: 12 },
    damage: { max: 12, radius: 40, falloff: 'linear' },
    crater: { shape: 'circle', radius: 12 },
    presentation: { color: '#ff6b3d', trail: 'line', sound: 'napalm' },
    ai: { tags: ['denial'], cost: 11 },
  },
  {
    id: 'burrow', name: 'Burrowing Charge', short: 'BURROW', glyph: '▼',
    role: 'Undermine a dug-in tank',
    description: 'Drills through the ground before it detonates. The deep, narrow shaft drops anything standing above it.',
    counterplay: 'Weak blast. It must land almost directly under the target, and bedrock limits how far tanks can fall.',
    ammo: { unlimited: false, start: 1, cap: 4, price: 140 },
    projectile: { kind: 'burrow', depth: 62, drillSpeed: 260 },
    damage: { max: 30, radius: 50, falloff: 'linear' },
    crater: { shape: 'shaft', radius: 26, depth: 64 },
    presentation: { color: '#c9a2ff', trail: 'line', sound: 'burrow' },
    ai: { tags: ['dig'], cost: 12 },
  },

  // ── Unlockable arsenal ─────────────────────────────────────────────────
  // Homages to the original Scorched Earth weapons. They start at zero stock;
  // src/game/unlocks.js says how each is earned and how many a new battle
  // issues once it is.
  {
    id: 'leapfrog', name: 'Leapfrog', short: 'LEAPFROG', glyph: '≈',
    role: 'Walk damage across a ridge',
    description: 'Explodes on impact, then hops onward twice. Each hop is weaker than the last.',
    counterplay: 'The hops follow the shot direction, so a wall or a cliff edge cuts the chain short.',
    ammo: { unlimited: false, start: 0, cap: 4, price: 190 },
    projectile: { kind: 'leapfrog', hops: 2, hopSpeed: 300, carry: 0.55, decay: 0.7 },
    damage: { max: 40, radius: 60, falloff: 'linear' },
    crater: { shape: 'circle', radius: 34 },
    presentation: { color: '#8dff9a', trail: 'line', sound: 'heavy' },
    ai: { tags: ['area'], cost: 13 },
  },
  {
    id: 'funky', name: 'Funky Bomb', short: 'FUNKY', glyph: '✺',
    role: 'Chaos in every direction',
    description: 'Bursts on impact and flings six multicoloured bomblets in a wild spray around the blast.',
    counterplay: 'The spray is hard to predict, including for the firer. Never use it close to home.',
    ammo: { unlimited: false, start: 0, cap: 3, price: 260 },
    projectile: { kind: 'funky', count: 6, scale: 0.65 },
    damage: { max: 36, radius: 58, falloff: 'linear' },
    crater: { shape: 'circle', radius: 30 },
    presentation: { color: '#ff7ad9', trail: 'dots', sound: 'cluster', palette: ['#ff7ad9', '#7af0ff', '#ffe66b', '#9dff6a', '#b68cff', '#ff9a5c'] },
    ai: { tags: ['area'], cost: 16 },
  },
  {
    id: 'deathshead', name: "Death's Head", short: 'DEATHHD', glyph: '☠',
    role: 'The heaviest MIRV',
    description: 'Splits into nine heavy warheads at the top of its arc. Lob it over a crowded valley.',
    counterplay: 'Wildly expensive and you can carry only one. Fired flat, it lands before it splits.',
    ammo: { unlimited: false, start: 0, cap: 1, price: 640 },
    projectile: { kind: 'cluster', count: 9, spreadVx: 30, spreadVy: 14 },
    damage: { max: 38, radius: 68, falloff: 'linear' },
    crater: { shape: 'circle', radius: 40 },
    presentation: { color: '#e8e2d0', trail: 'dots', sound: 'cluster' },
    ai: { tags: ['heavy', 'area'], cost: 50 },
  },
  {
    id: 'roller', name: 'Heavy Roller', short: 'ROLLER', glyph: '◉',
    role: 'Finds the low ground',
    description: 'Lands, then rolls downhill until it reaches a tank or the bottom of a valley, and explodes there.',
    counterplay: 'Useless against a tank on a peak. A tank in a hollow is a magnet for it, including yours.',
    ammo: { unlimited: false, start: 0, cap: 4, price: 180 },
    projectile: { kind: 'roller', speed: 170, range: 420 },
    damage: { max: 55, radius: 66, falloff: 'linear' },
    crater: { shape: 'circle', radius: 40 },
    presentation: { color: '#c0c8d4', trail: 'line', sound: 'heavy' },
    ai: { tags: ['terrain'], cost: 13 },
  },
  {
    id: 'dirt', name: 'Ton of Dirt', short: 'DIRT', glyph: '▲',
    role: 'Bury a tank or build a wall',
    description: 'Drops a huge ball of earth. A buried tank sits in a pit and must fire steeply or blast its way out.',
    counterplay: 'Deals no damage at all. Any explosion digs the victim free again.',
    ammo: { unlimited: false, start: 0, cap: 4, price: 120 },
    projectile: { kind: 'ballistic' },
    damage: { max: 0, radius: 1, falloff: 'linear' },
    crater: { shape: 'mound', radius: 62 },
    presentation: { color: '#b9824a', trail: 'line', sound: 'burrow' },
    ai: { tags: ['terrain'], cost: 10 },
  },
  {
    id: 'riotcharge', name: 'Riot Charge', short: 'RIOT CHG', glyph: '○',
    role: 'Clear a safe firing pocket',
    description: 'A compact, harmless dirt-clearing charge. Use it to uncover a buried tank before firing explosives.',
    counterplay: 'It removes only a modest amount of ground and causes no direct damage.',
    ammo: { unlimited: false, start: 1, cap: 6, price: 70 },
    projectile: { kind: 'ballistic' },
    damage: { max: 0, radius: 1, falloff: 'linear' },
    crater: { shape: 'circle', radius: 48 },
    presentation: { color: '#ffe29a', trail: 'line', sound: 'shell' },
    ai: { tags: ['dig'], cost: 5 },
  },
  {
    id: 'riot', name: 'Heavy Riot Bomb', short: 'HVY RIOT', glyph: '◌',
    role: 'Clear ground without harm',
    description: 'Blows an enormous hole in the ground but harms no one. Drop a tank into the pit, or dig yourself out.',
    counterplay: 'Damage comes only from the fall, and parachutes cancel that.',
    ammo: { unlimited: false, start: 0, cap: 4, price: 110 },
    projectile: { kind: 'ballistic' },
    damage: { max: 0, radius: 1, falloff: 'linear' },
    crater: { shape: 'circle', radius: 92 },
    presentation: { color: '#ffd166', trail: 'line', sound: 'heavy' },
    ai: { tags: ['dig'], cost: 9 },
  },
  {
    id: 'hotnapalm', name: 'Hot Napalm', short: 'HOTNAP', glyph: '♨',
    role: 'Wide, lasting firestorm',
    description: 'A hotter, longer napalm load that floods a wide stretch of ground with fire.',
    counterplay: 'Still stopped by steep ridges and put out by blasts and rain. Foam makes a tank immune.',
    ammo: { unlimited: false, start: 0, cap: 3, price: 260 },
    projectile: { kind: 'napalm', spread: 150, climb: 12, turns: 4, burn: 17 },
    damage: { max: 16, radius: 46, falloff: 'linear' },
    crater: { shape: 'circle', radius: 14 },
    presentation: { color: '#ff3d2e', trail: 'line', sound: 'napalm' },
    ai: { tags: ['denial'], cost: 16 },
  },
  {
    id: 'laser', name: 'Laser', short: 'LASER', glyph: '⌁',
    role: 'Line-of-sight sniping',
    description: 'A straight beam that ignores gravity and wind. Power sets its range. Hits only what it can see.',
    counterplay: 'Blocked by any hill in the way, and its tiny blast punishes the smallest aiming error.',
    ammo: { unlimited: false, start: 0, cap: 4, price: 200 },
    projectile: { kind: 'beam', speed: 1800, rangePerPower: 14 },
    damage: { max: 50, radius: 26, falloff: 'linear' },
    crater: { shape: 'circle', radius: 12 },
    presentation: { color: '#ff4f6d', trail: 'line', sound: 'shell' },
    ai: { tags: ['precision'], cost: 14 },
  },
  {
    id: 'plasma', name: 'Plasma Blast', short: 'PLASMA', glyph: '✹',
    role: 'Close-range defence',
    description: 'Discharges around your own tank instead of flying. Power sets the size of the blast; a tighter blast hits harder. You are unharmed.',
    counterplay: 'Weak against anything not close by, and it leaves the firer exactly where it was.',
    ammo: { unlimited: false, start: 0, cap: 3, price: 230 },
    projectile: { kind: 'plasma', charge: 50, minScale: 0.45, focus: 1 },
    damage: { max: 58, radius: 170, falloff: 'linear' },
    crater: { shape: 'none', radius: 1 },
    presentation: { color: '#7af0ff', trail: 'line', sound: 'nuke' },
    ai: { tags: ['area'], cost: 15 },
  },
  {
    id: 'sandhog', name: 'Heavy Sandhog', short: 'SANDHOG', glyph: '⋔',
    role: 'Three-way undermining',
    description: 'Burrows on impact and forks into three tunnelling warheads that blow the ground out from under a tank.',
    counterplay: 'Each warhead is weak, and bedrock limits how far anything can fall.',
    ammo: { unlimited: false, start: 0, cap: 3, price: 230 },
    projectile: { kind: 'burrow', depth: 80, drillSpeed: 240, forks: 3, forkSpread: 0.55 },
    damage: { max: 26, radius: 52, falloff: 'linear' },
    crater: { shape: 'shaft', radius: 24, depth: 58 },
    presentation: { color: '#d99a5b', trail: 'line', sound: 'burrow' },
    ai: { tags: ['dig'], cost: 16 },
  },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Returns a list of problems; empty when valid. */
export function validateWeapon(w) {
  const errors = [];
  const where = `weapon "${w?.id ?? '?'}"`;
  const need = (cond, msg) => { if (!cond) errors.push(`${where}: ${msg}`); };
  need(w && typeof w === 'object', 'must be an object');
  if (!w || typeof w !== 'object') return errors;
  need(typeof w.id === 'string' && /^[a-z][a-z0-9-]*$/.test(w.id), 'id must be a lowercase slug');
  for (const k of ['name', 'short', 'role', 'description', 'counterplay']) need(typeof w[k] === 'string' && w[k].length > 0, `${k} is required text`);
  need(w.ammo && typeof w.ammo.unlimited === 'boolean', 'ammo.unlimited must be boolean');
  if (w.ammo && !w.ammo.unlimited) {
    need(Number.isInteger(w.ammo.start) && w.ammo.start >= 0, 'ammo.start must be a non-negative integer');
    need(Number.isInteger(w.ammo.cap) && w.ammo.cap >= 1, 'ammo.cap must be a positive integer');
    need(w.ammo.start <= w.ammo.cap, 'ammo.start cannot exceed ammo.cap');
    need(Number.isInteger(w.ammo.price) && w.ammo.price > 0, 'ammo.price must be a positive integer');
  }
  need(w.projectile && PROJECTILE_KINDS.includes(w.projectile.kind), `projectile.kind must be one of ${PROJECTILE_KINDS.join(', ')}`);
  if (w.projectile?.kind === 'cluster') need(Number.isInteger(w.projectile.count) && w.projectile.count >= 2 && w.projectile.count <= 9 && isNum(w.projectile.spreadVx), 'cluster needs count 2–9 and spreadVx');
  if (w.projectile?.kind === 'napalm') need(isNum(w.projectile.spread) && Number.isInteger(w.projectile.turns) && w.projectile.turns > 0 && isNum(w.projectile.burn) && isNum(w.projectile.climb), 'napalm needs spread, climb, turns, burn');
  if (w.projectile?.kind === 'burrow') {
    need(isNum(w.projectile.depth) && w.projectile.depth > 0 && isNum(w.projectile.drillSpeed) && w.projectile.drillSpeed > 0, 'burrow needs depth and drillSpeed');
    if (w.projectile.forks != null) need(Number.isInteger(w.projectile.forks) && w.projectile.forks >= 1 && w.projectile.forks <= 5 && isNum(w.projectile.forkSpread), 'burrow forks must be 1–5 with forkSpread');
  }
  const p = w.projectile ?? {};
  if (p.kind === 'leapfrog') need(Number.isInteger(p.hops) && p.hops >= 1 && p.hops <= 4 && isNum(p.hopSpeed) && isNum(p.carry) && isNum(p.decay) && p.decay > 0 && p.decay <= 1, 'leapfrog needs hops 1–4, hopSpeed, carry, decay 0–1');
  if (p.kind === 'funky') need(Number.isInteger(p.count) && p.count >= 2 && p.count <= 9 && isNum(p.scale) && p.scale > 0 && p.scale <= 1, 'funky needs count 2–9 and scale 0–1');
  if (p.kind === 'roller') need(isNum(p.speed) && p.speed > 0 && isNum(p.range) && p.range > 0, 'roller needs speed and range');
  if (p.kind === 'beam') need(isNum(p.speed) && p.speed > 0 && isNum(p.rangePerPower) && p.rangePerPower > 0, 'beam needs speed and rangePerPower');
  if (p.kind === 'plasma') need(Number.isInteger(p.charge) && p.charge >= 0 && isNum(p.minScale) && p.minScale > 0 && p.minScale <= 1 && isNum(p.focus) && p.focus >= 0, 'plasma needs integer charge ticks, minScale 0–1, and focus ≥ 0');
  need(w.damage && isNum(w.damage.max) && w.damage.max >= 0 && w.damage.max <= 200, 'damage.max must be 0–200');
  need(w.damage && isNum(w.damage.radius) && w.damage.radius > 0 && w.damage.radius <= 300, 'damage.radius must be 1–300');
  need(w.damage && FALLOFFS.includes(w.damage.falloff), `damage.falloff must be one of ${FALLOFFS.join(', ')}`);
  need(w.crater && CRATER_SHAPES.includes(w.crater.shape) && isNum(w.crater.radius) && w.crater.radius > 0 && w.crater.radius <= 200, 'crater needs a known shape and radius 1–200');
  if (w.crater?.shape === 'shaft') need(isNum(w.crater.depth) && w.crater.depth > 0, 'shaft crater needs depth');
  need(w.presentation && typeof w.presentation.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.presentation.color), 'presentation.color must be #rrggbb');
  need(w.ai && Array.isArray(w.ai.tags) && isNum(w.ai.cost) && w.ai.cost >= 0, 'ai needs tags[] and cost ≥ 0');
  return errors;
}

export function validateRegistry(list) {
  const errors = [];
  if (!Array.isArray(list) || list.length === 0) errors.push('weapon registry must be a non-empty array');
  const ids = new Set();
  for (const w of list ?? []) {
    errors.push(...validateWeapon(w));
    if (ids.has(w?.id)) errors.push(`duplicate weapon id "${w.id}"`);
    ids.add(w?.id);
  }
  if (list?.length && !list.some((w) => w.ammo?.unlimited)) errors.push('registry needs at least one unlimited weapon as a fallback');
  if (errors.length) throw new Error(`Invalid weapon registry:\n- ${errors.join('\n- ')}`);
  return Object.freeze(list.map((w) => Object.freeze(w)));
}

export const WEAPONS = validateRegistry(WEAPON_DATA);
export const WEAPON_IDS = WEAPONS.map((w) => w.id);
const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));
export const getWeapon = (id) => BY_ID.get(id);
export const FALLBACK_WEAPON = WEAPONS.find((w) => w.ammo.unlimited).id;

// Every limited item a tank can carry: weapons with finite ammo, then defenses.
const STOCKED = [
  ...WEAPONS.filter((w) => !w.ammo.unlimited).map((w) => ({ id: w.id, start: w.ammo.start, cap: w.ammo.cap })),
  ...DEFENSES.map((d) => ({ id: d.id, start: d.stock.start, cap: d.stock.cap })),
];
{
  const clash = DEFENSES.find((d) => BY_ID.has(d.id));
  if (clash) throw new Error(`Defense id "${clash.id}" collides with a weapon id.`);
}

/** Price, cap, and name for anything sold in the armory (weapon or defense). */
export function stockInfo(id) {
  const w = getWeapon(id);
  if (w) return { id, kind: 'weapon', name: w.name, unlimited: w.ammo.unlimited, price: w.ammo.price, cap: w.ammo.cap };
  const d = getDefense(id);
  if (d) return { id, kind: 'defense', name: d.name, unlimited: false, price: d.stock.price, cap: d.stock.cap };
  return null;
}

/** Inventory maps item id → count; unlimited weapons are not stored. */
export function defaultInventory(overrides = {}) {
  const inv = {};
  for (const it of STOCKED) inv[it.id] = it.start;
  return sanitizeInventory({ ...inv, ...overrides });
}

export function emptyInventory() {
  const inv = {};
  for (const it of STOCKED) inv[it.id] = 0;
  return inv;
}

export function sanitizeInventory(inv, { capped = false } = {}) {
  const out = {};
  for (const it of STOCKED) {
    let n = Math.floor(Number(inv?.[it.id]));
    if (!Number.isFinite(n) || n < 0) n = 0;
    out[it.id] = capped ? Math.min(n, it.cap) : Math.min(n, 99);
  }
  return out;
}

export function hasAmmo(inventory, id) {
  const w = getWeapon(id);
  if (!w) return false;
  return w.ammo.unlimited || (inventory?.[id] ?? 0) > 0;
}

/** Damage at a distance, from the registry's falloff curve. `radius` overrides the weapon's (plasma). */
export function damageAt(weapon, distance, radius = weapon.damage.radius) {
  const { max, falloff } = weapon.damage;
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return Math.round(max * (falloff === 'quadratic' ? t * t : t));
}
