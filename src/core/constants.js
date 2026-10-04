// World dimensions and physics constants. Physics runs in world units
// (pixels of a 1400×560 battlefield) on a fixed tick, independent of the
// display size and frame rate.

export const W = 1400;
export const H = 560;
export const TICK = 1 / 200;            // seconds per simulation tick
export const TICKS_PER_SECOND = 200;
export const GRAVITY = 320;             // px/s²
export const WIND_ACCEL = 2.6;          // px/s² per wind unit
export const SPEED_PER_POWER = 8;       // launch speed (px/s) per power point
export const BARREL_LENGTH = 25;
export const BARREL_HEIGHT = 14;
export const BEDROCK = H - 14;          // ground can never be lower than this y
export const SKY_LIMIT = 70;            // ground can never be higher than this y
export const TANK_HALF_WIDTH = 18;
export const TANK_HEIGHT = 20;
export const PAD_HALF_WIDTH = 22;
export const MAX_FLIGHT_TICKS = 12 * TICKS_PER_SECOND;
export const RESOLVE_HOLD_TICKS = 110;  // pause after impacts before the next turn
export const MISS_HOLD_TICKS = 60;
export const FALL_SAFE_DISTANCE = 20;   // px of drop before fall damage
export const FALL_DAMAGE_PER_PX = 0.42;
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 180;
export const POWER_MIN = 10;
export const POWER_MAX = 100;
export const DEFAULT_MAX_TURNS = 160;
