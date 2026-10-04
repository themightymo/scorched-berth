# Scorched Berth — Feature Backlog

## Product goal

Build a fast, readable browser artillery game that evokes a 1990s DOS shareware classic without copying another game's art, text, characters, or exact presentation. Preserve the satisfying loop: read the battlefield, choose a weapon, adjust angle and power, fire, and adapt to the changed terrain.

This is the implementation brief for AI-assisted development. Work through milestones in order. Every milestone must leave the game playable, tested, and deployable.

## Implementation status (2026-10-03)

M0–M5 are complete and M6 is complete except online multiplayer and online daily scores, which the owner has put on hold. Stat ratings (a 30-point card per commander and player chassis) were added at the owner's request. Working notes are in `docs/PROGRESS.md`.

## Current baseline (before this build)

The existing vanilla JavaScript/Vite prototype already has:

- one human tank versus three computer tanks
- angle, power, wind, trajectory preview, and turn-based firing
- standard, heavy, and mini-nuke shells with limited ammunition
- radial damage, destructible terrain, craters, particles, and basic fall damage
- AI firing-solution search with aim error
- randomized terrain and changing wind
- keyboard aiming/firing, help, synthesized sound, and mute
- victory, defeat, rematch, responsive layout, and a small Node test suite

Improve these foundations; do not rebuild them without reason.

## Guardrails

- Keep vanilla JavaScript, Canvas, CSS, and Vite unless a dependency removes more complexity than it adds.
- Split simulation/state from rendering and DOM work before expanding gameplay.
- Use seeded randomness for maps, AI, and weapon effects so failures are reproducible.
- Keep simulation independent of frame rate and display size.
- Prefer small data-driven systems over more conditionals in `main.js`.
- Store versioned settings and campaign data in `localStorage`; invalid data must fall back safely.
- Pause or greatly reduce animation in hidden tabs.
- Respect `prefers-reduced-motion`; flicker, scanlines, and shake must be optional.
- Support keyboard-only and audio-off play. Never communicate status by color alone.
- Use public-domain historical figures for commanders. Do not use copyrighted franchise characters, Nazi figures, other modern extremist leaders, or nationality-based caricatures. Keep portrayals stylized, respectful, and focused on gameplay doctrine rather than claims of historical simulation.
- Do not commit generated `dist/` output unless deployment requires it.

## Definition of done

Every item requires:

1. Its acceptance criteria pass in supported desktop browsers.
2. Existing tests pass and deterministic rules receive focused new tests.
3. `npm run build` succeeds without console errors.
4. Keyboard, responsive layout, reduced motion, and audio-off play are checked when relevant.
5. The README or field manual reflects changed controls or rules.
6. No placeholder controls, unreachable states, or known blockers remain.

## Effort scale

- XS: less than half a day
- S: roughly half to one day
- M: 1–3 days
- L: 3–7 days
- XL: decompose before implementation

Estimates include tests and cleanup and are deliberately broader than pure code-generation time.

## M0 — Stabilize the foundation (P0)

### 0.1 Extract a deterministic game engine — L · ✅ Done

Move weapons, projectile integration, collision, damage, terrain deformation, turn transitions, and win detection into modules without DOM or Canvas access.

Acceptance criteria:

- The same seed and commands produce the same state transitions.
- Tests advance a complete shot without fake DOM elements or animation frames.
- Rendering reads state but does not mutate physics state.
- Existing play behavior remains materially unchanged.

### 0.2 Define explicit game states — M · ✅ Done

Use states such as `briefing`, `aiming`, `projectile`, `resolving`, `aiThinking`, `paused`, and `battleOver`, with legal transitions in one place.

Acceptance criteria:

- Players cannot fire twice, act during AI turns, or interact behind a modal.
- Restart cancels pending AI work and animation cleanly.
- Hiding and reopening the tab cannot skip or duplicate a turn.

### 0.3 Establish quality commands — S · ✅ Done

Add scripts for tests and combined verification. Test pure rules rather than source layout or DOM implementation details.

Acceptance criteria:

- One command runs all tests and the production build.
- Tests cover seeded maps, projectile resolution, damage falloff, craters, falls, ammunition, turn order, and battle completion.

## M1 — Authentic presentation and controls (P0)

### 1.1 Cohesive DOS-inspired visual system — M · ✅ Done

Create a limited palette, crisp pixel-scale treatment, consistent borders and typography, and optional scanline/vignette effects. Favor legibility over heavy filters.

Acceptance criteria:

- Canvas stays crisp at common device-pixel ratios and sizes.
- Text and controls have readable contrast.
- Scanlines, flicker, particles, and shake can be reduced or disabled.
- Effects never obscure aiming, wind, health, or impacts.

### 1.2 Tactical HUD and battle log — M · ✅ Done

