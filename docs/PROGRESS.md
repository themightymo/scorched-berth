# Build checklist (working document)

Tracks the autonomous build of `feature-backlog.md` so work can resume after an interruption.
Last updated: 2026-10-03 (build complete except online features).

## How to resume
1. `npm install` → `npm test` (all should pass) → `npm run simulate` → `npm run build`.
2. Optional browser pass: `npm run build && npm run smoke` (needs local Chrome; set `CHROME_PATH` if not macOS default).
3. Continue from the first unchecked item below.

## Done
- [x] **M0** Deterministic engine (`src/core/engine.js`): seeded RNG, fixed 200 Hz tick, JSON state, commands, replays, digest. No DOM.
- [x] **M0** Explicit app state machine (`src/game/machine.js`) with legal transitions; pause/resume to exact sub-state.
- [x] **M0** Quality commands: `npm test`, `npm run simulate`, `npm run verify` (tests + 100 AI battles + build).
- [x] **M1** DOS visual system: 700×280 pixel buffer upscaled, dithered sky/strata, crisp labels, optional scanlines/flicker/shake/flash.
- [x] **M1** Tactical HUD + battle log (40 entries, text glyphs not colour-only), roster with text status.
- [x] **M1** Keyboard-first controls (fine/coarse aim, 1–6, [ ], Space/Enter/F, P/Esc pause, H help, M mute), focus handling, pause freezes sim + AI.
- [x] **M2** Validated weapon registry (6 weapons) driving UI, help, armory, AI.
- [x] **M2** Damage falloff, direct hits, craters (collapse-safe), settling and once-per-fall damage, napalm fire zones, burrowing shaft, cluster split at apex.
- [x] **M2** Preview modes full/partial/off (persisted); wind shown as number + words + arrows.
- [x] **M3** Shared AI evaluator (`src/ai/ai.js`): real-engine what-if sims, no access to battle RNG, time budget + deterministic fallback.
- [x] **M3** Six historical commanders with data doctrines; Recruit/Veteran/Ace; `?dev=1` diagnostics overlay.
- [x] **M3** 100-battle seeded simulation: 0 exceptions, 0 overruns (see `npm run simulate`).
- [x] **M4** Economy + armory (prices/caps from registry), tournament (5 rounds, retry/continue, idempotent rewards, resume mid-battle from saved commands), versioned saves with backup-on-corrupt.
- [x] **M4** Fair map generator: 6 profiles, vents hazard, bounded retries, safe fallback, seed shown in briefing.
- [x] **M5** Synthesised audio (master/effects/music, gesture-unlocked, voice limiter), full screen flow, debrief stats from events, effects pass.
- [x] **M6** Hot-seat (hand-off screen, private aim/arsenal, series with private armory), 6 data-defined challenges, local daily seed, replay viewer with verification + share codes, weather (clear/gale/rain) + night, themes (3, contrast-validated) + name/colour, sandbox rules, map editor (save/share/play-test).
- [x] Tests: engine, rules/mapgen, AI, game layer (49 passing at last run).

- [x] **Stat ratings** (owner request): 30-point cards (Firepower, Armour, Muzzle velocity, Hull, Stability) for all six commanders and five player chassis; engine mechanics, AI, UI (dossiers, briefing, setup, settings, manual), tests.
- [x] Browser smoke suite passes 15/15 (`npm run smoke`; auto-uses a Playwright headless shell if installed).
- [x] README, `feature-backlog.md` status, `docs/online-design.md`.
- [x] Final `npm run verify`: 51 tests, 100/100 AI battles (0 exceptions, 0 overruns, p95 ≈ 20 ms), build OK.

## Waiting on the owner
- [x] Online multiplayer and online daily leaderboard: **on hold by owner decision (2026-10-03)**. Design kept in `docs/online-design.md`; do not build until asked.
- [ ] Optional: `git rm -r --cached dist node_modules` and commit (not done; no commits without permission).

## Manual QA still recommended
- Listen to audio in a real browser (synth sounds, music loop, volume sliders, mute persistence).
- Play a full tournament by hand for difficulty feel; check Firefox and Safari.
- Screen-reader pass (VoiceOver/NVDA) over the battle log, roster, and dialogs.

## Decisions and assumptions
- Product name follows the backlog: **Scorched Berth** (the old "Scorched Earth" title copied the original game's name).
- The old `tests/game.test.cjs` read `main.js` source through `vm`; it was replaced by behavioural tests of the new modules covering the same cases.
- `dist/` and `node_modules/` are committed in git history; `.gitignore` now excludes them but they remain tracked until someone runs `git rm -r --cached dist node_modules` (not done: no commits without permission).
- Tank AI difficulty never changes armour or damage. Commander stat ratings are a separate, visible, per-commander trait (equal point budget), not a difficulty cheat.
