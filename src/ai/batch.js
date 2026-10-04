// Headless seeded AI battles for balance checks, tests, and CI.

import { createBattle, applyCommand, runUntilIdle } from '../core/engine.js';
import { decideShot } from './ai.js';
import { COMMANDERS, DIFFICULTY_IDS, commanderPlayer } from './commanders.js';
import { PROFILE_IDS } from '../core/mapgen.js';
import { WEATHER_IDS } from '../core/weather.js';

const emptyStats = () => ({ shots: 0, weapons: {}, rareShots: 0, selfDamage: 0, damage: 0, kills: 0, wins: 0, battles: 0, switches: 0, weakestPicks: 0, targetedShots: 0, grudgeShots: 0, fallbacks: 0 });

/**
 * Run `count` AI-only battles. Options: seedPrefix, timeBudgetMs (override),
 * players per battle, maxTurns. Returns totals plus per-commander stats.
 */
export function runBatch({ count = 100, seedPrefix = 'SIM', players = 4, maxTurns = 80, timeBudgetMs, difficulty, commanders, weatherCycle = true } = {}) {
  const report = { battles: 0, completed: 0, exceptions: [], overruns: 0, timeouts: 0, decisions: 0, decisionMs: [], turns: 0, ceasefires: 0, byCommander: {}, byDifficulty: {} };
  for (const d of DIFFICULTY_IDS) report.byDifficulty[d] = { shots: 0, hits: 0, damage: 0 };
  for (const c of COMMANDERS) report.byCommander[c.id] = emptyStats();
  for (let b = 0; b < count; b++) {
    const seed = `${seedPrefix}-${b}`;
    const roster = Array.from({ length: players }, (_, i) => {
      const c = commanders ? commanders[(b + i) % commanders.length] : COMMANDERS[(b * 3 + i) % COMMANDERS.length].id;
      return commanderPlayer(c, difficulty ?? DIFFICULTY_IDS[(b + i) % 3]);
    });
    report.battles++;
    try {
      const state = createBattle({
        seed, mode: 'sim', players: roster, rules: { maxTurns },
        map: { profile: PROFILE_IDS[b % PROFILE_IDS.length] },
        weather: weatherCycle ? WEATHER_IDS[b % WEATHER_IDS.length] : 'clear',
        night: weatherCycle && b % 5 === 4,
      });
      for (const c of new Set(roster.map((r) => r.commander))) report.byCommander[c].battles++;
      let guard = 0;
      while (state.phase !== 'battleOver') {
        if (++guard > maxTurns + 5) throw new Error('turn guard exceeded');
        const actor = state.actor;
        const tank = state.tanks[actor];
        const weakest = state.tanks.map((t, i) => [t, i]).filter(([t, i]) => t.alive && i !== actor).sort((a, b2) => a[0].hp - b2[0].hp)[0]?.[1];
        const grudgeFrom = [...state.events].reverse().find((e) => e.t === 'damage' && e.to === actor && e.by != null && e.by !== actor)?.by;
        const { command, diagnostics } = decideShot(state, actor, { timeBudgetMs });
        report.decisions++;
        report.decisionMs.push(diagnostics.elapsedMs);
        if (diagnostics.overrun) report.overruns++;
        if (diagnostics.timedOut) report.timeouts++;
        const st = report.byCommander[tank.commander];
        st.shots++;
        st.weapons[command.weapon] = (st.weapons[command.weapon] ?? 0) + 1;
        if (command.weapon !== 'shell') st.rareShots++;
        if (diagnostics.fallback) st.fallbacks++;
        if (command.target != null) {
          st.targetedShots++;
          if (tank.memo.lastTarget != null && tank.memo.lastTarget !== command.target) st.switches++;
          if (command.target === weakest) st.weakestPicks++;
          if (grudgeFrom != null && command.target === grudgeFrom) st.grudgeShots++;
        }
        const res = applyCommand(state, command);
        if (!res.ok) throw new Error(`AI produced illegal command: ${res.error}`);
        const eventStart = state.events.length;
        runUntilIdle(state);
        const dd = report.byDifficulty[tank.difficulty];
        dd.shots++;
        let shotDamage = 0;
        for (let i = eventStart; i < state.events.length; i++) { const e = state.events[i]; if (e.t === 'damage' && e.by === actor && e.to !== actor && e.cause !== 'fire') shotDamage += e.amount; }
        if (shotDamage > 0) dd.hits++;
        dd.damage += shotDamage;
        for (let i = eventStart; i < state.events.length; i++) {
          const e = state.events[i];
          if (e.t === 'damage' && e.by === actor && e.cause !== 'fire') {
            if (e.to === actor) st.selfDamage += e.amount; else st.damage += e.amount;
          }
          if (e.t === 'eliminated' && e.by === actor && e.to !== actor) st.kills++;
        }
      }
      report.completed++;
      report.turns += state.turn;
      if (state.result.reason === 'ceasefire') report.ceasefires++;
      if (state.result.winner != null) report.byCommander[state.tanks[state.result.winner].commander].wins++;
    } catch (err) {
      report.exceptions.push(`${seed}: ${err.message}`);
    }
  }
  const sorted = report.decisionMs.slice().sort((a, b) => a - b);
  report.timing = {
    meanMs: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
  delete report.decisionMs;
  return report;
}

export function summarizeCommander(st) {
  const shots = Math.max(1, st.shots);
  return {
    shots: st.shots,
    rareRate: st.rareShots / shots,
    heavyRate: ((st.weapons.heavy ?? 0) + (st.weapons.nuke ?? 0)) / shots,
    areaRate: ((st.weapons.cluster ?? 0) + (st.weapons.napalm ?? 0)) / shots,
    selfDamagePerShot: st.selfDamage / shots,
    damagePerShot: st.damage / shots,
    switchRate: st.switches / Math.max(1, st.targetedShots),
    weakestRate: st.weakestPicks / Math.max(1, st.targetedShots),
    grudgeRate: st.grudgeShots / Math.max(1, st.targetedShots),
    winRate: st.wins / Math.max(1, st.battles),
  };
}
