//https://socket.io/docs/client-api/
const io = require('socket.io-client');
const { vec } = require('../common/vector.js');

const ADDRESS = 'http://192.168.1.204:3001';
// const ADDRESS = 'https://trussbucket.herokuapp.com/';
const socket = io(ADDRESS);












const createDummy = false;

const numHoles = 100;
var mapRadius = 5000;
var playerRadius = 40; //pix
var hookRadius_outer = 10; //circle radius (PURELY COSMETIC, ONLY CENTER OF HOOK MATTERS)
var hookRadius_inner = .7 * (hookRadius_outer / Math.sqrt(2)); //inner hook radius (square radius, not along diagonal) (PURELY COSMETIC)

const hookCutoffDistance = 1000; //based on center of player and center of hook
const maxHooksOut = 2; //per player
const throw_cooldown = 100; //ms
const reel_cooldown = 1.5 * 1000;
const reel_nofriction_timeout = 1 * 1000//.4 * 1000;
const knockback_nofriction_timeout = .2 * 1000;
const chat_message_timeout = 10 * 1000;

const chat_maxMessages = 3;
const chat_maxMessageLen = 30;


const walkspeed = 225 / 1000; // pix/ms
const walkspeed_hooked = 100 / 1000; // pix/ms

const boostMultEffective_max = 1;
const boostMult_max = 1.5;
const a0 = 1 / (80 * 16); // boost decay v^2 term
const b0 = 1 / (2 * 80 * 16); // boost decay constant term
const c0 = 1 / (2 * 37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// ^ Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started

const playerVel_max = (1 + boostMultEffective_max) * walkspeed; //ignoring kb

const aimingspeed_hooked = walkspeed;

const hookspeed_min = 600 / 1000;
const hookspeed_max = 700 / 1000;
const hookspeed_hooked = hookspeed_max + 100 / 1000;

const hookspeed_reset = 1500 / 1000;

const hookspeedreel_min = walkspeed + 80 / 1000; //400 / 1000; //230 / 1000;
const hookspeedreel_max = walkspeed + 80 / 1000;//420 / 1000; //280 / 1000;
const a0h = 1 / (80 * 16); // v^2 term
const b0h = 1 / (100 * 16);
const c0h = 1 / (30 * 16); // c / (speedMult + d) term
const d0h = 1 / (.015 * 16);

const knockbackspeed_min = 400 / 1000; // only for one engagement-- multiple kbs can combine to make speeds bigger or smaller than this
const knockbackspeed_max = 450 / 1000;
const percentPoolBallEffect = .3;
const a0k = 4 * 1 / (160 * 16);
const b0k = 4 * 1 / (1000 * 16);
const c0k = 2 * 1 / (30 * 16);
const d0k = 1 / (.015 * 16);






const generateRandomLoc = () => {
  let r = Math.sqrt(Math.random()) * mapRadius; //see CDF math in notebook
  let theta = Math.random() * 2 * Math.PI;
  let pos = { x: r * Math.cos(theta), y: -r * Math.sin(theta) };
  return pos;
  // return { x: 10 + Math.random() * 1000, y: 10 + Math.random() * -1000 };
}

// returns qVel projected on motionVec
// minSpeed is the minimum speed that can be returned (if it would return 0, return motionDir with speed minSpeed. same idea for maxSpeed)
// multiplier is the multiplier for the projected velocity
var projectedVelocityInDirection = (qVel, motionDir, minSpeed = -Infinity, maxSpeed = Infinity, multiplier = 1) => {
  let motionSpeed = multiplier * vec.parallelComponentMagnitude(qVel, motionDir);
  if (motionSpeed < minSpeed) motionSpeed = minSpeed;
  else if (motionSpeed > maxSpeed) motionSpeed = maxSpeed;
  let motionVec = vec.normalized(motionDir, motionSpeed);
  return motionVec;
}

/** ---------- PLAYER COLORS ---------- */
var generateColorPalette = () => {
  let playerBaseColors = [
    'hsl(0, 72%, 40%)',
    'hsl(0, 90%, 60%)',
    'hsl(0, 60%, 50%)',
    'hsl(30, 80%, 50%)',
    'hsl(40, 70%, 45%)',
    'hsl(100, 60%, 40%)',
    'hsl(130, 70%, 40%)',
    'hsl(220, 60%, 45%)',
    'hsl(270, 60%, 40%)',
    'hsl(300, 70%, 40%)',
    'hsl(320, 80%, 50%)',
  ];
  let hsl_string = function (h, s, l) {
    h = h % 360;
    s = (s < 0 ? 0 : s > 100 ? 100 : s);
    l = (l < 0 ? 0 : l > 100 ? 100 : l);
    return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
  };

  let palette = [];
  for (let pcol of playerBaseColors) {
    let h = parseInt(pcol.substring(4, pcol.indexOf(', ')));
    let s = parseInt(pcol.substring(pcol.indexOf(', ') + 2, pcol.lastIndexOf(', ') - 1));
    let l = parseInt(pcol.substring(pcol.lastIndexOf(', ') + 2).match(/(\d)*/g)[0]);
    //player, hook, line, bobber
    let obj = [pcol, hsl_string(h, 100, l + 20), hsl_string(h, s - 20, l + 30), hsl_string(h, s, l - 15)];
    palette.push(obj);
  }

  let special = [
    ['hsl(0, 0%, 90%)', 'hsl(0, 0%, 90%)', 'hsl(0, 0%, 70%)', '#c2a500'],
    ['hsl(180, 100%, 70%)', 'hsl(180, 100%, 70%)', 'hsl(180, 100%, 70%)', '#e732fb'],
  ]

  return palette.concat(special);
}
const playerHookColorPalette = generateColorPalette();





// game assumes these are normalized
var keyVectors = {
  'up': { x: 0, y: 1 },
  'down': { x: 0, y: -1 }, //must = -up
  'left': { x: -1, y: 0 }, //must = -right
  'right': { x: 1, y: 0 }
}


/** ---------- LOCAL PLAYER KEY, BOOST, AND WALK FUNCTIONS ---------- */

//returns true iff key 1 is parallel and in the opposite direction to key 2 
var keyDirection_isOpposite = (d1, d2) => {
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

// if k is null, there is no orthogonal key to a and b being pressed, or there are 2
// if k is not, it's the single key pressed that's orthogonal to key k
var keysPressed_singleOrthogonalTo = (pInfo, d) => {
  let keysPressed = pInfo.walk.keysPressed;
  let ret = null;
  switch (d) {
    case "left":
    case "right":
      if (keysPressed.has("up")) ret = "up";
      if (keysPressed.has("down")) {
        if (ret) ret = null;
        else {
          ret = "down";
        }
      }
      break;
    case "up":
    case "down":
      if (keysPressed.has("left")) ret = "left";
      if (keysPressed.has("right")) {
        if (ret) ret = null;
        else {
          ret = "right";
        }
      }
      break;
  }
  return ret;
}


var recentKeys_insert = (pInfo, key) => {
  if (key === pInfo.boost.recentKeys[1]) { //repeat
    pInfo.boost.recentKeysRepeat = true;
  } else { // no repeat
    pInfo.boost.recentKeysRepeat = false;
    pInfo.boost.recentKeys[0] = pInfo.boost.recentKeys[1];
    pInfo.boost.recentKeys[1] = key;
  }
}
// stops player from being able to continue / initiate boost (they have to redo as if standing still with no keys pressed yet)
var boostReset = (pInfo) => {
  pInfo.boost.Multiplier = 0;
  pInfo.boost.Dir = null;
  pInfo.boost.Key = null;
  pInfo.boost.recentKeys = [];
  pInfo.boost.recentKeysRepeat = false;
}
// creates a boost in direction of key k, with boostMultipler increased by inc
var boostSet = (pInfo, k, inc) => {
  pInfo.boost.Multiplier += inc;
  if (pInfo.boost.Multiplier <= 0) boostReset(pInfo);
  else {
    pInfo.boost.Dir = keyVectors[k];
    pInfo.boost.Key = k;
  }
}





// Can assume that the last entry in recentKeys is not null 
// since this is called after a WASD key is pressed
// updates pInfo.boost.Dir and pInfo.boost.Key
var boost_updateOnPress = (pInfo, key) => {

  recentKeys_insert(pInfo, key);

  let a = pInfo.boost.recentKeys[0];
  let b = pInfo.boost.recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  let c = keysPressed_singleOrthogonalTo(pInfo, b);  // c is the key of the BOOST DIRECTION!!! (or null if no boost)

  // have no boost yet, so initialize
  if (!pInfo.boost.Dir) {
    // starting boost: no boost yet, so initialize 
    // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
    if (keyDirection_isOpposite(a, b) && c) {
      boostSet(pInfo, c, .5);
    }
  }
  // currently have boost, continue it or lose it
  else if (c) {
    // continue boost
    if (c === pInfo.boost.Key && !pInfo.boost.recentKeysRepeat && keyDirection_isOpposite(a, b)) {
      boostSet(pInfo, c, .5);
    }
    // repeat same key twice
    else if (c === pInfo.boost.Key && pInfo.boost.recentKeysRepeat) {
      boostSet(pInfo, c, -.1);
    }
    // change boost direction
    else if (keyDirection_isOpposite(b, pInfo.boost.Key)) {
      boostSet(pInfo, c, .5);
    }
  }
  else {
    boostReset(pInfo);
  }

}

var boost_updateOnRelease = (pInfo, keyReleased) => {
  if (pInfo.boost.Key) { // W and A/D boost
    if (pInfo.walk.keysPressed.size === 0
      || (keyReleased === pInfo.boost.Key && pInfo.walk.keysPressed.size !== 1)) { //reset boost
      boostReset(pInfo);
    }
  }
}


var walk_updateOnPress = (pInfo, dir) => {
  let pDirectionPressed = pInfo.walk.directionPressed;
  switch (dir) {
    case "up":
    case "down":
    case "left":
    case "right":
      pInfo.walk.directionPressed = vec.add(pDirectionPressed, keyVectors[dir]);
      break;
  }
}


var walk_updateOnRelease = (pInfo, dir) => {
  let pDirectionPressed = pInfo.walk.directionPressed;
  switch (dir) {
    case "up":
    case "down":
    case "left":
    case "right":
      pInfo.walk.directionPressed = vec.sub(pDirectionPressed, keyVectors[dir]);
      break;
  }
}

var boost_decay = (pInfo, dt) => {
  //boost decay
  if (pInfo.boost.Dir) {
    pInfo.boost.Multiplier -= dt * (a0 * Math.pow(pInfo.boost.Multiplier, 2) + b0 + c0 / (pInfo.boost.Multiplier + d0));
    if (pInfo.boost.Multiplier <= 0) pInfo.boost.Multiplier = 0;
    else if (pInfo.boost.Multiplier > boostMult_max) pInfo.boost.Multiplier = boostMult_max;
  }
}

//calculate velocity
var player_velocity_update = (pInfo, p, followHook) => {
  let speed = followHook ? walkspeed_hooked : walkspeed;
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

/** ---------- CHAT FUNCTIONS ---------- */
var chatAddMessage = (pid, msg) => {
  msg = msg.trim();
  if (!msg) return;
  if (msg.length > chat_maxMessageLen) {
    msg = msg.substring(0, chat_maxMessageLen);
  }
  if (players[pid].messages.length === chat_maxMessages) {
    players[pid].messages.shift();
    playersInfo[pid].chat.timeouts.shift();
  }

  players[pid].messages.push(msg);
  playersInfo[pid].chat.timeouts.push(chat_message_timeout);
}

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

/** ---------- KNOCKBACK FUNCTIONS ---------- */
// pid of player being kb'd, hid of hook knocking back player
var knockbackAdd = (hid, pid) => {
  let kbVel;
  let kbFromHookVel = projectedVelocityInDirection(hooks[hid].vel, hooks[hid].vel, knockbackspeed_min, knockbackspeed_max);
  //if hook is headed towards player (ie NOT FAR INSIDE PLAYER), incorporate pool ball effect:
  let hookToKbPlayer = vec.sub(players[pid].loc, hooks[hid].loc);
  if (vec.dot(hookToKbPlayer, hooks[hid].vel) > 0) { //ignores case where hookToKbPlayer = {0,0}
    let kbFromPoolEffect = projectedVelocityInDirection(hooks[hid].vel, hookToKbPlayer, knockbackspeed_min, knockbackspeed_max);
    kbVel = vec.weightedSum([percentPoolBallEffect, 1 - percentPoolBallEffect], kbFromPoolEffect, kbFromHookVel);
  } else { //just hook vel:
    kbVel = kbFromHookVel;
  }

  let pInfo = playersInfo[pid];
  if (pInfo.knockback.dir) { //add onto previous kb
    kbVel = vec.add(kbVel, vec.scalar(pInfo.knockback.dir, pInfo.knockback.speed));
  }
  // subtract pVel since kb is relative to player (or else kb is way too big)
  kbVel = vec.sub(kbVel, players[pid].vel);

  pInfo.knockback.dir = vec.normalized(kbVel);
  pInfo.knockback.speed = vec.magnitude(kbVel);
  pInfo.knockback.timeremaining = knockback_nofriction_timeout;
}

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

/** ---------- HOOK FUNCTIONS ----------  */
var getOwned = (pid_from) => {
  return playersInfo[pid_from].hooks.owned;
}
var getAttached = (pid_to) => {
  return playersInfo[pid_to].hooks.attached;
}
var getHookedBy = (pid) => {
  return playersInfo[pid].hooks.hookedBy;
}
var getAttachedTo = (pid) => {
  return playersInfo[pid].hooks.attachedTo;
}
//gets hid from p_from to p_to
// assumes a hook to pid_from to pid_to exists
var getHookFrom_To_ = (pid_from, pid_to) => {
  for (let hid of getOwned(pid_from)) {
    if (hooks[hid].to === pid_to) return hid;
  }
  throw "no hookTo found";
}

// assumes h.vel NOT NULL (assume it gets set), and h.to
// pid starts reeling hook hid, which has a player attached (assumes h.to)
var hookStartReelingPlayer = (pid_hookowner, hid, reelVel) => {
  let h = hooks[hid];
  playersInfo[h.to].hooks.followHook = hid;
  h.reelingPlayer = pid_hookowner;
  h.vel = reelVel;
  h.nofriction_timeout = reel_nofriction_timeout;
}

// h, WHICH HAS A PLAYER ATTACHED, stops getting reeled (**assumes h.to**)
//player stops following hook and hook starts following player
var hookStopReelingPlayer = (h) => {
  playersInfo[h.to].hooks.followHook = null;
  h.reelingPlayer = null;
  h.nofriction_timeout = null;
  h.vel = null;
}

var hnum = 0;
var generateHID = () => {
  return 'h' + hnum++;
}


// returns [hook id, hook object]
var createNewHook = (pid_from, throwDir) => {
  let p = players[pid_from];
  let hookColors = playersInfo[pid_from].hooks.defaultColors;
  let hookVel = playersInfo[pid_from].hooks.attached.size > 0 ?
    vec.normalized(throwDir, hookspeed_hooked)
    : projectedVelocityInDirection(p.vel, throwDir, hookspeed_min, hookspeed_max);
  let hook = {
    from: pid_from,
    to: null,
    loc: vec.add(p.loc, vec.normalized(throwDir, playerRadius)),
    vel: hookVel,
    isResetting: false,
    reelingPlayer: null,
    nofriction_timeout: null,
    waitTillExit: new Set(),
    colors: hookColors,
  };
  let hid = generateHID();
  return [hid, hook];
}

//updates velocity for when hook is in isResetting mode
// should call hookResetInit before running this...
var hook_reset_velocity_update = (h) => {
  let reelDir = vec.sub(players[h.from].loc, h.loc);
  h.vel = vec.normalized(reelDir, hookspeed_reset);
}

// no need to call hook_detach before running this!!
var hookResetInit = (hid, setWaitTillExit) => {
  let h = hooks[hid];
  if (h.isResetting) return;
  hookDetach(hid, setWaitTillExit);
  h.isResetting = true;
  hook_reset_velocity_update(h);
}

//detach hid from everyone it's hooking
//deletePlayersInfoOnly = true only when the hook will be deleted immediately (so don't need to bother deleting hook info)
var hookDetach = (hid, setWaitTillExit) => {
  let h = hooks[hid];
  let to = h.to, from = h.from;
  //delete playersInfo of h.to:
  if (to) {
    getAttached(to).delete(hid);
    if (playersInfo[to].hooks.followHook === hid) {
      hookStopReelingPlayer(h);
    }
    getHookedBy(to).delete(from);
    // delete playersInfo of h.from:
    getAttachedTo(from).delete(to);
    if (setWaitTillExit) h.waitTillExit.add(to);

    h.to = null;
  }
  if (getOwned(h.from).size === 0)
    playersInfo[h.from].hooks.reel_cooldown = null;
}

var hookThrow = (pid_from, hookDir) => {
  let [hid, hook] = createNewHook(pid_from, hookDir);
  hooks[hid] = hook;
  hook.waitTillExit.add(pid_from);
  getOwned(pid_from).add(hid);
  //throw cooldown
  playersInfo[pid_from].hooks.throw_cooldown = throw_cooldown;
}

//attach hook hid to player pid_to
//update hooks[hid]'s to and player's attached
var hookAttach = (hid, pid_to) => {
  //knockback
  knockbackAdd(hid, pid_to);
  //attachment
  hooks[hid].to = pid_to;
  hooks[hid].vel = null;
  hooks[hid].isResetting = false;
  getAttached(pid_to).add(hid);
  getHookedBy(pid_to).add(hooks[hid].from);
  getAttachedTo(hooks[hid].from).add(pid_to);
  // reset pid_to boost
  boostReset(playersInfo[pid_to]);
  //reset reel cooldown for hook owner
  playersInfo[hooks[hid].from].hooks.reel_cooldown = null;
  hooks[hid].waitTillExit.clear();
}


//reels all hooks owned by pid
var hookReel = (pid) => {
  // console.log('reeling');
  for (let hid of getOwned(pid)) {
    let h = hooks[hid];
    if (h.to) {
      //for all hooks attached to player, start following the player
      for (let hid2 of getAttached(h.to)) {
        hookStopReelingPlayer(hooks[hid2]);
      }
      let reelDir = vec.sub(players[h.from].loc, h.loc);
      let hookVel = projectedVelocityInDirection(players[h.from].vel, reelDir, hookspeedreel_min, hookspeedreel_max);
      hookStartReelingPlayer(pid, hid, hookVel);
      // also reset knockback of player
      knockbackReset(playersInfo[h.to]);
    }
    else {
      hookResetInit(hid, true);
    }
  }
  playersInfo[pid].hooks.reel_cooldown = reel_cooldown;
  // console.log('hooks', hooks);
}



//delete hook from hooks, from.owned, and to.attached, and followHook
//note: don't need to call detach, it happens here (and more efficiently)
var hookDelete = (hid) => {
  let h = hooks[hid];
  //delete from owned, attached, followHook, and hooks
  getOwned(h.from).delete(hid); //from (owned)
  if (h.to) getAttached(h.to).delete(hid); //to (attached)
  //to (attached) & followHook 
  hookDetach(hid, false);
  delete hooks[hid]; //hooks
  // console.log('hooks after delete', hooks);
}

var hook_resetAllOwned = (pid, setWaitTillExit) => {
  for (let hid of getOwned(pid)) {
    hookResetInit(hid, setWaitTillExit);
  }
}
var hook_resetAllAttached = (pid, setWaitTillExit) => {
  for (let hid of getAttached(pid)) {
    hookResetInit(hid, setWaitTillExit);
  }
}
var hook_deleteAllOwned = (pid) => {
  for (let hid of getOwned(pid)) {
    hookDelete(hid);
  }
}

var reel_cooldown_decay = (pInfo, dt) => {
  if (pInfo.hooks.reel_cooldown) {
    pInfo.hooks.reel_cooldown -= dt;
    if (pInfo.hooks.reel_cooldown <= 0)
      pInfo.hooks.reel_cooldown = null;
  }
}

var throw_cooldown_decay = (pInfo, dt) => {
  if (pInfo.hooks.throw_cooldown) {
    pInfo.hooks.throw_cooldown -= dt;
    if (pInfo.hooks.throw_cooldown <= 0)
      pInfo.hooks.throw_cooldown = null;
  }
}


// assumes h.reelingPlayer
var reel_nofriction_timeout_decay = (h, dt) => {
  // hook must be reeling a player to have decay
  // decrease cooldown
  if (h.nofriction_timeout) {
    h.nofriction_timeout -= dt;
    if (h.nofriction_timeout <= 0) {
      //decay with the leftover time:
      dt = -h.nofriction_timeout;
      h.nofriction_timeout = null;
      if (dt === 0) return;
    }
    else return;
  }
  // decay hook now that cooldown is over (h.vel exists since reelingplayer ==> h.to ==> h.vel)
  // assumes h.reelingPlayer, so don't need to check going forward:
  let hSpeedMultiplier = vec.magnitude(h.vel) / hookspeed_max;
  hSpeedMultiplier -= dt * (a0h * Math.pow(hSpeedMultiplier, 2) + b0h + c0h / (hSpeedMultiplier + d0h));
  if (hSpeedMultiplier > 0)
    h.vel = vec.normalized(h.vel, hSpeedMultiplier * hookspeed_max);
  else {
    //player stops following hook and hook starts following player
    hookStopReelingPlayer(h);
  }
}

/** ---------- EVENT HELPERS ---------- */
var player_create = (pid, username) => {
  let [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username);
  if (players[pid]) console.error('player already exists when joining', pid)
  if (playersInfo[pid]) console.error('playersInfo already exists when joining', pid)
  players[pid] = newPlayer;
  playersInfo[pid] = newPlayerInfo;
  if (createDummy) {
    [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username, { loc: newPlayer.loc });
    let randomId = 'dummy' + Math.random();
    players[randomId] = newPlayer;
    playersInfo[randomId] = newPlayerInfo;
  }
  // console.log("hooks:", hooks);
}


var player_delete = (pid) => {
  // delete all hooks that were from player
  if (!playersInfo[pid]) {
    console.log("players:", players);
    console.log("hooks:", hooks);

    console.error('player disconnect error:', pid);
    console.log('hooks', hooks);
    return;
  }

  hook_deleteAllOwned(pid);
  // detach & pull in all hooks that are attached to player
  // console.log('attached', getAttached(pid));
  hook_resetAllAttached(pid, false);
  // console.log('attached\'', getAttached(pid));
  delete players[pid];
  delete playersInfo[pid];
}


/** ---------- SOCKET CALLS & FUNCTIONS ---------- */

const generateRandomPlayerColor = () => {
  //get random from 
  return playerHookColorPalette[Math.floor(Math.random() * playerHookColorPalette.length)];
}

const createNewPlayerAndInfo = (username, pOptions = {}) => {
  let startLoc = generateRandomLoc();
  let [pCol, hCol, lineCol, bobberCol] = generateRandomPlayerColor();
  return [
    {// PLAYER:
      loc: startLoc,
      vel: { x: 0, y: 0 },
      username: username,
      color: pCol,
      messages: [],
      ...pOptions,
    },
    // PLAYER INFO:
    {//NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
      boost: {
        Dir: null, // direction of the boost (null iff no boost)
        Key: null, // key that needs to be held down for current boost to be active
        Multiplier: 0, // magnitude of boost in units of walkspeed
        recentKeys: [], //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
        recentKeysRepeat: false,
      },
      walk: {
        directionPressed: { x: 0, y: 0 }, //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)
        keysPressed: new Set(), // contains 'up', 'down', 'left', and 'right'
      },
      hooks: {
        owned: new Set(), //hook ids originating from this player
        attached: new Set(), //list of hook ids attached to this player (NOT necessarily owned by this player)
        followHook: null,
        reel_cooldown: null,
        throw_cooldown: null,
        hookedBy: new Set(),
        attachedTo: new Set(),
        isAiming: false,
        defaultColors: [hCol, lineCol, bobberCol],
      },
      knockback: {
        speed: null,
        dir: null,
        timeremaining: null,
      },
      chat: {
        timeouts: [],
      }
    }
  ]
}













const updateGame = (dt) => {
  //1.
  for (let hid in hooks) {
    let h = hooks[hid];
    //if reeling a player, then decay the reel
    if (h.reelingPlayer) {
      reel_nofriction_timeout_decay(h, dt);
    }
    else if (h.isResetting) //h.reelingPlayer will never be true when h.isResetting, since reelingPlayer requries h.to and resetting requires !h.to
      hook_reset_velocity_update(h);

    if (h.vel)
      h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
  }

  //2.
  // update ALL player velocities and locations, confining them when necessary
  for (let pid in players) {
    let pInfo = playersInfo[pid];
    let p = players[pid];
    //chat timeout
    chat_message_timeout_decay(pid, dt);
    // cooldown
    reel_cooldown_decay(pInfo, dt);
    throw_cooldown_decay(pInfo, dt);
    // boost decay & kb decay & update velocity
    boost_decay(pInfo, dt);
    if (pInfo.knockback.dir) knockback_timeout_decay(pInfo, dt);
    player_velocity_update(pInfo, p, pInfo.hooks.followHook);
    // update player location (even if hooked, lets player walk within hook bubble)
    p.loc = vec.add(p.loc, vec.scalar(p.vel, dt));

    // update players confined to hook radius
    if (pInfo.hooks.followHook) {
      let h = hooks[pInfo.hooks.followHook];
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let htop = vec.sub(p.loc, h.loc);
        boostReset(pInfo);
        p.loc = vec.add(h.loc, vec.normalized(htop, playerRadius));
      }
    }
    // confine player to world border
    if (!vec.isContaining(vec.zero, p.loc, mapRadius, playerRadius)) {
      p.loc = vec.normalized(p.loc, mapRadius - playerRadius);
      boostReset(pInfo);
      if (pInfo.hooks.followHook) {
        //if the player is following a hook, need to stop that reel if it's drilling the player into the wall
        let h = hooks[pInfo.hooks.followHook];
        if (vec.dot(h.loc, h.vel) > 0) //if velocity has towards-border velocity component, reset the reel
          hookStopReelingPlayer(h);
      }
    }
  }


  //3. 
  // update all hooks following a player now that players have moved and velocities are updated
  for (let hid in hooks) {
    let h = hooks[hid];
    // --- UPDATE LOC OF HOOKS BEING AIMED OR RESETTING --- 
    if (!h.to && playersInfo[h.from].hooks.isAiming) {
      let PtoH = vec.sub(h.loc, players[h.from].loc);
      let aimDir = playersInfo[h.from].hooks.attached.size > 0 ?
        vec.normalized(playersInfo[h.from].walk.directionPressed, aimingspeed_hooked)
        : players[h.from].vel;
      let pVelOrthogonalToReel = vec.orthogonalComponent(aimDir, PtoH);
      h.loc = vec.add(h.loc, vec.scalar(pVelOrthogonalToReel, dt));
    }

    // --- UPDATE LOC OF HOOKS FOLLOWING A PLAYER --- 
    if (!h.vel) { //aka h.to
      let p = players[h.to]; //guaranteed to exist since !h.vel
      // if h.to doesn't contain hook anymore, project hook onto h.to
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let PtoH = vec.sub(h.loc, p.loc);
        h.loc = vec.add(p.loc, vec.normalized(PtoH, playerRadius));
      }
      // if following, then h.to, so don't care about collisions, already hooked
    }
    // --- RESET HOOK IF TOO FAR --- 
    // if hook is too far, reset it
    if (!vec.isContaining(players[h.from].loc, h.loc, hookCutoffDistance, 0)) {
      hookResetInit(hid, false);
    }
  }


  //4. 
  for (let pid in players) { //pid = player to be hooked
    for (let hid in hooks) {
      let h = hooks[hid];
      // --- HANDLE COLLISIONS OF HOOKS NOT YET ATTACHED (!h.to) ---
      if (!h.to) {
        //player has exited hook, so remove it from waitTillExit
        if (!vec.isCollided(players[pid].loc, h.loc, playerRadius, hookRadius_outer)) {
          h.waitTillExit.delete(pid);
        }
        // if colliding and not in waitTillExit and not taken care of
        else if (!h.waitTillExit.has(pid)) {
          //if player colliding with their own hook, delete
          if (h.from === pid && !h.to) {
            playersInfo[pid].hooks.throw_cooldown = null;
            hookDelete(hid);
          }
          // if the hook's owner is already hooking this player, it shouldnt have 2 hooks on the same player
          else if (getHookedBy(pid).has(h.from)) {
            //reset old attached hook, and attach the new hook 
            let oldhook = getHookFrom_To_(h.from, pid);
            hookResetInit(oldhook, true);
            hookAttach(hid, pid);
          }
          //if two players hook each other, delete both hooks and knock each other back
          else if (getAttachedTo(pid).has(h.from)) {
            let hook_to_hfrom = getHookFrom_To_(pid, h.from);
            hookDelete(hook_to_hfrom);
            knockbackAdd(hid, pid);
            hookDelete(hid);
          }
          // otherwise, just attach the hook!
          else {
            hookAttach(hid, pid);
          }
        }
        //if colliding with sender and resetting, delete hook (takes care of quickreel problem)
        else if (h.isResetting && h.from === pid) {
          hookDelete(hid);
        }
      } //end for (hooks)
    } //end if (!h.to)
  } //end for (players)


  //5.
  for (let hlid in world.holes) {
    let hl = world.holes[hlid];
    for (let pid in players) {
      if (vec.isContaining(hl.loc, players[pid].loc, hl.radius, playerRadius / 2)) {
        // DISCONNECT
        player_delete(pid);
        //CONNECT
        player_create(pid, 'respawned1');
      }
    }
  }
}











/** ---------- GAME CONSTANTS ----------
 * these are initialized by server after player joins
 */
var players = null;
var playersInfo = null;
var hooks = null;
var playerid = null;
var world = null;

// up, down, left, right
var keysPressedLocal = new Set();

/** ---------- SENDING TO SERVER ---------- 
 * (receiving is at very bottom) 
 * */
// returns a new function to execute and a promise that resolves when the new function executes
// returns [new_fn, promise]
const getWaitForExecutionPair = (callback) => {
  let r;
  const promise = new Promise((res, rej) => { r = res; });
  let new_fn = (...args) => {
    callback(...args);
    r();
  }
  return [new_fn, promise];
};

var send = {
  // sent when you join the game:
  join: async (callback) => {
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', 'user1', new_callback);
    await new_promise;
  },
  goindirection: (direction) => { // tells server that user just pressed a key (direction = "up|down|left|right")
    socket.emit('goindirection', direction);
  },
  stopindirection: (direction) => { // tells server that user just released a key (direction = "up|down|left|right")
    socket.emit('stopindirection', direction);
  },
  leftclick: (hookDir) => {
    socket.emit('leftclick', hookDir);
  },
  rightclick: () => {
    socket.emit('rightclick');
  },
  resethooks: () => {
    socket.emit('resethooks');
  },
  startaiming: () => {
    socket.emit('startaiming');
  },
  stopaiming: () => {
    socket.emit('stopaiming');
  },
  chatmessage: (msg) => {
    socket.emit('chatmessage', msg);
  },
}



/** ---------- CHAT ---------- */
var isChatting = false;
var chatMsg = "";


/** ---------- KEYBOARD (ALL LOCAL) ---------- */
var keyDirections = {
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}
var keyActions = {
  'r': "resethooks",
  'c': "resetzoom",
  'shift': "aiming",
  '/': "startchat",
  'enter': "sendchat",
  'escape': "cancel",
}



/** ---------- CANVAS / SCREEN CONSTANTS ---------- */
var canvas = document.getElementById("canvas");
const canv_top = canvas.getBoundingClientRect().top;
const canv_left = canvas.getBoundingClientRect().left;

var c = canvas.getContext("2d");

var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;
canvas.width = WIDTH;
canvas.height = HEIGHT;
var midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 }; //in world coords

