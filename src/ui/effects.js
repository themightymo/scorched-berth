// Presentation-only effects driven by engine events. Uses Math.random freely
// because nothing here feeds back into the simulation.

import { getWeapon } from '../core/weapons.js';
import { getDefense } from '../core/defenses.js';

const BUDGET = { full: 700, reduced: 220, off: 0 };

export function createEffects() {
  const fx = {
    particles: [], rings: [], floaters: [], trail: [],
    shake: 0, shakeX: 0, shakeY: 0, flash: 0, cursor: 0,
  };

  fx.reset = (state) => {
    fx.particles.length = 0; fx.rings.length = 0; fx.floaters.length = 0; fx.trail.length = 0;
    fx.shake = 0; fx.flash = 0;
    fx.cursor = state ? state.events.length : 0;
  };

  function burst(x, y, count, colors, speed, opts, budget) {
    const room = Math.max(0, budget - fx.particles.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      fx.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.5, life: 0.5 + Math.random() * 0.8, max: 1.3, size: Math.random() < 0.3 ? 2 : 1, color: colors[i % colors.length], gravity: opts.gravity ?? 300 });
    }
  }

  /** Process new engine events. `hooks` receives sounds and log lines. */
  fx.consume = (state, settings, reduced, hooks = {}) => {
    const budget = BUDGET[settings.particles] ?? BUDGET.full;
    const flashes = settings.flashes && !reduced;
    const shake = settings.shake && !reduced;
    for (; fx.cursor < state.events.length; fx.cursor++) {
      const e = state.events[fx.cursor];
      hooks.event?.(e, state);
      switch (e.t) {
        case 'fire': {
          const t = state.tanks[e.by];
          const rad = (e.angle * Math.PI) / 180;
          burst(t.x + Math.cos(rad) * 26, t.y - 14 - Math.sin(rad) * 26, 10, ['#fff3c4', '#ffb347'], 90, { gravity: 0 }, budget);
          if (flashes) fx.flash = Math.max(fx.flash, 0.06);
          break;
        }
        case 'explosion': {
          const w = getWeapon(e.weapon);
          const big = e.radius ?? w.crater.radius;
          if (w.crater.shape === 'mound') {
            burst(e.x, e.y - 10, Math.round(big * 0.8), ['#b9824a', '#6b4a2b', '#d9a86b'], 140, {}, budget);
            if (shake) fx.shake = Math.max(fx.shake, 0.15);
            break;
          }
          fx.rings.push({ x: e.x, y: e.y, radius: big * 1.1, life: 0.45, max: 0.45, color: w.presentation.color });
          burst(e.x, e.y, Math.round(big * 0.9), [w.presentation.color, '#ffe8a1', '#6b4a2b', '#3a2a1a'], 160 + big * 1.5, {}, budget);
          if (shake) fx.shake = Math.max(fx.shake, Math.min(0.5, big / 160));
          if (flashes && big > 60) fx.flash = Math.max(fx.flash, Math.min(0.35, big / 400));
          break;
        }
        case 'split':
          burst(e.x, e.y, 14, ['#9fe8ff', '#ffffff'], 70, { gravity: 0 }, budget);
          break;
        case 'burrow':
          burst(e.x, e.y, 18 * (e.forks ?? 1), ['#6b4a2b', '#b9824a'], 110, {}, budget);
          break;
        case 'hop':
          burst(e.x, e.y, 10, ['#8dff9a', '#ffffff'], 90, {}, budget);
          break;
        case 'scatter':
          burst(e.x, e.y, 30, getWeapon('funky').presentation.palette, 160, {}, budget);
          if (flashes) fx.flash = Math.max(fx.flash, 0.08);
          break;
        case 'roll':
          burst(e.x, e.y, 8, ['#c0c8d4', '#6b4a2b'], 60, {}, budget);
          break;
        case 'beamEnd':
          burst(e.x, e.y, 8, ['#ff4f6d', '#ffffff'], 50, { gravity: 0 }, budget);
          break;
        case 'buried': {
          const t = state.tanks[e.to];
          fx.floaters.push({ x: t.x, y: t.y - 44, text: 'BURIED', color: '#d9a86b', life: 1.6, max: 1.6 });
          break;
        }
        case 'ignite':
          for (let x = e.x0; x < e.x1; x += 12) burst(x, state.terrain[Math.round(x)] - 2, 2, ['#ff9a3d', '#ffef8a'], 60, {}, budget);
          break;
        case 'damage': {
          const t = state.tanks[e.to];
          const color = e.cause === 'fire' ? '#ffb347' : e.cause === 'fall' ? '#d9c7a0' : e.cause === 'vent' ? '#7fe0d8' : '#ff8a7a';
          fx.floaters.push({ x: t.x + (Math.random() * 16 - 8), y: t.y - 40, text: `-${e.amount}${e.cause === 'fall' ? ' FALL' : e.cause === 'fire' ? ' BURN' : ''}`, color, life: 1.4, max: 1.4 });
          break;
        }
        case 'eliminated': {
          const t = state.tanks[e.to];
          burst(t.x, t.y - 6, 40, ['#ffffff', '#ffcf6b', '#ff6b3d', '#333333'], 220, {}, budget);
          if (shake) fx.shake = Math.max(fx.shake, 0.4);
          break;
        }
        case 'defense': {
          const t = state.tanks[e.by];
          const color = getDefense(e.item)?.presentation.color ?? '#ffffff';
          if (e.item === 'relocate') burst(e.from, t.y - 8, 24, [color, '#ffffff'], 120, { gravity: 0 }, budget);
          if (e.item === 'berm') {
            for (const dir of [-1, 1]) burst(t.x + dir * 38, t.y - 10, 12, ['#b9824a', '#6b4a2b'], 90, {}, budget);
          }
          fx.rings.push({ x: t.x, y: t.y - 10, radius: 46, life: 0.5, max: 0.5, color });
          burst(t.x, t.y - 10, 16, [color, '#ffffff'], 80, { gravity: 0 }, budget);
          if (e.amount && (e.item === 'repair' || e.item === 'plating')) fx.floaters.push({ x: t.x, y: t.y - 40, text: `+${e.amount}`, color: '#9dff6a', life: 1.4, max: 1.4 });
          break;
        }
        case 'shieldHit': {
          const t = state.tanks[e.to];
          fx.rings.push({ x: t.x, y: t.y - 10, radius: 40, life: 0.35, max: 0.35, color: '#7fd6ff' });
          fx.floaters.push({ x: t.x + (Math.random() * 16 - 8), y: t.y - 52, text: `SHIELD ${e.absorbed}`, color: '#7fd6ff', life: 1.2, max: 1.2 });
          break;
        }
        case 'deflect':
          fx.rings.push({ x: e.x, y: e.y, radius: 24, life: 0.4, max: 0.4, color: '#c9a2ff' });
          burst(e.x, e.y, 14, ['#c9a2ff', '#ffffff'], 120, { gravity: 0 }, budget);
          break;
        case 'intercept':
          fx.rings.push({ x: e.x, y: e.y, radius: 30, life: 0.35, max: 0.35, color: '#ff9a7a' });
          burst(e.x, e.y, 22, ['#ff9a7a', '#ffe8a1', '#555555'], 140, {}, budget);
          if (flashes) fx.flash = Math.max(fx.flash, 0.05);
          break;
        case 'fall': {
          const t = state.tanks[e.to];
          burst(t.x, t.y, 10, ['#b9824a', '#6b4a2b'], 60, {}, budget);
          break;
        }
        default: break;
      }
    }
  };

  /** Advance purely visual effects. */
  fx.update = (dt, state, reduced) => {
    for (const p of fx.particles) { p.life -= dt; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    fx.particles = fx.particles.filter((p) => p.life > 0 && p.y < 600);
    for (const r of fx.rings) r.life -= dt;
    fx.rings = fx.rings.filter((r) => r.life > 0);
    for (const f of fx.floaters) { f.life -= dt; f.y -= (reduced ? 0 : 22) * dt; }
    fx.floaters = fx.floaters.filter((f) => f.life > 0).slice(-14);
    for (const t of fx.trail) t.life -= dt * 0.8;
    fx.trail = fx.trail.filter((t) => t.life > 0);
    if (state) for (const p of state.projectiles) {
      if (p.kind === 'plasma') continue;
      const w = getWeapon(p.weapon);
      if (w.presentation.trail === 'dots' && fx.trail.length && Math.random() < 0.5) continue;
      fx.trail.push({ x: p.x, y: p.y, life: 0.9, color: w.presentation.color });
    }
    if (fx.trail.length > 500) fx.trail.splice(0, fx.trail.length - 500);
    fx.shake = Math.max(0, fx.shake - dt);
    fx.shakeX = fx.shake ? (Math.random() * 2 - 1) * fx.shake * 18 : 0;
    fx.shakeY = fx.shake ? (Math.random() * 2 - 1) * fx.shake * 12 : 0;
    fx.flash = Math.max(0, fx.flash - dt * 1.6);
  };

  return fx;
}
