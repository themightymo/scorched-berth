// HTML templates for every non-battle screen and dialog. Pure functions of
// their inputs; the controller wires `data-action` buttons.

import { html, raw, esc } from './dom.js';
import { WEAPONS, getWeapon } from '../core/weapons.js';
import { DEFENSES } from '../core/defenses.js';
import { MAP_PROFILES, PROFILE_IDS } from '../core/mapgen.js';
import { WEATHER, WEATHER_IDS, NIGHT } from '../core/weather.js';
import { COMMANDERS, getCommander, DIFFICULTY, DIFFICULTY_IDS } from '../ai/commanders.js';
import { ROUNDS, rankFor, RETRY_PENALTY } from '../game/tournament.js';
import { THEMES, TANK_COLORS } from '../game/themes.js';
import { CHALLENGES } from '../game/challenges.js';
import { canBuy, sellPrice, ECONOMY } from '../game/economy.js';
import { reasonText } from './log.js';
import { RATING_KEYS, RATING_INFO, RATING_MAX, RATING_BUDGET, CHASSIS, getChassis } from '../core/ratings.js';
import { UNLOCKS, unlockFor, unlockStatus } from '../game/unlocks.js';
import { tankPortrait, SPRITE_NOTES } from './sprites.js';

/** Trading-card style stat block: label, 10-segment bar, number. */
export function ratingCard(ratings, { compact = false } = {}) {
  if (compact) return html`<span class="rating-line" aria-label="${RATING_KEYS.map((k) => `${RATING_INFO[k].label} ${ratings[k]}`).join(', ')}">${RATING_KEYS.map((k) => `${RATING_INFO[k].short} ${ratings[k]}`).join(' · ')}</span>`;
  return html`<dl class="rating-card">${RATING_KEYS.map((k) => html`<dt title="${RATING_INFO[k].effect}">${RATING_INFO[k].label}</dt><dd aria-label="${ratings[k]} out of ${RATING_MAX}"><span class="rbar" aria-hidden="true">${'█'.repeat(ratings[k])}${'░'.repeat(RATING_MAX - ratings[k])}</span> ${ratings[k]}</dd>`)}</dl>`;
}
const chassisOptions = CHASSIS.map((c) => [c.id, `${c.name}: ${c.blurb}`]);

const btn = (action, label, { arg = '', cls = '', key = '', disabled = false, desc = '' } = {}) => html`<button type="button" class="${cls}" data-action="${action}" data-arg="${arg}" data-nav ${raw(disabled ? 'disabled' : '')} ${raw(desc ? `aria-describedby="${esc(desc)}"` : '')}>${label}${key ? raw(` <kbd>${esc(key)}</kbd>`) : ''}</button>`;
const ammoText = (w, inv) => (w.ammo.unlimited ? '∞' : `×${inv?.[w.id] ?? 0}`);
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const objectiveText = (o) => (o?.type === 'surviveTurns' ? `Survive until turn ${o.turns}.` : o?.type === 'maxShots' ? `Destroy every target within ${o.shots} shots.` : 'Destroy every other tank.');

export function titleScreen({ run, records, notices, dailyKey, daily }) {
  const t = records.totals;
  const active = run && run.status === 'active';
  const goLabel = !active ? 'GO — buy stuff, then battle'
    : run.stage === 'armory' ? `GO — buy stuff for round ${run.round + 1}`
      : run.stage === 'battle' ? `GO — resume battle ${run.round + 1}/${ROUNDS.length}`
        : run.stage === 'debrief' ? 'GO — review the last battle'
          : `GO — continue round ${run.round + 1}/${ROUNDS.length}`;
  return html`
  <section class="title-screen" aria-labelledby="title-h">
    <pre class="logo" aria-hidden="true">${LOGO}</pre>
    <h1 id="title-h" class="sr-only">Scorched Berth</h1>
    <p class="tagline">Read the battlefield. Choose a payload. Adjust angle and power. Fire, and adapt to the ground you leave behind.</p>
    ${notices.length ? html`<div class="notice" role="status">${notices.map((n) => html`<p>⚠ ${n}</p>`)}</div>` : ''}
    <div class="title-grid">
      <nav class="menu box" aria-label="Main menu">
        <h2 class="box-title">MAIN MENU</h2>
        ${btn('go', goLabel, { cls: 'primary', key: 'Enter' })}
        <p class="main-loop">GO <span aria-hidden="true">→</span> BUY STUFF <span aria-hidden="true">→</span> BATTLE</p>
        <details class="other-menu">
          <summary data-nav>ALL THE OTHER STUFF</summary>
          <div class="menu other-menu-items">
            ${btn('quick', 'Quick Battle — custom opponents')}
            ${btn('challenges', 'Challenges')}
            ${btn('daily', `Daily Challenge · ${dailyKey}${daily ? ` · best ${daily.best}` : ''}`)}
            ${btn('hotseat', 'Hot-Seat — pass and play')}
            ${btn('sandbox', 'Sandbox — custom rules')}
            ${btn('editor', 'Map Editor')}
            ${btn('replays', 'Replays')}
            ${btn('arsenal', `Arsenal · ${UNLOCKS.filter((u) => unlockStatus(records, u.weapon).done).length}/${UNLOCKS.length} unlocked`)}
            ${btn('roster', 'Commander Dossiers')}
            ${btn('open-settings', 'Settings')}
            ${btn('open-help', 'Field Manual')}
            ${btn('tournament-new', active ? 'Start Over — abandon current run' : 'Start a fresh five-battle run')}
          </div>
        </details>
      </nav>
      <aside class="box records" aria-label="Service record">
        <h2 class="box-title">SERVICE RECORD</h2>
        <dl class="stat-list">
          <dt>Battles</dt><dd>${t.battles}</dd>
          <dt>Victories</dt><dd>${t.wins}</dd>
          <dt>Accuracy</dt><dd>${t.shots ? Math.round((t.hits / t.shots) * 100) : 0}%</dd>
          <dt>Damage dealt</dt><dd>${t.damage}</dd>
          <dt>Eliminations</dt><dd>${t.kills}</dd>
          <dt>Best tournament</dt><dd>${records.bestTournament ? `${records.bestTournament.score} (${records.bestTournament.rank})` : '—'}</dd>
        </dl>
        <p class="hint">Arrow keys move through menus · Enter selects · Esc goes back · M toggles sound · H opens the manual.</p>
      </aside>
    </div>
  </section>`;
}

