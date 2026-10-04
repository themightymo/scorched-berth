// Engine-independent math helpers. Browsers may differ in the last bit of
// Math.sin/Math.cos, so simulation code uses these series-based versions to
// keep seeded battles and replays identical everywhere.

export const PI = 3.141592653589793;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sinRad(x) {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n <= 11; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

/** Deterministic sine of an angle in degrees. */
export function dsin(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  if (d > 180) d -= 360;
  // Fold into [-90, 90] for faster series convergence.
  if (d > 90) d = 180 - d;
  else if (d < -90) d = -180 - d;
  return sinRad((d * PI) / 180);
}

export const dcos = (deg) => dsin(deg + 90);

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Small stable hash of any JSON-serialisable value (for replay verification). */
export function hashValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
