// Tank sprites. Each commander's tank carries a signature piece that says who
// is inside: Lincoln's stovepipe hat, Napoleon's bicorne, Elizabeth's crown and
// ruff, Caesar's laurel wreath and eagle standard, Genghis Khan's fur-trimmed
// helmet and horsetail standard, Attila's wolf helm and spiked ram. Human
// players drive the plain tank.
//
// Sprites are drawn in buffer pixels (half world resolution) through a tiny
// surface `g = { rect(x, y, w, h, color), line(x0, y0, x1, y1, color) }`, so
// the battlefield renderer, dossier portraits, and tests share one source.
// (lx, ly) is the centre of the tank's base; negative y is up.

const K = '#000000';
const HAT = '#30303c', HAT_HI = '#5a5a70';
const GOLD = '#ffd34d', GOLD_DK = '#c99a2a';
const STEEL = '#b4bcc8';
const BONE = '#efe3c2';

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const darken = (hex, t) => { const c = rgb(hex).map((v) => Math.round(v * (1 - t))); return `rgb(${c[0]},${c[1]},${c[2]})`; };

/** How far above the base (buffer px) each sprite reaches, for placing labels. */
export const SPRITE_TOP = { lincoln: 19, napoleon: 14, elizabeth: 16, caesar: 24, genghis: 24, attila: 12 };
export const spriteTop = (commander) => SPRITE_TOP[commander] ?? 8;

/** What each tank's signature piece is, for dossiers and screen readers. */
export const SPRITE_NOTES = {
  lincoln: 'Turret topped by a tall stovepipe hat.',
  napoleon: 'Turret wears a bicorne hat with a tricolour cockade.',
  elizabeth: 'Jewelled crown on a lace ruff, pearls along the hull.',
  caesar: 'Golden helm in a laurel wreath, with an eagle standard at the rear.',
  genghis: 'Fur-trimmed spiked helmet and a horsetail standard.',
  attila: 'Wolf-pelt helm, bone spikes, and an iron ram on the prow.',
};

function baseTank(g, lx, ly, col, angle) {
  const dark = darken(col, 0.55);
  g.rect(lx - 10, ly - 8, 20, 9, K); // outline for contrast on any sky
  g.rect(lx - 9, ly - 2, 18, 2, dark); // treads
  g.rect(lx - 8, ly - 5, 16, 3, col); // hull
  g.rect(lx - 4, ly - 7, 8, 2, col); // turret
  for (let k = -6; k <= 6; k += 4) g.rect(lx + k, ly - 1, 1, 1, dark);
  const rad = (angle * Math.PI) / 180;
  g.line(lx, ly - 7, lx + Math.cos(rad) * 12, ly - 7 - Math.sin(rad) * 12, col);
}

