# Scorched Earth — Artillery Command

A browser artillery game inspired by Scorched Earth. Built with Canvas, vanilla JavaScript, and Vite.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production build.

## Play

You command Nomad, the green tank. Adjust angle and power, choose a payload, and fire. Angles below 90° fire right; angles above 90° fire left. Wind affects projectiles, explosions deform terrain, and long falls damage tanks. Defeat the three computer opponents to win.

- Left / right arrows: angle
- Up / down arrows: power
- Space: fire
- Music note: toggle synthesized sound
- Question mark: field manual

Standard shells are unlimited. Each battle includes three heavy shells and one mini nuke. New Battle resets the battlefield and ammunition.

## Verify

```sh
node --test tests/game.test.cjs
npm run build
```

Tests cover blast damage, terrain destruction, AI projectiles, ammunition, victory/defeat, and resetting. Fonts use Google Fonts with local fallbacks; gameplay needs no external service.
