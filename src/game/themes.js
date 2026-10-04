// Interface and battlefield palettes, plus WCAG contrast checks so every
// theme (and every tank colour a player can pick) stays readable.

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ui: CSS tokens. field: battlefield palette used by the renderer.
export const THEMES = {
  console: {
    id: 'console', name: 'Command Console', description: 'Dark navy console with amber and cyan accents.',
    ui: { bg: '#07090f', panel: '#0e1424', panel2: '#151e33', line: '#34466e', text: '#dfe7f2', muted: '#9aa8c0', accent: '#5fe0ee', warn: '#ffc857', danger: '#ff7b6b', ok: '#86e88a', focus: '#ffe066', ink: '#07090f' },
    field: { sky: ['#140f2e', '#2a1c4a', '#54305e', '#8e4a5c', '#c87458'], sun: '#ffd27a', hills: ['#3a2a4e', '#2d2240'], ground: '#6b4a2b', ground2: '#4d3420', crust: '#b9824a', bedrock: '#2a1d14', fire: ['#ffef8a', '#ff9a3d', '#e2492d'], vent: '#4fd1c5', text: '#fff6e0', shadow: '#000000' },
  },
  contrast: {
    id: 'contrast', name: 'High Contrast', description: 'Black and white interface with bold yellow focus; flat battlefield colours.',
    ui: { bg: '#000000', panel: '#000000', panel2: '#121212', line: '#ffffff', text: '#ffffff', muted: '#e0e0e0', accent: '#00e5ff', warn: '#ffe600', danger: '#ff6b6b', ok: '#5dff6a', focus: '#ffe600', ink: '#000000' },
    field: { sky: ['#000000', '#000000', '#0b0b1a', '#141428', '#1e1e3a'], sun: '#ffffff', hills: ['#1a1a1a', '#111111'], ground: '#7a7a7a', ground2: '#5a5a5a', crust: '#ffffff', bedrock: '#333333', fire: ['#ffffff', '#ffe600', '#ff6b00'], vent: '#00e5ff', text: '#ffffff', shadow: '#000000' },
  },
  signal: {
    id: 'signal', name: 'Signal (colour-blind safe)', description: 'Blue/orange palette that avoids red–green distinctions.',
    ui: { bg: '#0a0c10', panel: '#121722', panel2: '#1a2130', line: '#46557a', text: '#eef2f8', muted: '#a9b4c8', accent: '#56b4e9', warn: '#e69f00', danger: '#f0a35e', ok: '#56b4e9', focus: '#f0e442', ink: '#0a0c10' },
    field: { sky: ['#0b1630', '#14284d', '#244273', '#3d6194', '#6f8fb8'], sun: '#f0e442', hills: ['#1d2c47', '#16233a'], ground: '#5b5048', ground2: '#3f3731', crust: '#c8b49a', bedrock: '#1f1b18', fire: ['#f0e442', '#e69f00', '#d55e00'], vent: '#56b4e9', text: '#ffffff', shadow: '#000000' },
  },
};
export const THEME_IDS = Object.keys(THEMES);

/** Tank colours a player may choose; each must read against every sky. */
export const TANK_COLORS = [
  { id: 'lime', name: 'Lime', hex: '#9dff6a' },
  { id: 'cyan', name: 'Cyan', hex: '#5fe0ee' },
  { id: 'amber', name: 'Amber', hex: '#ffc857' },
  { id: 'rose', name: 'Rose', hex: '#ff8fb1' },
  { id: 'violet', name: 'Violet', hex: '#c9a2ff' },
  { id: 'white', name: 'White', hex: '#f4f4f4' },
  { id: 'sky', name: 'Sky', hex: '#8fb8ff' },
  { id: 'orange', name: 'Orange', hex: '#ffa25c' },
];

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export function validateTheme(theme) {
  const problems = [];
  const { ui, field } = theme;
  for (const k of ['text', 'muted']) for (const bg of ['bg', 'panel', 'panel2']) {
    if (contrast(ui[k], ui[bg]) < MIN_TEXT_CONTRAST) problems.push(`${theme.id}: ${k} on ${bg} below ${MIN_TEXT_CONTRAST}:1`);
  }
  for (const k of ['accent', 'warn', 'danger', 'ok', 'focus']) {
    if (contrast(ui[k], ui.bg) < MIN_UI_CONTRAST) problems.push(`${theme.id}: ${k} on bg below ${MIN_UI_CONTRAST}:1`);
  }
  if (contrast(ui.ink, ui.accent) < MIN_TEXT_CONTRAST) problems.push(`${theme.id}: ink on accent buttons below ${MIN_TEXT_CONTRAST}:1`);
  if (contrast(field.text, field.sky[0]) < MIN_TEXT_CONTRAST) problems.push(`${theme.id}: battlefield labels below ${MIN_TEXT_CONTRAST}:1`);
  return problems;
}

/** A tank colour must stand out from the upper sky where tanks and labels sit. */
export function tankColorReadable(hex, theme) {
  return theme.field.sky.slice(0, 3).every((sky) => contrast(hex, sky) >= MIN_UI_CONTRAST);
}
