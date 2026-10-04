// Minimal Chrome DevTools Protocol driver (no dependencies). Used by the
// optional browser smoke test. Requires a local Chrome/Chromium; set
// CHROME_PATH if it is not in the default macOS location.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// Prefer a classic headless shell (always "visible"); Chrome's new headless
// mode can report the page hidden after modal dialogs, which pauses the game.
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  // A Playwright-installed headless shell, if present.
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of readdirSync(join(cache, dir))) {
        const bin = join(cache, dir, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  } catch { /* no cache */ }
  return DEFAULT_CHROME;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ port = 9333, width = 1366, height = 900, reducedMotion = false } = {}) {
  const userDir = mkdtempSync(join(tmpdir(), 'sb-chrome-'));
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []), 'about:blank',
  ];
  const proc = spawn(findBrowser(), args, { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not ready */ }
  }
  if (!target) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message)); else resolve(data.result);
    } else if (data.method) listeners.forEach((l) => l(data));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP ${method} timed out`)); }, 20000);
    pending.set(n, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const logs = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    if (m.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text });
    if (m.method === 'Log.entryAdded') logs.push({ type: m.params.entry.level, text: `${m.params.entry.text} ${m.params.entry.url ?? ''}` });
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // Headless Chrome sometimes reports the page as hidden after modal <dialog>
  // use, which (correctly) pauses the game and stops requestAnimationFrame.
  // ensureVisible() brings the page back to the foreground after input.
  const ensureVisible = async () => {
    const r = await send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
    if (r.result.value !== 'visible') { await send('Page.bringToFront'); await sleep(50); }
  };
  const page = {
    send, logs, ensureVisible,
    async goto(url) { await send('Page.navigate', { url }); await sleep(800); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, { shift = false, code } = {}) {
      const map = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, ' ': 32, Tab: 9 };
      const vk = map[key] ?? key.toUpperCase().charCodeAt(0);
      const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;
      const base = { key, code: code ?? (key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(40);
      await ensureVisible();
    },
    async click(selector) {
      const ok = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
      if (!ok) throw new Error(`No element for ${selector}`);
      await sleep(80);
      await ensureVisible();
    },
    async screenshot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    async setViewport(width, height, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await sleep(200);
    },
    async waitFor(expr, timeout = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { if (await page.eval(expr)) return true; await sleep(100); }
      throw new Error(`Timed out waiting for ${expr}`);
    },
    close() { try { ws.close(); } catch { /* */ } proc.kill(); },
  };
  return page;
}

export { sleep };
