//https://socket.io/docs/server-api/
const express = require('express');
const PORT = process.env.PORT || 3001;
const INDEX = '/public/index.html';

console.log('A')
const server = express()
.use(express.static('public'))
.use((req, res) => res.sendFile(INDEX, { root: __dirname }))
.listen(PORT, function () {
  console.log(`listening on *:${PORT}`);
});
console.log('B')

const io = require('socket.io')(server, { pingInterval: 5000, pingTimeout: 25000 });
console.log('C')
const { vec } = require('../common/vector.js');
console.log('D')

const GAME_UPDATE_TIME = 8; // formerly WAIT_TIME # ms to wait to re-render & broadcast players object
const GAME_SEND_TIME = 16;
const GAME_REQUEST_TIME = 16 * 2;

const createDummy = false;
const numHoles = 100;
const topNleaderboard = 2;

const mapRadius = 5000;
const playerRadius = 40; //pix
const hookRadius_outer = 10; //circle radius (PURELY COSMETIC, ONLY CENTER OF HOOK MATTERS)
const hookRadius_inner = .7 * (hookRadius_outer / Math.sqrt(2)); //inner hook radius (square radius, not along diagonal) (PURELY COSMETIC)

const rodDistance = 80; // length of rod away from player (scales linearly if player grows)
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

//TODO: SEND ONLY WHAT YOU NEED (loc, not vel or anything else)
//TODO: disconnect bug
//TODO: efficiencies, add redundancy in data structures (get rid of loop in hook-hook check with playersHooked object, etc)
// TODOs:
// - player hooking speed is slower
// - reeling a player who's walking away is slower (or faster?) than usual
// if player is beeing reeled, their velocity should reflect that
// - map stuff : locality on a big map
// - warning if hook is approaching the hookReset distance, and hook slows down / changes color too
// string turns green when ready to reel
// hook turns red if almost too far
// world is sent once at beginning, callback does not do anything with players or hooks

// player walking into wall has 0 velocity
// send update on a frequent interval, independent from WAIT_TIME (based on ping?)

// TODO make reel cooldown = amount of time it takes for hook to stop after reeling them in (related to nofriction_timeoutf)
// also make reel so that player doesn't have to walk back towards player theyre reeling (distance per reel > distance that player could walk in that time)
// player should be able to follow their hook like it's a leash on a dog even if it's going at a 45 degree angle (worst case), it shouldnt be too fast
// fix aiming for hooked players (so it's way faster and more controlled), and resetting hooks
//better aiming cancels boost
//hook deflection on border
//while reeling, slow down?
//decrease hookspeed so it's easier to dodge







/** ---------- GAME CONSTANTS ---------- */
//playerid (= socket.id) -> socket
var sockets = {};

// PLAYER INFO TO BE BROADCAST (GLOBAL)
var players = {
  /*
    "initialPlayer (socket.id)": {
      loc:...,
      vel: { x: 0, y: 0 },

      username: "billybob",
      color: "orange",
      messages:[m0, m1, ...],
      tipOfRodLoc:, location in world of tip of rod
      facingDir:, direction facing
    }
    */
};

// LOCAL (SERVER SIDE) PLAYER INFO
var playersInfo = {
  /*
    "initialPlayer (socket.id)": {
      "metrics": {
        kills,
        timeStarted,
        //NOTE: SCORE IS LOCATED IN LEADERBOARD
      },
      "consts":{
        GAME_SEND_TIME,

        walkspeed,
        boost,
        radius,
        rodDistance,
        hookCutoffDistance,
      }
      //NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
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
      
      knockback: {
        //all these are either defined appropriately or null
        speed: null, //kbSpeed
        dir: null, //NormalizedDir //null if no knockback
        timeremaining: null // timeout
      },
      
      hooks: {
        see hook invariants
      },
      
      chat: {
        timeouts: [t0, t1, ...], //list of time before message disappears, corresponding to each msg
      },

      pvp: {
        taggedBy: , //player who most recently hit this player
      }
    },
  */
}


var hooks = {
  /* 
  hid: {
    see hook invariants
  }
  */
}


