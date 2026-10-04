// Map editor: sculpt a heightmap, place spawns and vents, validate with the
// generator's fairness rules, save locally, share as a code, and play-test.

import { html, raw, esc } from './dom.js';
import { createRenderer } from './render.js';
import { W, SKY_LIMIT, BEDROCK } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { blankMap, encodeMap, decodeMap, prepareMap, MAX_SPAWNS, MAX_SAVED_MAPS } from '../game/mapformat.js';
import { generateMap, PROFILE_IDS, MAP_PROFILES } from '../core/mapgen.js';
import { encodeShare, decodeShare } from '../game/replays.js';

const TOOLS = [
  ['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten'], ['spawn', 'Spawn point'], ['vent', 'Vent'],
];

export function editorTemplate(savedMaps) {
  return html`
  <section class="editor" aria-labelledby="ed-h">
    <h1 id="ed-h" class="screen-title">MAP EDITOR</h1>
    <p class="lede">Sculpt the ground, place two to six spawn points, then validate. Maps must pass the same fairness checks as generated ones.</p>
    <div class="field-frame editor-frame"><canvas id="editor-canvas" width="1400" height="560" tabindex="0" role="application" aria-label="Map canvas. Left and right arrows move the cursor; up and down apply the tool." aria-describedby="ed-keys"></canvas></div>
    <p class="keyhint" id="ed-keys">Mouse: drag to apply the tool. Keyboard (canvas focused): ←/→ move the cursor (Shift ×5) · ↑ raise · ↓ lower · S toggle spawn · V toggle vent · [ ] brush size.</p>
    <div class="editor-tools">
      <fieldset class="box"><legend>TOOL</legend>
        <div class="row wrap" role="radiogroup" aria-label="Tool">${TOOLS.map(([id, label]) => html`<label class="field check"><input type="radio" name="ed-tool" value="${id}" ${raw(id === 'raise' ? 'checked' : '')}> <span>${label}</span></label>`)}</div>
        <label class="field"><span>Brush width <output id="ed-brush-out">60</output></span><input type="range" id="ed-brush" min="10" max="200" step="5" value="60"></label>
      </fieldset>
      <fieldset class="box"><legend>MAP</legend>
        <label class="field"><span>Name</span><input id="ed-name" maxlength="30" value="Untitled ridge" autocomplete="off"></label>
        <label class="field"><span>Start from</span><select id="ed-base">${PROFILE_IDS.map((p) => html`<option value="${p}">${MAP_PROFILES[p].name}</option>`)}<option value="blank">Flat ground</option></select></label>
        <div class="row wrap"><button type="button" data-ed="generate" data-nav>Generate base</button>
        ${savedMaps.length ? html`<select id="ed-load" aria-label="Saved maps">${savedMaps.map((m, i) => html`<option value="${i}">${m.name}</option>`)}</select><button type="button" data-ed="load" data-nav>Load</button><button type="button" data-ed="delete" data-nav>Delete</button>` : ''}</div>
      </fieldset>
      <div class="box">
        <h2 class="box-title">VALIDATION</h2>
        <ul id="ed-problems" class="problems" aria-live="polite"></ul>
        <div class="row wrap">
          <button type="button" data-ed="save" data-nav>Save (${savedMaps.length}/${MAX_SAVED_MAPS})</button>
          <button type="button" data-ed="export" data-nav>Copy share code</button>
          <button type="button" data-ed="play" class="primary" data-nav>Play-test</button>
        </div>
        <label class="field"><span>Import code</span><textarea id="ed-import" rows="2" spellcheck="false"></textarea></label>
        <button type="button" data-ed="import" data-nav>Import</button>
      </div>
    </div>
    <div class="actions"><button type="button" data-action="back" data-nav>Back <kbd>Esc</kbd></button></div>
  </section>`;
}