let updateCanvasSize = () => {
  WIDTH = window.innerWidth;
  HEIGHT = window.innerHeight;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 };
}


/** ---------- DRAWING / CAMERA / GRAPHICS ---------- */
//1. update camZoom and camLoc
//2. call updateCamView()
//3. when drawing, use getPosOnScreen.
var camZoomDefault = 1.5;
var camZoom = camZoomDefault;
var camLoc = null; //camera location in world
var camZoomIsResetting = false;

const camZoomResetMult = 1 / 100; //percent (out of 1) per ms
const bgLineSpacing = 600;
const bgLineWidth = .5;
const bgLineWidthBold = .7;
const bgNumDivisions = 8;
const bgMaxLines = bgNumDivisions; //max num bold lines you see on a screen

//log_n(m)
const logn = (n, m) => {
  return Math.log(m) / Math.log(n);
}

const positiveMod = (n, m) => {
  if (n < 0) return ((n % m) + m) % m;
  else return n % m;
}

var getPosOnScreen = (locInWorld) => {
  let camToObj = vec.sub(locInWorld, camLoc);
  let screenPos = vec.normalized(camToObj, vec.magnitude(camToObj) / camZoom);
  let posWithNegY = vec.add(screenPos, midScreen);
  return { x: posWithNegY.x, y: -posWithNegY.y };
}