const LOGO = String.raw`
 ___  ___ ___  ___  ___ _  _ ___ ___    ___ ___ ___ _____ _  _
/ __|/ __/ _ \| _ \/ __| || | __|   \  | _ ) __| _ \_   _| || |
\__ \ (_| (_) |   / (__| __ | _|| |) | | _ \ _||   / | | | __ |
|___/\___\___/|_|_\\___|_||_|___|___/  |___/___|_|_\ |_| |_||_|`;

function selectField(id, label, options, value, { desc } = {}) {
  return html`<label class="field"><span>${label}</span><select id="${id}" ${raw(desc ? `aria-describedby="${esc(desc)}"` : '')}>${options.map(([v, l]) => html`<option value="${v}" ${raw(String(v) === String(value) ? 'selected' : '')}>${l}</option>`)}</select></label>`;
}
const checkField = (id, label, checked) => html`<label class="field check"><input type="checkbox" id="${id}" ${raw(checked ? 'checked' : '')}> <span>${label}</span></label>`;
const numField = (id, label, value, min, max, step = 1, hint = '') => html`<label class="field"><span>${label}</span><input type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}" inputmode="numeric">${hint ? html`<small>${hint}</small>` : ''}</label>`;

const commanderOptions = COMMANDERS.map((c) => [c.id, `${c.name} — ${c.title}`]);
const difficultyOptions = DIFFICULTY_IDS.map((d) => [d, DIFFICULTY[d].name]);
const colorOptions = TANK_COLORS.map((c) => [c.hex, c.name]);

/** Shared setup screen for quick battle, sandbox, and hot-seat. */
export function setupScreen(m, { locked = new Set() } = {}) {
  const titles = { quick: 'QUICK BATTLE', sandbox: 'SANDBOX', hotseat: 'HOT-SEAT' };
  const isSandbox = m.mode === 'sandbox', isHot = m.mode === 'hotseat';
  return html`
  <section class="setup" aria-labelledby="setup-h">
    <h1 id="setup-h" class="screen-title">${titles[m.mode]}</h1>
    <p class="lede">${isHot ? 'Two to four commanders share one keyboard. Aim and armory are hidden while the device is passed.' : isSandbox ? 'Bend the rules: gravity, wind, armour, and arsenal. Sandbox results are not recorded.' : 'One battle against the commanders of your choice.'}</p>
    <form class="setup-form" id="setup-form" onsubmit="return false">
      <fieldset class="box">
        <legend>BATTLEFIELD</legend>
        ${selectField('s-profile', 'Terrain', PROFILE_IDS.map((p) => [p, MAP_PROFILES[p].name]), m.profile)}
        ${selectField('s-weather', 'Weather', WEATHER_IDS.map((w) => [w, `${WEATHER[w].name}: ${WEATHER[w].effect}`]), m.weather)}
        ${checkField('s-night', `Night: ${NIGHT.effect}`, m.night)}
        ${checkField('s-hazards', 'Thermal vents may appear (Thermal Vents terrain only)', m.hazards)}
        <label class="field"><span>Seed</span><input id="s-seed" value="${m.seed}" maxlength="24" autocomplete="off" spellcheck="false"><small>Same seed + same shots = same battle.</small></label>
        ${btn('reroll-seed', 'New random seed')}
        ${isHot ? selectField('s-rounds', 'Rounds', [[1, '1 battle'], [3, 'Best of 3 (armory between rounds)'], [5, 'Best of 5 (armory between rounds)']], m.rounds) : ''}
      </fieldset>
      <fieldset class="box">
        <legend>TANKS (${m.players.length}/6)</legend>
        <ol class="player-list">
          ${m.players.map((p, i) => html`<li class="player-row">
            <span class="slot">${i + 1}</span>
            ${p.kind === 'human'
              ? html`<label class="field compact"><span>Name</span><input data-p="${i}" data-k="name" value="${p.name}" maxlength="16" autocomplete="off"></label>
                     <label class="field compact"><span>Colour</span><select data-p="${i}" data-k="color">${colorOptions.map(([v, l]) => html`<option value="${v}" ${raw(v === p.color ? 'selected' : '')}>${l}</option>`)}</select></label>
                     <label class="field compact"><span>Chassis</span><select data-p="${i}" data-k="chassis">${chassisOptions.map(([v, l]) => html`<option value="${v}" ${raw(v === (p.chassis ?? 'standard') ? 'selected' : '')}>${l}</option>`)}</select></label>
                     <span class="tag">HUMAN</span> ${ratingCard(getChassis(p.chassis).ratings, { compact: true })}`
              : html`<label class="field compact"><span>Commander</span><select data-p="${i}" data-k="commander">${commanderOptions.map(([v, l]) => html`<option value="${v}" ${raw(v === p.commander ? 'selected' : '')}>${l}</option>`)}</select></label>
                     <label class="field compact"><span>Skill</span><select data-p="${i}" data-k="difficulty">${difficultyOptions.map(([v, l]) => html`<option value="${v}" ${raw(v === p.difficulty ? 'selected' : '')}>${l}</option>`)}</select></label>
                     <span class="tag">AI</span> ${ratingCard(getCommander(p.commander).ratings, { compact: true })}`}
            ${i > 0 ? btn('remove-player', 'Remove', { arg: i, cls: 'small' }) : ''}
          </li>`)}
        </ol>
        <div class="row">
          ${btn('add-ai', '+ AI commander', { disabled: m.players.length >= 6 })}
          ${isHot ? btn('add-human', '+ Human player', { disabled: m.players.length >= 6 || m.players.filter((p) => p.kind === 'human').length >= 4 }) : ''}
        </div>
        <p class="hint">${raw(DIFFICULTY_IDS.map((d) => `<b>${DIFFICULTY[d].name}:</b> ${esc(DIFFICULTY[d].summary)}`).join('<br>'))}</p>
      </fieldset>
      ${isSandbox ? html`<fieldset class="box">
        <legend>RULES</legend>
        ${numField('r-gravity', 'Gravity %', Math.round(m.rules.gravity * 100), 40, 200, 5)}
        ${numField('r-windmax', 'Max wind', m.rules.windMax ?? WEATHER[m.weather].windMax, 0, 40)}
        ${numField('r-windstep', 'Wind change per turn', m.rules.windStep ?? WEATHER[m.weather].windStep, 0, 12)}
        ${numField('r-hp', 'Starting armour', m.rules.startHp, 10, 400, 10)}
        ${numField('r-turns', 'Turn limit', m.rules.maxTurns, 4, 400)}
        ${selectField('r-walls', 'Side walls', [['open', 'Open: shots leave the field'], ['rebound', 'Rebound: shots bounce back']], m.rules.walls)}
        ${checkField('r-unlimited', 'Unlimited ammunition', m.rules.unlimitedAmmo)}
        <div class="inv-grid">${WEAPONS.filter((w) => !w.ammo.unlimited && !locked.has(w.id)).map((w) => numField(`inv-${w.id}`, `${w.name} each`, m.inventory[w.id] ?? 0, 0, 9))}</div>
        ${locked.size ? html`<p class="hint">🔒 ${locked.size} more weapon${locked.size === 1 ? '' : 's'} can be unlocked. See the Arsenal on the title screen.</p>` : ''}
        <p class="hint">Defenses each (always consumed, even with unlimited ammunition):</p>
        <div class="inv-grid">${DEFENSES.map((d) => numField(`inv-${d.id}`, d.name, m.inventory[d.id] ?? 0, 0, 9))}</div>
      </fieldset>` : ''}
    </form>
    <div class="actions">
      ${btn('back', 'Back', { key: 'Esc' })}
      ${btn('setup-go', 'To briefing', { cls: 'primary', key: 'Enter' })}
    </div>
  </section>`;
}

