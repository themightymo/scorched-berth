import { W, BEDROCK } from '../src/core/constants.js';
import { createBattle } from '../src/core/engine.js';

export const flatTerrain = (y = 400) => Array.from({ length: W + 1 }, () => y);

/** Battle on flat ground with fixed tank positions and no wind. */
export function flatBattle({ xs = [200, 600, 1000], y = 400, terrain, hp, rules = {}, kinds, inventory, objective, weather = 'clear' } = {}) {
  return createBattle({
    seed: 'TEST',
    map: { custom: { terrain: terrain ?? flatTerrain(y), spawns: xs } },
    shufflePositions: false,
    rules: { fixedWind: 0, ...rules },
    weather,
    objective,
    players: xs.map((x, i) => ({ name: `T${i}`, kind: kinds?.[i] ?? (i === 0 ? 'human' : 'ai'), color: '#ffffff', hp: hp?.[i], inventory, commander: 'caesar', difficulty: 'veteran' })),
  });
}

export const fire = (state, weapon, angle, power, actor = state.actor) => ({ type: 'fire', actor, weapon, angle, power });

export { W, BEDROCK };