const DRAW = {
  lincoln(g, lx, ly, col) {
    g.rect(lx - 6, ly - 9, 13, 2, K);
    g.rect(lx - 5, ly - 8, 11, 1, HAT); // brim
    g.rect(lx - 4, ly - 19, 9, 11, K);
    g.rect(lx - 3, ly - 18, 7, 10, HAT); // stovepipe crown
    g.rect(lx - 3, ly - 11, 7, 2, col); // hat band in the commander's colour
    g.rect(lx - 2, ly - 17, 1, 5, HAT_HI); // sheen
  },
  napoleon(g, lx, ly) {
    g.rect(lx - 8, ly - 11, 17, 4, K);
    g.rect(lx - 5, ly - 13, 11, 2, K);
    g.rect(lx - 2, ly - 14, 5, 1, K);
    g.rect(lx - 7, ly - 10, 15, 2, HAT);
    g.rect(lx - 7, ly - 11, 1, 1, HAT); g.rect(lx + 7, ly - 11, 1, 1, HAT); // upturned points
    g.rect(lx - 5, ly - 12, 11, 2, HAT);
    g.rect(lx - 2, ly - 13, 5, 1, HAT);
    g.rect(lx - 7, ly - 8, 15, 1, GOLD_DK); // braid
    g.rect(lx - 1, ly - 11, 1, 1, '#3a6bff'); g.rect(lx, ly - 11, 1, 1, '#ffffff'); g.rect(lx + 1, ly - 11, 1, 1, '#ff4040'); // cockade
  },
  elizabeth(g, lx, ly) {
    for (let i = -6; i <= 6; i += 3) g.rect(lx + i, ly - 4, 1, 1, '#fff6e0'); // pearls
    g.rect(lx - 6, ly - 9, 13, 2, K);
    for (let i = -5; i <= 5; i++) g.rect(lx + i, ly - 8, 1, 1, i % 2 ? '#ffffff' : '#c8c8dc'); // lace ruff
    g.rect(lx - 5, ly - 13, 11, 4, K);
    g.rect(lx - 2, ly - 16, 5, 3, K);
    g.rect(lx - 3, ly - 12, 7, 1, '#7a2a9a'); // velvet cap
    g.rect(lx - 4, ly - 10, 9, 1, GOLD); // band
    g.rect(lx - 4, ly - 12, 1, 2, GOLD); g.rect(lx + 4, ly - 12, 1, 2, GOLD); g.rect(lx, ly - 12, 1, 2, GOLD); // points
    g.rect(lx, ly - 15, 1, 3, GOLD); g.rect(lx - 1, ly - 14, 3, 1, GOLD); // cross
    g.rect(lx - 2, ly - 10, 1, 1, '#ff3b5c'); g.rect(lx + 2, ly - 10, 1, 1, '#3bb0ff'); // jewels
  },
  caesar(g, lx, ly, col, f) {
    const rx = lx - f * 9;
    // Eagle standard (aquila) with a red vexillum, planted at the rear.
    g.rect(rx - 1, ly - 21, 3, 15, K);
    g.rect(rx - 3, ly - 19, 7, 8, K);
    g.rect(rx - 3, ly - 24, 7, 3, K);
    g.rect(rx, ly - 21, 1, 14, '#8a6a3a');
    g.rect(rx - 2, ly - 18, 5, 1, GOLD);
    g.rect(rx - 2, ly - 17, 5, 4, '#c8302a');
    g.rect(rx - 2, ly - 13, 5, 1, GOLD);
    g.rect(rx - 2, ly - 22, 5, 1, GOLD); g.rect(rx, ly - 23, 1, 1, GOLD); // eagle
    // Golden helm ringed with laurel.
    g.rect(lx - 6, ly - 13, 13, 5, K);
    g.rect(lx - 3, ly - 10, 7, 3, GOLD);
    g.rect(lx - 2, ly - 11, 5, 1, GOLD);
    const leaf = ['#3a8a2e', '#5fbf4a'];
    [[-5, -8], [-5, -9], [-5, -10], [-4, -11], [-3, -12], [-2, -12]].forEach(([dx, dy], i) => {
      g.rect(lx + dx, ly + dy, 1, 1, leaf[i % 2]);
      g.rect(lx - dx, ly + dy, 1, 1, leaf[(i + 1) % 2]);
    });
    void col;
  },
  genghis(g, lx, ly, col, f) {
    const rx = lx - f * 9;
    // Horsetail standard (tug): trident tip over a pale tassel.
    g.rect(rx - 1, ly - 21, 3, 16, K);
    g.rect(rx - 2, ly - 24, 5, 9, K);
    g.rect(rx, ly - 20, 1, 14, '#6b4a2b');
    g.rect(rx - 1, ly - 22, 3, 1, STEEL); g.rect(rx, ly - 23, 1, 1, STEEL);
    g.rect(rx - 1, ly - 21, 3, 4, '#e8e2d0');
    g.rect(rx - 1, ly - 17, 1, 1, '#e8e2d0'); g.rect(rx + 1, ly - 17, 1, 1, '#e8e2d0');
    // Spiked helmet with a fur brim.
    g.rect(lx - 6, ly - 10, 13, 3, K);
    g.rect(lx - 4, ly - 12, 9, 2, K);
    g.rect(lx - 2, ly - 14, 5, 2, K);
    g.rect(lx - 1, ly - 18, 3, 4, K);
    g.rect(lx - 3, ly - 11, 7, 2, STEEL);
    g.rect(lx - 2, ly - 12, 5, 1, STEEL);
    g.rect(lx - 1, ly - 13, 3, 1, STEEL);
    g.rect(lx, ly - 16, 1, 3, STEEL);
    g.rect(lx, ly - 17, 1, 1, '#d43a2a'); // plume
    for (let i = -5; i <= 5; i++) g.rect(lx + i, ly - 9, 1, 2, i % 2 ? '#8a5a32' : '#b07a48'); // fur
    void col;
  },
  attila(g, lx, ly, col, f) {
    // Iron ram on the prow.
    const fx = lx + f * 10;
    g.rect(f > 0 ? fx : fx - 3, ly - 6, 4, 5, K);
    g.rect(fx, ly - 5, 1, 3, STEEL);
    g.rect(fx + f, ly - 4, 1, 2, STEEL);
    g.rect(fx + f * 2, ly - 4, 1, 1, STEEL);
    g.rect(lx - 8, ly - 4, 16, 1, darken(col, 0.45)); // war stripe
    for (const x of [-8, -6, 5, 7]) g.rect(lx + x, ly - 6, 1, 1, BONE); // bone spikes
    g.rect(lx - 8, ly - 7, 1, 1, BONE); g.rect(lx + 7, ly - 7, 1, 1, BONE);
    // Wolf-pelt helm with ears and glowing eyes.
    g.rect(lx - 5, ly - 12, 11, 5, K);
    g.rect(lx - 4, ly - 10, 9, 3, '#8d8d96');
    g.rect(lx - 4, ly - 11, 2, 1, '#8d8d96'); g.rect(lx + 3, ly - 11, 2, 1, '#8d8d96');
    g.rect(lx - 2, ly - 9, 1, 1, '#ffdf3a'); g.rect(lx + 2, ly - 9, 1, 1, '#ffdf3a');
    g.rect(lx - 1, ly - 8, 3, 1, '#5d5d66'); // snout
  },
};

