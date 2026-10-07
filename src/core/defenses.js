// The defensive equipment registry. Like weapons, every defense is data that
// the engine, armory, HUD, help text, and AI all read from here.
//
// Two modes:
// - active: chosen during your turn and sent with the fire command. It deploys
//   when your turn ends (after your own shot resolves). One per turn.
// - passive: carried in stock and triggers automatically when needed.
//
// Defenses always use up stock, even under the sandbox's unlimited-ammo rule.

const MODES = ['active', 'passive'];

export const DEFENSE_DATA = [
  {
    id: 'shield', name: 'Heavy Shield', short: 'H SHIELD', glyph: '◯', mode: 'active',
    role: 'Soak the next volley',
    description: 'Projects a bubble that absorbs the next 60 points of blast damage, then collapses. It stays up across turns until it is used up.',
    counterplay: 'Blocks blasts only: fire, vents, and falls go straight through. Big payloads strip it fast.',
    stock: { start: 0, cap: 3, price: 160 },
    params: { absorb: 60 },
    presentation: { color: '#7fd6ff' },
  },
  {
    id: 'deflector', name: 'Deflector Field', short: 'DEFLECT', glyph: '⟲', mode: 'active',
    role: 'Return to sender',
    description: 'The first enemy projectile to enter the field is bounced away, and the bounced round counts as yours. The field then collapses.',
    counterplay: 'Deflects one projectile only: a cluster’s other bomblets still land. A cheap shell can strip it.',
    stock: { start: 0, cap: 2, price: 230 },
    params: { radius: 54 },
    presentation: { color: '#c9a2ff' },
  },
  {
    id: 'repair', name: 'Battery', short: 'BATTERY', glyph: '⚡', mode: 'active',
    role: 'Patch the hull',
    description: 'Restores 35 armour at the end of your turn, up to your maximum.',
    counterplay: 'Wasted when you are nearly full, and lost if you die during your own turn.',
    stock: { start: 0, cap: 4, price: 130 },
    params: { heal: 35 },
    presentation: { color: '#9dff6a' },
  },
  {
    id: 'fuel', name: 'Fuel', short: 'FUEL', glyph: '▶', mode: 'active',
    role: 'Move your tank a little',
    description: 'Drives your tank up to 55 m in the direction its barrel points after the shot resolves.',
    counterplay: 'Steep ground, battlefield edges, and other tanks can shorten the move.',
    stock: { start: 0, cap: 5, price: 75 },
    params: { distance: 55, clearance: 34 },
    presentation: { color: '#ffd166' },
  },
  {
    id: 'foam', name: 'Fire Suppressant', short: 'FOAM', glyph: '❄', mode: 'active',
    role: 'Stop the burn',
    description: 'Smothers every fire within 100 m and makes your tank immune to fire and vents for two rounds.',
    counterplay: 'No help against blasts. New napalm can be laid again once it wears off.',
    stock: { start: 0, cap: 3, price: 90 },
    params: { reach: 100, rounds: 2 },
    presentation: { color: '#bff4ff' },
  },
  {
    id: 'berm', name: 'Earthworks', short: 'BERM', glyph: '⌓', mode: 'active',
    role: 'Dig in',
    description: 'Throws up a dirt berm on both sides of your tank. Flat shots smash into it instead of you.',
    counterplay: 'A high lob drops straight over the berm, and any blast can blow it away.',
    stock: { start: 0, cap: 4, price: 80 },
    params: { inner: 16, outer: 62, height: 38 },
    presentation: { color: '#c79a5b' },
  },
  {
    id: 'anchor', name: 'Bedrock Anchor', short: 'ANCHOR', glyph: '⚓', mode: 'active',
    role: 'Hold your ground',
    description: 'Locks the ground under your tank for two rounds. Craters and burrowing charges cannot dig it out from under you.',
    counterplay: 'Only the ground beneath you holds. Blast damage still lands in full.',
    stock: { start: 0, cap: 3, price: 100 },
    params: { rounds: 2 },
    presentation: { color: '#a8b4c4' },
  },
  {
    id: 'relocate', name: 'Emergency Relocator', short: 'JUMP', glyph: '⇄', mode: 'active',
    role: 'Shoot and scoot',
    description: 'After your shot lands, warps your tank to a random spot well away from every other tank.',
    counterplay: 'You cannot choose where you land. It may be worse ground, or close to a fire.',
    stock: { start: 0, cap: 2, price: 180 },
    params: { clearance: 150, tries: 32 },
    presentation: { color: '#ffd36b' },
  },
  {
    id: 'interceptor', name: 'Point-Defense Gun', short: 'P-DEF', glyph: '✦', mode: 'passive',
    role: 'Automatic interception',
    description: 'Fires automatically at the first hostile projectile that comes within 80 m and destroys it in mid-air. Uses one charge each time.',
    counterplay: 'It shoots at anything hostile nearby, so a cheap decoy shell can drain its charges. One bomblet in five is a small win.',
    stock: { start: 0, cap: 2, price: 220 },
    params: { radius: 80 },
    presentation: { color: '#ff9a7a' },
  },
  {
    id: 'parachute', name: 'Parachute', short: 'CHUTE', glyph: '☂', mode: 'passive',
    role: 'Fall safely',
    description: 'Opens automatically when a fall would cause damage. You drift down and take no fall damage.',
    counterplay: 'One fall per parachute. It does nothing against the blast that opened the hole.',
    stock: { start: 0, cap: 4, price: 60 },
    params: { drift: 90 },
    presentation: { color: '#f6e7b8' },
  },
  {
    id: 'plating', name: 'Hull Plating', short: 'PLATE', glyph: '▣', mode: 'passive',
    role: 'Extra armour',
    description: 'Bolted on at the start of your next battle: +25 maximum and current armour for that battle.',
    counterplay: 'One plate per battle, used up when the battle starts whether or not you are hit.',
    stock: { start: 0, cap: 2, price: 120 },
    params: { armour: 25 },
    presentation: { color: '#d7d7d7' },
  },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Returns a list of problems; empty when valid. */
export function validateDefense(d) {
  const errors = [];
  const where = `defense "${d?.id ?? '?'}"`;
  const need = (cond, msg) => { if (!cond) errors.push(`${where}: ${msg}`); };
  need(d && typeof d === 'object', 'must be an object');
  if (!d || typeof d !== 'object') return errors;
  need(typeof d.id === 'string' && /^[a-z][a-z0-9-]*$/.test(d.id), 'id must be a lowercase slug');
  for (const k of ['name', 'short', 'role', 'description', 'counterplay']) need(typeof d[k] === 'string' && d[k].length > 0, `${k} is required text`);
  need(MODES.includes(d.mode), `mode must be one of ${MODES.join(', ')}`);
  need(d.stock && Number.isInteger(d.stock.start) && d.stock.start >= 0, 'stock.start must be a non-negative integer');
  need(d.stock && Number.isInteger(d.stock.cap) && d.stock.cap >= 1, 'stock.cap must be a positive integer');
  need(d.stock && d.stock.start <= d.stock.cap, 'stock.start cannot exceed stock.cap');
  need(d.stock && Number.isInteger(d.stock.price) && d.stock.price > 0, 'stock.price must be a positive integer');
  need(d.params && typeof d.params === 'object' && Object.values(d.params).every(isNum), 'params must be numbers');
  need(d.presentation && /^#[0-9a-f]{6}$/i.test(d.presentation.color ?? ''), 'presentation.color must be #rrggbb');
  return errors;
}

export function validateDefenses(list) {
  const errors = [];
  const ids = new Set();
  for (const d of list ?? []) {
    errors.push(...validateDefense(d));
    if (ids.has(d?.id)) errors.push(`duplicate defense id "${d.id}"`);
    ids.add(d?.id);
  }
  if (errors.length) throw new Error(`Invalid defense registry:\n- ${errors.join('\n- ')}`);
  return Object.freeze(list.map((d) => Object.freeze(d)));
}

export const DEFENSES = validateDefenses(DEFENSE_DATA);
export const DEFENSE_IDS = DEFENSES.map((d) => d.id);
export const ACTIVE_DEFENSES = DEFENSES.filter((d) => d.mode === 'active');
const BY_ID = new Map(DEFENSES.map((d) => [d.id, d]));
export const getDefense = (id) => BY_ID.get(id);
