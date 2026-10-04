# Online multiplayer and leaderboards: proposed design

Status: **on hold.** The owner decided on 2026-10-03 to hold off on all online functionality. Do not implement until asked. Both features need a server that someone hosts, pays for, secures, and moderates. Everything below is a proposal for review. No backend, account, or credential has been created.

## What the existing code already provides

- **Deterministic simulation.** A battle is fully defined by `config` + an ordered list of `fire` commands (`src/core/engine.js`). The same inputs produce the same `stateDigest` everywhere: trig uses series math, the RNG is seeded, and the tick is fixed.
- **Replays as data.** `makeReplay` / `verifyReplay` (`src/game/replays.js`) already re-simulate and check a digest.
- **Daily seeds.** `dailyConfig(dateKey)` builds an identical battle for every player.

These make a thin, authoritative server practical: the server only has to validate commands and re-simulate, not stream physics.

## Option A: Online daily leaderboard (smaller; recommended first)

1. The client finishes a daily battle and submits `{ dateKey, config, commands, digest, displayName }`.
2. The server rebuilds `dailyConfig(dateKey)` itself and ignores any client config, then runs `replayBattle` with the submitted commands in a Node worker (the `src/core` modules are DOM-free and run unmodified), checks the digest, and computes the score server-side with `dailyScore`.
3. The score is stored only if re-simulation succeeds. One submission per player per day; later submissions replace earlier ones only if higher.

**Anti-abuse.** Server-side re-simulation stops forged scores, but not tool-assisted aiming (a script could brute-force angle/power offline). Mitigations: a per-day secret salt released at the start of the day that perturbs wind, rate limiting, and an "assisted" flag for runs that used Full preview. Name filtering and a report/remove path are needed for display names.

**Infrastructure.** One small serverless function plus a key-value or SQL table, e.g. Cloudflare Workers + D1, Vercel Functions + Postgres, or Supabase. Expected cost at hobby scale: free tier to a few dollars per month.

**Privacy.** Anonymous device id + display name, no email. Needs a short privacy notice and a deletion path.

## Option B: Online turn-based multiplayer (larger; a separate project)

- **Authority:** server-authoritative command log. Clients send `fire` commands; the server checks `legalCommand`, appends the command, re-simulates to get the new digest, and broadcasts the command. Clients simulate locally and compare digests to detect desyncs.
- **Transport:** WebSockets (e.g. Cloudflare Durable Objects, one object per match), or HTTP polling for asynchronous play-by-turn.
- **Hidden information:** trajectory previews are computed client-side and never shared; armory purchases are sent only to the server.
- **Reconnects:** the match state is `config + commands`, so a reconnecting client replays the log; no snapshot protocol is needed.
- **Turn timers and abandonment:** a per-turn deadline; on timeout the server issues the deterministic AI fallback command for the absent player.
- **Matchmaking, accounts, moderation, abuse reporting, and hosting operations** are all new scope.

## Decisions needed from the owner

1. Is any backend acceptable? If yes, which host or account should be used, and who owns its costs and operations?
2. Leaderboard identity: anonymous display names, or accounts?
3. Should online multiplayer be pursued at all for 1.0+, or only the daily leaderboard?

Until these are answered, both features stay out of scope. The game remains fully playable offline, and daily scores stay local.