export function briefingScreen({ config, map, mode, extra }) {
  const weather = WEATHER[config.weather] ?? WEATHER.clear;
  const humans = config.players.filter((p) => p.kind === 'human');
  const opponents = config.players.filter((p) => p.kind !== 'human');
  const profile = config.map.custom ? { name: config.map.name, blurb: 'Custom map from the editor.' } : MAP_PROFILES[config.map.profile];
  return html`
  <section class="briefing" aria-labelledby="brief-h">
    <p class="eyebrow">${config.label ?? mode.toUpperCase()}</p>
    <h1 id="brief-h" class="screen-title">MISSION BRIEFING</h1>
    <div class="brief-grid">
      <div class="box">
        <h2 class="box-title">CONDITIONS</h2>
        <dl class="stat-list">
          <dt>Terrain</dt><dd>${profile.name} — ${profile.blurb}</dd>
          <dt>Weather</dt><dd>${weather.glyph} ${weather.name}: ${weather.effect}</dd>
          ${config.night ? html`<dt>Night</dt><dd>☾ ${NIGHT.effect}</dd>` : ''}
          ${config.rules?.fixedWind != null ? html`<dt>Wind</dt><dd>Fixed at ${Math.abs(config.rules.fixedWind)} ${config.rules.fixedWind < 0 ? 'west' : 'east'}</dd>` : ''}
          <dt>Objective</dt><dd>${objectiveText(config.objective)}</dd>
          <dt>Seed</dt><dd><code>${config.seed}</code>${map?.fallback ? ' (safe fallback layout)' : ''}</dd>
        </dl>
        ${extra ? html`<p class="hint">${extra}</p>` : ''}
      </div>
      <div class="box">
        <h2 class="box-title">OPPOSITION</h2>
        <ul class="opp-list">
          ${opponents.map((p) => {
            if (p.kind === 'dummy') return html`<li><span class="insignia" aria-hidden="true">◎</span><div><b>${p.name}</b> — stationary target${p.hp ? ` (${p.hp} armour)` : ''}</div></li>`;
            const c = getCommander(p.commander);
            return html`<li><img class="tank-thumb" src="${tankPortrait(c.id, c.color, 2)}" width="68" height="56" alt=""><div><b>${c.name}</b> · ${DIFFICULTY[p.difficulty].name}<br><span class="muted">${c.title}: ${c.doctrine}</span><br>${ratingCard(p.ratings ?? c.ratings, { compact: true })}</div></li>`;
          })}
        </ul>
      </div>
      <div class="box">
        <h2 class="box-title">${humans.length > 1 ? 'COMMANDERS' : 'YOUR ARSENAL'}</h2>
        ${humans.length > 1
          ? html`<ul class="opp-list">${humans.map((h) => html`<li><span class="insignia" style="--c:${h.color}" aria-hidden="true">■</span><div><b>${h.name}</b></div></li>`)}</ul><p class="hint">Arsenals stay private. Each player sees only their own.</p>`
          : html`<ul class="arsenal">${WEAPONS.filter((w) => !unlockFor(w.id) || (humans[0]?.inventory?.[w.id] ?? 0) > 0).map((w) => html`<li><span class="glyph" style="--c:${w.presentation.color}" aria-hidden="true">${w.glyph}</span> ${w.name} <b>${config.rules?.unlimitedAmmo ? '∞' : ammoText(w, humans[0]?.inventory)}</b></li>`)}${DEFENSES.filter((d) => (humans[0]?.inventory?.[d.id] ?? 0) > 0).map((d) => html`<li><span class="glyph" style="--c:${d.presentation.color}" aria-hidden="true">${d.glyph}</span> ${d.name} <b>×${humans[0].inventory[d.id]}</b></li>`)}</ul>
             ${humans[0]?.ratings ? html`<h3 class="box-subtitle">YOUR TANK</h3>${ratingCard(humans[0].ratings)}` : ''}`}
      </div>
    </div>
    <div class="actions">
      ${btn('back', 'Back', { key: 'Esc' })}
      ${btn('deploy', 'Deploy', { cls: 'primary', key: 'Enter' })}
    </div>
  </section>`;
}

