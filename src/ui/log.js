// Turns engine events into battle-log lines. Every line names what happened
// in words so status never depends on colour or sound.

import { getWeapon } from '../core/weapons.js';

const name = (state, i) => (i == null ? 'The field' : state.tanks[i]?.name ?? `Tank ${i + 1}`);

const REASONS = {
  lastStanding: 'Last tank standing.',
  humansDestroyed: 'All human-commanded tanks were destroyed.',
  mutualDestruction: 'Mutual destruction: no tank survived.',
  survived: 'Objective complete: survived to the final turn.',
  outOfShots: 'Out of shots before the objective was complete.',
  ceasefire: 'Turn limit reached. Ceasefire declared; healthiest tank wins.',
  noFighters: 'No armed tanks remain.',
};
export const reasonText = (r) => REASONS[r] ?? '';

/** Returns { text, tone } or null for events that should not be logged. */
export function describe(e, state) {
  switch (e.t) {
    case 'battleStart': return { text: `Battle begins. Seed ${e.seed}.`, tone: 'info' };
    case 'turn': {
      const w = e.wind === 0 ? 'calm' : `${e.wind > 0 ? 'east' : 'west'} ${Math.abs(e.wind)}`;
      return { text: `Turn ${e.turn}: ${name(state, e.actor)} to fire. Wind ${w}.`, tone: 'turn' };
    }
    case 'fire': return { text: `${name(state, e.by)} fires ${getWeapon(e.weapon).name} at ${e.angle}°, power ${e.power}.`, tone: 'info' };
    case 'directHit': return { text: `Direct hit on ${name(state, e.to)}!`, tone: 'hit' };
    case 'split': return { text: `Cluster charge splits into ${e.count} bomblets.`, tone: 'info' };
    case 'burrow': return { text: 'Burrowing charge drills into the ground…', tone: 'info' };
    case 'ignite': return { text: `Napalm ignites ${Math.round(e.x1 - e.x0)} m of ground for ${e.turns} turns.`, tone: 'warn' };
    case 'extinguish': return { text: 'A blast smothers part of the fire.', tone: 'info' };
    case 'fireOut': return { text: 'A fire burns out.', tone: 'info' };
    case 'offscreen': return { text: `${name(state, e.by)}’s shot leaves the battlefield.`, tone: 'miss' };
    case 'fizzle': return { text: 'The shot fizzles out.', tone: 'miss' };
    case 'damage': {
      const victim = name(state, e.to);
      if (e.cause === 'fall') return { text: `${victim} takes ${e.amount} fall damage.`, tone: 'hit' };
      if (e.cause === 'fire') return { text: `${victim} burns for ${e.amount}.`, tone: 'hit' };
      if (e.cause === 'vent') return { text: `${victim} is scalded by a vent for ${e.amount}.`, tone: 'hit' };
      if (e.by === e.to) return { text: `${victim} is caught in its own blast: −${e.amount}.`, tone: 'hit' };
      return { text: `${victim} takes ${e.amount} damage from ${name(state, e.by)}.`, tone: 'hit' };
    }
    case 'fall': return e.distance >= 8 ? { text: `${name(state, e.to)} falls ${e.distance} m.`, tone: 'info' } : null;
    case 'eliminated': {
      if (e.by == null || e.by === e.to) return { text: `${name(state, e.to)} is destroyed.`, tone: 'kill' };
      return { text: `${name(state, e.to)} destroyed by ${name(state, e.by)}.`, tone: 'kill' };
    }
    case 'battleOver': {
      const who = e.winner == null ? 'No winner.' : `${name(state, e.winner)} wins.`;
      return { text: `Battle over. ${who} ${reasonText(e.reason)}`, tone: 'kill' };
    }
    default: return null;
  }
}
