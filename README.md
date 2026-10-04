# Scorched Berth

A turn-based browser artillery game in the spirit of 1990s DOS shareware. Read the battlefield, choose a payload, set angle and power, fire, and adapt to the ground you leave behind. Built with vanilla JavaScript, Canvas, CSS, and Vite. There are no runtime dependencies, and nothing needs a server.

## Run

```sh
npm install
npm run dev        # local development server
npm run build      # production build in dist/
npm run preview    # serve the production build
```

## Verify

```sh
npm test           # all unit and behaviour tests (node:test, no browser)
npm run simulate   # 100 seeded AI-only battles: timing, failures, commander behaviour
npm run verify     # tests + simulation + production build (use before shipping)
npm run smoke      # optional: end-to-end checks in headless Chrome (run `npm run build` first; set CHROME_PATH if Chrome is not in the default macOS location)
```

Add `?dev=1` to the URL to show the AI diagnostics overlay (target, score, predicted impact, decision time) and expose `window.__sb` for debugging. Normal play never shows diagnostics.

## Modes

- **Tournament**: five escalating battles against the historical commanders. You earn credits for damage, eliminations, survival, and victory, and a defeat always pays at least 170. Spend credits in the armory between rounds. Progress saves after every shot; reloading resumes exactly where you left off. After a defeat, **Continue** keeps the result and its credits; **Retry** replays the round from its start for −250 score.
- **Quick Battle**: pick the terrain, weather, night, seed, and up to five AI commanders with difficulty levels.
- **Challenges**: six data-defined scenarios (range finding, crosswind, burrowing, napalm, survival, a night duel), each with up to three stars.
- **Daily Challenge**: the same seeded battlefield for everyone on a given date. The best score is stored on this device only.
- **Hot-Seat**: two to four people share one keyboard. A hand-off screen hides each player's aim and arsenal, and each player shops in a private armory between rounds.
- **Sandbox**: change gravity, wind, starting armour, the turn limit, wall rebounds, unlimited ammunition, and the starting arsenal. Results are not recorded.
- **Map Editor**: sculpt terrain, place two to six spawns and thermal vents, validate against the same fairness rules as generated maps, save locally, share as a code, and play-test.
- **Replays**: the last 12 battles are stored as seed + commands. Playback re-simulates every shot and confirms the result matches. Replays can be shared as text codes.

## Controls

| Key | Action |
| --- | --- |
| ← / → | Angle ±1° (Shift: ±5°). Left raises the barrel toward the left. |
| ↑ / ↓ | Power ±1 (Shift: ±5) |
| 1–6, [ / ] | Choose payload |
| Space, Enter, F | Fire |
| P, Esc | Pause / resume (freezes shots in flight and AI turns) |
| H, ? | Field manual |
| M | Mute |
| ↑/↓, Enter, Esc | Navigate menus, confirm, go back |

Every control also works with the mouse. Page scrolling is blocked only while gameplay keys are active. Hiding the tab pauses the battle.

## Rules

- 90° fires straight up; below 90° fires right, above 90° fires left.
- **Wind** pushes every projectile sideways at a steady rate. It shifts a little after every turn, more in a gale. The trajectory preview (Full, Partial, or Off in Settings) includes the current wind.
- **Damage** falls off linearly to zero at the blast radius. A direct hit deals full damage. Craters reshape the ground. Tanks fall when the ground beneath them is removed, and a fall of more than 20 m causes damage, applied once per fall.
- **Payloads**: Standard Shell (unlimited), Heavy Shell, Mini Nuke, Cluster Charge (splits into five at the top of its arc), Napalm Canister (fire burns tanks at the end of each turn; blasts put it out; rain weakens it), and Burrowing Charge (drills before detonating; its shaft drops tanks above it). The field manual and armory list each payload's role and counterplay.
- **Weather**: Clear, Gale (strong, shifting wind), or Rain (weaker napalm). **Night** limits the preview to Partial and widens every AI's aim.
- **Thermal vents** (Thermal Vents terrain) burn tanks that end a turn on them. Tanks never spawn near one.

