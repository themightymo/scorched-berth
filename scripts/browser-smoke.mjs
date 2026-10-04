// Optional end-to-end smoke test in headless Chrome (no npm dependencies).
// Usage: npm run build && npm run smoke   (set CHROME_PATH if needed)
// Screenshots are written to SMOKE_OUT (default: ./smoke-output, git-ignored).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { launchChrome, sleep } from './cdp.mjs';

const PORT = Number(process.env.SMOKE_PORT ?? 4179);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.SMOKE_OUT ?? 'smoke-output';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const results = [];
let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`✔ ${name} (${Date.now() - t0}ms)`); } catch (err) { failures++; results.push(`✖ ${name}: ${err.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function playUntil(page, done, { timeout = 150000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.eval(done)) return;
    const st = await page.eval('__sb.machine.state');
    if (st === 'aiming') {
      // Aim roughly toward the nearest living opponent using the real preview.
      await page.eval(`(() => { const s = __sb.session.state; const me = s.tanks[s.actor]; const foes = s.tanks.filter((t, i) => t.alive && i !== s.actor); const f = foes.sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0]; const a = __sb.session.aim[s.actor]; a.angle = f.x > me.x ? 50 : 130; a.power = Math.min(100, Math.max(25, Math.round(Math.sqrt(Math.abs(f.x - me.x) * 320 / Math.sin(Math.PI * 100 / 180)) / 8))); })()`);
      await page.key(' ');
    } else if (st === 'handoff') await page.key('Enter');
    else if (st === 'battleOver') await page.key('Enter');
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${done}; at ${await page.eval('JSON.stringify([__sb.machine.state, __sb.session?.state.turn, __sb.session?.state.tanks.map((t) => t.hp)])')}`);
}

