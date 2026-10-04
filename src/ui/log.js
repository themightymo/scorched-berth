// Turns engine events into battle-log lines. Every line names what happened
// in words so status never depends on colour or sound.

import { getWeapon } from '../core/weapons.js';
import { getDefense } from '../core/defenses.js';

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
    case 'burrow': return { text: e.forks > 1 ? `The sandhog forks into ${e.forks} tunnelling warheads…` : 'Burrowing charge drills into the ground…', tone: 'info' };
    case 'hop': return { text: e.left > 0 ? 'Leapfrog hops onward…' : 'Leapfrog makes its last hop…', tone: 'info' };
    case 'scatter': return { text: `Funky bomb flings ${e.count} bomblets in every direction!`, tone: 'warn' };
    case 'roll': return { text: `Heavy roller lands and rolls ${e.dir > 0 ? 'east' : 'west'}…`, tone: 'info' };
    case 'beamEnd': return { text: 'The laser runs out of range and fades.', tone: 'miss' };
    case 'buried': return { text: `${name(state, e.to)} is buried in dirt! Fire steeply or blast free.`, tone: 'warn' };
    case 'ignite': return { text: `Napalm ignites ${Math.round(e.x1 - e.x0)} m of ground for ${e.turns} turns.`, tone: 'warn' };
    case 'extinguish': return { text: e.cause === 'foam' ? 'Suppressant foam smothers a fire.' : e.cause === 'dirt' ? 'Falling dirt smothers part of the fire.' : 'A blast smothers part of the fire.', tone: 'info' };
    case 'defense': {
      const who = name(state, e.by);
      switch (e.item) {
        case 'plating': return { text: `${who} bolts on hull plating: +${e.amount} armour.`, tone: 'info' };
        case 'shield': return { text: `${who} raises an energy shield.`, tone: 'info' };
        case 'deflector': return { text: `${who} powers up a deflector field.`, tone: 'info' };
        case 'repair': return { text: `${who} patches the hull: +${e.amount} armour.`, tone: 'info' };
        case 'foam': return { text: `${who} sprays fire suppressant and is fireproof for two rounds.`, tone: 'info' };
        case 'berm': return { text: `${who} throws up earthworks.`, tone: 'info' };
        case 'anchor': return { text: `${who} drives a bedrock anchor into the ground.`, tone: 'info' };
        case 'relocate': return { text: `${who} warps ${Math.round(Math.abs(e.x - e.from))} m to a new position.`, tone: 'info' };
        default: return { text: `${who} deploys ${getDefense(e.item)?.name ?? 'a defense'}.`, tone: 'info' };
      }
    }
    case 'defenseFailed': return { text: `${name(state, e.by)}’s ${getDefense(e.item)?.name ?? 'defense'} finds no safe spot and stays put.`, tone: 'warn' };
    case 'shieldHit': return { text: e.left > 0 ? `${name(state, e.to)}’s shield absorbs ${e.absorbed} (${e.left} left).` : `${name(state, e.to)}’s shield absorbs ${e.absorbed} and collapses.`, tone: 'info' };
    case 'deflect': return { text: `${name(state, e.to)}’s deflector bounces ${name(state, e.by)}’s shot away!`, tone: 'warn' };
    case 'intercept': return { text: `${name(state, e.to)}’s point-defense gun shoots down ${name(state, e.by)}’s ${getWeapon(e.weapon)?.name ?? 'shot'}.`, tone: 'warn' };
    case 'parachute': return { text: `${name(state, e.to)} opens a parachute.`, tone: 'info' };
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