Unify turn, wind, angle, power, weapon, ammo, health, and recent events in a keyboard-readable HUD.

Acceptance criteria:

- Current actor and available action are immediately clear.
- The log retains at least eight meaningful events.
- Weapon descriptions show damage, radius, ammo, and tactical role from simulation data.

### 1.3 Keyboard-first controls and pause — M · ✅ Done

Add consistent shortcuts, focus handling, pause/resume, and a control reference. Defer remapping until defaults are stable.

Acceptance criteria:

- Angle and power have fine and coarse adjustment.
- Weapon selection, fire, pause, help, and confirmation work by keyboard.
- Page scrolling is prevented only while gameplay shortcuts are active.
- Pause freezes simulation and pending AI work without losing state.

## M2 — Combat and weapon framework (P0)

### 2.1 Data-driven weapon registry — M · ✅ Done

Represent ammo, projectile type, fuse, damage curve, radius, terrain effect, presentation, and AI tags as validated data.

Acceptance criteria:

- UI, player firing, AI, and help read the same registry.
- Invalid weapon data fails clearly during development.
- A simple ballistic weapon can be added without editing unrelated systems.

### 2.2 Improve damage, craters, and settling — L · ✅ Done

Define damage falloff, self-damage, terrain deformation, support, falling, collision, and destruction consistently.

Acceptance criteria:

- Craters never create invalid terrain or trap resolution in a loop.
- Tanks settle after deformation and take distance-based fall damage once per fall.
- Direct, edge-of-blast, self, overlapping-blast, and destroyed-tank cases have tests.
- Results are independent of frame rate.

### 2.3 Add three tactically distinct weapons — L · ✅ Done

- Cluster charge: separates near its apex for broad coverage.
- Napalm canister: creates short-lived area denial on exposed terrain.
- Burrowing charge: penetrates before exploding and makes a distinct crater.

Acceptance criteria:

- Each weapon changes the decision, not merely damage and radius.
- Each has counterplay, inventory rules, log messages, a visual identity, and AI rules.
- Multi-projectile and persistent effects resolve deterministically.

Defer smoke, mines, guidance, and mega-weapons. They require visibility, persistent collision, new input, or special AI rules.

### 2.4 Wind and trajectory readability — S · ✅ Done

Document wind and make preview accuracy an explicit difficulty/accessibility setting.

Acceptance criteria:

- Wind affects preview and live shots identically.
- Preview supports full, partial, and off modes and persists.
- Direction and strength are conveyed without relying only on numbers.

## M3 — Personality-driven AI (P0)

Personality must emerge from explainable parameters, not one-off scripts.

### 3.1 AI evaluation model — L · ✅ Done

Generate legal candidate shots using the real engine and score expected damage, self-damage, terrain value, ammo conservation, and uncertainty.

Acceptance criteria:

- AI uses the same physics as the player and cannot read future randomness.
- AI respects inventory and chooses a legal fallback when needed.
- Difficulty changes search budget, uncertainty, and memory—not health or damage.
- Every AI turn has a strict time budget and deterministic fallback.

### 3.2 Historical commander roster — M · ✅ Done

These are playful, fictionalized gameplay interpretations—not claims about the figures' real tactics, beliefs, or character.

| Commander | Doctrine | Mechanical profile |
|---|---|---|
| Abraham Lincoln | Patient resolve | favors survival, measured shots, and late-round recovery |
| Genghis Khan | Relentless pressure | attacks early, accepts wider variance, and values broad battlefield disruption |
| Attila the Hun | Shock assault | favors heavy payloads and immediate pressure over ammunition conservation |
| Julius Caesar | Disciplined precision | prefers reliable firing solutions and controlled terrain denial |
| Napoleon Bonaparte | Bold opportunism | pursues high-value openings and changes targets readily |
| Queen Elizabeth I | Strategic patience | conserves rare weapons and favors low-risk counterattacks |

Each data profile includes target priorities, weapon preferences, risk tolerance, terrain weighting, aim variance, patience, and short bark lines.

Acceptance criteria:

- Seeded simulation batches show measurably different weapon, target, and risk behavior.
- UI explains doctrines without exposing exact weights.
- Art, dialogue, and short biographies use public-domain historical references, avoid fabricated quotations, and avoid ethnic, national, religious, gender, or disability stereotypes.
- The roster contains no copyrighted fictional characters, Nazi figures, or modern extremist leaders.

### 3.3 Difficulty and diagnostics — M · ✅ Done

Add Recruit, Veteran, and Ace plus a developer-only overlay for target, candidate score, predicted impact, and decision time.

Acceptance criteria:

- Descriptions state what difficulty changes.
- Normal play never exposes diagnostics.
- At least 100 seeded simulated battles finish without AI exceptions or time-budget failures.

## M4 — Match structure and persistence (P1)

### 4.1 Round economy and armory — L · ✅ Done

