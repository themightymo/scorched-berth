// Central application state machine. Every screen and battle sub-state is
// listed here with its legal transitions; nothing else changes `state`.

const BATTLE_LIVE = ['aiming', 'aiThinking', 'handoff', 'projectile', 'resolving'];
const RESTART = ['aiming', 'aiThinking', 'handoff', 'briefing'];

export const TRANSITIONS = {
  title: ['setup', 'briefing', 'armory', 'debrief', 'challenges', 'replays', 'editor', 'tournamentEnd', 'roster'],
  setup: ['title', 'briefing'],
  roster: ['title'],
  challenges: ['title', 'briefing'],
  replays: ['title', 'replayViewer'],
  replayViewer: ['replays', 'title'],
  editor: ['title', 'briefing'],
  briefing: ['aiming', 'aiThinking', 'handoff', 'battleOver', 'title', 'setup', 'challenges', 'editor', 'armory'],
  handoff: ['aiming', 'paused', 'title'],
  aiming: ['projectile', 'paused'],
  aiThinking: ['projectile', 'paused'],
  projectile: ['resolving', 'paused', 'aiming', 'aiThinking', 'handoff', 'battleOver'],
  resolving: ['aiming', 'aiThinking', 'handoff', 'battleOver', 'paused'],
  paused: [...BATTLE_LIVE, ...RESTART, 'title'],
  battleOver: ['debrief'],
  debrief: ['armory', 'briefing', 'title', 'tournamentEnd', 'setup', 'challenges', 'editor', 'replayViewer'],
  armory: ['briefing', 'title', 'armory'],
  tournamentEnd: ['title'],
};

export const STATES = Object.keys(TRANSITIONS);
export const BATTLE_STATES = new Set([...BATTLE_LIVE, 'paused', 'battleOver']);
/** States where the human may adjust aim and fire. */
export const PLAYER_INPUT_STATES = new Set(['aiming']);

export function createMachine(initial = 'title', { onChange, strict = false } = {}) {
  let current = initial;
  let resumeTo = null;
  const machine = {
    get state() { return current; },
    get resumeTo() { return resumeTo; },
    can(to) {
      // From pause, only the interrupted sub-state, a restart, or quitting is legal.
      if (current === 'paused' && BATTLE_LIVE.includes(to) && to !== resumeTo && !RESTART.includes(to)) return false;
      return (TRANSITIONS[current] ?? []).includes(to);
    },
    go(to, info) {
      if (to === current && to !== 'armory') return true;
      if (!machine.can(to)) {
        const msg = `Illegal transition ${current} → ${to}`;
        if (strict) throw new Error(msg);
        console.warn(msg);
        return false;
      }
      const from = current;
      if (to === 'paused') resumeTo = from;
      else if (from === 'paused') resumeTo = null;
      current = to;
      onChange?.(to, from, info);
      return true;
    },
    /** Return from pause to the exact sub-state that was interrupted. */
    resume() {
      if (current !== 'paused' || !resumeTo) return false;
      return machine.go(resumeTo);
    },
    isBattle() { return BATTLE_STATES.has(current); },
  };
  return machine;
}