/*
Hook invariants:
  - if you're hooked by someone and you hit them with your hook, both hooks disappear 
  - when you reel, all hooks get reeled in and the reel cooldown starts
  - when you throw hook, your velocity adds only if it boost it (not if it slows it)
  - if attached, can't be resetting

  - player hooked speed is much slower and there's an allowed region within distance of the followHook you can go
  - player hooked hookthrow speed is faster
  - warning if hook is approaching the hookReset distance, and hook slows down / changes color too
  
  hooks[hid]: {
    from, // NEVER null
    to, // always the player the hook is latched onto (or null)
    loc, // NEVER null
    vel, // null iff !!to and not reeling anyone in, ie null iff following a player (!null iff !to or reeling someone in), i.e. when just attached and following someone (when hook onto player and not the one reeling, lose velocity and track that player).
    colors: [hook, line, bobber], // color of each part of the hook
    isResetting, //while true, reel in fast and always towards h.from, and can't reel (unless collides with player, then set to false). never isResetting if someone is attached ie !!to.
    reelingPlayer, //not null iff there exists a player with p.followHook === reelingPlayer, i.e. this hook is currently reeling reelingPlayer
    nofriction_timeout: null, // not null ==> reelingPlayer not null (not vice versa). Time left for reelingPlayer to follow followHook (starts from top whenever h.to reeled, resets to null whenever another hook on h.attached gets reeled), and then hook vel decays, and then hook follows player and player stops following hook
    waitTillExit: new Set(), //the players that this hook will ignore (not latch onto/disappear) (when the hook exits a player, it should remove that player--only has elements when !h.to) 
  }

  playersInfo[pid].hooks: {
    owned: // contains every hook the person owns (typically 1)
    attached: // contains every hook being attached to this player
    followHook: //contains the most recent h.from hid that reeled this h.to player
    reel_cooldown: null, //time left till can reel again (starts from top whenever reel, resets to null if all hooks come in)
    throw_cooldown: null, //time left till can throw again (starts from top whenever throw, resets after throw_cooldown)
    hookedBy: // pids this player is hooked by (redundant info, makes stuff faster but info is already contained in attached)
    attachedTo: // pids this player is hooking (redundant info, makes stuff faster but info is already contained in owned)
    isAiming: false // true iff player is aiming the hooks (shift button)
    defaultColors: [hook, line, bobber] // (typically constant once initialized) the default colors of throwing a hook 
  }

  player loc = !followHook? player.loc: hook.loc bounded by radius, after updating hook.locs
  hook loc = !vel? to.loc : hook.loc

 */
var generateHoles = () => {
  let holes = {};
  for (let i = 0; i < numHoles; i++) {
    let hlLoc = generateRandomLoc();
    holes['hl' + i] = {
      loc: hlLoc,
      radius: Math.random() * 40 + playerRadius,
      color: 'hsl(' + Math.floor(Math.random() * 360) + ', 100%, 10%)',
    };
  }
  let special = {
    sparta: {
      loc: { x: 0, y: 0 },
      radius: 500,
      color: 'black',
    },
  };

  return { ...special, ...holes };
}
var world = {
  holes: generateHoles(),
};


class Leaderboard {
  // playerindex = pid -> index in scores
  // scores = sorted list of [player, score], by DESCENDING score 
  constructor() {
    this.scores = [];
    this.playerindex = {};
    this._getInsertLoc = (score) => {
      let i = 0;
      let j = this.scores.length;
      while (i < j) {
        let index = Math.floor((i + j) / 2);
        let elt = this.scores[index][1];
        if (score > elt) j = index;
        else i = index + 1;
      }
      return i; //i === j
    };
    this.needsRebroadcast = false; //true when a player in the topN was updated
  }
  //updates needsReboradcast to false, and sends original val of needsRebroadcast
  shouldRebroadcastTopN() {
    let ret = this.needsRebroadcast;
    this.needsRebroadcast = false;
    return ret;
  }
  //extracts username from top players
  getTopN() {
    let leaders = [];
    let thisleaders = this.scores.slice(0, topNleaderboard);
    thisleaders.forEach(([pid, score]) => { leaders.push([players[pid].username, score]) });
    return leaders;
  }
  //adds inc to player's score
  addToPlayerScore(pid, inc) {
    //remove player from scores
    let pindex = this.playerindex[pid];
    let pscore = this.scores.splice(pindex, 1)[0][1];
    let newscore = pscore + inc;
    let newindex = this._getInsertLoc(newscore);
    //update data structures
    this.scores.splice(newindex, 0, [pid, newscore]);
    this.playerindex[pid] = newindex;
    for (let [p, _] of this.scores.slice(newindex + 1)) {
      this.playerindex[p]++;
    }

    if (pindex <= topNleaderboard || newindex <= topNleaderboard) {
      this.needsRebroadcast = true;
    }
  }
  initPlayer(pid) {
    this.scores.push([pid, 0]);
    let newindex = this.scores.length - 1;
    this.playerindex[pid] = newindex;
    if (newindex <= topNleaderboard) {
      this.needsRebroadcast = true;
    }
  }
  //deletes player from leaderboard
  deletePlayer(pid) {
    let pindex = this.playerindex[pid];
    delete this.playerindex[pid];
    this.scores.splice(pindex, 1);
    //decrease index of all indices greater than pindex
    for (let [p, _] of this.scores.slice(pindex)) {
      this.playerindex[p]--;
    }
    if (pindex <= topNleaderboard) {
      this.needsRebroadcast = true;
    }
  }
  getPlayerScore(pid) {
    return this.scores[this.playerindex[pid]][1];
  }
}

