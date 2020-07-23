const { vec } = require('../common/vector.js');
const { consts } = require('../common/constants.js');
var {
  walkspeed,
  walkspeed_hooked,
  //boost
  a0,
  b0,
  c0,
  d0,
  //kb
  a0k,
  b0k,
  c0k,
  d0k
} = consts;
const { consts: constsServer } = require('../server/constantsServer.js');
var {
  boostMultEffective_max,
  boostMult_max,
} = constsServer;


/** ---------- UPDATE FUNCTIONS (called every dt) ---------- */
var boost_decay = (pInfo, dt) => {
  //boost decay
  if (pInfo.boost.Dir) {
    pInfo.boost.Multiplier -= dt * (a0 * Math.pow(pInfo.boost.Multiplier, 2) + b0 + c0 / (pInfo.boost.Multiplier + d0));
    if (pInfo.boost.Multiplier <= 0) pInfo.boost.Multiplier = 0;
    else if (pInfo.boost.Multiplier > boostMult_max) pInfo.boost.Multiplier = boostMult_max;
  }
}

//calculate velocity
var player_velocity_update = (pInfo, p) => {
  let speed = pInfo.hooks.followHook ? walkspeed_hooked : walkspeed;
  let walk = vec.normalized(pInfo.walk.directionPressed, speed);

  let ans = walk;
  if (pInfo.boost.Dir) {
    let pBoostMultiplierEffective = pInfo.boost.Multiplier > boostMultEffective_max ? boostMultEffective_max : pInfo.boost.Multiplier;
    let boost = vec.normalized(pInfo.boost.Dir, pBoostMultiplierEffective * speed);
    ans = vec.add(ans, boost);
  }
  if (pInfo.knockback.dir) {
    let kb = vec.normalized(pInfo.knockback.dir, pInfo.knockback.speed);
    ans = vec.add(ans, kb);
  }
  p.vel = ans;
}


// stops player from being able to continue / initiate boost (they have to redo as if standing still with no keys pressed yet)
var boostReset = (pInfo) => {
  pInfo.boost.Multiplier = 0;
  pInfo.boost.Dir = null;
  pInfo.boost.Key = null;
  pInfo.boost.recentKeys = [];
  pInfo.boost.recentKeysRepeat = false;
}

/** ---------- KNOCKBACK FUNCTIONS ---------- */

var knockbackReset = (pInfo) => {
  pInfo.knockback.timeremaining = null;
  pInfo.knockback.speed = null;
  pInfo.knockback.dir = null;
}

// assumes knockback.vel (and knockback.speed, and timeremaining)
var knockback_timeout_decay = (pInfo, dt) => {
  // decrease cooldown
  if (pInfo.knockback.timeremaining) {
    pInfo.knockback.timeremaining -= dt;
    if (pInfo.knockback.timeremaining <= 0) {
      //decay with the leftover time:
      dt = -pInfo.knockback.timeremaining;
      pInfo.knockback.timeremaining = null;
      if (dt === 0) return;
    }
    else return;
  }
  // decay player now that cooldown is over
  let kbSpeed = pInfo.knockback.speed;
  let dv = -dt * (a0k * Math.pow(kbSpeed, 2) + b0k + c0k / (kbSpeed + d0k));
  kbSpeed += dv;
  if (kbSpeed > 0) {
    pInfo.knockback.speed = kbSpeed;
  }
  else {
    //player stops following hook and hook starts following player
    knockbackReset(pInfo);
  }
}


/** ---------- AIMING FUNCTIONS ---------- */
var aimingStart = (pid) => {
  playersInfo[pid].hooks.isAiming = true;
}

var aimingStop = (pid) => {
  let pInfo = playersInfo[pid];
  pInfo.hooks.isAiming = false;
}



/** ---------- CHAT FUNCTIONS ---------- */

var chatRemoveMessage = (pid) => {
  players[pid].messages.shift();
  playersInfo[pid].chat.timeouts.shift();
}

var chat_message_timeout_decay = (pid, dt) => {
  for (let i = 0; i < playersInfo[pid].chat.timeouts.length; i++) {
    playersInfo[pid].chat.timeouts[i] -= dt;
    if (playersInfo[pid].chat.timeouts[i] < 0) {
      chatRemoveMessage(pid);
    }
  }
}


exports.player = {
  //player
  boostReset,
  boost_decay,
  player_velocity_update,
  //kb
  knockbackReset,
  knockback_timeout_decay,
  //aiming
  aimingStart,
  aimingStop,
  //chat
  chat_message_timeout_decay,

}
