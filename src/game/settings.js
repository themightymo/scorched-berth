// Persistent player settings (version 2).

import { clamp } from '../core/math.js';
import { THEME_IDS, TANK_COLORS } from './themes.js';
import { KEYS, loadVersioned, saveVersioned } from './storage.js';
import { CHASSIS } from '../core/ratings.js';

export const SETTINGS_VERSION = 2;

export const SETTING_OPTIONS = {
  preview: ['full', 'partial', 'off'],
  motion: ['system', 'reduced', 'full'],
  particles: ['full', 'reduced', 'off'],
  speed: [1, 2, 3],
  textSize: ['normal', 'large'],
};

export function defaultSettings() {
  return {
    v: SETTINGS_VERSION,
    audio: { master: 0.7, effects: 0.8, music: 0.35, muted: false },
    preview: 'partial',
    motion: 'system',
    scanlines: true,
    flicker: false,
    shake: true,
    flashes: true,
    particles: 'full',
    speed: 1,
    theme: 'console',
    textSize: 'normal',
    playerName: 'Commander',
    playerColor: TANK_COLORS[0].hex,
    playerChassis: 'standard',
    seenIntro: false,
  };
}

const vol = (v, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v) * 100) / 100, 0, 1) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export function sanitizeSettings(raw) {
  const d = defaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  const a = s.audio && typeof s.audio === 'object' ? s.audio : {};
  const name = typeof s.playerName === 'string' ? s.playerName.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 16) : '';
  return {
    v: SETTINGS_VERSION,
    audio: { master: vol(a.master, d.audio.master), effects: vol(a.effects, d.audio.effects), music: vol(a.music, d.audio.music), muted: bool(a.muted, d.audio.muted) },
    preview: oneOf(s.preview, SETTING_OPTIONS.preview, d.preview),
    motion: oneOf(s.motion, SETTING_OPTIONS.motion, d.motion),
    scanlines: bool(s.scanlines, d.scanlines),
    flicker: bool(s.flicker, d.flicker),
    shake: bool(s.shake, d.shake),
    flashes: bool(s.flashes, d.flashes),
    particles: oneOf(s.particles, SETTING_OPTIONS.particles, d.particles),
    speed: oneOf(Number(s.speed), SETTING_OPTIONS.speed, d.speed),
    theme: oneOf(s.theme, THEME_IDS, d.theme),
    textSize: oneOf(s.textSize, SETTING_OPTIONS.textSize, d.textSize),
    playerName: name || d.playerName,
    playerColor: TANK_COLORS.some((c) => c.hex === s.playerColor) ? s.playerColor : d.playerColor,
    playerChassis: CHASSIS.some((c) => c.id === s.playerChassis) ? s.playerChassis : d.playerChassis,
    seenIntro: bool(s.seenIntro, d.seenIntro),
  };
}

export const SETTINGS_SPEC = {
  version: SETTINGS_VERSION,
  defaults: defaultSettings,
  sanitize: sanitizeSettings,
  migrations: {
    // v0: unversioned prototype shape { muted, volume } → v1.
    0: (old) => ({ audio: { muted: old.muted ?? false, master: old.volume ?? 0.7 } }),
    // v1 → v2: Full preview was the old default and made aiming trivial; move everyone to Partial once.
    1: (old) => ({ ...old, preview: old.preview === 'full' ? 'partial' : old.preview }),
  },
};

export const loadSettings = (store) => loadVersioned(store, KEYS.settings, SETTINGS_SPEC);
export const saveSettings = (store, s) => saveVersioned(store, KEYS.settings, SETTINGS_SPEC, s);

/** Effective reduced-motion flag given the setting and the OS preference. */
export function reducedMotion(settings, systemPrefersReduced) {
  if (settings.motion === 'reduced') return true;
  if (settings.motion === 'full') return false;
  return !!systemPrefersReduced;
}
