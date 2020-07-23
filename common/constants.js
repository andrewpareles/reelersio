
// PUBLIC CONSTS

const mapRadius = 5000;
const playerRadius = 40; //pix
const hookRadius_outer = 10; //circle radius (PURELY COSMETIC, ONLY CENTER OF HOOK MATTERS)
const hookRadius_inner = .7 * (hookRadius_outer / Math.sqrt(2)); //inner hook radius (square radius, not along diagonal) (PURELY COSMETIC)

const walkspeed = 225 / 1000; // pix/ms
const walkspeed_hooked = 100 / 1000; // pix/ms

const hookspeed_reset = 1500 / 1000;
const aimingspeed_hooked = walkspeed;

const chat_maxMessages = 3;
const chat_maxMessageLen = 30;

const hookCutoffDistance = 1000; //based on center of player and center of hook
const maxHooksOut = 2; //per player

// Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started
const a0 = 1 / (80 * 16); // boost decay v^2 term
const b0 = 1 / (2 * 80 * 16); // boost decay constant term
const c0 = 1 / (2 * 37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);

const a0h = 1 / (80 * 16); // v^2 term
const b0h = 1 / (100 * 16);
const c0h = 1 / (30 * 16); // c / (speedMult + d) term
const d0h = 1 / (.015 * 16);

const a0k = 4 * 1 / (160 * 16);
const b0k = 4 * 1 / (1000 * 16);
const c0k = 2 * 1 / (30 * 16);
const d0k = 1 / (.015 * 16);

exports.consts = {
  mapRadius,
  playerRadius,
  hookRadius_outer,
  hookRadius_inner,

  hookspeed_reset,
  aimingspeed_hooked,
  chat_maxMessages,
  chat_maxMessageLen,
  walkspeed,
  walkspeed_hooked,
  
  hookCutoffDistance,
  maxHooksOut,

  //boost
  a0,
  b0,
  c0,
  d0,
  //hook
  a0h,
  b0h,
  c0h,
  d0h,
  //kb
  a0k,
  b0k,
  c0k,
  d0k,
}