// make sure start is the intersection to start bolding!! start, end, inc are all in corrds of screen
//inclusive of both start and end unless excludeStart==true, then exclude start
// if x=true then draw all appropriate vertical lines using x coord, else horiz w/ y coord
const drawVerticalLine = (x, lineWidth) => {
  c.beginPath();
  c.strokeStyle = 'hsla(0,0%,30%,.3)';
  c.lineWidth = lineWidth;
  c.moveTo(x, 0);
  c.lineTo(x, HEIGHT);
  c.stroke();
};
const drawHorizontalLine = (y, lineWidth) => {
  c.beginPath();
  c.strokeStyle = 'hsla(0,0%,30%,.3)';
  c.lineWidth = lineWidth;
  c.moveTo(0, y);
  c.lineTo(WIDTH, y);
  c.stroke();
};
var drawBGLinesAlongCoord = (isX, start, end, inc, excludeStart) => {
  let count = 0;
  if (excludeStart) {
    count++;
    start += inc;
  }
  let fn = isX ? drawVerticalLine : drawHorizontalLine;
  for (let coord = start; inc > 0 ? coord <= end : coord >= end; coord += inc) {
    let lineWidth = count % bgNumDivisions === 0 ? bgLineWidthBold : bgLineWidth;
    fn(coord, lineWidth);
    count++;
  }
}