/** Celebration box for weapons that just unlocked. */
function unlockBanner(ids) {
  if (!ids?.length) return '';
  return html`<div class="box unlock-banner" role="status">
    <h2 class="box-title">🔓 NEW WEAPON${ids.length > 1 ? 'S' : ''} UNLOCKED</h2>
    <ul class="arsenal">${ids.map((id) => { const w = getWeapon(id); return html`<li><span class="glyph" style="--c:${w.presentation.color}" aria-hidden="true">${w.glyph}</span> <b>${w.name}</b> — ${w.role}. <span class="muted">${unlockFor(id).text}.</span></li>`; })}</ul>
    <p class="hint">Quick battles, hot-seat, and play-tests now issue starting rounds. Tournament armories sell it.</p>
  </div>`;
}

export function debriefScreen({ state, stats, me, outcome, mode, score, rewards, actions, title, extra, replaySaved, unlocked = [] }) {
  const heading = outcome === 'victory' ? 'VICTORY' : outcome === 'draw' ? 'STALEMATE' : outcome === 'spectate' ? 'BATTLE COMPLETE' : 'DEFEAT';
  return html`
  <section class="debrief" aria-labelledby="debrief-h">
    <p class="eyebrow">${title}</p>
    <h1 id="debrief-h" class="screen-title outcome-${outcome}">${heading}</h1>
    <p class="lede">${reasonText(state.result?.reason)} ${state.turn} turns.</p>
    ${extra ? html`<p class="notice">${extra}</p>` : ''}
    ${unlockBanner(unlocked)}
    <div class="debrief-grid">
      <div class="box wide">
        <h2 class="box-title">AFTER-ACTION REPORT</h2>
        <div class="table-wrap"><table class="stats-table">
          <caption class="sr-only">Statistics for every tank</caption>
          <thead><tr><th scope="col">Tank</th><th scope="col">Status</th><th scope="col">Shots</th><th scope="col">Hits</th><th scope="col">Accuracy</th><th scope="col">Damage</th><th scope="col">Taken</th><th scope="col">Kills</th></tr></thead>
          <tbody>${stats.tanks.map((s, i) => html`<tr class="${i === me ? 'me' : ''}"><th scope="row">${i === me ? '▶ ' : ''}${s.name}</th><td>${s.survived ? 'Survived' : `Destroyed (turn ${s.eliminatedTurn ?? '?'})`}</td><td>${s.shots}</td><td>${s.hits}</td><td>${Math.round(s.accuracy * 100)}%</td><td>${s.damage}</td><td>${s.taken}</td><td>${s.kills}</td></tr>`)}</tbody>
        </table></div>
      </div>
      ${score ? html`<div class="box"><h2 class="box-title">SCORE</h2><dl class="stat-list">${score.parts.map((p) => html`<dt>${p.label}</dt><dd>${p.amount}</dd>`)}<dt><b>Total</b></dt><dd><b>${score.total}</b></dd></dl></div>` : ''}
      ${rewards ? html`<div class="box"><h2 class="box-title">CREDITS EARNED</h2><dl class="stat-list">${rewards.lines.map((l) => html`<dt>${l.label}</dt><dd>+${l.amount}</dd>`)}<dt><b>Total</b></dt><dd><b>+${rewards.total}</b></dd></dl></div>` : ''}
    </div>
    ${replaySaved ? html`<p class="hint">Replay saved. Open it from the Replays menu, or press Watch Replay.</p>` : ''}
    <div class="actions">${actions.map((a) => html`<div class="action-wrap">${btn(a.action, a.label, { cls: a.primary ? 'primary' : '', key: a.key ?? '', arg: a.arg ?? '', desc: a.note ? `note-${a.action}` : '' })}${a.note ? html`<small id="note-${a.action}" class="note">${a.note}</small>` : ''}</div>`)}</div>
  </section>`;
}

