// Run seeded AI-only battles and print timing, failures, and commander behaviour.
// Usage: node scripts/simulate.mjs [count]
import { runBatch, summarizeCommander } from '../src/ai/batch.js';

const count = Number(process.argv[2] ?? 100);
const t0 = performance.now();
const report = runBatch({ count });
const seconds = ((performance.now() - t0) / 1000).toFixed(1);
const pct = (v) => `${(v * 100).toFixed(0)}%`.padStart(5);

console.log(`Seeded AI battles: ${report.completed}/${report.battles} completed in ${seconds}s`);
console.log(`Decisions: ${report.decisions} · mean ${report.timing.meanMs.toFixed(1)}ms · p95 ${report.timing.p95Ms.toFixed(1)}ms · max ${report.timing.maxMs.toFixed(1)}ms`);
console.log(`Budget cut-offs (fell back to best-so-far): ${report.timeouts} · hard overruns: ${report.overruns} · ceasefires: ${report.ceasefires} · avg turns ${(report.turns / Math.max(1, report.completed)).toFixed(1)}`);
console.log(`Exceptions: ${report.exceptions.length}`);
for (const e of report.exceptions.slice(0, 10)) console.log(`  ${e}`);
console.log('\ncommander   shots  rare heavy  area  self/shot dmg/shot switch weakest grudge  wins');
for (const [id, st] of Object.entries(report.byCommander)) {
  const s = summarizeCommander(st);
  console.log(`${id.padEnd(10)} ${String(s.shots).padStart(6)} ${pct(s.rareRate)} ${pct(s.heavyRate)} ${pct(s.areaRate)} ${s.selfDamagePerShot.toFixed(2).padStart(9)} ${s.damagePerShot.toFixed(1).padStart(8)} ${pct(s.switchRate)} ${pct(s.weakestRate)}  ${pct(s.grudgeRate)} ${pct(s.winRate)}`);
}
console.log('\ndifficulty  shots  hit-rate  dmg/shot');
for (const [id, d] of Object.entries(report.byDifficulty)) console.log(`${id.padEnd(10)} ${String(d.shots).padStart(6)} ${pct(d.hits / Math.max(1, d.shots))}     ${(d.damage / Math.max(1, d.shots)).toFixed(1).padStart(6)}`);
if (report.exceptions.length || report.overruns || report.completed !== report.battles) process.exit(1);