await sleep(1500);
const page = await launchChrome({ port: 9333 });
const noErrors = () => page.logs.filter((l) => ['error', 'exception', 'warning', 'warn'].includes(l.type) && !/favicon/.test(l.text));
try {
  await check('title screen loads without console errors', async () => {
    await page.goto(`${BASE}/?dev=1`);
    await page.eval("localStorage.setItem('scorched-berth.settings', JSON.stringify({ v: 1, speed: 3 }))");
    await page.goto(`${BASE}/?dev=1`);
    assert(await page.eval("__sb.machine.state === 'title'"), 'not on title');
    assert(await page.eval("document.visibilityState === 'visible'"), 'headless page not visible');
    assert(await page.eval("document.querySelectorAll('[data-action]').length >= 10"), 'menu missing');
    await page.screenshot(`${OUT}/title.png`);
    assert(noErrors().length === 0, JSON.stringify(noErrors()));
  });

  await check('every menu screen opens and returns with Escape', async () => {
    for (const action of ['quick', 'sandbox', 'hotseat', 'challenges', 'replays', 'roster', 'editor']) {
      await page.click(`[data-action="${action}"]`);
      await sleep(150);
      await page.screenshot(`${OUT}/screen-${action}.png`);
      await page.eval('document.activeElement.blur()');
      await page.key('Escape');
      await sleep(100);
      assert(await page.eval("__sb.machine.state === 'title'"), `${action}: Escape did not return to title`);
    }
  });

  await check('settings and manual dialogs open and close', async () => {
    await page.click('#btn-settings');
    assert(await page.eval("document.getElementById('dlg-settings').open"), 'settings closed');
    await page.eval("document.querySelector('#settings-form input[name=preview][value=off]').click()");
    await page.key('Escape');
    assert(await page.eval("JSON.parse(localStorage.getItem('scorched-berth.settings')).preview === 'off'"), 'setting not persisted');
    await page.key('h');
    assert(await page.eval("document.getElementById('dlg-help').open"), 'manual did not open');
    await page.key('Escape');
  });

  await check('keyboard-only quick battle: aim, fire, pause freezes the sim', async () => {
    await page.click('[data-action="quick"]');
    await page.click('[data-action="setup-go"]');
    await page.key('Enter');
    await page.waitFor("['aiming','aiThinking'].includes(__sb.machine.state)");
    await page.waitFor("__sb.machine.state === 'aiming'", 30000);
    const before = await page.eval('JSON.stringify(__sb.session.aim[__sb.session.state.actor])');
    await page.key('ArrowLeft'); await page.key('ArrowUp', { shift: true }); await page.key('2');
    const after = JSON.parse(await page.eval('JSON.stringify(__sb.session.aim[__sb.session.state.actor])'));
    assert(JSON.stringify(after) !== before && after.weapon === 'heavy', 'keys did not change aim');
    assert(await page.eval('window.scrollY') === 0, 'page scrolled during gameplay keys');
    await page.key(' ');
    assert(await page.eval("__sb.machine.state === 'projectile'"), 'did not fire');
    await page.key(' ');
    assert(await page.eval('__sb.session.state.commands.length') === 1, 'fired twice');
    await page.key('p');
    assert(await page.eval("__sb.machine.state === 'paused'"), 'not paused');
    const tick = await page.eval('__sb.session.state.tick');
    await sleep(800);
    assert(await page.eval('__sb.session.state.tick') === tick, 'simulation advanced while paused');
    await page.screenshot(`${OUT}/paused.png`);
    await page.key('p');
    assert(await page.eval("__sb.machine.state === 'projectile' || __sb.machine.state === 'resolving' || __sb.machine.state === 'aiThinking' || __sb.machine.state === 'aiming'"), 'did not resume');
  });

  await check('hiding the tab pauses without skipping or duplicating a turn', async () => {
    await page.waitFor("['aiming','aiThinking','projectile','resolving'].includes(__sb.machine.state)", 30000);
    const snap = () => page.eval('JSON.stringify([__sb.session.state.turn, __sb.session.state.commands.length, __sb.session.state.tick])');
    await page.eval("Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))");
    assert(await page.eval("__sb.machine.state === 'paused'"), 'not paused on hide');
    const before = await snap();
    await sleep(1500);
    assert(await snap() === before, 'battle advanced while hidden');
    await page.eval("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))");
    assert(await page.eval("__sb.machine.state === 'paused'"), 'returning to the tab should stay paused until the player resumes');
    await page.key('p');
    assert(await page.eval("__sb.machine.state !== 'paused'"), 'did not resume');
    const [turn, cmds] = JSON.parse(before);
    await page.waitFor(`__sb.session.state.commands.length > ${cmds} || __sb.session.state.turn > ${turn} || __sb.machine.state === 'aiming'`, 20000);
    assert(await page.eval(`__sb.session.state.commands.length <= ${cmds + 1}`), 'a turn was duplicated');
  });

  await check('battle plays to the debrief and rematch works', async () => {
    await playUntil(page, "__sb.machine.state === 'debrief'");
    await page.screenshot(`${OUT}/debrief.png`);
    assert(await page.eval("document.querySelector('.stats-table tbody tr') !== null"), 'no stats table');
    await page.click('[data-action="rematch"]');
    assert(await page.eval("['aiming','aiThinking'].includes(__sb.machine.state)"), 'rematch did not start');
    assert(await page.eval('__sb.session.state.commands.length') === 0, 'rematch kept commands');
    await page.key('p');
    await page.click('[data-ov="quit"]');
    await page.eval("document.querySelector('#dlg-confirm .primary').click()"); await page.waitFor("__sb.machine.state === 'title'", 5000);
    await sleep(100);
    assert(await page.eval("__sb.machine.state === 'title'"), 'quit failed');
  });

  await check('replay viewer verifies the recorded battle', async () => {
    await page.click('[data-action="replays"]');
    await page.click('[data-action="replay-watch"]');
    assert(await page.eval("__sb.machine.state === 'replayViewer'"), 'viewer not open');
    assert(await page.eval("document.querySelector('.replay-status').textContent.includes('Verified')"), 'replay not verified');
    await sleep(1500);
    await page.screenshot(`${OUT}/replay.png`);
    await page.key('Escape');
    await page.key('Escape');
  });

  await check('tournament saves after each shot and resumes after reload', async () => {
    await page.click('[data-action="tournament-new"]');
    await page.click('[data-action="deploy"]');
    await page.waitFor("__sb.machine.state === 'aiming'", 30000);
    await page.key(' ');
    await page.waitFor("__sb.machine.state === 'aiming' && __sb.session.state.commands.length >= 2", 60000);
    const digest = await page.eval("JSON.stringify([__sb.session.state.turn, __sb.session.state.commands.length, __sb.session.state.tanks.map(t => t.hp)])");
    await page.goto(`${BASE}/?dev=1`);
    assert(await page.eval("!!document.querySelector('[data-action=\"tournament-continue\"]')"), 'no continue option');
    await page.click('[data-action="tournament-continue"]');
    await page.click('[data-action="deploy"]');
    const resumed = await page.eval("JSON.stringify([__sb.session.state.turn, __sb.session.state.commands.length, __sb.session.state.tanks.map(t => t.hp)])");
    assert(resumed === digest, `resume mismatch ${resumed} vs ${digest}`);
    await playUntil(page, "__sb.machine.state === 'debrief'");
    const credits = await page.eval('__sb.run.credits');
    await page.goto(`${BASE}/?dev=1`);
    await page.click('[data-action="tournament-continue"]');
    assert(await page.eval("__sb.machine.state === 'debrief'"), 'did not reopen debrief');
    assert(await page.eval('__sb.run.credits') === credits, 'credits changed on reload');
    await page.click('[data-action="t-continue"]');
    assert(await page.eval("__sb.machine.state === 'armory'"), 'no armory');
    await page.screenshot(`${OUT}/armory.png`);
    const c0 = await page.eval('__sb.run.credits');
    await page.eval("document.querySelector('[data-action=\"buy\"]:not([disabled])')?.click()");
    assert(await page.eval('__sb.run.credits') <= c0, 'purchase increased credits');
    assert(await page.eval('__sb.run.credits') >= 0, 'negative credits');
    await page.click('[data-action="armory-done"]');
    assert(await page.eval("__sb.machine.state === 'briefing'"), 'armory did not lead to briefing');
    await page.key('Escape');
  });

  await check('hot-seat hides the next player behind a hand-off screen', async () => {
    await page.click('[data-action="hotseat"]');
    await page.click('[data-action="setup-go"]');
    await page.click('[data-action="deploy"]');
    await page.waitFor("__sb.machine.state === 'handoff'", 20000);
    await page.screenshot(`${OUT}/handoff.png`);
    assert(await page.eval("document.getElementById('out-angle').value === '—'"), 'aim visible during hand-off');
    await page.key('Enter');
    assert(await page.eval("__sb.machine.state === 'aiming'"), 'ready did not start turn');
    await page.key('p');
    await page.click('[data-ov="quit"]');
    await page.eval("document.querySelector('#dlg-confirm .primary').click()"); await page.waitFor("__sb.machine.state === 'title'", 5000);
  });

  await check('challenge and daily briefings deploy', async () => {
    await page.click('[data-action="challenges"]');
    await page.click('[data-action="challenge-play"]');
    await page.click('[data-action="deploy"]');
    assert(await page.eval("__sb.machine.state === 'aiming'"), 'challenge did not start');
    await page.key('p'); await page.click('[data-ov="quit"]'); await page.eval("document.querySelector('#dlg-confirm .primary').click()"); await page.waitFor("__sb.machine.state === 'title'", 5000);
    await page.click('[data-action="daily"]');
    await page.screenshot(`${OUT}/daily.png`);
    await page.click('[data-action="deploy"]');
    assert(await page.eval("['aiming','aiThinking'].includes(__sb.machine.state)"), 'daily did not start');
    await page.key('p'); await page.click('[data-ov="quit"]'); await page.eval("document.querySelector('#dlg-confirm .primary').click()"); await page.waitFor("__sb.machine.state === 'title'", 5000);
  });

  await check('map editor validates and play-tests', async () => {
    await page.click('[data-action="editor"]');
    assert(await page.eval("document.getElementById('ed-problems').textContent.includes('passes')"), 'default map invalid');
    await page.eval("document.getElementById('editor-canvas').focus()");
    for (let i = 0; i < 5; i++) await page.key('ArrowUp');
    await page.click('[data-ed="play"]');
    assert(await page.eval("__sb.machine.state === 'briefing'"), 'play-test did not brief');
    await page.click('[data-action="deploy"]');
    assert(await page.eval("__sb.machine.state === 'aiming'"), 'custom battle did not start');
    await page.key('p'); await page.click('[data-ov="quit"]'); await page.eval("document.querySelector('#dlg-confirm .primary').click()"); await page.waitFor("__sb.machine.state === 'title'", 5000);
  });

  await check('corrupt saves recover with a visible notice', async () => {
    await page.eval("localStorage.setItem('scorched-berth.settings', '{broken'); localStorage.setItem('scorched-berth.tournament', '[1,2')");
    await page.goto(`${BASE}/?dev=1`);
    assert(await page.eval("__sb.machine.state === 'title'"), 'title failed');
    assert(await page.eval("document.querySelector('.notice')?.textContent.includes('backup')"), 'no recovery notice');
    assert(await page.eval("localStorage.getItem('scorched-berth.settings.backup') === '{broken'"), 'no backup kept');
  });

  await check('phone width has no horizontal scroll', async () => {
    await page.setViewport(375, 812, true);
    await page.goto(`${BASE}/?dev=1`);
    assert(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), 'title overflows');
    await page.screenshot(`${OUT}/mobile-title.png`);
    await page.click('[data-action="quick"]');
    await page.click('[data-action="setup-go"]');
    await page.click('[data-action="deploy"]');
    await sleep(300);
    assert(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), 'battle overflows');
    await page.screenshot(`${OUT}/mobile-battle.png`);
    await page.setViewport(1366, 900);
  });

  await check('no console errors or warnings during the run', async () => {
    assert(noErrors().length === 0, JSON.stringify(noErrors().slice(0, 5)));
  });
} finally {
  page.close();
}

await check('reduced-motion preference is honoured', async () => {
  const rm = await launchChrome({ port: 9334, reducedMotion: true });
  try {
    await rm.goto(`${BASE}/`);
    if (!(await rm.eval("document.documentElement.classList.contains('reduced-motion')"))) throw new Error('reduced-motion class missing');
  } finally { rm.close(); }
});

server.kill();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} smoke check(s) failed.` : '\nAll smoke checks passed.');
process.exit(failures ? 1 : 0);