export function armoryScreen({ who, credits, inventory, heading, message, nextLabel, history, locks = {} }) {
  return html`
  <section class="armory" aria-labelledby="armory-h">
    <p class="eyebrow">${heading}</p>
    <h1 id="armory-h" class="screen-title">ARMORY — ${who}</h1>
    <p class="credits" aria-live="polite">Credits: <b>${credits}</b>${message ? html` · <span class="msg">${message}</span>` : ''}</p>
    <h2 class="box-title armory-section">PAYLOADS</h2>
    <div class="armory-grid">
      ${WEAPONS.filter((w) => !w.ammo.unlimited).map((w) => {
        const lock = locks[w.id];
        if (lock) return lockedCard(w, lock);
        const err = canBuy(credits, inventory, w.id);
        const owned = inventory[w.id] ?? 0;
        return html`<article class="box weapon-card" aria-labelledby="w-${w.id}">
          <h2 id="w-${w.id}" class="box-title"><span class="glyph" style="--c:${w.presentation.color}" aria-hidden="true">${w.glyph}</span> ${w.name}</h2>
          <p class="role">${w.role}</p>
          <p>${w.description}</p>
          <p class="muted"><b>Counterplay:</b> ${w.counterplay}</p>
          <dl class="stat-list compact"><dt>Damage</dt><dd>${w.damage.max ? `${w.damage.max}${w.projectile.kind === 'cluster' ? ` × ${w.projectile.count}` : ''}` : 'None'}</dd><dt>Blast radius</dt><dd>${w.damage.max ? `${w.damage.radius} m` : '—'}</dd><dt>Owned</dt><dd>${owned} / ${w.ammo.cap}</dd><dt>Price</dt><dd>${w.ammo.price}</dd></dl>
          <div class="row">
            ${btn('buy', `Buy (${w.ammo.price})`, { arg: w.id, disabled: !!err, desc: `why-${w.id}` })}
            ${btn('sell', `Sell (+${sellPrice(w.id)})`, { arg: w.id, disabled: owned <= 0 })}
          </div>
          <small id="why-${w.id}" class="note">${err ?? 'Available.'}</small>
        </article>`;
      })}
    </div>
    <h2 class="box-title armory-section">DEFENSES</h2>
    <p class="hint">Active defenses are chosen during your turn and deploy when it ends (one per turn). Automatic ones trigger by themselves.</p>
    <div class="armory-grid">
      ${DEFENSES.map((d) => {
        const err = canBuy(credits, inventory, d.id);
        const owned = inventory[d.id] ?? 0;
        return html`<article class="box weapon-card" aria-labelledby="w-${d.id}">
          <h2 id="w-${d.id}" class="box-title"><span class="glyph" style="--c:${d.presentation.color}" aria-hidden="true">${d.glyph}</span> ${d.name}</h2>
          <p class="role">${d.role} · ${d.mode === 'active' ? 'Active' : 'Automatic'}</p>
          <p>${d.description}</p>
          <p class="muted"><b>Counterplay:</b> ${d.counterplay}</p>
          <dl class="stat-list compact"><dt>Owned</dt><dd>${owned} / ${d.stock.cap}</dd><dt>Price</dt><dd>${d.stock.price}</dd></dl>
          <div class="row">
            ${btn('buy', `Buy (${d.stock.price})`, { arg: d.id, disabled: !!err, desc: `why-${d.id}` })}
            ${btn('sell', `Sell (+${sellPrice(d.id)})`, { arg: d.id, disabled: owned <= 0 })}
          </div>
          <small id="why-${d.id}" class="note">${err ?? 'Available.'}</small>
        </article>`;
      })}
    </div>
    ${history ? html`<p class="hint">${history}</p>` : ''}
    <div class="actions">
      ${btn('armory-quit', 'Save and quit to title', { key: 'Esc' })}
      ${btn('armory-done', nextLabel, { cls: 'primary', key: 'Enter' })}
    </div>
  </section>`;
}

function progressBar(have, goal) {
  const n = Math.round((have / goal) * 10);
  return html`<span class="rbar" aria-hidden="true">${'█'.repeat(n)}${'░'.repeat(10 - n)}</span> ${have.toLocaleString()} / ${goal.toLocaleString()}`;
}

function lockedCard(w, lock) {
  return html`<article class="box weapon-card locked" aria-labelledby="w-${w.id}">
    <h2 id="w-${w.id}" class="box-title"><span class="glyph" aria-hidden="true">🔒</span> ${w.name}</h2>
    <p class="role">${w.role}</p>
    <p>${w.description}</p>
    <p><b>Unlock:</b> ${lock.text}.</p>
    <p class="muted" aria-label="Progress ${lock.have} of ${lock.goal}">${progressBar(lock.have, lock.goal)}</p>
  </article>`;
}

/** Every weapon, with how each locked one is earned and progress toward it. */
export function arsenalScreen(records, opts) {
  const done = UNLOCKS.filter((u) => unlockStatus(records, u.weapon, opts).done).length;
  return html`
  <section aria-labelledby="ar-h">
    <h1 id="ar-h" class="screen-title">ARSENAL</h1>
    <p class="lede">${done} of ${UNLOCKS.length} special weapons unlocked. Each is a tribute to a classic from the original Scorched Earth. Battles in sandbox mode and the map editor do not count toward unlocks.</p>
    <div class="armory-grid">${WEAPONS.map((w) => {
      const st = unlockStatus(records, w.id, opts);
      const special = !!unlockFor(w.id);
      return html`<article class="box weapon-card ${st.done ? '' : 'locked'}" aria-labelledby="a-${w.id}">
        <h2 id="a-${w.id}" class="box-title"><span class="glyph" style="--c:${w.presentation.color}" aria-hidden="true">${st.done ? w.glyph : '🔒'}</span> ${w.name}${special ? '' : html` <span class="tag">STANDARD</span>`}</h2>
        <p class="role">${w.role}</p>
        <p>${w.description}</p>
        <p class="muted"><b>Counterplay:</b> ${w.counterplay}</p>
        <dl class="stat-list compact"><dt>Damage</dt><dd>${w.damage.max ? `${w.damage.max}${w.projectile.count ? ` × ${w.projectile.count}` : ''}` : 'None'}</dd><dt>Price</dt><dd>${w.ammo.unlimited ? 'Free' : w.ammo.price}</dd></dl>
        ${special ? html`<p><b>${st.done ? '✓ Unlocked' : 'Unlock'}:</b> ${st.text}.</p>${st.done ? '' : html`<p class="muted" aria-label="Progress ${st.have} of ${st.goal}">${progressBar(st.have, st.goal)}</p>`}` : ''}
      </article>`;
    })}</div>
    <div class="actions">${btn('back', 'Back', { key: 'Esc' })}</div>
  </section>`;
}

