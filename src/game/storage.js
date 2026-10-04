// Versioned localStorage persistence that never throws and never silently
// discards unreadable data: corrupt or newer-version payloads are backed up
// under `<key>.backup` before defaults are used.

export const KEYS = {
  settings: 'scorched-berth.settings',
  tournament: 'scorched-berth.tournament',
  records: 'scorched-berth.records',
  replays: 'scorched-berth.replays',
  maps: 'scorched-berth.maps',
};

export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

/** localStorage when usable (private modes can throw), otherwise memory. */
export function defaultBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memoryBackend();
    const probe = '__sb_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryBackend();
  }
}

export function createStore(backend = defaultBackend()) {
  return {
    backend,
    readRaw(key) { try { return backend.getItem(key); } catch { return null; } },
    write(key, value) {
      try { backend.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    remove(key) { try { backend.removeItem(key); } catch { /* ignore */ } },
    backup(key, raw) { try { backend.setItem(`${key}.backup`, raw); } catch { /* ignore */ } },
  };
}

/**
 * Load a versioned document.
 * spec = { version, defaults: () => obj, sanitize: (obj) => obj, migrations: { [fromVersion]: (obj) => obj } }
 * Returns { data, status } where status ∈ ok | missing | migrated | corrupt | future.
 */
export function loadVersioned(store, key, spec) {
  const raw = store.readRaw(key);
  if (raw == null) return { data: spec.defaults(), status: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    store.backup(key, raw);
    return { data: spec.defaults(), status: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    store.backup(key, raw);
    return { data: spec.defaults(), status: 'corrupt' };
  }
  let v = Number.isInteger(parsed.v) ? parsed.v : 0;
  if (v > spec.version) {
    store.backup(key, raw);
    return { data: spec.defaults(), status: 'future' };
  }
  let status = 'ok';
  try {
    while (v < spec.version) {
      const step = spec.migrations?.[v];
      if (!step) throw new Error(`no migration from v${v}`);
      parsed = step(parsed);
      v++;
      status = 'migrated';
    }
    const data = spec.sanitize({ ...parsed, v: spec.version });
    return { data, status };
  } catch {
    store.backup(key, raw);
    return { data: spec.defaults(), status: 'corrupt' };
  }
}

export function saveVersioned(store, key, spec, data) {
  return store.write(key, { ...spec.sanitize(data), v: spec.version });
}