var playerCamera = {
  update: (newCamLoc, dt) => {
    camLoc = newCamLoc;
    if (camZoomIsResetting) {
      if (camZoom > camZoomDefault) { //zoom too big
        camZoom -= camZoom * camZoomResetMult * dt;
        if (camZoom <= camZoomDefault) {
          camZoom = camZoomDefault;
          camZoomIsResetting = false;
        }
      } else { //zoom too small
        camZoom += camZoom * camZoomResetMult * dt;
        if (camZoom >= camZoomDefault) {
          camZoom = camZoomDefault;
          camZoomIsResetting = false;
        }
      }
    }
  },
  drawBG: () => {
    //draw every other nth line, where n = add, bolding every bgNumDivisions_th line
    let add = Math.pow(bgNumDivisions, Math.ceil(logn(bgNumDivisions, Math.ceil(Math.max(WIDTH, HEIGHT) * camZoom / bgLineSpacing) / bgMaxLines)));
    //gets camera location's bottom location mod spacing * numDivisions (add this to camera to get aligned spacing; numDivisions so can just count to bolden every bgNumDivision)
    let camLocModSpacing = vec.apply(camLoc, positiveMod, add * bgLineSpacing);
    let intersectionModLoc = getPosOnScreen(vec.sub(camLoc, camLocModSpacing));

    let inc = add * bgLineSpacing / (camZoom * bgNumDivisions);
    drawBGLinesAlongCoord(true, intersectionModLoc.x, WIDTH, inc, false);
    drawBGLinesAlongCoord(true, intersectionModLoc.x, 0, -inc, true);
    drawBGLinesAlongCoord(false, intersectionModLoc.y, HEIGHT, inc, false);
    drawBGLinesAlongCoord(false, intersectionModLoc.y, 0, -inc, true);
  },
  drawWorldBorder: () => {
    c.beginPath();
    c.lineWidth = 20 / camZoom;
    c.strokeStyle = 'green';
    let pos = getPosOnScreen({ x: 0, y: 0 });
    c.arc(pos.x, pos.y, mapRadius / camZoom + c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();
  },

  drawPlayer: (pid) => {
    let color = players[pid].color;
    let loc = getPosOnScreen(players[pid].loc);

    c.beginPath();
    c.lineWidth = 6 / camZoom;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, playerRadius / camZoom - c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();


    //draw chat messages:
    let n = 1;
    if (pid === socket.id && isChatting) {
      let msg = chatMsg || "|";
      c.font = (20 / camZoom) + "px Verdana";
      c.textAlign = "center";
      c.textBaseline = "top";
      //inside
      c.fillStyle = color;
      c.fillText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      //outline
      c.strokeStyle = 'black';
      c.lineWidth = .1 / camZoom;
      c.strokeText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      n++;
    }
    for (let i = players[pid].messages.length - 1; i >= 0; i--) {
      let msg = players[pid].messages[i];
      c.font = (30 / camZoom) + "px Verdana";
      c.textAlign = "center";
      c.textBaseline = "top";
      //inside
      c.fillStyle = color;
      c.fillText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      //bold
      c.strokeStyle = 'black';
      c.lineWidth = .1 / camZoom;
      c.strokeText(msg, loc.x, loc.y + (playerRadius + 5) * n / camZoom);
      n++;
    }

  },

  drawHook: (hid, pid_from) => {
    let ploc = getPosOnScreen(players[pid_from].loc);
    let hloc = getPosOnScreen(hooks[hid].loc);
    let [hcol, linecol, bobbercol] = hooks[hid].colors;
    let outer_lw = 2 / camZoom;
    let inner_lw = 2 / camZoom;
    // draw the line
    c.beginPath();
    c.lineWidth = 1 / camZoom;
    c.strokeStyle = linecol;
    c.moveTo(ploc.x, ploc.y);
    c.lineTo(hloc.x, hloc.y);
    c.stroke();

    // draw the hook
    // inside hook (square)
    c.beginPath();
    c.strokeStyle = hcol;
    c.lineWidth = inner_lw;
    let hRad_inner = hookRadius_inner / camZoom;
    c.rect(hloc.x - hRad_inner + inner_lw / 2, hloc.y - hRad_inner + inner_lw / 2, 2 * hRad_inner - inner_lw, 2 * hRad_inner - inner_lw);
    c.stroke();

    // outside bobber (circle)
    c.beginPath();
    c.lineWidth = outer_lw;
    c.strokeStyle = bobbercol;
    let hRad_outer = hookRadius_outer / camZoom;
    c.arc(hloc.x, hloc.y, hRad_outer + outer_lw / 2, 0, 2 * Math.PI);
    c.stroke();
  },

  drawHole: (hlid) => {
    let color = world.holes[hlid].color;
    let loc = getPosOnScreen(world.holes[hlid].loc);
    let radius = world.holes[hlid].radius / camZoom;

    c.beginPath();
    c.lineWidth = radius;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, radius - c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();
  },
}


/** ---------- FUNCTION CALLED EVERY FRAME TO DRAW/CALCULATE ---------- */
var prevtime;
var starttime;
var currtime;
let newFrame = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  currtime = timestamp - starttime;
  prevtime = timestamp;

  //update world as if server (interpolate)
  try{
    
    updateGame(dt);
  } catch (e) {
    
  }
    
  // calculate fps
  let fps = Math.round(1000 / dt);
  // console.log("fps: ", fps);

  //update camera:
  playerCamera.update(players[socket.id].loc, dt);

  //render:
  c.clearRect(0, 0, WIDTH, HEIGHT);

  //draw BG:
  playerCamera.drawBG();

  //draw holes:
  for (let hlid in world.holes) {
    playerCamera.drawHole(hlid);
  }

  //draw border:
  playerCamera.drawWorldBorder();

  //draw others:
  for (let pid in players) {
    if (pid === socket.id) continue;
    playerCamera.drawPlayer(pid);
  }
  //draw me last
  playerCamera.drawPlayer(socket.id);

  // draw hooks
  for (let hid in hooks) {
    playerCamera.drawHook(hid, hooks[hid].from);
  }


  window.requestAnimationFrame(newFrame);
}