//maps score -> set of players
var leaderboard = new Leaderboard();




// game assumes these are normalized!!
const keyVectors = {
  'up': vec.normalized({ x: 0, y: 1 }),
  'down': vec.normalized({ x: 0, y: -1 }), //must = -up
  'left': vec.normalized({ x: -1, y: 0 }), //must = -right
  'right': vec.normalized({ x: 1, y: 0 })
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

/** ---------- CHAT FUNCTIONS ---------- */
var chatAddMessage = (pid, msg) => {
  msg = msg.trim();
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
  let kbFromHookVel = vec.projectedVelocityInDirection(hooks[hid].vel, hooks[hid].vel, knockbackspeed_min, knockbackspeed_max);
  //if hook is headed towards player (ie NOT FAR INSIDE PLAYER), incorporate pool ball effect:
  let hookToKbPlayer = vec.sub(players[pid].loc, hooks[hid].loc);
  if (vec.dot(hookToKbPlayer, hooks[hid].vel) > 0) { //ignores case where hookToKbPlayer = {0,0}
    let kbFromPoolEffect = vec.projectedVelocityInDirection(hooks[hid].vel, hookToKbPlayer, knockbackspeed_min, knockbackspeed_max);
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

//move to location
var player_moveTo = (p, loc) => {
  let dLoc = vec.sub(loc, p.loc);
  p.loc = loc;
  p.tipOfRodLoc = vec.add(p.tipOfRodLoc, dLoc);
}
//move in direction of p.vel
var player_move = (p, dt) => {
  let dLoc = vec.scalar(p.vel, dt);
  p.loc = vec.add(p.loc, dLoc);
  p.tipOfRodLoc = vec.add(p.tipOfRodLoc, dLoc);

}
/** ---------- AIMING FUNCTIONS ---------- */
var aimingStart = (pid) => {
  playersInfo[pid].hooks.isAiming = true;
}

var aimingStop = (pid) => {
  let pInfo = playersInfo[pid];
  pInfo.hooks.isAiming = false;
}

/** ---------- PVP TAGGING ----------  */

// pvp tag from aggressor to tagged
var updatePvpTag = (pid_tagged, pid_aggressor) => {
  playersInfo[pid_tagged].pvp.taggedBy = pid_aggressor;
}

//when killer kills dead, update score
var updateScoreOnKill = (pid_killer, pid_dead) => {
  playersInfo[pid_killer].metrics.kills++;
  let scoreInc = Math.round(leaderboard.getPlayerScore(pid_dead) + 1);
  leaderboard.addToPlayerScore(pid_killer, scoreInc);
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


var calculateTipOfRodLoc = (pLoc, rodDir) => {
  return vec.add(pLoc, vec.normalized(rodDir, playerRadius + rodDistance));
}

var updateFacingDirInfo = (p, facingDir) => {
  p.facingDir = vec.normalized(facingDir);
  p.tipOfRodLoc = calculateTipOfRodLoc(p.loc, facingDir);
}

// returns [hook id, hook object]
var createNewHook = (pid_from, throwDir) => {
  let p = players[pid_from];
  let hookColors = playersInfo[pid_from].hooks.defaultColors;
  let hookVel = playersInfo[pid_from].hooks.attached.size > 0 ?
    vec.normalized(throwDir, hookspeed_hooked)
    : vec.projectedVelocityInDirection(p.vel, throwDir, hookspeed_min, hookspeed_max);
  let hook = {
    from: pid_from,
    to: null,
    loc: players[pid_from].tipOfRodLoc, //vec.add(p.loc, vec.normalized(throwDir, playerRadius)),
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
  let reelDir = vec.sub(players[h.from].tipOfRodLoc, h.loc);
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
  let h = hooks[hid];
  //knockback
  knockbackAdd(hid, pid_to);
  //attachment
  h.to = pid_to;
  h.vel = null;
  h.isResetting = false;
  getAttached(pid_to).add(hid);
  getHookedBy(pid_to).add(h.from);
  getAttachedTo(h.from).add(pid_to);
  // reset pid_to boost
  boostReset(playersInfo[pid_to]);
  //reset reel cooldown for hook owner
  playersInfo[h.from].hooks.reel_cooldown = null;
  h.waitTillExit.clear();
  //pvp tag
  updatePvpTag(h.to, h.from);
}


//reels all hooks owned by pid
var hookReel = (pid, shouldReelPlayers) => {
  // console.log('reeling');
  for (let hid of getOwned(pid)) {
    let h = hooks[hid];
    if (h.to) {
      if (!shouldReelPlayers) continue;
      //for all hooks attached to player, start following the player
      for (let hid2 of getAttached(h.to)) {
        hookStopReelingPlayer(hooks[hid2]);
      }
      let reelDir = vec.sub(players[h.from].tipOfRodLoc, h.loc);
      let hookVel = vec.projectedVelocityInDirection(players[pid].vel, reelDir, hookspeedreel_min, hookspeedreel_max);
      hookStartReelingPlayer(pid, hid, hookVel);
      // also reset knockback of player
      knockbackReset(playersInfo[h.to]);
      // set pvp tag
      updatePvpTag(h.to, h.from);
    }
    else {
      hookResetInit(hid, true);
    }
  }
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
  let now = Date.now();
  let startLoc = generateRandomLoc();
  let [pCol, hCol, lineCol, bobberCol] = generateRandomPlayerColor();
  let defaultFacingDir = { x: 1, y: 0 };
  return [
    {// PLAYER:
      loc: startLoc,
      vel: { x: 0, y: 0 },
      username: username,
      color: pCol,
      messages: [],
      facingDir: defaultFacingDir,
      tipOfRodLoc: calculateTipOfRodLoc(startLoc, defaultFacingDir),
      ...pOptions,
    },
    // PLAYER INFO:
    {//NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
      metrics: {
        kills: 0,
        timeStarted: now,
      },
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
      },
      pvp: {
        taggedBy: null,
      },
    }
  ]
}


//returns false if the player is not connected!!! (NOT TRUE!!)
const checkPlayerIsConnected = (pid, debugString = '') => {
  let ret = !sockets[pid];
  if (ret) {
    console.error('Player ', pid, ' was not connected, but sent an event: ', debugString);
  }
  return ret;
}
const validateVec = (v, debugString = '') => {
  if (v && typeof v.x === 'number' && typeof v.y === 'number') {
    let extractedV = { x: v.x, y: v.y };
    return extractedV;
  } else {
    console.error('Expected vector ', v, ' was not of the correct data type:', debugString);
    return false;
  }
}
const validateDir = (d, debugString = '') => {
  if (d && typeof d === 'string' && keyVectors[d]) {
    return d;
  } else {
    console.error('Expected dir ', d, ' was not of the correct data type:', debugString);
    return false;
  }
}
const validateStr = (s, debugString = '') => {
  if (typeof s === "string") {
    return s;
  } else {
    console.error('Expected string ', s, ' was not of the correct data type:', debugString);
    return false;
  }
}


//if you want to understand the game, this is where to do it:
// fired when client connects
io.on('connection', (socket) => {
  //set what server does on different events
  socket.on('join', (username, callback) => {
    console.log("player joining:", socket.id, "sockets:", Object.keys(sockets), "players:", Object.keys(players));
    let debug = 'join';
    username = validateStr(username, debug); if (!username) username = "Player";
    sockets[socket.id] = socket;
    player_create(socket.id, username);
    leaderboard.initPlayer(socket.id);
    try {
      callback(
        players,
        hooks,
        world,
        leaderboard.getTopN(),
        playerRadius,
        hookRadius_outer,
        hookRadius_inner,
        mapRadius,
        chat_maxMessageLen,
      );
    } catch (e) {
      console.error('Failed to run callback ', callback, 'for player ', socket.id);
      console.error('Error:', e);
    }
  });


  socket.on('disconnect', (reason) => {
    console.log("player disconnecting:", socket.id, reason, "sockets:", Object.keys(sockets), "players:", Object.keys(players));
    if (!playersInfo[socket.id]) {
      console.error('player disconnect error:', socket.id);
    }
    if (checkPlayerIsConnected(socket.id)) return;

    delete sockets[socket.id];
    player_delete(socket.id);
    leaderboard.deletePlayer(socket.id);
  });


  socket.on('goindirection', (dir) => {// dir is up, down, left, or right
    let debug = 'goindirection';
    if (checkPlayerIsConnected(socket.id, debug)) return;
    dir = validateDir(dir, debug); if (!dir) return;

    let pInfo = playersInfo[socket.id];
    if (!pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.add(dir);
      walk_updateOnPress(pInfo, dir);
      boost_updateOnPress(pInfo, dir);
    }
  });


  socket.on('stopindirection', (dir) => {// dir is up, down, left, or right
    let debug = 'stopindirection';
    if (checkPlayerIsConnected(socket.id, debug)) return;
    dir = validateDir(dir, debug); if (!dir) return;

    let pInfo = playersInfo[socket.id];
    if (pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.delete(dir);
      walk_updateOnRelease(pInfo, dir);
      boost_updateOnRelease(pInfo, dir);
    }
  });


  socket.on('leftclick', (dir) => {// hookDir is {x, y}
    let debug = 'leftclick';
    if (checkPlayerIsConnected(socket.id, debug)) return;
    dir = validateVec(dir, debug); if (!dir) return;

    //received facing info, so update facing info
    updateFacingDirInfo(players[socket.id], dir);
    // console.log('throwing hook');
    let pInfo = playersInfo[socket.id];
    if (!pInfo.hooks.throw_cooldown) {
      //throw a new hook
      if (pInfo.hooks.owned.size < maxHooksOut)
        hookThrow(socket.id, dir);
    }
  });

  socket.on('rightclick', () => {
    let debug = 'rightclick';
    if (checkPlayerIsConnected(socket.id, debug)) return;

    // console.log('starting to reel')
    let pInfo = playersInfo[socket.id];
    if (pInfo.hooks.owned.size >= 1) {
      // console.log('reeling');
      let shouldReelAttached = !pInfo.hooks.reel_cooldown;
      hookReel(socket.id, shouldReelAttached);
      if (shouldReelAttached)
        pInfo.hooks.reel_cooldown = reel_cooldown;
    }
  });


  socket.on('resethooks', () => {
    let debug = 'resethooks';
    if (checkPlayerIsConnected(socket.id, debug)) return;

    // hook_resetAllOwned(socket.id);
    hook_deleteAllOwned(socket.id);
  });

  socket.on('startaiming', () => {
    let debug = 'startaiming';
    if (checkPlayerIsConnected(socket.id, debug)) return;

    aimingStart(socket.id);
  });

  socket.on('stopaiming', () => {
    let debug = 'stopaiming';
    if (checkPlayerIsConnected(socket.id, debug)) return;

    aimingStop(socket.id);
  });

  socket.on('chatmessage', (msg) => {
    let debug = 'chatmessage';
    if (checkPlayerIsConnected(socket.id, debug)) return;
    msg = validateStr(msg, debug); if (!msg) return;

    // for commands:
    /*
Regex for commands:
(\/tp\s+)((("[^"]*")|([^\s]*)))(\s*)((("[^"]*")|([^\s]*)))
/tp "a"    "b"
/tp a b
/tp     fat  "test   "
/tp "a""b"
/tp "username 1" b
*/
// match  msg with ^ to see if tp, etc
// if regex (tp)
// else if regex (something else)
// else:
    chatAddMessage(socket.id, msg);
  });

});

var facingDirCallback = (playerid) => {
  let debug = 'facingdir';
  return (dir) => {
    if (checkPlayerIsConnected(playerid, debug)) return;
    dir = validateVec(dir, debug); if (!dir) return;

    updateFacingDirInfo(players[playerid], dir);
  };
}


var playersWhoDied = {}; //{playerids: holeid}
// ---------- RUN GAME (socket calls do the updating, this just runs it) ----------
// Update locations, then update states
// 1. update hooks with velocity (i.e update hooks not following a player), and confine them to world border 
// 2. update all player locations, and confine them to the hooks they're following (and confine to world border too)
// 3. update hooks based on confinement to player, distance to player, and aiming.
// 4. update hooks based on collisions (only for hooks with !h.to)
// 5. hole collisions (DEATHS)
const updateGame = (dt) => {
  // if (dt > GAME_UPDATE_TIME + 5) console.log('server fps lag', dt);
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
    player_velocity_update(pInfo, p);
    // update player location (even if hooked, lets player walk within hook bubble)
    player_move(p, dt);

    // update players confined to hook radius
    if (pInfo.hooks.followHook) {
      let h = hooks[pInfo.hooks.followHook];
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let htop = vec.sub(p.loc, h.loc);
        boostReset(pInfo);
        player_moveTo(p, vec.add(h.loc, vec.normalized(htop, playerRadius)));
      }
    }
    // confine player to world border
    if (!vec.isContaining(vec.zero, p.loc, mapRadius, playerRadius)) {
      player_moveTo(p, vec.normalized(p.loc, mapRadius - playerRadius));
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
  // --- HANDLE COLLISIONS OF HOOKS NOT YET ATTACHED (!h.to) ---
  for (let pid in players) { //pid = player to be hooked
    for (let hid in hooks) {
      let h = hooks[hid];
      if (!h.to) {
        //if player owns the hook
        if (h.from === pid) {
          if (!vec.isCollided(players[h.from].tipOfRodLoc, h.loc, 0, hookRadius_outer)) {
            h.waitTillExit.delete(pid);
          }
          //if !waitTillExit
          else if (!h.waitTillExit.has(pid)) {
            //if player reeled in their own hook, delete
            playersInfo[pid].hooks.throw_cooldown = null;
            hookDelete(hid);
          }
          //if colliding with sender and resetting, delete hook (takes care of quickreel problem)
          else if (h.isResetting) {
            hookDelete(hid);
          }
        } //end if (h.from === pid)
        else {
          //player has exited hook, so remove it from waitTillExit
          if (!vec.isCollided(players[pid].loc, h.loc, playerRadius, hookRadius_outer)) {
            h.waitTillExit.delete(pid);
          }
          // if colliding and not in waitTillExit and not taken care of
          else if (!h.waitTillExit.has(pid)) {
            // if the hook's owner is already hooking this player, it shouldnt have 2 hooks on the same player
            if (getHookedBy(pid).has(h.from)) {
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
        } //end if (pid !== h.from)
      } //end if (!h.to)
    } //end for (hooks)
  } //end for (players)


  //5. DEATHS
  for (let hlid in world.holes) {
    let hl = world.holes[hlid];
    for (let pid in players) {
      if (vec.isContaining(hl.loc, players[pid].loc, hl.radius, playerRadius / 2)) {
        //add player to playersWhoDied (don't want to do this every dt, so need if statement, player isn't deleted instantly)
        if (!playersWhoDied[pid]) {
          //decide who killer is, if any
          let killer = playersInfo[pid].pvp.taggedBy;
          if (false && killer) {
            //TODO: if killer is completely dead, send a beyondGraveKill message
            if (!playersInfo[killer]) {
              //TODO
            }
            // otherwise, TODO: HANDLE REDEMPTION from tagging, i.e. knockback or an idiot walking into a hole (not just swallowing as a hole)
            else if (false) {
              //TODO
            }
          }
          //update killer's score
          // if (killer) {
          //   updateScoreOnKill(killer, pid);
          // }
          // console.log('A', killer);

          playersWhoDied[pid] = [hlid, killer];
        }
      }
    }
  }
}




var prevtime = null;
setInterval(() => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  updateGame(dt);
}, GAME_UPDATE_TIME);




setInterval(() => {
  //send server image to all
  for (let playerid in sockets) {
    sockets[playerid].volatile.json.emit('serverimage', players, hooks, playersWhoDied);
  }

  //if need to send leaderboard, then do
  if (leaderboard.shouldRebroadcastTopN())
    io.json.emit('updateleaders', leaderboard.getTopN());

  // TODO let player be a hole for a period of time, and reclaim their life
  if (Object.keys(playersWhoDied).length > 0) {
    let now = Date.now();
    for (let playerid in playersWhoDied) {
      let [hlid, killer] = playersWhoDied[playerid];
      let pMetrics = playersInfo[playerid].metrics;
      sockets[playerid].json.emit('deathmessage', leaderboard.getPlayerScore(playerid), now - pMetrics.timeStarted, pMetrics.kills, hlid, killer);
      //TODO don't immediately disconnect, but make a timer for redemption
      sockets[playerid].disconnect(true);
    }
    playersWhoDied = {};
  }
}, GAME_SEND_TIME);


setInterval(() => {
  for (let playerid in sockets) {
    sockets[playerid].volatile.json.emit('requestfacingdirection', facingDirCallback(playerid));
  }
}, GAME_REQUEST_TIME);


console.log('Z')
