// Versioned custom-map format used by the map editor, share codes, and
// custom battles. Heights are stored as rounded integers, delta-encoded.

import { W, BEDROCK, SKY_LIMIT, PAD_HALF_WIDTH } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { validateLayout } from '../core/mapgen.js';
import { flattenPad } from '../core/terrain.js';
import { KEYS, loadVersioned, saveVersioned } from './storage.js';

export const MAP_VERSION = 1;
export const MAX_SPAWNS = 6;
export const MAX_SAVED_MAPS = 10;

export function encodeHeights(terrain) {
  let prev = 0;
  return terrain.map((y) => { const v = Math.round(y); const d = v - prev; prev = v; return d.toString(36); }).join(',');
}

export function decodeHeights(text) {
  const parts = String(text).split(',');
  if (parts.length !== W + 1) throw new Error(`expected ${W + 1} heights`);
  let prev = 0;
  return parts.map((p) => {
    const d = parseInt(p, 36);
    if (!Number.isFinite(d)) throw new Error('bad height');
    prev += d;
    return clamp(prev, SKY_LIMIT, BEDROCK);
  });
}

export function blankMap(name = 'Untitled ridge') {
  const terrain = Array.from({ length: W + 1 }, () => 400);
  return { name, terrain, spawns: [200, 520, 880, 1200], vents: [] };
}

export function encodeMap(map) {
  return {
    v: MAP_VERSION,
    name: String(map.name ?? 'Custom map').slice(0, 30),
    heights: encodeHeights(map.terrain),
    spawns: map.spawns.map((x) => Math.round(x)),
    vents: map.vents.map((v) => ({ x0: Math.round(v.x0), x1: Math.round(v.x1) })),
  };
}

export function decodeMap(raw) {
  if (!raw || raw.v !== MAP_VERSION) throw new Error('Unsupported map version.');
  const terrain = decodeHeights(raw.heights);
  const spawns = (Array.isArray(raw.spawns) ? raw.spawns : []).map((x) => clamp(Math.round(Number(x)), 0, W)).filter(Number.isFinite).slice(0, MAX_SPAWNS);
  const vents = (Array.isArray(raw.vents) ? raw.vents : []).map((v) => ({ x0: clamp(Math.round(Number(v.x0)), 0, W), x1: clamp(Math.round(Number(v.x1)), 0, W) })).filter((v) => v.x1 - v.x0 >= 10).slice(0, 6);
  return { name: String(raw.name ?? 'Custom map').slice(0, 30) || 'Custom map', terrain, spawns, vents };
}

/** Flatten spawn pads and run the generator's fairness checks. */
export function prepareMap(map) {
  const terrain = map.terrain.slice();
  for (const x of map.spawns) flattenPad(terrain, x, PAD_HALF_WIDTH);
  const problems = map.spawns.length < 2 ? ['place at least two spawn points'] : validateLayout({ terrain, spawns: map.spawns, vents: map.vents });
  return { map: { ...map, terrain }, problems };
}

export const MAPS_SPEC = {
  version: MAP_VERSION,
  defaults: () => ({ v: MAP_VERSION, items: [] }),
  sanitize: (raw) => ({
    v: MAP_VERSION,
    items: (Array.isArray(raw?.items) ? raw.items : []).map((m) => { try { decodeMap(m); return m; } catch { return null; } }).filter(Boolean).slice(0, MAX_SAVED_MAPS),
  }),
  migrations: {},
};
export const loadMaps = (store) => loadVersioned(store, KEYS.maps, MAPS_SPEC);
export const saveMaps = (store, data) => saveVersioned(store, KEYS.maps, MAPS_SPEC, data);
