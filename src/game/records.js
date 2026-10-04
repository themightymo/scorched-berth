// Local records: career totals, best tournament, daily and challenge results.

import { KEYS, loadVersioned, saveVersioned } from './storage.js';

export const RECORDS_VERSION = 1;

export function defaultRecords() {
  return { v: RECORDS_VERSION, totals: { battles: 0, wins: 0, shots: 0, hits: 0, damage: 0, kills: 0, direct: 0, burns: 0 }, bestTournament: null, tournaments: 0, daily: {}, challenges: {}, recorded: [] };
}

const n = (v) => Math.max(0, Math.floor(Number(v) || 0));

export function sanitizeRecords(raw) {
  const d = defaultRecords();
  const t = raw?.totals ?? {};
  const out = { ...d, totals: Object.fromEntries(Object.keys(d.totals).map((k) => [k, n(t[k])])) };
  if (raw?.bestTournament && Number.isFinite(raw.bestTournament.score)) out.bestTournament = { score: n(raw.bestTournament.score), rank: String(raw.bestTournament.rank ?? '').slice(0, 20), date: String(raw.bestTournament.date ?? '').slice(0, 10) };
  out.tournaments = n(raw?.tournaments);
  for (const [k, v] of Object.entries(raw?.daily ?? {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v) out.daily[k] = { best: n(v.best), attempts: n(v.attempts), won: !!v.won };
  for (const [k, v] of Object.entries(raw?.challenges ?? {})) if (/^[a-z0-9-]{1,40}$/.test(k) && v) out.challenges[k] = { stars: Math.min(3, n(v.stars)), best: n(v.best) };
  out.recorded = Array.isArray(raw?.recorded) ? raw.recorded.filter((s) => typeof s === 'string').slice(-200) : [];
  return out;
}

export const RECORDS_SPEC = { version: RECORDS_VERSION, defaults: defaultRecords, sanitize: sanitizeRecords, migrations: {} };
export const loadRecords = (store) => loadVersioned(store, KEYS.records, RECORDS_SPEC);
export const saveRecords = (store, r) => saveVersioned(store, KEYS.records, RECORDS_SPEC, r);

/** Add a battle to career totals once (keyed by battle id). */
export function addBattle(records, id, stat, won) {
  if (records.recorded.includes(id)) return records;
  const t = records.totals;
  return {
    ...records,
    recorded: [...records.recorded, id].slice(-200),
    totals: { battles: t.battles + 1, wins: t.wins + (won ? 1 : 0), shots: t.shots + stat.shots, hits: t.hits + stat.hits, damage: t.damage + stat.damage, kills: t.kills + stat.kills, direct: t.direct + (stat.direct ?? 0), burns: t.burns + (stat.burns ?? 0) },
  };
}
