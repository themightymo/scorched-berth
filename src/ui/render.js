// Canvas renderer. Reads simulation state; never writes to it.
// The battlefield is drawn into a 700×280 pixel buffer (half the world
// resolution) and scaled up with nearest-neighbour sampling for a crisp,
// low-resolution look. Labels and the trajectory preview are drawn on top at
// full display resolution so they stay legible.

import { W, H, BEDROCK } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { getWeapon } from '../core/weapons.js';
import { getCommander } from '../ai/commanders.js';

const LW = W / 2, LH = H / 2;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = makeCanvas(LW, LH);
  const b = buf.getContext('2d');
  const terrainLayer = makeCanvas(LW, LH);
  const tctx = terrainLayer.getContext('2d');
  let skyKey = '', skyLayer = null, terrainKey = '';

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(320, Math.round(rect.width * dpr)), h = Math.max(128, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function buildSky(theme, night, seed) {
    const key = `${theme.id}|${night}|${seed}`;
    if (key === skyKey) return;
    skyKey = key;
    skyLayer = makeCanvas(LW, LH);
    const s = skyLayer.getContext('2d');
    const f = theme.field;
    const bands = (night ? f.sky.map((c) => mix(rgb(c), [4, 6, 14], 0.72)) : f.sky.map(rgb));
    const img = s.createImageData(LW, LH);
    const horizon = LH * 0.82;
    for (let y = 0; y < LH; y++) {
      const t = Math.min(0.9999, y / horizon) * (bands.length - 1);
      const i = Math.floor(t), frac = t - i;
      for (let x = 0; x < LW; x++) {
        const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const c = frac > threshold ? bands[Math.min(i + 1, bands.length - 1)] : bands[i];
        const o = (y * LW + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    const rng = createRng(`${seed}|sky`);
    if (night) for (let k = 0; k < 140; k++) {
      const x = rng.int(0, LW - 1), y = rng.int(0, Math.floor(LH * 0.55)), o = (y * LW + x) * 4, v = rng.int(150, 255);
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = Math.min(255, v + 20);
    }
    s.putImageData(img, 0, 0);
    // Sun or moon
    const sx = rng.int(LW * 0.55, LW * 0.85), sy = rng.int(28, 60);
    s.fillStyle = night ? '#d9dcef' : f.sun;
    s.beginPath(); s.arc(sx, sy, night ? 9 : 16, 0, Math.PI * 2); s.fill();
    if (night) { s.fillStyle = css(bands[0]); s.beginPath(); s.arc(sx + 4, sy - 2, 8, 0, Math.PI * 2); s.fill(); }
    // Two layers of distant hills
    f.hills.forEach((hex, layer) => {
      const col = night ? mix(rgb(hex), [0, 0, 0], 0.5) : rgb(hex);
      s.fillStyle = css(col);
      const base = LH * (0.55 + layer * 0.08), amp = 26 - layer * 6;
      const pts = Array.from({ length: 12 }, () => rng.range(-1, 1));
      s.beginPath(); s.moveTo(0, LH);
      for (let x = 0; x <= LW; x += 2) {
        const u = (x / LW) * (pts.length - 2), i = Math.floor(u), t = u - i;
        const v = pts[i] + (pts[i + 1] - pts[i]) * (t * t * (3 - 2 * t));
        s.lineTo(x, Math.round(base - v * amp - Math.abs(Math.sin(x * 0.05 + layer)) * 3));
      }
      s.lineTo(LW, LH); s.fill();
    });
  }

  function buildTerrain(state, theme, night) {
    const t = state.terrain;
    let sum = 0;
    for (let x = 0; x <= W; x += 2) sum += Math.round(t[x] * 4);
    const key = `${theme.id}|${night}|${sum}|${t.length}|${state.seed}`;
    if (key === terrainKey) return;
    terrainKey = key;
    const f = theme.field;
    const dim = night ? 0.55 : 0;
    const g1 = mix(rgb(f.ground), [0, 0, 0], dim), g2 = mix(rgb(f.ground2), [0, 0, 0], dim), crust = mix(rgb(f.crust), [0, 0, 0], dim * 0.6), bed = mix(rgb(f.bedrock), [0, 0, 0], dim);
    const img = tctx.createImageData(LW, LH);
    const bedrockY = BEDROCK / 2;
    for (let x = 0; x < LW; x++) {
      const top = Math.round(Math.min(t[x * 2], t[x * 2 + 1]) / 2);
      const wobble = Math.round(Math.sin(x * 0.11) * 2 + Math.sin(x * 0.037) * 3);
      for (let y = Math.max(0, top); y < LH; y++) {
        let c;
        const depth = y - top;
        if (depth < 2) c = crust;
        else if (y >= bedrockY - 2) c = bed;
        else {
          const band = (y + wobble) / 9;
          const frac = band - Math.floor(band);
          const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
          const odd = Math.floor(band) % 2 === 1;
          c = (frac < 0.18 && frac * 5.5 < threshold) ? (odd ? g1 : g2) : (odd ? g2 : g1);
        }
        const o = (y * LW + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
  }

  function pixelLine(x0, y0, x1, y1, color) {
    b.fillStyle = color;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 64; i++) {
      b.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function drawTank(t, angle, isActive, theme, time, reduced) {
    const lx = Math.round(t.x / 2), ly = Math.round(t.y / 2);
    if (!t.alive) {
      b.fillStyle = '#1b1b1b';
      b.fillRect(lx - 8, ly - 3, 16, 3);
      b.fillStyle = '#3a3a3a';
      b.fillRect(lx - 5, ly - 5, 7, 2);
      if (!reduced && Math.floor(time * 3 + t.x) % 3 === 0) { b.fillStyle = '#555'; b.fillRect(lx - 1, ly - 9 - Math.floor((time * 6) % 4), 2, 2); }
      return;
    }
    const col = t.color;
    const dark = css(mix(rgb(col), [0, 0, 0], 0.55));
    b.fillStyle = '#000000';
    b.fillRect(lx - 10, ly - 8, 20, 9); // outline for contrast on any sky
    b.fillStyle = dark;
    b.fillRect(lx - 9, ly - 2, 18, 2); // treads
    b.fillStyle = col;
    b.fillRect(lx - 8, ly - 5, 16, 3); // hull
    b.fillRect(lx - 4, ly - 7, 8, 2); // turret
    b.fillStyle = dark;
    for (let k = -6; k <= 6; k += 4) b.fillRect(lx + k, ly - 1, 1, 1);
    const rad = (angle * Math.PI) / 180;
    pixelLine(lx, ly - 7, lx + Math.cos(rad) * 12, ly - 7 - Math.sin(rad) * 12, col);
    if (isActive && (reduced || Math.floor(time * 2) % 2 === 0)) {
      b.fillStyle = theme.ui.focus;
      b.fillRect(lx - 11, ly + 1, 22, 1);
    }
  }

  function drawFires(state, theme, time, reduced) {
    const [c1, c2, c3] = theme.field.fire;
    for (const f of state.fires) {
      for (let x = Math.floor(f.x0 / 2); x <= Math.ceil(f.x1 / 2); x++) {
        const top = Math.round(state.terrain[Math.min(W, x * 2)] / 2);
        const flick = reduced ? ((x * 7) % 5) : Math.floor(((Math.sin(x * 1.7 + time * 9) + 1) * 2.5));
        const h = 2 + flick;
        b.fillStyle = c3; b.fillRect(x, top - h, 1, h);
        b.fillStyle = c2; b.fillRect(x, top - Math.ceil(h * 0.6), 1, Math.ceil(h * 0.6));
        if (h > 3) { b.fillStyle = c1; b.fillRect(x, top - 2, 1, 1); }
      }
    }
    for (const v of state.vents) {
      for (let x = Math.floor(v.x0 / 2); x <= Math.ceil(v.x1 / 2); x++) {
        const top = Math.round(state.terrain[Math.min(W, x * 2)] / 2);
        b.fillStyle = theme.field.vent;
        b.fillRect(x, top, 1, 2);
        if (!reduced && ((x + Math.floor(time * 4)) % 6 === 0)) { b.fillStyle = 'rgba(220,255,250,0.55)'; b.fillRect(x, top - 3 - Math.floor((time * 5 + x) % 4), 1, 1); }
      }
    }
  }

  /**
   * view = { state, theme, settings, reduced, time, effects, preview, aim, labels, diag, hidePreview }
   */
  function draw(view) {
    resize();
    const { state, theme, reduced, effects } = view;
    const night = !!state.config.night;
    buildSky(theme, night, state.seed);
    buildTerrain(state, theme, night);
    b.imageSmoothingEnabled = false;
    b.drawImage(skyLayer, 0, 0);
    b.drawImage(terrainLayer, 0, 0);
    drawFires(state, theme, view.time, reduced);

    // Trails, projectiles, particles (low-res)
    for (const p of effects.trail) {
      b.fillStyle = css(rgb(p.color), Math.max(0, p.life));
      b.fillRect(Math.round(p.x / 2), Math.round(p.y / 2), 1, 1);
    }
    for (const p of state.projectiles) {
      const w = getWeapon(p.weapon);
      b.fillStyle = '#000';
      b.fillRect(Math.round(p.x / 2) - 1, Math.round(p.y / 2) - 1, 3, 3);
      b.fillStyle = w.presentation.color;
      b.fillRect(Math.round(p.x / 2), Math.round(p.y / 2), p.kind === 'bomblet' ? 1 : 2, p.kind === 'bomblet' ? 1 : 2);
    }
    state.tanks.forEach((t, i) => {
      const angle = view.aim && i === view.aim.actor ? view.aim.angle : t.angle;
      drawTank(t, angle, i === state.actor && state.phase === 'aiming', theme, view.time, reduced);
    });
    for (const r of effects.rings) {
      const k = 1 - r.life / r.max;
      b.fillStyle = css(rgb(r.color), Math.max(0, r.life / r.max) * 0.9);
      b.beginPath(); b.arc(r.x / 2, r.y / 2, Math.max(1, (r.radius / 2) * (0.35 + 0.65 * k)), 0, Math.PI * 2); b.fill();
    }
    for (const p of effects.particles) {
      b.fillStyle = css(rgb(p.color), Math.max(0, Math.min(1, p.life / p.max)));
      b.fillRect(Math.round(p.x / 2), Math.round(p.y / 2), p.size, p.size);
    }

    // Blit to display
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / W, sy = canvas.height / H;
    const shakeX = effects.shake ? (effects.shakeX ?? 0) * sx : 0, shakeY = effects.shake ? (effects.shakeY ?? 0) * sy : 0;
    ctx.drawImage(buf, shakeX, shakeY, canvas.width, canvas.height);
    if (effects.flash > 0) { ctx.fillStyle = `rgba(255,240,200,${effects.flash})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    // Crisp overlay
    const px = (x) => x * sx + shakeX, py = (y) => y * sy + shakeY;
    const unit = Math.max(1, sx);
    if (view.preview && view.preview.length) {
      ctx.fillStyle = theme.field.text;
      ctx.strokeStyle = '#000';
      for (let i = 0; i < view.preview.length; i++) {
        const p = view.preview[i];
        const s = Math.max(2, Math.round(3 * unit));
        ctx.fillStyle = '#000';
        ctx.fillRect(px(p.x) - s / 2 - 1, py(p.y) - s / 2 - 1, s + 2, s + 2);
        ctx.fillStyle = i % 2 ? theme.field.text : theme.ui.focus;
        ctx.fillRect(px(p.x) - s / 2, py(p.y) - s / 2, s, s);
      }
    }
    const fontPx = Math.max(12, Math.round(13 * unit * (view.largeText ? 1.25 : 1)));
    ctx.font = `${fontPx}px 'VT323', 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    state.tanks.forEach((t, i) => {
      const label = view.labels?.[i] ?? t.name;
      const x = px(t.x), y = py(t.y - 26);
      ctx.lineWidth = Math.max(2, unit * 2);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = t.alive ? theme.field.text : '#9a9a9a';
      const text = t.alive ? `${label} ${t.hp}` : `${label} ✕`;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      if (t.alive) {
        const bw = 40 * sx, bh = Math.max(3, 3 * sy);
        ctx.fillStyle = '#000';
        ctx.fillRect(x - bw / 2 - 1, y + 1, bw + 2, bh + 2);
        ctx.fillStyle = t.color;
        ctx.fillRect(x - bw / 2, y + 2, (bw * t.hp) / t.maxHp, bh);
      }
      if (i === state.actor && state.phase !== 'battleOver' && t.alive) {
        ctx.fillStyle = theme.ui.focus;
        ctx.strokeText('▼', x, y - fontPx);
        ctx.fillText('▼', x, y - fontPx);
      }
    });
    for (const f of effects.floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 1.5));
      ctx.strokeStyle = '#000';
      ctx.fillStyle = f.color;
      ctx.strokeText(f.text, px(f.x), py(f.y));
      ctx.fillText(f.text, px(f.x), py(f.y));
    }
    ctx.globalAlpha = 1;
    if (view.diag) drawDiagnostics(ctx, view.diag, px, py, fontPx, theme);
  }

  function drawDiagnostics(c, d, px, py, fontPx, theme) {
    c.save();
    c.textAlign = 'left';
    c.textBaseline = 'top';
    if (d.predicted) {
      const x = px(d.predicted.x), y = py(d.predicted.y);
      c.strokeStyle = theme.ui.danger; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - 8, y - 8); c.lineTo(x + 8, y + 8); c.moveTo(x + 8, y - 8); c.lineTo(x - 8, y + 8); c.stroke();
    }
    const lines = [
      `AI DIAG · ${getCommander(d.commander).name} (${d.difficulty})`,
      `target #${d.target ?? '-'}  weapon ${d.weapon}  score ${d.score}`,
      `intended ${d.intended?.angle}°/${d.intended?.power}  σ ${d.sigma}  robust ${d.robust == null ? '-' : d.robust.toFixed(2)}`,
      `traces ${d.traces}  sims ${d.sims}  ${d.elapsedMs.toFixed(1)}ms / ${d.budgetMs}ms${d.timedOut ? ' CUT' : ''}${d.fallback ? ' FALLBACK' : ''}`,
      ...d.candidates.map((k) => `  ${k.weapon.padEnd(7)} ${String(k.angle).padStart(3)}°/${String(k.power).padStart(3)} → #${k.target ?? '-'} ${k.score}`),
    ];
    const lh = fontPx * 1.05;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillRect(8, 8, fontPx * 22, lh * lines.length + 8);
    c.fillStyle = '#9dff6a';
    lines.forEach((l, i) => c.fillText(l, 12, 12 + i * lh));
    c.restore();
  }

  /** Draw only terrain + markers for the map editor. */
  function drawEditor({ terrain, spawns, vents, theme, cursor, brush, problems }) {
    resize();
    const fake = { terrain, seed: 'EDITOR', config: { night: false }, fires: [], vents, projectiles: [], tanks: [] };
    buildSky(theme, false, 'EDITOR');
    buildTerrain(fake, theme, false);
    b.drawImage(skyLayer, 0, 0);
    b.drawImage(terrainLayer, 0, 0);
    drawFires(fake, theme, 0, true);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
    const sx = canvas.width / W, sy = canvas.height / H;
    const fontPx = Math.max(12, Math.round(13 * sx));
    ctx.font = `${fontPx}px 'VT323', monospace`;
    ctx.textAlign = 'center';
    spawns.forEach((x, i) => {
      const y = terrain[Math.round(x)] * sy;
      ctx.fillStyle = '#000'; ctx.fillRect(x * sx - 23 * sx, y - 10 * sy, 46 * sx, 10 * sy);
      ctx.fillStyle = theme.ui.ok; ctx.fillRect(x * sx - 22 * sx, y - 9 * sy, 44 * sx, 8 * sy);
      ctx.fillStyle = theme.field.text; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(`SPAWN ${i + 1}`, x * sx, y - 14 * sy); ctx.fillText(`SPAWN ${i + 1}`, x * sx, y - 14 * sy);
    });
    if (cursor) {
      ctx.strokeStyle = theme.ui.focus; ctx.lineWidth = 2;
      ctx.strokeRect((cursor.x - brush) * sx, 0, brush * 2 * sx, canvas.height);
      ctx.beginPath(); ctx.moveTo(cursor.x * sx, 0); ctx.lineTo(cursor.x * sx, canvas.height); ctx.stroke();
    }
    void problems;
  }

  return { draw, drawEditor, resize, invalidate() { terrainKey = ''; skyKey = ''; } };
}