// Small keepsakes left beside a destroyed commander's wreck.
const RELIC = {
  lincoln(g, lx, ly) { g.rect(lx + 6, ly - 5, 7, 5, K); g.rect(lx + 7, ly - 4, 5, 3, HAT); g.rect(lx + 12, ly - 6, 1, 6, HAT); },
  napoleon(g, lx, ly) { g.rect(lx + 5, ly - 4, 9, 4, K); g.rect(lx + 6, ly - 3, 7, 2, HAT); g.rect(lx + 9, ly - 3, 1, 1, '#ff4040'); },
  elizabeth(g, lx, ly) { g.rect(lx + 6, ly - 4, 7, 4, K); g.rect(lx + 7, ly - 2, 5, 1, GOLD); g.rect(lx + 7, ly - 3, 1, 1, GOLD); g.rect(lx + 9, ly - 3, 1, 1, GOLD); g.rect(lx + 11, ly - 3, 1, 1, GOLD); },
  caesar(g, lx, ly) { g.rect(lx + 4, ly - 3, 12, 3, K); g.rect(lx + 5, ly - 2, 9, 1, '#8a6a3a'); g.rect(lx + 13, ly - 2, 2, 1, GOLD); },
  genghis(g, lx, ly) { g.rect(lx + 4, ly - 3, 12, 3, K); g.rect(lx + 5, ly - 2, 9, 1, '#6b4a2b'); g.rect(lx + 13, ly - 2, 2, 1, '#e8e2d0'); },
  attila(g, lx, ly) { g.rect(lx + 6, ly - 4, 7, 4, K); g.rect(lx + 7, ly - 3, 5, 2, '#8d8d96'); g.rect(lx + 7, ly - 4, 1, 1, '#8d8d96'); g.rect(lx + 11, ly - 4, 1, 1, '#8d8d96'); },
};

/** Draw a living tank. `commander` may be null for a human player's plain tank. */
export function drawTankSprite(g, { lx, ly, color, angle, commander }) {
  const facing = angle <= 90 ? 1 : -1;
  baseTank(g, lx, ly, color, angle);
  DRAW[commander]?.(g, lx, ly, color, facing);
}

/** Draw a wreck, with the commander's keepsake lying beside it. */
export function drawWreck(g, { lx, ly, commander }) {
  g.rect(lx - 8, ly - 3, 16, 3, '#1b1b1b');
  g.rect(lx - 5, ly - 5, 7, 2, '#3a3a3a');
  RELIC[commander]?.(g, lx, ly);
}

/**
 * A crisp, scaled-up portrait of a tank as a data URL (browser only). Cached
 * per commander and colour.
 */
const portraits = new Map();
let portraitPalette = { id: '', snap: (c) => c };
/** Snap portrait colours to a theme's palette (`snap` null for full colour). */
export function setPortraitPalette(id, snap) {
  portraitPalette = { id: snap ? id : '', snap: snap ?? ((c) => c) };
}
export function tankPortrait(commander, color, scale = 4) {
  const key = `${commander}|${color}|${scale}|${portraitPalette.id}`;
  const { snap } = portraitPalette;
  if (portraits.has(key)) return portraits.get(key);
  if (typeof document === 'undefined') return '';
  const w = 34, h = 28;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  const rect = (x, y, rw, rh, fill) => { ctx.fillStyle = snap(fill); ctx.fillRect(Math.round(x) * scale, Math.round(y) * scale, rw * scale, rh * scale); };
  const line = (x0, y0, x1, y1, fill) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) rect(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1, 1, fill);
  };
  drawTankSprite({ rect, line }, { lx: 17, ly: 26, color, angle: 40, commander });
  const url = c.toDataURL('image/png');
  portraits.set(key, url);
  return url;
}