/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  if (keysPressedLocal.has(key)) return;
  keysPressedLocal.add(key);
  // console.log('pressing', key);

  if (isChatting && key.length === 1) {
    if (chatMsg.length < maxMessageLen) {
      chatMsg += event.key;
    }
  }
  else if (isChatting && key == "backspace") {
    chatMsg = chatMsg.substr(0, chatMsg.length - 1);
  }

  else if (keyDirections[key]) { //ie WASD was pressed, not some other key
    let movementDir = keyDirections[key];
    send.goindirection(movementDir);

  } else if (keyActions[key]) {
    let actionKey = keyActions[key];
    switch (actionKey) {
      case "resethooks":
        send.resethooks();
        break;
      case "resetzoom":
        camZoomIsResetting = true;
        break;
      case "aiming":
        send.startaiming();
        break;

      // chat:
      case "startchat":
        isChatting = true;
        chatMsg = "";
        break;
      case "sendchat":
        if (isChatting) {
          chatMsg = chatMsg.trim();
          if (chatMsg) send.chatmessage(chatMsg);
          isChatting = false;
          chatMsg = "";
        }
        break;
      case "cancel":
        if (isChatting) {
          isChatting = false;
          chatMsg = "";
        }
        break;
    }

  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  if (!keysPressedLocal.has(key)) return;
  keysPressedLocal.delete(key);

  // console.log('releasing', key);

  if (keyDirections[key]) {
    let movementDir = keyDirections[key];
    send.stopindirection(movementDir);

  } else if (keyActions[key]) {
    let actionKey = keyActions[key];
    switch (actionKey) {
      case "aiming":
        send.stopaiming();
        break;
    }

  }
});


