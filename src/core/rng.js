// Seeded randomness. Generators keep their state in a plain `{ s }` object so
// battle state stays JSON-serialisable and can be saved, cloned, or replayed.

export function hashString(text) {
  let h = 2166136261 >>> 0;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Final avalanche so similar strings diverge.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 step: mutates the holder and returns a float in [0, 1). */
export function nextFloat(holder) {
  holder.s = (holder.s + 0x6d2b79f5) >>> 0;
  let t = holder.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rngState = (seed) => ({ s: (typeof seed === 'number' ? seed : hashString(seed)) >>> 0 });

/** Convenience wrapper with helpers; shares state with the holder. */
export function createRng(seedOrHolder) {
  const holder = typeof seedOrHolder === 'object' && seedOrHolder ? seedOrHolder : rngState(seedOrHolder);
  const rng = {
    holder,
    next: () => nextFloat(holder),
    range: (a, b) => a + nextFloat(holder) * (b - a),
    int: (a, b) => a + Math.floor(nextFloat(holder) * (b - a + 1)),
    pick: (arr) => arr[Math.floor(nextFloat(holder) * arr.length)],
    chance: (p) => nextFloat(holder) < p,
    // Irwin–Hall approximation of a standard normal (no transcendental functions).
    gauss: () => {
      let s = 0;
      for (let i = 0; i < 6; i++) s += nextFloat(holder);
      return (s - 3) * 1.4142135623730951;
    },
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat(holder) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  return rng;
}

const SEED_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Human-friendly seed code, e.g. "K7Q2-9F4M". */
export function makeSeedCode(source = Math.random) {
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += SEED_CHARS[Math.floor(source() * SEED_CHARS.length)];
  }
  return out;
}

export function normalizeSeedCode(text) {
  const cleaned = String(text ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
  return cleaned || 'DEFAULT';
}
