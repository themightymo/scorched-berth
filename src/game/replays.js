// Replays record the battle config and commands, never animation frames.
// Playback re-simulates through the engine and checks the final digest.

import { replayBattle, stateDigest, normalizeConfig } from '../core/engine.js';
import { KEYS, loadVersioned, saveVersioned } from './storage.js';

export const REPLAY_VERSION = 1;
export const MAX_REPLAYS = 12;

export function makeReplay(state, meta = {}) {
  return {
    v: REPLAY_VERSION,
    id: `${state.seed}-${state.commands.length}-${stateDigest(state)}`,
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    title: String(meta.title ?? state.config.label ?? `${state.config.mode} battle`).slice(0, 60),
    config: state.config,
    commands: state.commands.map((c) => ({ ...c })),
    digest: stateDigest(state),
    summary: {
      turns: state.turn,
      winner: state.result?.winner != null ? state.tanks[state.result.winner].name : null,
      reason: state.result?.reason ?? null,
      tanks: state.tanks.map((t) => t.name),
    },
  };
}

export function verifyReplay(replay) {
  try {
    const state = replayBattle(replay.config, replay.commands);
    return { ok: stateDigest(state) === replay.digest, state };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function sanitizeReplay(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.commands) || !r.config) return null;
  try { normalizeConfig(r.config); } catch { return null; }
  const commands = r.commands.slice(0, 1000).filter((c) => c && c.type === 'fire' && Number.isInteger(c.actor) && typeof c.weapon === 'string' && Number.isInteger(c.angle) && Number.isInteger(c.power));
  return {
    v: REPLAY_VERSION,
    id: String(r.id ?? '').slice(0, 80) || `replay-${commands.length}`,
    date: String(r.date ?? '').slice(0, 10),
    title: String(r.title ?? 'Replay').slice(0, 60),
    config: r.config,
    commands,
    digest: String(r.digest ?? ''),
    summary: r.summary && typeof r.summary === 'object' ? r.summary : {},
  };
}

export const REPLAYS_SPEC = {
  version: REPLAY_VERSION,
  defaults: () => ({ v: REPLAY_VERSION, items: [] }),
  sanitize: (raw) => ({ v: REPLAY_VERSION, items: (Array.isArray(raw?.items) ? raw.items : []).map(sanitizeReplay).filter(Boolean).slice(0, MAX_REPLAYS) }),
  migrations: {},
};
export const loadReplays = (store) => loadVersioned(store, KEYS.replays, REPLAYS_SPEC);
export const saveReplays = (store, data) => saveVersioned(store, KEYS.replays, REPLAYS_SPEC, data);

export function addReplay(list, replay) {
  const items = [replay, ...list.items.filter((r) => r.id !== replay.id)].slice(0, MAX_REPLAYS);
  return { ...list, items };
}

// Share codes: base64 of UTF-8 JSON, prefixed for recognition.
const PREFIX = 'SBR1:';
export function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return PREFIX + btoa(bin);
}
export function decodeShare(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(PREFIX)) throw new Error('Not a Scorched Berth share code.');
  const bin = atob(t.slice(PREFIX.length));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function importReplay(text) {
  const r = sanitizeReplay(decodeShare(text));
  if (!r) throw new Error('That code does not contain a valid replay.');
  return r;
}
