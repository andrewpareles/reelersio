const { consts: constsShared } = require('../common/constants.js');
var {
  walkspeed,
} = constsShared;

const throw_cooldown = 100; //ms
const reel_cooldown = 1.5 * 1000;
const reel_nofriction_timeout = 1 * 1000//.4 * 1000;
const knockback_nofriction_timeout = .2 * 1000;
const chat_message_timeout = 10 * 1000;

const boostMultEffective_max = 1;
const boostMult_max = 1.5;
// game assumes these are normalized
const keyVectors = {
  'up': { x: 0, y: 1 },
  'down': { x: 0, y: -1 }, //must = -up
  'left': { x: -1, y: 0 }, //must = -right
  'right': { x: 1, y: 0 }
}

const playerVel_max = (1 + boostMultEffective_max) * walkspeed; //ignoring kb

const hookspeed_min = 600 / 1000;
const hookspeed_max = 700 / 1000;
const hookspeed_hooked = hookspeed_max + 100 / 1000;

const hookspeedreel_min = walkspeed + 80 / 1000; //400 / 1000; //230 / 1000;
const hookspeedreel_max = walkspeed + 80 / 1000;//420 / 1000; //280 / 1000;

const knockbackspeed_min = 400 / 1000; // only for one engagement-- multiple kbs can combine to make speeds bigger or smaller than this
const knockbackspeed_max = 450 / 1000;
const percentPoolBallEffect = .3;



exports.consts = {
  throw_cooldown,
  reel_cooldown,
  reel_nofriction_timeout,
  knockback_nofriction_timeout,
  chat_message_timeout,

  boostMultEffective_max,
  boostMult_max,
  keyVectors,

  playerVel_max,

  hookspeed_min,
  hookspeed_max,
  hookspeed_hooked,

  hookspeedreel_min,
  hookspeedreel_max,

  knockbackspeed_min,
  knockbackspeed_max,
  percentPoolBallEffect,

}