export function mountEditor(root, { theme, savedMaps, onSave, onDelete, onPlay, announce, initial }) {
  const canvas = root.querySelector('#editor-canvas');
  const renderer = createRenderer(canvas);
  let map = initial ? { ...initial, terrain: initial.terrain.slice() } : (() => { const g = generateMap({ seed: 'EDITOR', profile: 'rolling', count: 4, hazards: false }); return { name: 'Untitled ridge', terrain: g.terrain, spawns: g.spawns, vents: [] }; })();
  let cursor = { x: W / 2 };
  let brush = 60;
  let dragging = false;
  let raf = 0;
  const problemsEl = root.querySelector('#ed-problems');
  root.querySelector('#ed-name').value = map.name;

  const tool = () => root.querySelector('input[name="ed-tool"]:checked')?.value ?? 'raise';

  function validate() {
    const { problems } = prepareMap(map);
    problemsEl.innerHTML = problems.length ? problems.slice(0, 6).map((p) => `<li>✕ ${esc(p)}</li>`).join('') : '<li>✓ Map passes all fairness checks.</li>';
    return problems;
  }

  function apply(kind, x, strength = 1) {
    const r = brush / 2;
    if (kind === 'spawn' || kind === 'vent') return;
    const t = map.terrain;
    const target = t[Math.round(clamp(x, 0, W))];
    const copy = kind === 'smooth' ? t.slice() : null;
    for (let i = Math.max(0, Math.round(x - r)); i <= Math.min(W, Math.round(x + r)); i++) {
      const fall = Math.cos(((i - x) / r) * (Math.PI / 2));
      if (kind === 'raise') t[i] -= 4 * fall * strength;
      else if (kind === 'lower') t[i] += 4 * fall * strength;
      else if (kind === 'flatten') t[i] += (target - t[i]) * 0.35 * fall;
      else if (kind === 'smooth') { let s = 0, n = 0; for (let k = -6; k <= 6; k++) { const j = clamp(i + k, 0, W); s += copy[j]; n++; } t[i] += (s / n - t[i]) * 0.5 * fall; }
      t[i] = clamp(t[i], SKY_LIMIT + 20, BEDROCK - 20);
    }
  }

  function toggleSpawn(x) {
    const near = map.spawns.findIndex((s) => Math.abs(s - x) < 30);
    if (near >= 0) map.spawns.splice(near, 1);
    else if (map.spawns.length < MAX_SPAWNS) map.spawns.push(Math.round(clamp(x, 0, W)));
    else announce(`At most ${MAX_SPAWNS} spawn points.`);
    map.spawns.sort((a, b) => a - b);
    validate();
  }

  function toggleVent(x) {
    const near = map.vents.findIndex((v) => x >= v.x0 - 10 && x <= v.x1 + 10);
    if (near >= 0) map.vents.splice(near, 1);
    else if (map.vents.length < 6) map.vents.push({ x0: Math.round(clamp(x - 30, 0, W)), x1: Math.round(clamp(x + 30, 0, W)) });
    validate();
  }

  const worldX = (ev) => { const r = canvas.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * W; };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.focus();
    cursor.x = worldX(ev);
    const k = tool();
    if (k === 'spawn') return toggleSpawn(cursor.x);
    if (k === 'vent') return toggleVent(cursor.x);
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    apply(k, cursor.x);
  });
  canvas.addEventListener('pointermove', (ev) => { cursor.x = worldX(ev); if (dragging) apply(tool(), cursor.x); });
  const stop = () => { if (dragging) { dragging = false; validate(); } };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 25 : 5;
    let handled = true;
    if (ev.key === 'ArrowLeft') cursor.x = clamp(cursor.x - step, 0, W);
    else if (ev.key === 'ArrowRight') cursor.x = clamp(cursor.x + step, 0, W);
    else if (ev.key === 'ArrowUp') { apply('raise', cursor.x, 2); validate(); }
    else if (ev.key === 'ArrowDown') { apply('lower', cursor.x, 2); validate(); }
    else if (ev.key.toLowerCase() === 's') toggleSpawn(cursor.x);
    else if (ev.key.toLowerCase() === 'v') toggleVent(cursor.x);
    else if (ev.key === '[') setBrush(brush - 10);
    else if (ev.key === ']') setBrush(brush + 10);
    else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  });
  function setBrush(v) {
    brush = clamp(v, 10, 200);
    root.querySelector('#ed-brush').value = brush;
    root.querySelector('#ed-brush-out').value = brush;
  }
  root.querySelector('#ed-brush').addEventListener('input', (e) => setBrush(Number(e.target.value)));
  root.querySelector('#ed-name').addEventListener('input', (e) => { map.name = e.target.value.slice(0, 30); });

  // Listen on the editor section (replaced on every visit) so handlers never accumulate.
  root.querySelector('.editor').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-ed]');
    if (!b) return;
    const what = b.dataset.ed;
    if (what === 'generate') {
      const base = root.querySelector('#ed-base').value;
      if (base === 'blank') map = { ...blankMap(map.name), spawns: map.spawns.slice() };
      else { const g = generateMap({ seed: `ED-${Date.now()}`, profile: base, count: Math.max(2, map.spawns.length || 4), hazards: base === 'vents' }); map = { name: map.name, terrain: g.terrain, spawns: g.spawns, vents: g.vents }; }
      validate();
    } else if (what === 'save') {
      if (validate().length) return announce('Fix the validation problems before saving.');
      onSave(encodeMap(prepareMap(map).map));
    } else if (what === 'load' || what === 'delete') {
      const i = Number(root.querySelector('#ed-load').value);
      if (what === 'delete') return onDelete(i);
      try { map = decodeMap(savedMaps[i]); root.querySelector('#ed-name').value = map.name; validate(); announce(`Loaded ${map.name}.`); } catch { announce('That saved map could not be read.'); }
    } else if (what === 'export') {
      const code = encodeShare(encodeMap(prepareMap(map).map));
      try { await navigator.clipboard.writeText(code); announce('Share code copied to the clipboard.'); } catch { root.querySelector('#ed-import').value = code; announce('Clipboard unavailable: the code is in the import box. Copy it from there.'); }
    } else if (what === 'import') {
      try { map = decodeMap(decodeShare(root.querySelector('#ed-import').value)); root.querySelector('#ed-name').value = map.name; validate(); announce(`Imported ${map.name}.`); } catch (err) { announce(`Import failed: ${err.message}`); }
    } else if (what === 'play') {
      if (validate().length) return announce('Fix the validation problems before play-testing.');
      onPlay(prepareMap(map).map);
    }
  });

  function frame() {
    renderer.drawEditor({ terrain: map.terrain, spawns: map.spawns, vents: map.vents, theme: theme(), cursor, brush });
    raf = requestAnimationFrame(frame);
  }
  validate();
  frame();
  return {
    destroy() { cancelAnimationFrame(raf); },
    get map() { return map; },
  };
}