export function tournamentEndScreen(run, best, unlocked = []) {
  return html`
  <section class="debrief" aria-labelledby="end-h">
    <p class="eyebrow">TOURNAMENT COMPLETE</p>
    <h1 id="end-h" class="screen-title">FINAL SCORE ${run.score}</h1>
    ${unlockBanner(unlocked)}
    <p class="lede">Rank: <b>${rankFor(run.score)}</b>. Retries used: ${run.retries} (−${RETRY_PENALTY} each).${best ? ` Personal best: ${best.score}.` : ''}</p>
    <div class="box wide"><div class="table-wrap"><table class="stats-table">
      <thead><tr><th scope="col">Round</th><th scope="col">Result</th><th scope="col">Damage</th><th scope="col">Kills</th><th scope="col">Accuracy</th><th scope="col">Score</th><th scope="col">Credits</th></tr></thead>
      <tbody>${run.history.map((h) => html`<tr><th scope="row">${h.round + 1}. ${ROUNDS[h.round].name}${h.retried ? ' (retried)' : ''}</th><td>${h.outcome}</td><td>${h.damage}</td><td>${h.kills}</td><td>${Math.round(h.accuracy * 100)}%</td><td>${h.score}</td><td>+${h.credits}</td></tr>`)}</tbody>
    </table></div></div>
    <div class="actions">${btn('title', 'Return to title', { cls: 'primary', key: 'Enter' })}</div>
  </section>`;
}

export function challengesScreen(records) {
  return html`
  <section aria-labelledby="ch-h">
    <h1 id="ch-h" class="screen-title">CHALLENGES</h1>
    <p class="lede">Fixed scenarios that teach one idea each. Earn up to three stars.</p>
    <div class="card-grid">${CHALLENGES.map((c) => {
      const r = records.challenges[c.id];
      return html`<article class="box card" aria-labelledby="c-${c.id}">
        <h2 id="c-${c.id}" class="box-title">${c.name} <span class="tag">${c.tag}</span></h2>
        <p>${c.brief}</p>
        <p class="muted">Tip: ${c.tip}</p>
        <p class="stars" aria-label="${r?.stars ?? 0} of 3 stars">${stars(r?.stars ?? 0)}</p>
        ${btn('challenge-play', r?.stars ? 'Play again' : 'Play', { arg: c.id, cls: 'primary' })}
      </article>`;
    })}</div>
    <div class="actions">${btn('back', 'Back', { key: 'Esc' })}</div>
  </section>`;
}

export function replaysScreen(items, message) {
  return html`
  <section aria-labelledby="rp-h">
    <h1 id="rp-h" class="screen-title">REPLAYS</h1>
    <p class="lede">The last ${items.length} battles, stored as seeds and commands. Playback re-simulates each shot and checks the result matches.</p>
    ${message ? html`<p class="notice" role="status">${message}</p>` : ''}
    ${items.length ? html`<ul class="replay-list">${items.map((r, i) => html`<li class="box">
      <div><b>${r.title}</b><br><span class="muted">${r.date} · ${r.summary?.turns ?? '?'} turns · ${r.summary?.winner ? `${r.summary.winner} won` : 'no winner'} · seed ${r.config.seed}</span></div>
      <div class="row">${btn('replay-watch', 'Watch', { arg: i, cls: 'primary' })}${btn('replay-share', 'Copy share code', { arg: i })}${btn('replay-delete', 'Delete', { arg: i })}</div>
    </li>`)}</ul>` : html`<p class="box">No replays yet. Finish a battle and it will appear here.</p>`}
    <div class="box">
      <label class="field"><span>Import a share code</span><textarea id="replay-import" rows="3" spellcheck="false" placeholder="SBR1:…"></textarea></label>
      ${btn('replay-import', 'Import')}
    </div>
    <div class="actions">${btn('back', 'Back', { key: 'Esc' })}</div>
  </section>`;
}

export function rosterScreen() {
  return html`
  <section aria-labelledby="ro-h">
    <h1 id="ro-h" class="screen-title">COMMANDER DOSSIERS</h1>
    <p class="lede">Each AI commander is a playful, fictionalised gameplay interpretation of a public-domain historical figure. They are not claims about the real person's tactics, beliefs, or character, and their in-game lines are original, not quotations.</p>
    <div class="card-grid">${COMMANDERS.map((c) => html`<article class="box card" aria-labelledby="d-${c.id}">
      <h2 id="d-${c.id}" class="box-title"><span class="insignia" style="--c:${c.color}" aria-hidden="true">${c.insignia}</span> ${c.name}</h2>
      <img class="tank-portrait" src="${tankPortrait(c.id, c.color)}" width="136" height="112" alt="${c.name}'s tank. ${SPRITE_NOTES[c.id]}">
      <p class="role">${c.title}</p>
      <p class="muted">${c.bio}</p>
      <p>${c.doctrine}</p>
      ${ratingCard(c.ratings)}
      <ul class="tells">${c.tells.map((t) => html`<li>${t}</li>`)}</ul>
    </article>`)}</div>
    <div class="box"><h2 class="box-title">STAT RATINGS</h2><p class="muted">Every commander and player chassis spends the same ${RATING_BUDGET} points across five ratings (2–10), so each strength costs a weakness. Ratings change real mechanics:</p><dl class="stat-list">${RATING_KEYS.map((k) => html`<dt>${RATING_INFO[k].label}</dt><dd>${RATING_INFO[k].effect}</dd>`)}</dl></div>
    <div class="box"><h2 class="box-title">DIFFICULTY</h2><dl class="stat-list">${DIFFICULTY_IDS.map((d) => html`<dt>${DIFFICULTY[d].name}</dt><dd>${DIFFICULTY[d].summary} Armour and damage are never changed.</dd>`)}</dl></div>
    <div class="actions">${btn('back', 'Back', { key: 'Esc' })}</div>
  </section>`;
}

