// Application controller: owns the state machine, screens, battle loop,
// input, audio, and persistence. Simulation lives in src/core; this file only
// issues commands, steps the fixed-tick engine, and presents state.

import { $, html, raw, esc, isTyping, pad2 } from './dom.js';
import { createRenderer } from './render.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { describe, reasonText } from './log.js';
import * as S from './screens.js';
import { editorTemplate, mountEditor } from './editor.js';

import { createBattle, applyCommand, replayBattle, stateDigest, defenseBlocked } from '../core/engine.js';
import { DEFENSES, ACTIVE_DEFENSES, getDefense } from '../core/defenses.js';
import { createStepper } from '../core/clock.js';
import { trace } from '../core/physics.js';
import { WEAPONS, getWeapon, hasAmmo, defaultInventory, sanitizeInventory, emptyInventory, stockInfo } from '../core/weapons.js';
import { ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { makeSeedCode, normalizeSeedCode, createRng } from '../core/rng.js';
import { PROFILE_IDS } from '../core/mapgen.js';
import { WEATHER, NIGHT } from '../core/weather.js';
import { decideShot } from '../ai/ai.js';
import { COMMANDERS, COMMANDER_IDS, getCommander, HUMAN_BARKS, DIFFICULTY, commanderPlayer } from '../ai/commanders.js';
import { getChassis } from '../core/ratings.js';

import { createMachine } from '../game/machine.js';
import { createStore } from '../game/storage.js';
import { loadSettings, saveSettings, reducedMotion } from '../game/settings.js';
import { THEMES, TANK_COLORS } from '../game/themes.js';
import * as T from '../game/tournament.js';
import { loadRecords, saveRecords, addBattle, defaultRecords } from '../game/records.js';
import { makeReplay, verifyReplay, loadReplays, saveReplays, addReplay, encodeShare, importReplay } from '../game/replays.js';
import { loadMaps, saveMaps, decodeMap } from '../game/mapformat.js';
import { CHALLENGES, getChallenge, challengeConfig, challengeStars, dailyConfig, dailyScore, localDateKey } from '../game/challenges.js';
import { battleStats, battleScore, outcomeFor } from '../game/stats.js';
import { battleRewards, buy, sell } from '../game/economy.js';
import { unlockFor, isUnlocked, lockedWeapons, withKit, newlyUnlocked } from '../game/unlocks.js';

const LIVE = new Set(['aiming', 'aiThinking', 'projectile', 'resolving', 'handoff']);
const AI_DELAY_MS = 750;
const QUIP_CHANCE = 0.3;     // how often a tank says something as it fires

export function startApp() {
  // ── Persistence ─────────────────────────────────────────────────────────
  const store = createStore();
  const notices = [];
  const loadedSettings = loadSettings(store);
  let settings = loadedSettings.data;
  if (['corrupt', 'future'].includes(loadedSettings.status)) notices.push('Saved settings could not be read and were reset. A backup copy was kept.');
  const loadedRun = T.loadRun(store);
  let run = loadedRun.data;
  if (['corrupt', 'future'].includes(loadedRun.status)) notices.push('The tournament save could not be read. A backup copy was kept; start a new run to continue.');
  const loadedRecords = loadRecords(store);
  let records = loadedRecords.data;
  if (['corrupt', 'future'].includes(loadedRecords.status)) notices.push('Service records could not be read and were reset. A backup copy was kept.');
  let replays = loadReplays(store).data;
  let maps = loadMaps(store).data;

  // ── Services ────────────────────────────────────────────────────────────
  const audio = createAudio();
  const renderer = createRenderer($('field'));
  const effects = createEffects();
  const stepper = createStepper();
  const params = new URLSearchParams(location.search);
  const dev = params.has('dev');
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const machine = createMachine('title', { onChange: onStateChange });

  let session = null;   // current battle or replay
  let briefing = null;  // { config, mode, back, extra, meta }
  let setupModel = null;
  let hot = null;       // hot-seat series
  let editor = null;
  let replayMessage = '';
  let lastFrame = performance.now();

  const theme = () => THEMES[settings.theme] ?? THEMES.console;
  const reduced = () => reducedMotion(settings, motionQuery?.matches);
  const profile = () => ({ playerName: settings.playerName, playerColor: settings.playerColor, playerChassis: settings.playerChassis });
  // ?dev (or ?unlockall) opens the whole arsenal for testing; it never changes the saved record.
  const unlockOpts = { all: dev || params.has('unlockall') };
  const starterKit = (inv) => withKit(inv, records, unlockOpts);
  const lockedSet = () => new Set(lockedWeapons(records, unlockOpts));

  // ── Settings application ────────────────────────────────────────────────
  function applySettings() {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme().ui)) root.style.setProperty(`--${k}`, v);
    root.dataset.theme = settings.theme;
    root.classList.toggle('reduced-motion', reduced());
    root.classList.toggle('large-text', settings.textSize === 'large');
    root.classList.toggle('scanlines', settings.scanlines);
    root.classList.toggle('flicker', settings.flicker && !reduced());
    audio.configure(settings.audio);
    const mute = $('btn-mute');
    mute.setAttribute('aria-pressed', String(settings.audio.muted));
    mute.querySelector('span').textContent = settings.audio.muted ? 'Muted' : 'Sound';
    renderer.invalidate();
  }
  function persistSettings() { saveSettings(store, settings); applySettings(); }
  motionQuery?.addEventListener?.('change', applySettings);

  // ── Announcements ───────────────────────────────────────────────────────
  let announceTimer = 0;
  function announce(text) {
    const el = $('announcer');
    el.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.textContent = text; }, 30);
  }

  // ── Screens ─────────────────────────────────────────────────────────────
  function showScreen(content, { focus = true } = {}) {
    editor?.destroy(); editor = null;
    $('battle').hidden = true;
    const screen = $('screen');
    screen.hidden = false;
    screen.innerHTML = content.html;
    $('btn-pause').hidden = true;
    $('topbar-status').textContent = '';
    if (focus) {
      const target = screen.querySelector('[data-nav].primary:not([disabled])') ?? screen.querySelector('[data-nav]:not([disabled])');
      (target ?? screen).focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }

  function showBattleView() {
    editor?.destroy(); editor = null;
    $('screen').hidden = true;
    $('screen').innerHTML = '';
    $('battle').hidden = false;
    $('field-frame').tabIndex = 0;
  }

  function onStateChange(to) {
    $('btn-pause').hidden = !(LIVE.has(to) || to === 'paused');
    audio.music(to === 'title' || to === 'briefing' || to === 'armory' || to === 'debrief' || to === 'tournamentEnd');
  }

  function goTitle() {
    cancelAi();
    session = null;
    if (!machine.go('title')) return;
    const today = localDateKey();
    showScreen(S.titleScreen({ run, records, notices, dailyKey: today, daily: records.daily[today] }));
  }

  // ── Setup (quick / sandbox / hot-seat) ──────────────────────────────────
  function randomAi(rng, taken = []) {
    const pool = COMMANDER_IDS.filter((c) => !taken.includes(c));
    const id = rng.pick(pool.length ? pool : COMMANDER_IDS);
    return { kind: 'ai', commander: id, difficulty: 'veteran' };
  }
  function newSetup(mode) {
    const rng = createRng(makeSeedCode());
    const players = [{ kind: 'human', name: settings.playerName, color: settings.playerColor, chassis: settings.playerChassis }];
    if (mode === 'hotseat') players.push({ kind: 'human', name: 'Player 2', color: TANK_COLORS.find((c) => c.hex !== settings.playerColor).hex, chassis: 'standard' });
    const count = mode === 'hotseat' ? 1 : 3;
    for (let i = 0; i < count; i++) players.push(randomAi(rng, players.map((p) => p.commander)));
    return {
      mode, seed: makeSeedCode(), profile: rng.pick(PROFILE_IDS), weather: 'clear', night: false, hazards: true, rounds: 3, players,
      rules: { gravity: 1, windMax: null, windStep: null, startHp: 100, maxTurns: 160, walls: 'open', unlimitedAmmo: false },
      inventory: defaultInventory(),
    };
  }
  function openSetup(mode, keep = false) {
    if (!keep || !setupModel || setupModel.mode !== mode) setupModel = newSetup(mode);
    machine.go('setup');
    showScreen(S.setupScreen(setupModel, { locked: lockedSet() }));
  }
  function readSetupForm() {
    const m = setupModel;
    const v = (id) => $(id)?.value;
    m.profile = v('s-profile') ?? m.profile;
    m.weather = v('s-weather') ?? m.weather;
    m.night = !!$('s-night')?.checked;
    m.hazards = !!$('s-hazards')?.checked;
    m.seed = normalizeSeedCode(v('s-seed') || m.seed);
    if ($('s-rounds')) m.rounds = Number(v('s-rounds')) || 1;
    document.querySelectorAll('[data-p]').forEach((el) => {
      const p = m.players[Number(el.dataset.p)];
      if (p) p[el.dataset.k] = el.value;
    });
    if (m.mode === 'sandbox') {
      const num = (id, d) => (Number.isFinite(Number(v(id))) && v(id) !== '' ? Number(v(id)) : d);
      m.rules = {
        gravity: clamp(num('r-gravity', 100) / 100, 0.4, 2), windMax: clamp(Math.round(num('r-windmax', 15)), 0, 40), windStep: clamp(Math.round(num('r-windstep', 3)), 0, 12),
        startHp: clamp(Math.round(num('r-hp', 100)), 10, 400), maxTurns: clamp(Math.round(num('r-turns', 160)), 4, 400), walls: v('r-walls') === 'rebound' ? 'rebound' : 'open', unlimitedAmmo: !!$('r-unlimited')?.checked,
      };
      const inv = {};
      const locked = lockedSet();
      for (const w of WEAPONS) if (!w.ammo.unlimited && !locked.has(w.id)) inv[w.id] = clamp(Math.round(num(`inv-${w.id}`, 0)), 0, 9);
      for (const d of DEFENSES) inv[d.id] = clamp(Math.round(num(`inv-${d.id}`, 0)), 0, 9);
      m.inventory = sanitizeInventory(inv);
    }
  }
  function setupToConfig(m, seed = m.seed) {
    const inv = m.mode === 'sandbox' ? m.inventory : defaultInventory();
    return {
      seed, mode: m.mode,
      label: m.mode === 'hotseat' ? `Hot-seat · Round ${hot?.round ?? 1}/${m.rounds}` : m.mode === 'sandbox' ? 'Sandbox' : 'Quick battle',
      map: { profile: m.profile, hazards: m.hazards }, weather: m.weather, night: m.night,
      rules: m.mode === 'sandbox' ? m.rules : {},
      players: m.players.map((p, i) => (p.kind === 'human'
        ? { kind: 'human', name: (p.name || `Player ${i + 1}`).slice(0, 16), color: p.color, ratings: getChassis(p.chassis).ratings, inventory: hot?.wallets?.[i]?.inventory ?? (m.mode === 'sandbox' ? { ...inv } : starterKit(inv)) }
        : commanderPlayer(p.commander, p.difficulty, { inventory: { ...inv } }))),
    };
  }

  // ── Briefing ────────────────────────────────────────────────────────────
  function showBriefing(config, mode, { back = 'title', extra = '', meta = {} } = {}) {
    briefing = { config, mode, back, extra, meta };
    if (!machine.go('briefing')) return;
    showScreen(S.briefingScreen({ config, map: null, mode, extra }));
  }

  function briefingBack() {
    const b = briefing?.back;
    if (b === 'setup') return openSetup(setupModel.mode, true);
    if (b === 'challenges') return openChallenges();
    if (b === 'editor') return openEditor(briefing.meta.map);
    return goTitle();
  }

  function deploy() {
    const { config, mode, meta } = briefing;
    if (mode === 'tournament') {
      run = T.startBattle(run, config);
      T.saveRun(store, run);
      return startBattle(run.battle.config, { mode, battleId: run.battle.id, resumeCommands: run.battle.commands });
    }
    if (mode === 'daily') {
      const key = config.dailyKey;
      const d = records.daily[key] ?? { best: 0, attempts: 0, won: false };
      records = { ...records, daily: { ...records.daily, [key]: { ...d, attempts: d.attempts + 1 } } };
      saveRecords(store, records);
    }
    startBattle(config, { mode, battleId: `${mode}:${config.seed}:${Date.now().toString(36)}`, meta });
  }

  // ── Battle lifecycle ────────────────────────────────────────────────────
  function cancelAi() {
    if (!session) return;
    session.aiToken++;
    clearTimeout(session.aiTimer);
    session.aiTimer = 0;
  }

  function startBattle(config, { mode, battleId, resumeCommands = [], meta = {} }) {
    cancelAi();
    let state;
    try {
      state = resumeCommands.length ? replayBattle(config, resumeCommands) : createBattle(config);
    } catch (err) {
      console.error(err);
      if (mode === 'tournament') { run = T.retryRound(run); T.saveRun(store, run); }
      notices.push(`The battle could not be restored (${err.message}). It was reset.`);
      return goTitle();
    }
    session = {
      state, config: state.config, mode, battleId, meta,
      aim: {}, aiToken: 0, aiTimer: 0, diag: null, lastHuman: null, finished: false, replay: null,
      humans: state.tanks.map((t, i) => (t.kind === 'human' ? i : -1)).filter((i) => i >= 0),
    };
    effects.reset(state);
    stepper.reset();
    renderer.invalidate();
    $('log').innerHTML = '';
    if (resumeCommands.length) logLine({ text: `Battle resumed after ${resumeCommands.length} shots.`, tone: 'info' });
    else for (const e of state.events) { const d = describe(e, state); if (d) logLine(d); }
    effects.cursor = state.events.length;
    showBattleView();
    renderWeaponList();
    renderDefenseList();
    $('topbar-status').textContent = `${config.label ?? mode.toUpperCase()} · SEED ${state.seed}`;
    $('field').setAttribute('aria-label', `Battlefield: ${state.tanks.length} tanks. Use the battle log and tank list for details.`);
    nextTurnFlow();
    $('field-frame').focus({ preventScroll: true });
  }

  /** Decide which sub-state follows now that the engine is idle. */
  function nextTurnFlow() {
    const s = session.state;
    hideOverlay();
    if (s.phase === 'battleOver') return finishBattle();
    if (s.phase !== 'aiming') return machine.go(s.phase);
    const tank = s.tanks[s.actor];
    if (tank.kind === 'ai') {
      machine.go('aiThinking');
      scheduleAi();
    } else if (session.humans.length > 1 && session.lastHuman !== s.actor) {
      machine.go('handoff');
      showHandoff();
    } else {
      beginHumanTurn();
    }
    updateHud();
  }

  function beginHumanTurn() {
    const s = session.state;
    machine.go('aiming');
    hideOverlay();
    session.lastHuman = s.actor;
    const t = s.tanks[s.actor];
    const aim = session.aim[s.actor] ?? { angle: t.angle, power: t.power, weapon: 'shell' };
    if (!s.config.rules.unlimitedAmmo && !hasAmmo(t.inventory, aim.weapon)) aim.weapon = 'shell';
    aim.defense = null; // a defense is chosen fresh each turn so it is never spent by accident
    session.aim[s.actor] = aim;
    renderWeaponList();
    renderDefenseList();
    updateHud();
    const wind = s.wind === 0 ? 'calm' : `${Math.abs(s.wind)} ${s.wind > 0 ? 'east' : 'west'}`;
    announce(`${t.name}, your turn. Wind ${wind}. Angle ${aim.angle}, power ${aim.power}, ${getWeapon(aim.weapon).name}.`);
    showBanner(session.humans.length > 1 ? `${t.name.toUpperCase()} — YOUR TURN` : 'YOUR TURN');
    if (document.activeElement === document.body) $('field-frame').focus({ preventScroll: true });
  }

  function scheduleAi() {
    const token = ++session.aiToken;
    const s = session.state;
    const t = s.tanks[s.actor];
    showBanner(`${t.name.toUpperCase()} IS AIMING`);
    session.aiTimer = setTimeout(() => {
      if (!session || token !== session.aiToken || machine.state !== 'aiThinking') return;
      const { command, diagnostics } = decideShot(s, s.actor);
      session.diag = dev ? diagnostics : null;
      if (dev) console.debug('[ai]', diagnostics);
      issue(command);
    }, AI_DELAY_MS / settings.speed);
  }

  function issue(command) {
    const s = session.state;
    const res = applyCommand(s, command);
    if (!res.ok) { audio.play('deny'); announce(res.error); return false; }
    if (session.mode === 'tournament' && run?.battle?.id === session.battleId) {
      run = T.recordCommand(run, session.battleId, s.commands.at(-1));
      T.saveRun(store, run);
    }
    machine.go('projectile');
    hideBanner();
    updateHud();
    return true;
  }

  function fireHuman() {
    if (machine.state !== 'aiming' || !session) return;
    const s = session.state;
    const aim = session.aim[s.actor];
    const cmd = { type: 'fire', actor: s.actor, weapon: aim.weapon, angle: aim.angle, power: aim.power };
    if (aim.defense) cmd.use = aim.defense;
    const shot = shotPath(s, aim);
    if (!issue(cmd)) return;
    if (shot) (session.lastShot ??= {})[cmd.actor] = shot;
    aim.defense = null;
    audio.play('fire');
  }

  function pauseBattle(reason = '') {
    if (!session || session.replay || !LIVE.has(machine.state)) return false;
    cancelAi();
    machine.go('paused');
    showPauseMenu(reason);
    updateHud();
    return true;
  }

  function resumeBattle() {
    if (machine.state !== 'paused') return;
    hideOverlay();
    machine.resume();
    if (machine.state === 'aiThinking') scheduleAi();
    if (machine.state === 'handoff') showHandoff();
    if (machine.state === 'aiming') showBanner('RESUMED');
    stepper.reset();
    updateHud();
    $('field-frame').focus({ preventScroll: true });
  }

  async function restartBattle() {
    if (session.mode === 'tournament') {
      const ok = await confirmDialog(`Restarting a tournament battle counts as a retry: −${T.RETRY_PENALTY} score, and your credits and arsenal return to the start of this round.`, 'Restart round');
      if (!ok) return;
      run = T.retryRound(run);
      T.saveRun(store, run);
      cancelAi();
      session = null;
      machine.go('briefing');
      return openTournamentStage();
    }
    const ok = await confirmDialog('Restart this battle from the first turn? The current battle is discarded.', 'Restart');
    if (!ok) return;
    const { config, mode, meta } = session;
    if (mode === 'daily') { const d = records.daily[config.dailyKey]; records.daily[config.dailyKey] = { ...d, attempts: (d?.attempts ?? 0) + 1 }; saveRecords(store, records); }
    startBattle(config, { mode, battleId: `${mode}:${config.seed}:${Date.now().toString(36)}`, meta });
  }

  async function quitBattle() {
    const tournament = session?.mode === 'tournament';
    const ok = await confirmDialog(tournament ? 'Quit to the title? Your tournament battle is saved after every shot and resumes where you left off.' : 'Quit to the title? This battle will be discarded.', 'Quit to title');
    if (!ok) return;
    goTitle();
  }

  function finishBattle() {
    if (session.finished) return;
    session.finished = true;
    cancelAi();
    machine.go('battleOver');
    const s = session.state;
    const humanIdx = session.humans[0] ?? 0;
    const outcome = session.humans.length ? outcomeFor(s, humanIdx) : 'spectate';
    audio.play(outcome === 'victory' || (session.humans.length > 1 && s.result.winner != null && s.tanks[s.result.winner].kind === 'human') ? 'victory' : 'defeat');
    // Persist exactly once per battle.
    const stats = battleStats(s);
    const before = records;
    if (session.mode !== 'sandbox' && session.mode !== 'custom') {
      for (const i of session.humans) records = addBattle(records, `${session.battleId}:${i}`, stats.tanks[i], outcomeFor(s, i) === 'victory');
    }
    if (session.mode === 'tournament') {
      run = T.completeBattle(run, session.battleId, s, humanIdx);
      T.saveRun(store, run);
    }
    if (session.mode === 'daily') {
      const key = s.config.dailyKey, d = records.daily[key] ?? { best: 0, attempts: 1, won: false };
      records.daily = { ...records.daily, [key]: { best: Math.max(d.best, dailyScore(s)), attempts: d.attempts, won: d.won || outcome === 'victory' } };
    }
    if (session.mode === 'challenge') {
      const ch = getChallenge(s.config.challengeId);
      const stars = challengeStars(ch, s);
      const prev = records.challenges[ch.id] ?? { stars: 0, best: 0 };
      records.challenges = { ...records.challenges, [ch.id]: { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, stars) } };
      session.stars = stars;
    }
    saveRecords(store, records);
    session.unlocked = newlyUnlocked(before, records);
    if (session.unlocked.length) audio.play('victory');
    replays = addReplay(replays, makeReplay(s, { title: s.config.label ?? `${session.mode} battle` }));
    saveReplays(store, replays);
    session.replaySaved = true;
    const winner = s.result.winner == null ? 'No winner' : `${s.tanks[s.result.winner].name} wins`;
    showOverlay(html`<div class="overlay-card" role="dialog" aria-modal="true" aria-labelledby="over-h">
      <p class="eyebrow">BATTLE OVER</p><h2 id="over-h" class="screen-title">${winner}</h2><p>${reasonText(s.result.reason)}</p>
      <button type="button" class="primary" data-ov="debrief" data-nav>View debrief <kbd>Enter</kbd></button></div>`);
    announce(`Battle over. ${winner}. ${reasonText(s.result.reason)}`);
    updateHud();
  }

  // ── Debrief ─────────────────────────────────────────────────────────────
  function showDebrief() {
    const s = session.state;
    const stats = battleStats(s);
    const me = session.humans[0] ?? 0;
    const outcome = session.humans.length === 0 ? 'spectate' : session.humans.length > 1 ? (s.result.winner != null && s.tanks[s.result.winner].kind === 'human' ? 'victory' : 'draw') : outcomeFor(s, me);
    let score = session.humans.length === 1 ? battleScore(stats.tanks[me], outcome === 'victory') : null;
    let rewards = null, extra = '', actions = [];
    const title = s.config.label ?? 'Battle';
    const watch = { action: 'watch-last', label: 'Watch replay' };
    const titleBtn = { action: 'title', label: 'Title screen' };
    switch (session.mode) {
      case 'tournament': {
        const p = run?.pending;
        if (p && p.id === session.battleId) { score = p.score; rewards = p.rewards; }
        extra = `Tournament score ${run.score} · credits ${run.credits}.`;
        actions = [
          { action: 't-continue', label: run.round + 1 >= T.ROUNDS.length ? 'Finish tournament' : 'Continue to armory', primary: true, key: 'Enter', note: outcome === 'victory' ? '' : 'Keep this result and its credits.' },
          ...(T.canRetry(run) ? [{ action: 't-retry', label: 'Retry round', note: `−${T.RETRY_PENALTY} score; credits and arsenal reset to the start of this round.` }] : []),
          watch, { action: 'title', label: 'Save and quit to title' },
        ];
        break;
      }
      case 'challenge': {
        const ch = getChallenge(s.config.challengeId);
        extra = session.stars ? `Challenge complete: ${'★'.repeat(session.stars)}${'☆'.repeat(3 - session.stars)}` : 'Challenge failed. Try a different payload or angle.';
        actions = [{ action: 'rematch', label: 'Retry challenge', primary: true, key: 'Enter' }, { action: 'challenges', label: 'All challenges' }, watch, titleBtn];
        void ch;
        break;
      }
      case 'daily': {
        const d = records.daily[s.config.dailyKey];
        extra = `Daily score ${dailyScore(s)} · best today ${d?.best ?? 0} · attempts ${d?.attempts ?? 1}. Scores are kept on this device only.`;
        actions = [{ action: 'rematch', label: 'Try again', primary: true, key: 'Enter', note: 'Same battlefield and opponents; counts as another attempt.' }, watch, titleBtn];
        break;
      }
      case 'hotseat': {
        const next = hotAfterBattle(s, stats);
        rewards = null;
        extra = next.summary;
        actions = next.done
          ? [{ action: 'hot-new', label: 'New hot-seat series', primary: true, key: 'Enter' }, watch, titleBtn]
          : [{ action: 'hot-next', label: `Round ${hot.round + 1}: armory`, primary: true, key: 'Enter', note: 'Each player shops in private.' }, watch, titleBtn];
        break;
      }
      case 'custom':
        actions = [{ action: 'rematch', label: 'Play again', primary: true, key: 'Enter' }, { action: 'editor-back', label: 'Back to editor' }, watch, titleBtn];
        break;
      default:
        actions = [
          { action: 'rematch', label: 'Rematch', primary: true, key: 'Enter', note: 'Same seed, same battlefield.' },
          { action: 'new-battle', label: 'New battle', note: 'Same setup, new seed.' },
          { action: 'change-setup', label: 'Change setup' }, watch, titleBtn,
        ];
    }
    machine.go('debrief');
    showScreen(S.debriefScreen({ state: s, stats, me, outcome, mode: session.mode, score, rewards, actions, title, extra, replaySaved: session.replaySaved, unlocked: session.unlocked ?? [] }));
  }

  // ── Tournament ──────────────────────────────────────────────────────────
  function openTournamentStage() {
    if (!run) return goTitle();
    switch (run.stage) {
      case 'briefing':
        return showBriefing(T.roundConfig(run, profile()), 'tournament', { extra: `Round ${run.round + 1} of ${T.ROUNDS.length}. Score ${run.score} · credits ${run.credits}. Progress saves after every shot.` });
      case 'battle':
        return showBriefing(run.battle.config, 'tournament', { extra: `Battle in progress: ${run.battle.commands.length} shots fired. Deploy to resume exactly where you left off.` });
      case 'debrief': {
        // Rebuild the finished battle from its stored commands.
        const p = run.pending;
        try {
          const state = replayBattle(p.replay.config, p.replay.commands);
          session = { state, config: state.config, mode: 'tournament', battleId: p.id, aim: {}, aiToken: 0, humans: [0], finished: true, replaySaved: false };
          machine.go('debrief');
          return showDebrief();
        } catch {
          run = T.continueRun(run);
          T.saveRun(store, run);
          return openTournamentStage();
        }
      }
      case 'armory': return openArmory();
      case 'complete': return showTournamentEnd();
      default: return goTitle();
    }
  }

  function showTournamentEnd() {
    const best = records.bestTournament;
    let unlocked = [];
    if (!records.recorded.includes(`run:${run.runId}`)) {
      const before = records;
      const newBest = !best || run.score > best.score;
      records = { ...records, tournaments: records.tournaments + 1, recorded: [...records.recorded, `run:${run.runId}`], bestTournament: newBest ? { score: run.score, rank: T.rankFor(run.score), date: localDateKey() } : best };
      saveRecords(store, records);
      unlocked = newlyUnlocked(before, records);
    }
    machine.go('tournamentEnd');
    showScreen(S.tournamentEndScreen(run, best, unlocked));
  }

  function openArmory(message = '') {
    machine.go('armory');
    if (session?.mode === 'hotseat' || hot?.shopping) return renderHotArmory(message);
    showScreen(S.armoryScreen({
      who: settings.playerName, credits: run.credits, inventory: run.inventory, message, locks: armoryLocks(),
      heading: `TOURNAMENT · BEFORE ROUND ${run.round + 1}: ${T.ROUNDS[run.round].name.toUpperCase()}`,
      nextLabel: `To briefing: round ${run.round + 1}`,
      history: `Score ${run.score}. Next: ${T.opponentsFor(run, run.round).map((o) => `${getCommander(o.commander).name} (${DIFFICULTY[o.difficulty].name})`).join(', ')}.`,
    }), { focus: !message });
  }

  /** Locked weapon id → { text, have, goal } for the armory cards. */
  function armoryLocks() {
    const out = {};
    for (const id of lockedSet()) { const u = unlockFor(id); out[id] = { text: u.text, have: Math.min(u.goal, Math.floor(Number(u.progress(records)) || 0)), goal: u.goal }; }
    return out;
  }

  // ── Hot-seat series ─────────────────────────────────────────────────────
  function startHotSeries() {
    const humans = setupModel.players.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);
    hot = { round: 1, rounds: setupModel.rounds, wins: {}, wallets: {}, shopping: null, humans };
    for (const i of humans) { hot.wins[i] = 0; hot.wallets[i] = { credits: 0, inventory: starterKit(defaultInventory()) }; }
  }

  function hotAfterBattle(s, stats) {
    if (!hot.recorded?.includes(session.battleId)) {
      hot.recorded = [...(hot.recorded ?? []), session.battleId];
      const w = s.result.winner;
      if (w != null && hot.wins[w] != null) hot.wins[w]++;
      for (const i of hot.humans) {
        const r = battleRewards(stats.tanks[i], outcomeFor(s, i));
        hot.wallets[i] = { credits: hot.wallets[i].credits + r.total, inventory: sanitizeInventory(s.tanks[i].inventory, { capped: true }) };
      }
    }
    const table = hot.humans.map((i) => `${s.tanks[i].name}: ${hot.wins[i]} win${hot.wins[i] === 1 ? '' : 's'}`).join(' · ');
    const need = Math.floor(hot.rounds / 2) + 1;
    const champion = hot.humans.find((i) => hot.wins[i] >= need);
    const done = hot.round >= hot.rounds || champion != null;
    const summary = done ? `Series over. ${champion != null ? `${s.tanks[champion].name} takes the series.` : 'Series drawn.'} ${table}` : `Round ${hot.round} of ${hot.rounds}. ${table}`;
    return { done, summary };
  }

  function hotNextRound() {
    hot.round++;
    hot.shopping = { order: hot.humans.slice(), index: 0, gate: true };
    openArmory();
  }

  function renderHotArmory(message = '') {
    const sh = hot.shopping;
    const idx = sh.order[sh.index];
    const p = setupModel.players[idx];
    if (sh.gate) {
      showScreen(html`<section class="handoff-screen" aria-labelledby="ho-h"><p class="eyebrow">HOT-SEAT · ROUND ${hot.round}</p><h1 id="ho-h" class="screen-title">PASS TO ${p.name.toUpperCase()}</h1>
        <p class="lede">The armory shows ${p.name}'s credits and arsenal. Other players, look away.</p>
        <div class="actions"><button type="button" class="primary" data-action="hot-gate" data-nav>${p.name} is ready <kbd>Enter</kbd></button></div></section>`);
      return;
    }
    const wallet = hot.wallets[idx];
    showScreen(S.armoryScreen({ who: p.name, credits: wallet.credits, inventory: wallet.inventory, message, locks: armoryLocks(), heading: `HOT-SEAT · BEFORE ROUND ${hot.round}`, nextLabel: sh.index + 1 < sh.order.length ? 'Done: pass to next player' : 'Done: to briefing' }), { focus: !message });
  }

  // ── Challenges / daily / editor / replays ───────────────────────────────
  function openChallenges() {
    machine.go('challenges');
    showScreen(S.challengesScreen(records));
  }

  function openEditor(initial) {
    machine.go('editor');
    showScreen(raw(editorTemplate(maps.items).html));
    editor = mountEditor($('screen'), {
      theme, savedMaps: maps.items, announce, initial,
      onSave: (encoded) => {
        const items = [encoded, ...maps.items.filter((m) => m.name !== encoded.name)].slice(0, 10);
        maps = { ...maps, items };
        saveMaps(store, maps);
        announce(`Saved “${encoded.name}”.`);
        const keep = editor.map; openEditor(keep);
      },
      onDelete: (i) => { const keep = editor.map; maps = { ...maps, items: maps.items.filter((_, k) => k !== i) }; saveMaps(store, maps); openEditor(keep); announce('Map deleted.'); },
      onPlay: (map) => {
        const rng = createRng(makeSeedCode());
        const players = [{ kind: 'human', name: settings.playerName, color: settings.playerColor, ratings: getChassis(settings.playerChassis).ratings, inventory: starterKit(defaultInventory()) }];
        for (let i = 1; i < map.spawns.length; i++) players.push(commanderPlayer(rng.pick(COMMANDERS).id, 'veteran'));
        const config = { seed: makeSeedCode(), mode: 'custom', label: `Play-test · ${map.name}`, map: { custom: map, name: map.name }, weather: 'clear', night: false, players, shufflePositions: false };
        showBriefing(config, 'custom', { back: 'editor', meta: { map } });
      },
    });
  }

  function openReplays(message = replayMessage) {
    replayMessage = '';
    cancelAi();
    session = null;
    machine.go('replays');
    showScreen(S.replaysScreen(replays.items, message));
  }

  function watchReplay(rep) {
    const check = verifyReplay(rep);
    let state;
    try { state = createBattle(rep.config); } catch (err) { return openReplays(`Replay could not start: ${err.message}`); }
    session = {
      state, config: state.config, mode: 'replay', aim: {}, aiToken: 0, humans: [], finished: true, diag: null,
      replay: { rep, index: 0, playing: true, wait: 0.9, speed: 1, verified: check.ok, error: check.error },
    };
    effects.reset(state);
    stepper.reset();
    renderer.invalidate();
    $('log').innerHTML = '';
    for (const e of state.events) { const d = describe(e, state); if (d) logLine(d); }
    effects.cursor = state.events.length;
    machine.go('replayViewer');
    showBattleView();
    $('topbar-status').textContent = `REPLAY · ${rep.title} · SEED ${rep.config.seed}`;
    renderWeaponList();
    renderDefenseList();
    updateHud();
    showReplayBar();
    $('field-frame').focus({ preventScroll: true });
  }

  function replayRestart() { if (session?.replay) watchReplay(session.replay.rep); }

  function replayStepFrame(dt) {
    const r = session.replay, s = session.state;
    if (!r.playing) return;
    if (s.phase === 'aiming') {
      if (r.index >= r.rep.commands.length) { r.playing = false; showReplayBar(); return; }
      r.wait -= dt * r.speed;
      if (r.wait > 0) return;
      const res = applyCommand(s, r.rep.commands[r.index]);
      if (!res.ok) { r.playing = false; r.error = `Desync at shot ${r.index + 1}: ${res.error}`; showReplayBar(); return; }
      r.index++;
      r.wait = 0.9;
      showReplayBar();
    }
    if (s.phase === 'battleOver') { r.playing = false; showReplayBar(); return; }
    stepper.advance(s, dt, r.speed);
  }

  function showReplayBar() {
    const r = session.replay;
    const total = r.rep.commands.length;
    const status = r.error ? `⚠ ${r.error}` : r.verified ? '✓ Verified: re-simulation matches the recorded result.' : '⚠ Re-simulation does not match the recorded result.';
    showOverlay(html`<div class="replay-bar" role="toolbar" aria-label="Replay controls">
      <span>Shot ${Math.min(r.index, total)}/${total}${session.state.phase === 'battleOver' ? ' · finished' : ''}</span>
      <button type="button" data-ov="replay-toggle" data-nav>${r.playing ? '❚❚ Pause' : '▶ Play'} <kbd>Space</kbd></button>
      <button type="button" data-ov="replay-speed" data-nav>Speed ×${r.speed} <kbd>S</kbd></button>
      <button type="button" data-ov="replay-restart" data-nav>Restart <kbd>R</kbd></button>
      <button type="button" data-ov="replay-exit" data-nav>Exit <kbd>Esc</kbd></button>
      <span class="replay-status">${status}</span>
    </div>`, 'bar');
  }

  // ── Overlays / dialogs ──────────────────────────────────────────────────
  function showOverlay(content, kind = 'modal') {
    const ov = $('field-overlay');
    ov.innerHTML = content.html;
    ov.className = `field-overlay ${kind}`;
    ov.hidden = false;
    $('hud').toggleAttribute('inert', kind === 'modal');
    if (kind === 'modal') (ov.querySelector('.primary') ?? ov.querySelector('button'))?.focus({ preventScroll: true });
  }
  function hideOverlay() {
    const ov = $('field-overlay');
    ov.hidden = true;
    ov.innerHTML = '';
    $('hud').removeAttribute('inert');
  }

  function showPauseMenu(reason) {
    const tournament = session.mode === 'tournament';
    showOverlay(html`<div class="overlay-card" role="dialog" aria-modal="true" aria-labelledby="pause-h">
      <p class="eyebrow">${reason || 'GAME PAUSED'}</p><h2 id="pause-h" class="screen-title">PAUSED</h2>
      <p>The battle is frozen, including AI turns and shots in flight.</p>
      <div class="menu">
        <button type="button" class="primary" data-ov="resume" data-nav>Resume <kbd>P</kbd></button>
        <button type="button" data-ov="restart" data-nav>${tournament ? `Restart round (−${T.RETRY_PENALTY} score)` : 'Restart battle'}</button>
        <button type="button" data-ov="settings" data-nav>Settings</button>
        <button type="button" data-ov="help" data-nav>Field manual</button>
        <button type="button" data-ov="quit" data-nav>${tournament ? 'Save and quit to title' : 'Quit to title'}</button>
      </div></div>`);
  }

  function showHandoff() {
    const s = session.state, t = s.tanks[s.actor];
    showOverlay(html`<div class="overlay-card" role="dialog" aria-modal="true" aria-labelledby="hand-h">
      <p class="eyebrow">PASS THE CONTROLS</p><h2 id="hand-h" class="screen-title">${t.name.toUpperCase()}</h2>
      <p>Your aim and arsenal stay hidden until you are ready. Other players, look away.</p>
      <button type="button" class="primary" data-ov="ready" data-nav>${t.name} is ready <kbd>Enter</kbd></button></div>`);
    announce(`Pass the controls to ${t.name}. Press Enter when ready.`);
  }

  let bannerTimer = 0;
  function noKibitzing() {
    audio.play('deny');
    announce('No kibitzing!');
    if (!session || !LIVE.has(machine.state)) return;
    showBanner('NO KIBITZING!');
    const s = session.state;
    const others = s.tanks.map((t, i) => i).filter((i) => s.tanks[i].alive && i !== s.actor);
    if (others.length) effects.say(others[Math.floor(Math.random() * others.length)], 'No kibitzing!', 2.2);
  }

  function showBanner(text) {
    const b = $('banner');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), 1600);
  }
  function hideBanner() { $('banner').classList.remove('show'); }

  function openDialog(id, content, onClose) {
    const dlg = $(id);
    dlg.innerHTML = content.html;
    const restore = document.activeElement;
    dlg.addEventListener('close', () => { onClose?.(dlg.returnValue); if (restore?.isConnected) restore.focus({ preventScroll: true }); }, { once: true });
    dlg.showModal();
    (dlg.querySelector('[autofocus]') ?? dlg.querySelector('input, select, button'))?.focus();
  }

  function confirmDialog(message, label) {
    return new Promise((resolve) => {
      openDialog('dlg-confirm', S.confirmContent(message, label), (v) => resolve(v === 'ok'));
      $('dlg-confirm').querySelector('.primary')?.focus();
    });
  }

  function openHelp() {
    if (session && LIVE.has(machine.state)) pauseBattle('MANUAL OPEN');
    openDialog('dlg-help', S.helpContent());
  }

  function openSettings() {
    if (session && LIVE.has(machine.state)) pauseBattle('SETTINGS OPEN');
    openDialog('dlg-settings', S.settingsContent(settings, { inBattle: !!session, devHint: dev }), () => { if (machine.state === 'title') goTitle(); });
    const form = $('settings-form');
    const onChange = (e) => {
      const el = e.target;
      const s = structuredClone(settings);
      const pct = (v) => Number(v) / 100;
      switch (el.id || el.name) {
        case 'set-master': s.audio.master = pct(el.value); break;
        case 'set-effects': s.audio.effects = pct(el.value); break;
        case 'set-music': s.audio.music = pct(el.value); break;
        case 'set-muted': s.audio.muted = el.checked; break;
        case 'preview': s.preview = el.value; break;
        case 'motion': s.motion = el.value; break;
        case 'set-shake': s.shake = el.checked; break;
        case 'set-flashes': s.flashes = el.checked; break;
        case 'set-scanlines': s.scanlines = el.checked; break;
        case 'set-flicker': s.flicker = el.checked; break;
        case 'set-particles': s.particles = el.value; break;
        case 'set-speed': s.speed = Number(el.value); break;
        case 'set-theme': s.theme = el.value; break;
        case 'set-text': s.textSize = el.value; break;
        case 'set-name': s.playerName = el.value; break;
        case 'set-color': s.playerColor = el.value; break;
        case 'set-chassis': s.playerChassis = el.value; form.querySelector('.rating-card').outerHTML = S.ratingCard(getChassis(el.value).ratings).html; break;
        default: return;
      }
      const out = $(`${el.id}-out`);
      if (out) out.value = `${el.value}%`;
      settings = { ...s };
      persistSettings();
      if (el.id === 'set-name') settings.playerName = settings.playerName; // sanitised on save/load
      audio.unlock();
      if (el.id === 'set-effects' || el.id === 'set-master') audio.play('ui');
    };
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
    form.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.action === 'erase-run') {
        $('dlg-settings').close();
        if (await confirmDialog('Abandon the current tournament run? Its progress is deleted.', 'Abandon run')) { run = null; T.saveRun(store, null); goTitle(); }
      } else if (b.dataset.action === 'erase-all') {
        $('dlg-settings').close();
        if (await confirmDialog('Erase all service records, replays, saved maps, and the tournament run? Settings are kept.', 'Erase everything')) {
          run = null; T.saveRun(store, null);
          records = defaultRecords(); saveRecords(store, records);
          replays = { v: 1, items: [] }; saveReplays(store, replays);
          maps = { v: 1, items: [] }; saveMaps(store, maps);
          goTitle();
        }
      }
    });
  }

  // ── HUD ─────────────────────────────────────────────────────────────────
  function logLine({ text, tone }) {
    const glyph = { turn: '▶', hit: '✹', kill: '✕', miss: '~', warn: '!', radio: '»', info: '·' }[tone] ?? '·';
    const li = document.createElement('li');
    li.className = `log-${tone}`;
    li.innerHTML = `<span aria-hidden="true">${glyph}</span> ${esc(text)}`;
    const log = $('log');
    log.prepend(li);
    while (log.children.length > 40) log.lastElementChild.remove();
  }

  /**
   * Weapons shown in this battle's payload list: the standard six, plus any
   * unlockable weapon a tank started with (or, under unlimited ammunition,
   * any the player has unlocked). Keys 1–9 and 0 pick the first ten.
   */
  function battleArsenal(state) {
    const started = (id) => state.config.players.some((p) => (p.inventory?.[id] ?? 0) > 0);
    return WEAPONS.filter((w) => !unlockFor(w.id) || started(w.id) || (state.config.rules.unlimitedAmmo && isUnlocked(records, w.id, unlockOpts))).map((w) => w.id);
  }

  function renderWeaponList() {
    session.arsenal = battleArsenal(session.state);
    const keyFor = (i) => (i < 9 ? String(i + 1) : i === 9 ? '0' : '');
    $('weapon-list').innerHTML = session.arsenal.map(getWeapon).map((w, i) => `<button type="button" role="radio" class="weapon-btn" data-weapon="${w.id}" aria-checked="false" style="--c:${w.presentation.color}"><span class="wkey">${keyFor(i)}</span><span class="glyph" aria-hidden="true">${w.glyph}</span> <span class="wname">${esc(w.short)}</span> <span class="wammo"></span></button>`).join('');
    $('weapon-keyhint').textContent = session.arsenal.length > 9 ? '1–0 · [ ]' : `1–${session.arsenal.length} · [ ]`;
  }

  function renderDefenseList() {
    $('defense-list').innerHTML = DEFENSES.map((d) => (d.mode === 'active'
      ? `<button type="button" role="radio" class="weapon-btn" data-defense="${d.id}" aria-checked="false" style="--c:${d.presentation.color}"><span class="glyph" aria-hidden="true">${d.glyph}</span> <span class="wname">${esc(d.short)}</span> <span class="wammo"></span></button>`
      : `<span class="weapon-btn passive" data-passive="${d.id}" style="--c:${d.presentation.color}" title="${esc(d.name)}: automatic"><span class="glyph" aria-hidden="true">${d.glyph}</span> <span class="wname">${esc(d.short)}</span> <span class="wammo"></span></span>`)).join('');
  }

  /** Short text for a tank's active protections (shown in the roster). */
  function effectText(k) {
    const fx = k.fx ?? {};
    const parts = [];
    if (fx.shield > 0) parts.push(`◯${fx.shield}`);
    if (fx.deflector) parts.push('⟲');
    if (fx.anchor > 0) parts.push('⚓');
    if (fx.fireproof > 0) parts.push('❄');
    return parts.join(' ');
  }

  function windText(w) {
    if (w === 0) return { arrows: '·', words: 'CALM' };
    const n = Math.min(5, Math.ceil(Math.abs(w) / 5));
    return { arrows: (w > 0 ? '►' : '◄').repeat(n), words: `${Math.abs(w)} ${w > 0 ? 'EAST →' : '← WEST'}` };
  }

  function updateHud() {
    if (!session) return;
    const s = session.state;
    const t = s.tanks[s.actor];
    const st = machine.state;
    const humanTurn = st === 'aiming';
    const aim = session.aim[s.actor];
    const replay = !!session.replay;
    let line1, line2;
    if (replay) { line1 = 'REPLAY'; line2 = `${t.name} · turn ${s.turn}`; }
    else if (s.phase === 'battleOver') { line1 = 'BATTLE OVER'; line2 = s.result.winner == null ? 'No winner' : `${s.tanks[s.result.winner].name} wins`; }
    else if (st === 'paused') { line1 = 'PAUSED'; line2 = 'Press P to resume.'; }
    else if (st === 'handoff') { line1 = `PASS TO ${t.name.toUpperCase()}`; line2 = 'Waiting for the next player.'; }
    else if (humanTurn) { line1 = `▶ YOUR TURN — ${t.name}`; line2 = 'Set angle and power, choose a payload, then FIRE.'; }
    else if (st === 'aiThinking') { line1 = `${t.name.toUpperCase()} AIMING`; line2 = `${getCommander(t.commander).title} · ${DIFFICULTY[t.difficulty].name}. Hold position.`; }
    else { line1 = 'SHOT IN FLIGHT'; line2 = `${t.name} fired. Watch the impact.`; }
    const wt = windText(s.wind);
    const weather = WEATHER[s.config.weather];
    $('hud-turn').innerHTML = `<p class="turn-line">${esc(line1)}</p><p class="muted">${esc(line2)}</p><p class="muted small">Turn ${pad2(s.turn)} · ${esc(weather.glyph)} ${esc(weather.name)}${s.config.night ? ' · ☾ Night' : ''}</p>`;
    $('wind-readout').innerHTML = `<span class="small muted">WIND</span> <b class="wind-arrows" aria-hidden="true">${wt.arrows}</b> <span>${wt.words}</span>`;
    $('wind-readout').setAttribute('aria-label', s.wind === 0 ? 'Wind calm' : `Wind ${Math.abs(s.wind)} toward the ${s.wind > 0 ? 'east (right)' : 'west (left)'}`);

    // Aim controls reflect the active human only; hidden during hand-off.
    const showAim = humanTurn && aim;
    const shownAim = showAim ? aim : { angle: t.angle, power: t.power, weapon: t.weapon };
    const hideNumbers = st === 'handoff';
    $('in-angle').value = shownAim.angle; $('out-angle').value = hideNumbers ? '—' : `${shownAim.angle}°`;
    $('in-power').value = shownAim.power; $('out-power').value = hideNumbers ? '—' : `${shownAim.power}`;
    for (const id of ['in-angle', 'in-power']) $(id).disabled = !humanTurn;
    document.querySelectorAll('[data-nudge]').forEach((b) => { b.disabled = !humanTurn; });
    $('btn-fire').disabled = !humanTurn;
    const inv = t.inventory;
    // Only the active human sees ammunition counts; opponents' arsenals stay private.
    const privateInv = !humanTurn;
    document.querySelectorAll('.weapon-btn[data-weapon]').forEach((b) => {
      const w = getWeapon(b.dataset.weapon);
      const available = s.config.rules.unlimitedAmmo || hasAmmo(inv, w.id);
      const selected = shownAim.weapon === w.id;
      b.setAttribute('aria-checked', String(selected));
      b.classList.toggle('selected', selected);
      b.disabled = !humanTurn || !available;
      b.querySelector('.wammo').textContent = privateInv ? '' : s.config.rules.unlimitedAmmo ? '∞' : w.ammo.unlimited ? '∞' : `×${inv[w.id] ?? 0}`;
      b.setAttribute('aria-label', `${w.name}${privateInv ? '' : `, ${s.config.rules.unlimitedAmmo || w.ammo.unlimited ? 'unlimited' : `${inv[w.id] ?? 0} left`}`}${selected ? ', selected' : ''}`);
    });
    const chosen = humanTurn && aim ? aim.defense : null;
    document.querySelectorAll('[data-defense]').forEach((b) => {
      const d = getDefense(b.dataset.defense);
      const count = inv[d.id] ?? 0;
      const why = defenseBlocked(t, d.id);
      const selected = chosen === d.id;
      b.setAttribute('aria-checked', String(selected));
      b.classList.toggle('selected', selected);
      b.disabled = !humanTurn || (!!why && !selected);
      b.querySelector('.wammo').textContent = privateInv ? '' : `×${count}`;
      b.title = privateInv ? d.name : `${d.name}: ${why ?? d.role}`;
      b.setAttribute('aria-label', `${d.name}${privateInv ? '' : `, ${count} left${why ? `, unavailable: ${why}` : ''}`}${selected ? ', will deploy this turn' : ''}`);
    });
    document.querySelectorAll('[data-passive]').forEach((el) => {
      el.querySelector('.wammo').textContent = privateInv ? '' : `×${inv[el.dataset.passive] ?? 0}`;
    });
    const dd = chosen ? getDefense(chosen) : null;
    $('defense-detail').innerHTML = hideNumbers || privateInv ? ''
      : dd ? `<b>${esc(dd.name)}</b> will deploy when this turn ends. ${esc(dd.description)}`
      : 'None selected. Choose one to deploy after this shot (press D to cycle). Dashed items are automatic.';
    const w = getWeapon(shownAim.weapon);
    const blast = w.damage.max ? `Damage ${w.damage.max}${w.projectile.kind === 'cluster' ? ` ×${w.projectile.count}` : ''}, radius ${w.damage.radius} m` : 'No blast damage';
    $('weapon-detail').innerHTML = hideNumbers ? '' : `<b>${esc(w.name)}</b> — ${esc(w.role)}. ${blast}${privateInv ? '' : `, ammo ${s.config.rules.unlimitedAmmo || w.ammo.unlimited ? '∞' : inv[w.id] ?? 0}`}. ${esc(w.description)}`;

    // Roster: text status for every tank (never colour alone).
    $('hud-roster').innerHTML = `<h2 class="box-title">TANKS</h2><ul class="roster">${s.tanks.map((k, i) => {
      const inFire = k.alive && s.fires.some((f) => k.x >= f.x0 && k.x <= f.x1);
      const who = k.kind === 'human' ? 'Human' : k.kind === 'dummy' ? 'Target' : `${DIFFICULTY[k.difficulty].name} AI`;
      const base = !k.alive ? 'DESTROYED' : i === s.actor && s.phase !== 'battleOver' ? 'ACTIVE' : inFire && !(k.fx?.fireproof > 0) ? 'BURNING' : 'READY';
      const fxText = k.alive ? effectText(k) : '';
      const status = fxText ? `${base} ${fxText}` : base;
      return `<li class="${i === s.actor ? 'active' : ''} ${k.alive ? '' : 'dead'}" style="--c:${k.color}"><span class="marker" aria-hidden="true">${i === s.actor ? '▶' : k.alive ? '■' : '✕'}</span><span class="rname">${esc(k.name)}<small>${esc(who)}</small></span><span class="hp"><span class="hpbar" aria-hidden="true"><i style="width:${Math.round((k.hp / k.maxHp) * 100)}%"></i></span>${k.hp}/${k.maxHp}</span><span class="rstatus">${status}</span></li>`;
    }).join('')}</ul>`;
  }

  function setAim(patch) {
    if (machine.state !== 'aiming' || !session) return;
    const s = session.state;
    const aim = session.aim[s.actor];
    if (patch.angle != null) aim.angle = clamp(Math.round(patch.angle), ANGLE_MIN, ANGLE_MAX);
    if (patch.power != null) aim.power = clamp(Math.round(patch.power), POWER_MIN, POWER_MAX);
    if (patch.defense !== undefined) {
      const id = patch.defense;
      const why = id && defenseBlocked(s.tanks[s.actor], id);
      if (why) { audio.play('deny'); announce(why); return; }
      aim.defense = id;
      announce(id ? `${getDefense(id).name} will deploy when this turn ends.` : 'No defense this turn.');
    }
    if (patch.weapon) {
      if (!session.arsenal?.includes(patch.weapon)) return;
      if (!s.config.rules.unlimitedAmmo && !hasAmmo(s.tanks[s.actor].inventory, patch.weapon)) { audio.play('deny'); announce(`No ${getWeapon(patch.weapon).name} left.`); return; }
      aim.weapon = patch.weapon;
      announce(`${getWeapon(patch.weapon).name} selected.`);
    }
    updateHud();
  }
  function cycleWeapon(dir) {
    const s = session.state;
    const t = s.tanks[s.actor];
    const ids = session.arsenal.filter((id) => s.config.rules.unlimitedAmmo || hasAmmo(t.inventory, id));
    const i = ids.indexOf(session.aim[s.actor].weapon);
    setAim({ weapon: ids[(i + dir + ids.length) % ids.length] });
  }

  function cycleDefense() {
    const s = session.state;
    const t = s.tanks[s.actor];
    const ids = [null, ...ACTIVE_DEFENSES.map((d) => d.id).filter((id) => !defenseBlocked(t, id))];
    if (ids.length === 1) { audio.play('deny'); announce('No defenses available this turn.'); return; }
    const i = ids.indexOf(session.aim[s.actor].defense ?? null);
    setAim({ defense: ids[(i + 1) % ids.length] });
  }

  function previewPath() {
    if (!session || machine.state !== 'aiming') return null;
    const s = session.state;
    let mode = settings.preview;
    if (s.config.night && mode === 'full') mode = NIGHT.previewCap;
    if (mode === 'off') return null;
    const aim = session.aim[s.actor];
    const special = specialPreview(s, aim);
    if (special) return mode === 'partial' ? special.slice(0, Math.max(3, Math.ceil(special.length / 3))) : special;
    // Partial traces in still air, so the wind's pull shows up only in the live shot.
    const wind = mode === 'partial' ? 0 : s.wind;
    const path = [];
    const r = trace({ terrain: s.terrain, tanks: s.tanks, wind, gravity: s.config.rules.gravity, walls: s.config.rules.walls }, s.actor, aim.angle, aim.power, { path, sampleEvery: 10 });
    if (r.kind === 'ground' || r.kind === 'tank') path.push({ x: r.x, y: r.y });
    return mode === 'partial' ? path.slice(0, Math.max(3, Math.ceil(path.length / 3))) : path;
  }

  /** Faint path of the current player's previous shot, for correcting aim without a full preview. */
  function ghostPath() {
    if (!session || machine.state !== 'aiming') return null;
    const s = session.state;
    let mode = settings.preview;
    if (s.config.night && mode === 'full') mode = NIGHT.previewCap;
    return mode === 'full' ? null : session.lastShot?.[s.actor] ?? null;
  }

  /** The primary flight of a shot as it will actually fly (same trace the engine runs). */
  function shotPath(s, aim) {
    const pr = getWeapon(aim.weapon).projectile;
    if (pr.kind === 'beam' || pr.kind === 'plasma') return null;
    const path = [];
    const r = trace({ terrain: s.terrain, tanks: s.tanks, wind: s.wind, gravity: s.config.rules.gravity, walls: s.config.rules.walls }, s.actor, aim.angle, aim.power, { path, sampleEvery: 10 });
    const impact = r.kind === 'ground' || r.kind === 'tank' ? { x: r.x, y: r.y } : null;
    if (impact) path.push(impact);
    return { path, impact };
  }

  /** Laser: a straight dotted line to the end of its range. Plasma: the blast ring. */
  function specialPreview(s, aim) {
    const w = getWeapon(aim.weapon);
    const t = s.tanks[s.actor];
    const pr = w.projectile;
    if (pr.kind === 'plasma') {
      const u = (aim.power - POWER_MIN) / (POWER_MAX - POWER_MIN);
      const r = w.damage.radius * (pr.minScale + (1 - pr.minScale) * u);
      return Array.from({ length: 36 }, (_, k) => ({ x: t.x + Math.cos((k / 36) * Math.PI * 2) * r, y: t.y - 10 + Math.sin((k / 36) * Math.PI * 2) * r }));
    }
    if (pr.kind !== 'beam') return null;
    const rad = (aim.angle * Math.PI) / 180;
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const out = [];
    let x = t.x + dx * 25, y = t.y - 14 + dy * 25;
    for (let d = 0; d <= aim.power * pr.rangePerPower; d += 4) {
      x += dx * 4; y += dy * 4;
      if (x < 0 || x > s.terrain.length - 1 || y >= s.terrain[Math.round(x)]) break;
      if (d % 24 === 0) out.push({ x, y });
    }
    out.push({ x, y });
    return out;
  }

  // ── Frame loop ──────────────────────────────────────────────────────────
  const soundFor = { fire: null, explosion: 'explosion', split: 'split', burrow: 'burrow', ignite: 'ignite', damage: 'hit', eliminated: 'kill', turn: 'turn', defense: 'defense', shieldHit: 'shield', deflect: 'deflect', intercept: 'intercept', parachute: 'chute', hop: 'split', scatter: 'split', roll: 'burrow', buried: 'burrow' };
  function onEngineEvent(e, state) {
    const d = describe(e, state);
    if (d && !(e.t === 'turn' && e.turn === 1)) logLine(d);
    const snd = soundFor[e.t];
    if (snd === 'explosion') audio.play(snd, Math.min(1.5, (e.radius ?? getWeapon(e.weapon).crater.radius) / 60));
    else if (snd) audio.play(snd);
    if (e.t === 'fire' && state.tanks[e.by].kind !== 'human') audio.play('fire');
    if (e.t === 'fire' && Math.random() < QUIP_CHANCE) say(state, e.by, 'fire');
    if (e.t === 'eliminated') say(state, e.to, 'lastWords', 4.5);
  }

  /** Character chatter: presentation only, so it never touches the deterministic sim. */
  function say(state, idx, kind, seconds) {
    const t = state.tanks[idx];
    const list = (t.kind === 'ai' ? getCommander(t.commander).barks[kind] : null) ?? HUMAN_BARKS[kind];
    const line = list[Math.floor(Math.random() * list.length)];
    effects.say(idx, line, seconds);
    logLine({ text: `${t.name}: ${kind === 'lastWords' ? 'last words: ' : ''}${line}`, tone: 'radio' });
  }

  let frameErrors = 0;
  function frame(now) {
    // Schedule first so an unexpected error can never stop the loop.
    requestAnimationFrame(frame);
    try { tick(now); } catch (err) {
      if (frameErrors++ < 3) console.error('Frame error:', err);
    }
  }

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (dev) { window.__sb.frames = (window.__sb.frames ?? 0) + 1; window.__sb.dt = dt; }
    if (session && !$('battle').hidden) {
      const s = session.state;
      if (session.replay) replayStepFrame(dt);
      else if (machine.state === 'projectile' || machine.state === 'resolving') {
        stepper.advance(s, dt, settings.speed);
        if (machine.state === 'projectile' && s.phase === 'resolving') machine.go('resolving');
        if (s.phase === 'aiming' || s.phase === 'battleOver') nextTurnFlow();
      }
      const paused = machine.state === 'paused';
      effects.consume(s, settings, reduced(), { event: onEngineEvent });
      effects.update(paused ? 0 : dt, s, reduced());
      if ((machine.state === 'projectile' || machine.state === 'resolving' || session.replay) && Math.floor(now / 250) !== session.hudTick) { session.hudTick = Math.floor(now / 250); updateHud(); }
      const aimActor = machine.state === 'aiming' ? s.actor : null;
      renderer.draw({
        state: s, theme: theme(), reduced: reduced(), time: now / 1000, effects,
        preview: previewPath(),
        ghost: ghostPath(),
        aim: aimActor != null ? { actor: aimActor, angle: session.aim[aimActor].angle } : null,
        largeText: settings.textSize === 'large',
        diag: dev && session.diag && machine.state !== 'aiming' ? session.diag : null,
        labels: s.tanks.map((t) => (t.kind === 'ai' ? getCommander(t.commander).short : t.name)),
      });
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────
  $('screen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    audio.unlock();
    audio.play('ui');
    onAction(b.dataset.action, b.dataset.arg);
  });
  $('screen').addEventListener('change', (e) => {
    if (machine.state !== 'setup' || !e.target.closest('#setup-form')) return;
    readSetupForm();
    const k = e.target.dataset.k;
    if (k === 'chassis' || k === 'commander') {
      // Re-render so the stat card next to the row updates; keep focus in place.
      const sel = `[data-p="${e.target.dataset.p}"][data-k="${k}"]`;
      openSetup(setupModel.mode, true);
      document.querySelector(sel)?.focus();
    }
  });

  async function onAction(action, arg) {
    switch (action) {
      case 'title': return goTitle();
      case 'back': {
        const st = machine.state;
        if (st === 'briefing') return briefingBack();
        if (st === 'replayViewer') return openReplays();
        return goTitle();
      }
      case 'open-settings': return openSettings();
      case 'open-help': return openHelp();
      case 'tournament-new': {
        if (run && run.status === 'active' && !(await confirmDialog(`Abandon the current run (round ${run.round + 1}, score ${run.score}) and start a new tournament?`, 'Start new run'))) return;
        run = T.createRun({ chassis: settings.playerChassis });
        T.saveRun(store, run);
        return openTournamentStage();
      }
      case 'tournament-continue': return openTournamentStage();
      case 'quick': hot = null; return openSetup('quick');
      case 'sandbox': hot = null; return openSetup('sandbox');
      case 'hotseat': hot = null; return openSetup('hotseat');
      case 'challenges': return openChallenges();
      case 'daily': return showBriefing(dailyConfig(localDateKey(), profile()), 'daily', { extra: 'Everyone who plays today on this device gets the same battlefield. Your best score is kept locally; online leaderboards are not available.' });
      case 'editor': return openEditor();
      case 'replays': return openReplays();
      case 'roster': machine.go('roster'); return showScreen(S.rosterScreen());
      case 'arsenal': machine.go('arsenal'); return showScreen(S.arsenalScreen(records, unlockOpts));
      case 'reroll-seed': readSetupForm(); setupModel.seed = makeSeedCode(); return openSetup(setupModel.mode, true);
      case 'add-ai': readSetupForm(); setupModel.players.push(randomAi(createRng(makeSeedCode()), setupModel.players.map((p) => p.commander))); return openSetup(setupModel.mode, true);
      case 'add-human': {
        readSetupForm();
        const used = setupModel.players.map((p) => p.color);
        setupModel.players.splice(setupModel.players.filter((p) => p.kind === 'human').length, 0, { kind: 'human', chassis: 'standard', name: `Player ${setupModel.players.filter((p) => p.kind === 'human').length + 1}`, color: (TANK_COLORS.find((c) => !used.includes(c.hex)) ?? TANK_COLORS[0]).hex });
        return openSetup(setupModel.mode, true);
      }
      case 'remove-player': readSetupForm(); setupModel.players.splice(Number(arg), 1); return openSetup(setupModel.mode, true);
      case 'setup-go': {
        readSetupForm();
        const humans = setupModel.players.filter((p) => p.kind === 'human').length;
        if (setupModel.players.length < 2) return announce('Add at least one opponent.');
        if (setupModel.mode === 'hotseat' && humans < 2) return announce('Hot-seat needs at least two human players.');
        if (setupModel.mode === 'hotseat') startHotSeries();
        return showBriefing(setupToConfig(setupModel), setupModel.mode, { back: 'setup' });
      }
      case 'deploy': return deploy();
      case 'rematch': {
        const { config, mode, meta } = session;
        if (mode === 'daily') { const d = records.daily[config.dailyKey]; records.daily = { ...records.daily, [config.dailyKey]: { ...d, attempts: (d?.attempts ?? 0) + 1 } }; saveRecords(store, records); }
        machine.go('briefing');
        return startBattle(config, { mode, battleId: `${mode}:${config.seed}:${Date.now().toString(36)}`, meta });
      }
      case 'new-battle': setupModel.seed = makeSeedCode(); machine.go('briefing'); briefing = { config: setupToConfig(setupModel), mode: setupModel.mode, back: 'setup' }; return deploy();
      case 'change-setup': return openSetup(setupModel?.mode ?? 'quick', true);
      case 'watch-last': return watchReplay(replays.items[0]);
      case 't-continue':
        run = T.continueRun(run);
        T.saveRun(store, run);
        session = null;
        return run.stage === 'complete' ? showTournamentEnd() : openArmory();
      case 't-retry':
        run = T.retryRound(run);
        T.saveRun(store, run);
        session = null;
        return openTournamentStage();
      case 'buy':
      case 'sell': {
        const fn = action === 'buy' ? buy : sell;
        if (action === 'buy' && lockedSet().has(arg)) {
          audio.play('deny');
          const why = `${stockInfo(arg).name} is locked: ${unlockFor(arg).text}.`;
          return hot?.shopping ? renderHotArmory(why) : openArmory(why);
        }
        if (hot?.shopping) {
          const idx = hot.shopping.order[hot.shopping.index];
          const res = fn(hot.wallets[idx], arg);
          if (res.ok) hot.wallets[idx] = { credits: res.credits, inventory: res.inventory };
          audio.play(res.ok ? 'ui' : 'deny');
          return renderHotArmory(res.ok ? `${action === 'buy' ? 'Bought' : 'Sold'} ${stockInfo(arg).name}.` : res.error);
        }
        const res = fn({ credits: run.credits, inventory: run.inventory }, arg);
        if (res.ok) { run = T.updateWallet(run, res.credits, res.inventory); T.saveRun(store, run); }
        audio.play(res.ok ? 'ui' : 'deny');
        openArmory(res.ok ? `${action === 'buy' ? 'Bought' : 'Sold'} ${stockInfo(arg).name}.` : res.error);
        document.querySelector(`[data-action="${action}"][data-arg="${arg}"]`)?.focus();
        return;
      }
      case 'armory-done': {
        if (hot?.shopping) {
          hot.shopping.index++;
          hot.shopping.gate = true;
          if (hot.shopping.index < hot.shopping.order.length) return renderHotArmory();
          hot.shopping = null;
          return showBriefing(setupToConfig(setupModel, `${setupModel.seed}-R${hot.round}`), 'hotseat', { back: 'title' });
        }
        run = T.finishArmory(run);
        T.saveRun(store, run);
        return openTournamentStage();
      }
      case 'armory-quit': return goTitle();
      case 'hot-gate': hot.shopping.gate = false; return renderHotArmory();
      case 'hot-next': session = null; return hotNextRound();
      case 'hot-new': hot = null; return openSetup('hotseat', true);
      case 'challenge-play': {
        const ch = getChallenge(arg);
        return showBriefing(challengeConfig(ch, profile()), 'challenge', { back: 'challenges', extra: `Tip: ${ch.tip}` });
      }
      case 'editor-back': return openEditor(session?.meta?.map);
      case 'replay-watch': return watchReplay(replays.items[Number(arg)]);
      case 'replay-share': {
        const code = encodeShare(replays.items[Number(arg)]);
        try { await navigator.clipboard.writeText(code); openReplays('Share code copied to the clipboard.'); } catch { openReplays('Clipboard unavailable: the share code has been placed in the import box below.'); $('replay-import').value = code; }
        return;
      }
      case 'replay-delete': replays = { ...replays, items: replays.items.filter((_, i) => i !== Number(arg)) }; saveReplays(store, replays); return openReplays('Replay deleted.');
      case 'replay-import': {
        try {
          const rep = importReplay($('replay-import').value);
          replays = addReplay(replays, rep);
          saveReplays(store, replays);
          return openReplays(`Imported “${rep.title}”.`);
        } catch (err) { return openReplays(`Import failed: ${err.message}`); }
      }
      default: return undefined;
    }
  }

  $('field-overlay').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ov]');
    if (!b) return;
    audio.unlock();
    switch (b.dataset.ov) {
      case 'resume': return resumeBattle();
      case 'restart': return restartBattle();
      case 'settings': return openSettings();
      case 'help': return openHelp();
      case 'quit': return quitBattle();
      case 'ready': return beginHumanTurn();
      case 'debrief': return showDebrief();
      case 'replay-toggle': session.replay.playing = !session.replay.playing; if (session.state.phase === 'battleOver' || session.replay.index >= session.replay.rep.commands.length && session.state.phase === 'aiming') { if (session.replay.playing) return replayRestart(); } return showReplayBar();
      case 'replay-speed': session.replay.speed = session.replay.speed >= 4 ? 1 : session.replay.speed * 2; return showReplayBar();
      case 'replay-restart': return replayRestart();
      case 'replay-exit': return openReplays();
      default: return undefined;
    }
  });

  $('hud').addEventListener('click', (e) => {
    audio.unlock();
    const wb = e.target.closest('[data-weapon]');
    if (wb) return setAim({ weapon: wb.dataset.weapon });
    const db = e.target.closest('[data-defense]');
    if (db && session) {
      // Clicking the selected defense again clears it.
      const current = session.aim[session.state.actor]?.defense;
      return setAim({ defense: current === db.dataset.defense ? null : db.dataset.defense });
    }
    const nb = e.target.closest('[data-nudge]');
    if (nb && session) {
      const [k, d] = nb.dataset.nudge.split(':');
      const aim = session.aim[session.state.actor];
      return setAim({ [k]: aim[k] + Number(d) * (e.shiftKey ? 5 : 1) });
    }
  });
  $('in-angle').addEventListener('input', (e) => setAim({ angle: Number(e.target.value) }));
  $('in-power').addEventListener('input', (e) => setAim({ power: Number(e.target.value) }));
  $('btn-fire').addEventListener('click', () => { audio.unlock(); fireHuman(); });
  $('btn-pause').addEventListener('click', () => (machine.state === 'paused' ? resumeBattle() : pauseBattle()));
  $('btn-help').addEventListener('click', () => { audio.unlock(); openHelp(); });
  $('btn-settings').addEventListener('click', () => { audio.unlock(); openSettings(); });
  $('btn-mute').addEventListener('click', () => toggleMute());
  function toggleMute() {
    audio.unlock();
    settings = { ...settings, audio: { ...settings.audio, muted: !settings.audio.muted } };
    persistSettings();
    announce(settings.audio.muted ? 'Sound muted.' : 'Sound on.');
  }

  function moveFocus(container, dir) {
    const items = [...container.querySelectorAll('[data-nav]:not([disabled])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    items[(i + dir + items.length) % items.length].focus();
  }

  document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  document.addEventListener('keydown', (e) => {
    audio.unlock();
    const openDlg = document.querySelector('dialog[open]');
    if (openDlg) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.matches?.('[data-nav]')) { e.preventDefault(); moveFocus(openDlg, e.key === 'ArrowDown' ? 1 : -1); }
      return; // dialogs handle their own keys; nothing reaches the game behind them
    }
    if (isTyping(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
    const key = e.key;
    const st = machine.state;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (lower === 'm' && !e.ctrlKey && !e.metaKey) { toggleMute(); return; }
    if ((lower === 'h' || key === '?') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openHelp(); return; }
    if (lower === 'k' && !e.ctrlKey && !e.metaKey) { noKibitzing(); return; }

    if (st === 'replayViewer' && session?.replay) {
      const r = session.replay;
      if (key === ' ' || key === 'Enter') { if (e.target.closest?.('button')) return; e.preventDefault(); r.playing = !r.playing; showReplayBar(); }
      else if (lower === 's') { r.speed = r.speed >= 4 ? 1 : r.speed * 2; showReplayBar(); }
      else if (lower === 'r') replayRestart();
      else if (key === 'Escape') openReplays();
      return;
    }

    if (session && (LIVE.has(st) || st === 'paused' || st === 'battleOver')) {
      if (key === 'Escape' || lower === 'p') {
        e.preventDefault();
        if (st === 'paused') resumeBattle(); else pauseBattle();
        return;
      }
      if (st === 'paused') { if (key === 'ArrowDown' || key === 'ArrowUp') { e.preventDefault(); moveFocus($('field-overlay'), key === 'ArrowDown' ? 1 : -1); } return; }
      if (st === 'handoff' && key === 'Enter') { e.preventDefault(); beginHumanTurn(); return; }
      if (st === 'battleOver' && key === 'Enter') { e.preventDefault(); showDebrief(); return; }
      if (st !== 'aiming') {
        // Swallow gameplay keys so the page does not scroll mid-shot.
        if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) && !e.target.closest?.('button')) e.preventDefault();
        return;
      }
      const aim = session.aim[session.state.actor];
      const step = e.shiftKey ? 5 : 1;
      const onButton = !!e.target.closest?.('button');
      switch (key) {
        case 'ArrowLeft': e.preventDefault(); setAim({ angle: aim.angle + step }); return;
        case 'ArrowRight': e.preventDefault(); setAim({ angle: aim.angle - step }); return;
        case 'ArrowUp': e.preventDefault(); setAim({ power: aim.power + step }); return;
        case 'ArrowDown': e.preventDefault(); setAim({ power: aim.power - step }); return;
        case '[': cycleWeapon(-1); return;
        case ']': cycleWeapon(1); return;
        case ' ': case 'Enter': if (onButton) return; e.preventDefault(); fireHuman(); return;
        default: break;
      }
      if (lower === 'f') { fireHuman(); return; }
      if (lower === 'd' && !e.ctrlKey && !e.metaKey) { cycleDefense(); return; }
      if (/^[0-9]$/.test(key)) { const id = session.arsenal[key === '0' ? 9 : Number(key) - 1]; if (id) setAim({ weapon: id }); }
      return;
    }

    // Menus
    const screen = $('screen');
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (e.target.matches?.('[data-nav]') || e.target === screen || e.target === document.body) { e.preventDefault(); moveFocus(screen, key === 'ArrowDown' ? 1 : -1); }
      return;
    }
    if (key === 'Escape') {
      const back = screen.querySelector('[data-action="back"], [data-action="armory-quit"]');
      if (back) { e.preventDefault(); back.click(); }
      return;
    }
    if (key === 'Enter' && (e.target === screen || e.target === document.body)) {
      const primary = screen.querySelector('[data-nav].primary:not([disabled])');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (session?.replay) { session.replay.playing = false; showReplayBar(); }
      else pauseBattle('PAUSED WHILE THE TAB WAS HIDDEN');
      audio.suspend();
    } else {
      audio.resume();
      lastFrame = performance.now();
      stepper.reset();
    }
  });
  window.addEventListener('resize', () => renderer.resize());

  // ── Boot ────────────────────────────────────────────────────────────────
  applySettings();
  goTitle();
  requestAnimationFrame((t) => { lastFrame = t; frame(t); });
  if (dev) window.__sb = { stepper, get settings() { return settings; }, machine, get session() { return session; }, get run() { return run; }, store };
}