### Stat ratings

Every tank has a trading-card style stat block rated 2–10 in five categories, with the same 30-point budget for everyone, so each strength costs a weakness:

| Rating | Effect |
| --- | --- |
| Firepower | Damage dealt by blasts and fire (±4% per point from 6) |
| Armour | Damage taken from blasts, fire, and vents (∓4% per point) |
| Muzzle velocity | Shell launch speed: more range and less wind drift (±2.5% per point) |
| Hull | Maximum armour points (±5% per point) |
| Stability | Fall damage (∓8% per point) |

Each commander has a fixed card (see Commander Dossiers). Players choose a chassis in Settings (Standard, Striker, Bulwark, Longshot, Mountaineer); a tournament keeps the chassis it started with. Ratings are separate from AI difficulty, which never changes armour or damage.

## Commanders

Six AI commanders are playful, fictionalised gameplay interpretations of public-domain historical figures: Abraham Lincoln, Genghis Khan, Attila the Hun, Julius Caesar, Napoleon Bonaparte, and Queen Elizabeth I. They are not claims about the real people's tactics, beliefs, or character, and their in-game lines are original, not quotations. Each commander's doctrine is data in `src/ai/commanders.js`: target priorities, weapon preferences, risk tolerance, terrain weighting, aim variance, patience, ammunition conservation, and stat ratings. Difficulty (Recruit, Veteran, Ace) changes only search density, aim spread, and memory.

## Architecture

```
src/core/   deterministic simulation: no DOM, no Math.random, no timers
  engine.js     battle state, commands, fixed-tick step, damage, craters, falls, fire, turn order, outcomes, replay
  physics.js    projectile launch/step/trace shared by live shots, preview, AI, and map validation
  weapons.js    validated weapon registry (UI, help, armory, firing, and AI all read it)
  ratings.js    stat ratings, chassis, and their mechanical multipliers
  mapgen.js     seeded fair map generator with bounded retries and a safe fallback
  terrain.js, rng.js, math.js (series-based trig for cross-browser determinism), weather.js, clock.js (fixed-step driver)
src/ai/     shared candidate-shot evaluator (ai.js), commander data (commanders.js), batch simulation (batch.js)
src/game/   state machine, versioned storage, settings, themes, economy, tournament, records, replays, map format, challenges
src/ui/     app controller, canvas renderer, effects, synthesised audio, battle log, screens, map editor
tests/      node:test suites for engine, rules, AI, and game layer
scripts/    simulate.mjs (AI batch report), browser-smoke.mjs + cdp.mjs (optional headless Chrome checks)
```

- The simulation runs on a fixed 200 Hz tick, independent of frame rate and display size. Rendering reads state; effects and sounds react to engine events and never feed back.
- Battles are fully determined by `config` (seed, players, rules) plus the list of `fire` commands. That one property drives replays, tournament resume after reload, and AI what-if simulation.
- The AI traces real trajectories, resolves its best candidates on a copy of the battle through the real engine, and stops before the turn ends, so it can never see future randomness. Each decision has a time budget and a deterministic legal fallback.
- Every app screen and battle sub-state is listed in `src/game/machine.js` with its legal transitions.

## Saved data

All data lives in `localStorage` under `scorched-berth.*` keys: `settings`, `tournament`, `records`, `replays`, `maps`. Each document is versioned (`v: 1`) and sanitised on load. Unreadable, corrupt, or newer-version data is copied to `<key>.backup` before the game falls back to defaults, and the title screen shows a notice. Legacy unversioned settings are migrated. Tournament rewards are keyed by battle id, so reloading, retrying, or double-clicking can never apply them twice.

## Assets and fonts

All art is drawn procedurally and all sound is synthesised at runtime; there are no image or audio files. Fonts (VT323 and IBM Plex Mono, both under the SIL Open Font License) load from Google Fonts with local monospace fallbacks. Gameplay needs no network access.

## Not included

Online multiplayer and online leaderboards need a trusted backend. See [docs/online-design.md](docs/online-design.md) for the proposed design and the decisions it needs.