Award credits for survival, damage, and victory; offer a between-round armory with configured prices and caps.

Acceptance criteria:

- Purchases cannot produce negative credits or exceed caps.
- A loss remains recoverable; early success does not make later rounds automatic.
- Rewards cannot be duplicated by restarting or reloading.

### 4.2 Tournament mode — L · ✅ Done

Build a short sequence of escalating battles, rewards, and final score before considering a narrative campaign.

Acceptance criteria:

- Runs can start, advance, finish, restart, and resume after reload.
- Save data is versioned and resettable.
- Continue, retry, and new run have unambiguous consequences.

### 4.3 Fair map generator — L · ✅ Done

Add terrain profiles and hazards only with spawn-safety and viability checks.

Acceptance criteria:

- Tanks spawn on stable, separated ground away from edges and hazards.
- Generation has a bounded retry count and safe fallback.
- Briefings show the seed for reproduction.

## M5 — Audio, menus, and polish (P1)

### 5.1 Retro audio system — M · ✅ Done

Add master/effects/music controls, weapon cues, impact variants, and user-gesture-safe startup.

Acceptance criteria:

- Audio never blocks play or starts before consent.
- Volume and mute persist.
- Rapid effects do not clip excessively or grow without bound.

### 5.2 Complete screen flow — M · ✅ Done

Add title, mode selection, briefing, battle, debrief, and rematch/continue screens.

Acceptance criteria:

- Back and confirm are consistent by mouse and keyboard.
- Debrief accurately reports damage, accuracy, eliminations, turns, and score from recorded events.
- Every screen has a clear next action.

### 5.3 Effects and feedback pass — M · ✅ Done

Add weapon-specific trails, muzzle flash, debris, shake, and hit feedback within effect budgets.

Acceptance criteria:

- Effects never change simulation results.
- Reduced motion removes shake and minimizes flashes.
- Cluster explosions remain responsive on mid-range hardware.

## M6 — Optional replayability (P2)

| Feature | Effort | Scope note | Status |
|---|---:|---|---|
| Hot-seat multiplayer | M | hide private trajectory/armory information while passing turns | ✅ Done (hand-off screen, private armory, series) |
| Challenge scenarios | M | data-defined starts and victory conditions | ✅ Done (6 scenarios, stars) |
| Daily seeded challenge | M | local first; online scores require a trusted backend | ✅ Local done · online scores on hold (owner decision) |
| Replay/history viewer | L | record seeds and commands, not animation frames | ✅ Done (verified playback, share codes) |
| Weather and night | M | must change decisions and stay readable | ✅ Done (clear/gale/rain, night) |
| Names, colors, accessibility themes | S | validate contrast and persist | ✅ Done (3 themes, contrast tests) |
| Sandbox mode | L | expose safe rule and inventory controls | ✅ Done |
| Map editor | XL | scope after the map format stabilizes | ✅ Done (versioned map format v1) |
| Online multiplayer | XL | separate project: authority, sync, reconnects, abuse, hosting | ⏸ On hold (owner decision, 2026-10-03); design in docs/online-design.md |

## First-release non-goals

- exact replication of Scorched Earth assets, UI, names, or balance
- copyrighted guest characters, Nazi figures, or modern extremist personas
- accounts, global leaderboards, matchmaking, or cloud saves
- narrative campaign before tournament progression is proven
- mobile-first touch controls (responsive readability still matters)
- a large framework migration

## AI vibe-coding workflow

Do not implement this backlog in one prompt. Give an AI agent one item or one tightly related slice at a time:

> Implement backlog item **[ID and title]** in the existing Scorched Berth repository.
>
> First inspect the current code, tests, README, and backlog. Preserve behavior except where this item explicitly changes it. State assumptions before editing when they materially affect gameplay.
>
> Meet the item's acceptance criteria and global definition of done. Keep deterministic simulation separate from rendering and DOM code. Reuse the stack; justify any dependency.
>
> Keep the change reviewable. Add focused tests, run full verification, and fix regressions. Do not implement later items opportunistically.
>
> Report files changed, gameplay changes, tests and results, manual checks remaining, and follow-up risks.

Recommended loop:

1. Have the agent inspect and propose a short plan for one item.
2. Ensure the plan covers state changes, edge cases, tests, and migration impact.
3. Implement only that slice.
4. Run automated verification and manually play the affected flow.
5. Commit the working slice before starting another.

## Release gates

- **First playable upgrade:** M0–M2 complete; current loop preserved, cohesive HUD delivered, six weapons stable.
- **AI showcase:** M3 complete; six historical commanders are visibly and measurably distinct in seeded simulations.
- **Version 1.0:** M4–M5 complete; a tournament, persistence, settings/audio, and title-to-debrief flow pass QA.
- Treat M6 as post-1.0 unless playtesting proves one mode essential.
