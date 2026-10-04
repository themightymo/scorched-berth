// The single weapon registry. UI, help text, player firing, the armory, and
// the AI all read from here. Data is validated at import time so mistakes
// fail loudly during development.

const PROJECTILE_KINDS = ['ballistic', 'cluster', 'napalm', 'burrow'];
const CRATER_SHAPES = ['circle', 'shaft'];
const FALLOFFS = ['linear', 'quadratic'];

export const WEAPON_DATA = [
  {
    id: 'shell', name: 'Standard Shell', short: 'SHELL', glyph: '•',
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
    id: 'nuke', name: 'Mini Nuke', short: 'NUKE', glyph: '☢',
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
  if (w.projectile?.kind === 'burrow') need(isNum(w.projectile.depth) && w.projectile.depth > 0 && isNum(w.projectile.drillSpeed) && w.projectile.drillSpeed > 0, 'burrow needs depth and drillSpeed');
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

/** Inventory maps weapon id → count; unlimited weapons are not stored. */
export function defaultInventory(overrides = {}) {
  const inv = {};
  for (const w of WEAPONS) if (!w.ammo.unlimited) inv[w.id] = w.ammo.start;
  return sanitizeInventory({ ...inv, ...overrides });
}

export function emptyInventory() {
  const inv = {};
  for (const w of WEAPONS) if (!w.ammo.unlimited) inv[w.id] = 0;
  return inv;
}

export function sanitizeInventory(inv, { capped = false } = {}) {
  const out = {};
  for (const w of WEAPONS) {
    if (w.ammo.unlimited) continue;
    let n = Math.floor(Number(inv?.[w.id]));
    if (!Number.isFinite(n) || n < 0) n = 0;
    out[w.id] = capped ? Math.min(n, w.ammo.cap) : Math.min(n, 99);
  }
  return out;
}

export function hasAmmo(inventory, id) {
  const w = getWeapon(id);
  if (!w) return false;
  return w.ammo.unlimited || (inventory?.[id] ?? 0) > 0;
}

/** Damage at a distance, from the registry's falloff curve. */
export function damageAt(weapon, distance) {
  const { max, radius, falloff } = weapon.damage;
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return Math.round(max * (falloff === 'quadratic' ? t * t : t));
}