document.addEventListener('mousedown', function (event) {
  switch (event.button) {
    //left click:
    case 0:
      let mousePos = { x: event.clientX - canv_left, y: -(event.clientY - canv_top) };
      let hookDir = vec.sub(mousePos, midScreen); //points from player to mouse
      send.leftclick(hookDir);
      break;
    //right click
    case 2:
      send.rightclick();
      break;

  }
});

const zoomMin = 1 / 100;
const zoomMax = 100;
const dYPercent = 1 / 1000;
document.addEventListener('wheel', event => {
  if (camZoomIsResetting) return;
  let dZoom = 1 + (event.deltaY * dYPercent);
  let newZoom = camZoom * dZoom;
  if (newZoom < zoomMin) {
    camZoom = zoomMin;
  } else if (newZoom > zoomMax) {
    camZoom = zoomMax;
  } else {
    camZoom *= dZoom;
  }
});

//anti right-click and middle click
document.addEventListener('contextmenu', event => event.preventDefault());
document.onmousedown = function (e) { if (e.button === 1) return false; }

window.addEventListener('resize', () => {
  updateCanvasSize();
});


const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (...serverInfo) => {
    playerid = socket.id;
    [players, hooks, world, playerRadius, hookRadius_outer,
      hookRadius_inner, mapRadius, maxMessageLen] = serverInfo;
  };
  await send.join(joinCallback);

  console.log("playerid", playerid);
  console.log("players", players);
  console.log("hooks", hooks);
  console.log("world", world);
  console.log("playerRadius", playerRadius);
  console.log("hookRadius", hookRadius_outer);

  // once get here, know that everything is defined, so can start rendering  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const serverImage = (serverPlayers, serverPlayersInfo, serverHooks) => {
  if (!players) console.log("too early");
  players = serverPlayers;
  playersInfo = serverPlayersInfo;
  hooks = serverHooks;
}
socket.on('serverimage', serverImage);


socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
