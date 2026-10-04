// Weather presets. Each must change decisions, not just visuals.

export const WEATHER = {
  clear: {
    id: 'clear', name: 'Clear', glyph: '☼',
    effect: 'Normal wind. Napalm burns for its full duration.',
    windMax: 15, windStep: 3, fireTurns: 0, burnScale: 1,
  },
  gale: {
    id: 'gale', name: 'Gale', glyph: '≋',
    effect: 'Wind up to 26 and shifts sharply each turn. Area weapons forgive drift.',
    windMax: 26, windStep: 6, fireTurns: 0, burnScale: 1,
  },
  rain: {
    id: 'rain', name: 'Rain', glyph: '⁞',
    effect: 'Lighter wind. Napalm burns one turn less at half strength.',
    windMax: 11, windStep: 2, fireTurns: -1, burnScale: 0.5,
  },
};
export const WEATHER_IDS = Object.keys(WEATHER);

export const NIGHT = {
  name: 'Night',
  effect: 'The trajectory preview shows only the first part of the arc. Every commander aims less precisely.',
  aimPenalty: 1.35,
  previewCap: 'partial',
};