export function helpContent() {
  return html`
  <form method="dialog" class="dialog-body">
    <h2 id="help-title" class="screen-title">FIELD MANUAL</h2>
    <h3>Turn flow</h3>
    <p>Each tank fires once per turn. Set angle and power, choose a payload, and fire. 90° is straight up; below 90° fires right, above fires left. Craters reshape the ground. Tanks fall when the ground beneath them is removed, and a fall of more than 20 m causes damage. A direct hit always deals a weapon's full damage. When you are the only human in the battle, you can keep adjusting angle and power while the computer takes its turns, so your next shot is ready when your turn comes.</p>
    <h3>Controls</h3>
    <p><b>Touch:</b> swipe anywhere on the battlefield. Left/right changes angle and up/down changes power; the overlaid tracks show both values. <b>Mouse:</b> drag on the battlefield to point the barrel and set power by distance. Hold the ◄ ► ▲ ▼ buttons to keep adjusting. Tap a payload, then FIRE.</p>
    <table class="keys"><tbody>
      <tr><th scope="row"><kbd>←</kbd> <kbd>→</kbd></th><td>Angle ±1° (hold <kbd>Shift</kbd> for ±5°)</td></tr>
      <tr><th scope="row"><kbd>↑</kbd> <kbd>↓</kbd></th><td>Power ±1 (hold <kbd>Shift</kbd> for ±5)</td></tr>
      <tr><th scope="row"><kbd>1</kbd>–<kbd>6</kbd>, <kbd>[</kbd> <kbd>]</kbd></th><td>Choose payload</td></tr>
      <tr><th scope="row"><kbd>D</kbd></th><td>Cycle the defense to deploy when this turn ends (or click one; click again to clear)</td></tr>
      <tr><th scope="row"><kbd>Space</kbd> / <kbd>Enter</kbd> / <kbd>F</kbd></th><td>Fire</td></tr>
      <tr><th scope="row"><kbd>P</kbd> / <kbd>Esc</kbd></th><td>Pause and resume (pause also freezes AI turns)</td></tr>
      <tr><th scope="row"><kbd>H</kbd> / <kbd>?</kbd></th><td>This manual</td></tr>
      <tr><th scope="row"><kbd>M</kbd></th><td>Mute or unmute</td></tr>
      <tr><th scope="row"><kbd>K</kbd></th><td>Kibitz (not recommended)</td></tr>
      <tr><th scope="row"><kbd>Tab</kbd></th><td>Move between controls; menus also accept arrow keys</td></tr>
    </tbody></table>
    <h3>Wind</h3>
    <p>Wind pushes every projectile sideways at a steady rate for the whole flight. Its strength is shown as a number, a direction word, and a row of arrows. It shifts a little after every turn, more in a gale. Choose the trajectory preview in Settings. <b>Full</b> draws the whole arc, wind included. <b>Partial</b> (the default) draws only the first third, as if the air were still, so you have to judge the wind yourself. <b>Off</b> draws nothing. With Partial or Off, a faint trail and an ✕ mark where your previous shot actually landed, so you can correct. Night limits the preview to Partial.</p>
    <h3>Payloads</h3>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th scope="col">Payload</th><th scope="col">Damage</th><th scope="col">Radius</th><th scope="col">Role</th><th scope="col">Counterplay</th></tr></thead><tbody>
      ${WEAPONS.map((w) => html`<tr><th scope="row">${w.glyph} ${w.name}</th><td>${w.damage.max}${w.projectile.kind === 'cluster' ? ` ×${w.projectile.count}` : ''}</td><td>${w.damage.radius}</td><td>${w.description}${unlockFor(w.id) ? html` <i>Unlock: ${unlockFor(w.id).text}.</i>` : ''}</td><td>${w.counterplay}</td></tr>`)}
    </tbody></table></div>
    <h3>Defenses</h3>
    <p>Buy defenses in the armory. <b>Active</b> defenses are chosen during your turn (one per turn) and deploy when the turn ends, after your shot lands. <b>Automatic</b> defenses trigger by themselves and use up one charge each time. Defenses always use up stock, even with unlimited ammunition.</p>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th scope="col">Defense</th><th scope="col">Type</th><th scope="col">Effect</th><th scope="col">Counterplay</th></tr></thead><tbody>
      ${DEFENSES.map((d) => html`<tr><th scope="row">${d.glyph} ${d.name}</th><td>${d.mode === 'active' ? 'Active' : 'Automatic'}</td><td>${d.description}</td><td>${d.counterplay}</td></tr>`)}
    </tbody></table></div>
    <h3>Stat ratings</h3>
    <p>Every tank has a ${RATING_BUDGET}-point stat card rated 2–10. Commanders have fixed cards (see Commander Dossiers); you choose a chassis in Settings or in the hot-seat setup.</p>
    <ul>${RATING_KEYS.map((k) => html`<li><b>${RATING_INFO[k].label}:</b> ${RATING_INFO[k].effect}</li>`)}</ul>
    <ul>${CHASSIS.map((c) => html`<li><b>${c.name}</b> (${RATING_KEYS.map((k) => `${RATING_INFO[k].short} ${c.ratings[k]}`).join(' · ')}): ${c.blurb}</li>`)}</ul>
    <h3>Weather and hazards</h3>
    <ul>${WEATHER_IDS.map((id) => html`<li><b>${WEATHER[id].name}:</b> ${WEATHER[id].effect}</li>`)}<li><b>Night:</b> ${NIGHT.effect}</li><li><b>Thermal vents:</b> tanks that end a turn on a vent take 8 damage. Tanks never start near one.</li></ul>
    <h3>Tournament</h3>
    <p>${ROUNDS.length} escalating battles. You earn credits for damage, eliminations, survival, and victory, and a defeat always pays at least ${ECONOMY.lossFloor}. Spend credits in the armory between rounds. After a defeat you can <b>Continue</b> (keep the result and its credits) or <b>Retry</b> (replay the round from its start for −${RETRY_PENALTY} score). Progress saves after every shot.</p>
    <div class="actions"><button class="primary" value="close" data-nav>Close <kbd>Esc</kbd></button></div>
  </form>`;
}

