// Synthesised audio (no sample files). Starts only after a user gesture,
// routes everything through master/effects/music gains and a compressor, and
// limits simultaneous voices so rapid effects cannot pile up or clip.

const MAX_VOICES = 14;
const MIN_GAP_MS = 28;

// Original two-voice loop in A minor: [bass note, arpeggio notes] per bar.
const PROGRESSION = [
  [45, [57, 60, 64, 69]], [41, [53, 57, 60, 65]], [43, [55, 59, 62, 67]], [40, [52, 56, 59, 64]],
];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function createAudio() {
  let ctx = null, master, fxGain, musicGain, comp, noiseBuf;
  let voices = 0;
  const last = new Map();
  let settings = { master: 0.7, effects: 0.8, music: 0.35, muted: false };
  let unlocked = false;
  let musicTimer = null, musicStep = 0, nextNoteTime = 0, musicWanted = false;

  function ensure() {
    if (!unlocked) return null;
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch { return null; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6;
    master = ctx.createGain(); fxGain = ctx.createGain(); musicGain = ctx.createGain();
    fxGain.connect(master); musicGain.connect(master); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
    return ctx;
  }

  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
    fxGain.gain.setTargetAtTime(settings.effects * 0.9, t, 0.02);
    musicGain.gain.setTargetAtTime(settings.music * 0.22, t, 0.05);
    updateMusic();
  }

  function voice(kind, fn) {
    const c = ensure();
    if (!c || settings.muted || settings.master === 0 || settings.effects === 0) return;
    const now = performance.now();
    if (now - (last.get(kind) ?? 0) < MIN_GAP_MS || voices >= MAX_VOICES) return;
    last.set(kind, now);
    voices++;
    const dur = fn(c, c.currentTime);
    setTimeout(() => { voices = Math.max(0, voices - 1); }, (dur + 0.05) * 1000);
  }

  function tone(c, t, { type = 'square', from, to, dur, vol = 0.12, dest = fxGain }) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
    return dur;
  }

  function noise(c, t, { dur, vol = 0.3, freq = 800, q = 0.8, type = 'lowpass', sweepTo }) {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(fxGain);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return dur;
  }

  const SOUNDS = {
    fire: (c, t) => tone(c, t, { from: 220, to: 70, dur: 0.22, vol: 0.1 }),
    explosion: (c, t, size = 1) => { noise(c, t, { dur: 0.35 + size * 0.5, vol: 0.25 + size * 0.15, freq: 1400 - size * 500, sweepTo: 60 }); return tone(c, t, { type: 'sine', from: 90, to: 30, dur: 0.4 + size * 0.3, vol: 0.2 }); },
    split: (c, t) => tone(c, t, { type: 'triangle', from: 900, to: 1500, dur: 0.12, vol: 0.08 }),
    burrow: (c, t) => noise(c, t, { dur: 0.5, vol: 0.2, freq: 300, sweepTo: 80 }),
    ignite: (c, t) => noise(c, t, { dur: 0.7, vol: 0.18, freq: 600, type: 'bandpass', q: 0.6, sweepTo: 2400 }),
    hit: (c, t) => tone(c, t, { from: 520, to: 260, dur: 0.12, vol: 0.07 }),
    kill: (c, t) => { tone(c, t, { from: 300, to: 40, dur: 0.6, vol: 0.12 }); return noise(c, t, { dur: 0.8, vol: 0.25, freq: 900, sweepTo: 50 }); },
    turn: (c, t) => tone(c, t, { type: 'triangle', from: 660, dur: 0.07, vol: 0.06 }),
    ui: (c, t) => tone(c, t, { type: 'square', from: 880, dur: 0.04, vol: 0.04 }),
    defense: (c, t) => { tone(c, t, { type: 'triangle', from: 440, to: 880, dur: 0.18, vol: 0.06 }); return tone(c, t + 0.08, { type: 'sine', from: 660, to: 990, dur: 0.16, vol: 0.05 }); },
    shield: (c, t) => tone(c, t, { type: 'sine', from: 1200, to: 600, dur: 0.2, vol: 0.07 }),
    deflect: (c, t) => tone(c, t, { type: 'square', from: 300, to: 1400, dur: 0.16, vol: 0.06 }),
    intercept: (c, t) => { tone(c, t, { type: 'square', from: 1800, to: 900, dur: 0.06, vol: 0.05 }); return noise(c, t + 0.05, { dur: 0.3, vol: 0.15, freq: 1600, sweepTo: 200 }); },
    chute: (c, t) => noise(c, t, { dur: 0.35, vol: 0.1, freq: 900, type: 'bandpass', q: 0.8, sweepTo: 400 }),
    deny: (c, t) => tone(c, t, { type: 'square', from: 140, dur: 0.12, vol: 0.06 }),
    victory: (c, t) => { [0, 4, 7, 12].forEach((n, i) => tone(c, t + i * 0.12, { type: 'square', from: midi(64 + n), dur: 0.18, vol: 0.07 })); return 0.7; },
    defeat: (c, t) => { [7, 3, 0, -5].forEach((n, i) => tone(c, t + i * 0.16, { type: 'triangle', from: midi(57 + n), dur: 0.22, vol: 0.08 })); return 0.8; },
  };

  function scheduleMusic() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.25) {
      const bar = PROGRESSION[Math.floor(musicStep / 8) % PROGRESSION.length];
      const s = musicStep % 8;
      if (s % 4 === 0) tone(ctx, nextNoteTime, { type: 'triangle', from: midi(bar[0]), dur: 0.5, vol: 0.5, dest: musicGain });
      tone(ctx, nextNoteTime, { type: 'square', from: midi(bar[1][s % 4] + (s >= 4 ? 12 : 0)), dur: 0.16, vol: 0.18, dest: musicGain });
      nextNoteTime += 0.2;
      musicStep++;
    }
  }

  function updateMusic() {
    const shouldPlay = musicWanted && ctx && !settings.muted && settings.music > 0 && settings.master > 0;
    if (shouldPlay && !musicTimer) {
      nextNoteTime = ctx.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 100);
    } else if (!shouldPlay && musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  return {
    /** Call from a user gesture handler. */
    unlock() {
      unlocked = true;
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
      updateMusic();
    },
    get unlocked() { return unlocked; },
    configure(next) { settings = { ...settings, ...next }; apply(); },
    play(kind, arg) { const fn = SOUNDS[kind]; if (fn) voice(kind, (c, t) => fn(c, t, arg)); },
    music(on) { musicWanted = on; updateMusic(); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && ctx.state === 'suspended' && unlocked) ctx.resume().catch(() => {}); },
    get voices() { return voices; },
  };
}
