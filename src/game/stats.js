// Debrief statistics derived only from the recorded event log.

export function battleStats(state) {
  const tanks = state.tanks.map((t, i) => ({
    id: i, name: t.name, kind: t.kind, commander: t.commander,
    shots: 0, hits: 0, damage: 0, taken: 0, self: 0, kills: 0, falls: 0, burns: 0,
    survived: t.alive, eliminatedTurn: null, weapons: {},
  }));
  let shot = null; // { by, hit }
  for (const e of state.events) {
    if (e.t === 'fire') {
      shot = { by: e.by, hit: false };
      const s = tanks[e.by];
      s.shots++;
      s.weapons[e.weapon] = (s.weapons[e.weapon] ?? 0) + 1;
    } else if (e.t === 'damage') {
      const victim = tanks[e.to];
      victim.taken += e.amount;
      if (e.cause === 'fall') victim.falls++;
      if (e.by == null) continue;
      const by = tanks[e.by];
      if (e.by === e.to) { by.self += e.amount; continue; }
      by.damage += e.amount;
      if (e.cause === 'fire') by.burns += e.amount;
      if (shot && shot.by === e.by && !shot.hit && e.cause !== 'fire') { shot.hit = true; by.hits++; }
    } else if (e.t === 'eliminated') {
      tanks[e.to].eliminatedTurn = e.turn;
      if (e.by != null && e.by !== e.to) tanks[e.by].kills++;
    }
  }
  for (const s of tanks) s.accuracy = s.shots ? s.hits / s.shots : 0;
  return { tanks, turns: state.turn, result: state.result };
}

export const SCORE_RULES = { damage: 1, kill: 100, victory: 300, survival: 100, accuracy: 150 };

export function battleScore(stat, won) {
  const parts = [
    { label: 'Damage dealt', amount: Math.round(stat.damage * SCORE_RULES.damage) },
    { label: `Eliminations ×${stat.kills}`, amount: stat.kills * SCORE_RULES.kill },
    { label: 'Accuracy bonus', amount: Math.round(stat.accuracy * SCORE_RULES.accuracy) },
  ];
  if (stat.survived) parts.push({ label: 'Survived', amount: SCORE_RULES.survival });
  if (won) parts.push({ label: 'Victory', amount: SCORE_RULES.victory });
  return { parts, total: parts.reduce((n, p) => n + p.amount, 0) };
}

/** Outcome from one human's perspective. */
export function outcomeFor(state, idx) {
  const r = state.result;
  if (!r) return 'ongoing';
  if (r.winner === idx) return 'victory';
  if (r.winner == null && state.tanks[idx].alive && r.reason !== 'outOfShots') return 'draw';
  return 'defeat';
}