export function settingsContent(s, { inBattle, devHint }) {
  const radio = (name, value, label) => html`<label class="field check"><input type="radio" name="${name}" value="${value}" ${raw(String(s[name]) === String(value) ? 'checked' : '')}> <span>${label}</span></label>`;
  const range = (id, label, value) => html`<label class="field"><span>${label} <output id="${id}-out">${Math.round(value * 100)}%</output></span><input type="range" id="${id}" min="0" max="100" step="5" value="${Math.round(value * 100)}"></label>`;
  return html`
  <form method="dialog" class="dialog-body settings-form" id="settings-form">
    <h2 id="settings-title" class="screen-title">SETTINGS</h2>
    <p class="hint">Changes apply immediately and are saved on this device.</p>
    <fieldset><legend>Audio</legend>
      ${range('set-master', 'Master', s.audio.master)}
      ${range('set-effects', 'Effects', s.audio.effects)}
      ${range('set-music', 'Music', s.audio.music)}
      <label class="field check"><input type="checkbox" id="set-muted" ${raw(s.audio.muted ? 'checked' : '')}> <span>Mute all sound</span></label>
    </fieldset>
    <fieldset><legend>Trajectory preview</legend>
      ${radio('preview', 'full', 'Full arc with wind (easiest)')}${radio('preview', 'partial', 'Partial: first third, ignoring wind')}${radio('preview', 'off', 'Off (hardest)')}
    </fieldset>
    <fieldset><legend>Motion and effects</legend>
      ${radio('motion', 'system', 'Follow system reduced-motion setting')}${radio('motion', 'reduced', 'Always reduce motion')}${radio('motion', 'full', 'Full motion')}
      <label class="field check"><input type="checkbox" id="set-shake" ${raw(s.shake ? 'checked' : '')}> <span>Screen shake</span></label>
      <label class="field check"><input type="checkbox" id="set-flashes" ${raw(s.flashes ? 'checked' : '')}> <span>Explosion flashes</span></label>
      <label class="field check"><input type="checkbox" id="set-scanlines" ${raw(s.scanlines ? 'checked' : '')}> <span>CRT scanlines and vignette</span></label>
      <label class="field check"><input type="checkbox" id="set-flicker" ${raw(s.flicker ? 'checked' : '')}> <span>CRT flicker (off whenever motion is reduced)</span></label>
      ${selectField('set-particles', 'Particles', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']], s.particles)}
      ${selectField('set-speed', 'Battle speed', [[1, 'Normal'], [2, 'Fast ×2'], [3, 'Very fast ×3']], s.speed)}
    </fieldset>
    <fieldset><legend>Display</legend>
      ${selectField('set-theme', 'Theme', Object.values(THEMES).map((t) => [t.id, `${t.name}: ${t.description}`]), s.theme)}
      ${selectField('set-text', 'Text size', [['normal', 'Normal'], ['large', 'Large']], s.textSize)}
    </fieldset>
    <fieldset><legend>Your tank</legend>
      <label class="field"><span>Commander name</span><input id="set-name" value="${s.playerName}" maxlength="16" autocomplete="off"></label>
      ${selectField('set-color', 'Tank colour (all options meet contrast checks)', colorOptions, s.playerColor)}
      ${selectField('set-chassis', 'Chassis (stat card). A tournament keeps the chassis it started with.', chassisOptions, s.playerChassis)}
      ${ratingCard(getChassis(s.playerChassis).ratings)}
    </fieldset>
    ${inBattle ? '' : html`<fieldset><legend>Saved data</legend>
      <p class="hint">Erasing cannot be undone.</p>
      <div class="row">${btn('erase-run', 'Abandon tournament run')}${btn('erase-all', 'Erase all records, replays and maps')}</div>
    </fieldset>`}
    ${devHint ? html`<p class="hint">Developer diagnostics are on (?dev=1).</p>` : ''}
    <div class="actions"><button class="primary" value="close" data-nav>Done <kbd>Esc</kbd></button></div>
  </form>`;
}

export function confirmContent(message, confirmLabel, cancelLabel = 'Cancel') {
  return html`<form method="dialog" class="dialog-body"><h2 id="confirm-title" class="screen-title">CONFIRM</h2><p>${message}</p>
    <div class="actions"><button value="cancel" data-nav>${cancelLabel}</button><button value="ok" class="primary" data-nav>${confirmLabel}</button></div></form>`;
}
