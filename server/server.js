//https://socket.io/docs/server-api/
const express = require('express');
const PORT = process.env.PORT || 3001;
const INDEX = '/public/index.html';

const server = express()
  .use(express.static('public'))
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, function () {
    console.log(`listening on *:${PORT}`);
  });

const io = require('socket.io')(server);
const { vec } = require('../common/vector.js');

const WAIT_TIME = 8; // # ms to wait to re-render & broadcast players object

const mapRadius = 2000;

const playerRadius = 40; //pix
const walkspeed = 150 / 1000; // pix/ms
const walkspeed_hooked = 100 / 1000; // pix/ms

const hookRadius_outer = 10; //circle radius (PURELY COSMETIC, ONLY CENTER OF HOOK MATTERS)
const hookRadius_inner = .7 * (hookRadius_outer / Math.sqrt(2)); //inner hook radius (square radius, not along diagonal) (PURELY COSMETIC)

const boostMultEffective_max = (2.5 * 124 / 1000) / walkspeed;
const boostMult_max = 3;

const kb_minspeed = 124 / 1000;
const kb_maxspeed = 250 / 1000;
const knockback_timeout = .3 * 1000;

const playerVel_max = (1 + boostMultEffective_max) * walkspeed; //ignoring kb

const a0 = 1 / (160 * 16); // boost decay v^2 term
const b0 = 1 / (80 * 16); // boost decay constant term
const c0 = 1 / (37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// ^ Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started

const hookspeed_reset = 800 / 1000;

const hookspeed_max = playerVel_max + 50 / 1000;
const hookspeed_min = 300 / 1000;
const hookspeed_min_hooked = hookspeed_max;

const hookspeedreel_min = 220 / 1000; //230 / 1000;
const hookspeedreel_max = 235 / 1000; //280 / 1000;
const reel_cooldown = 1.7 * 1000;
const nofriction_timeout = .25 * 1000;

const throw_cooldown = 200; //ms

const maxHooksOut = 2; //per player
const hookCutoffDistance = 1000; //based on center of player and center of hook

// constant decay of reeling in player
const a0h = 1 / (160 * 16); // v^2 term
const b0h = 1 / (1000 * 16);
const c0h = 1 / (30 * 16); // c / (speedMult + d) term
const d0h = 1 / (.015 * 16);

//constant decay of knockback
const a0k = 4 * 1 / (160 * 16);
const b0k = 4 * 1 / (1000 * 16);
const c0k = 2 * 1 / (30 * 16);
const d0k = 1 / (.015 * 16);

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
    ['#c2a500', '#c2a500', '#c2a500', '#fb3254'],
    ['#fb3254', '#fb3254', '#fb3254', '#e732fb'],
    ['hsl(180, 100%, 70%)', 'hsl(180, 100%, 70%)', 'hsl(180, 100%, 70%)', '#e732fb'],
    ['#e732fb', '#e732fb', '#e732fb', 'hsl(180, 100%, 70%)'],
  ]

  return palette.concat(special);
}
const playerHookColorPalette = generateColorPalette();

//TODO: SEND ONLY WHAT YOU NEED (loc, not vel or anything else)
//TODO: disconnect bug / coloring bug
//TODO: efficiencies, add redundancy in data structures (get rid of loop in hook-hook check with playersHooked object, etc)
// TODOs:
// - player hooking speed is slower
// - player hooked speed is much slower and there's an allowed region within distance of the followHook you can go
// - player hooked hookthrow speed is faster
// - colors in hooks and players!!! fix colors, rendering etc
// - warning if hook is approaching the hookReset distance, and hook slows down / changes color too
// - reeling a player who's walking away is slower (or faster?) than usual
// - when delete a hook, delete all hooks that landed on that player after it
// pulls only last 1 sec
// hooks are centered on player
// if player is beeing reeled, their velocity should reflect that
// if throw then reel immediately, hook should disappear
// - map stuff
// string turns green when ready to reel
// hook turns red if almost too far
// world is sent once at beginning, callback does not do anything with players or hooks



// PLAYER INFO TO BE BROADCAST (GLOBAL)
var players = {
  /*
    "initialPlayer (socket.id)": {
      loc: { x: 0, y: 0 },//generateStartingLocation(),
      vel: { x: 0, y: 0 },

      username: "billybob",
      color: "orange",
    }
    */
};

// LOCAL (SERVER SIDE) PLAYER INFO
var playersInfo = {
  /*
    "initialPlayer (socket.id)": {
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
    vel, // null iff !!to and not reeling anyone in, i.e. when just attached and following someone (when hook onto player and not the one reeling, lose velocity and track that player).
    colors: [hook, line, bobber], // color of each part of the hook
    isResetting, //while true, reel in fast and always towards h.from, and can't reel (unless collides with player, then set to false). never isResetting if someone is attached ie !!to.
    reelingPlayer, //not null iff there exists a player with p.followHook === reelingPlayer, i.e. this hook is currently reeling reelingPlayer
    nofriction_timeout: null, // not null ==> reelingPlayer not null (not vice versa). Time left for reelingPlayer to follow followHook (starts from top whenever h.to reeled, resets to null whenever another hook on h.attached gets reeled), and then hook vel decays, and then hook follows player and player stops following hook
    waitTillExit: new Set(), //the players that this hook will ignore (not latch onto/disappear) (when the hook exits a player, it should remove that player)
  }

  playersInfo[pid].hooks: {
    owned: // contains every hook the person owns (typically 1)
    attached: // contains every hook being attached to this player
    followHook: //contains the most recent h.from hid that reeled this h.to player
    reel_cooldown: null, //time left till can reel again (starts from top whenever reel, resets to null if all hooks come in)
    throw_cooldown: null, //time left till can throw again (starts from top whenever throw, resets after throw_cooldown)
    hookedBy: // pids this player is hooked by (redundant info, makes stuff faster but info is already contained in attached)
    attachedTo: // pids this player is hooking (redundant info, makes stuff faster but info is already contained in owned)
    defaultColors: [hook, line, bobber] // (typically constant once initialized) the default colors of throwing a hook 
  }

  player loc = !followHook? player.loc: hook.loc bounded by radius, after updating hook.locs
  hook loc = !vel? to.loc : hook.loc

 */

var world = {
  holes: {
    sparta: {
      loc: { x: 400, y: -400 },
      radius: 150,
      color: 'black',
    }

  }
};




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

var boost_velocity_decay = (pInfo, dt) => {
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

/** ---------- KNOCKBACK FUNCTIONS ---------- */
// pid of player being kb'd, hid of hook knocking back player
var knockbackAdd = (hid, pid) => {
  let hookToKbPlayer = hooks[hid].vel; // vec.sub(players[pid].loc, hooks[hid].loc);
  // let throwPlayerToHook = vec.sub(hooks[hid].loc, players[hooks[hid].from].loc);
  let mult = 1;//Math.abs(vec.dot(vec.normalized(hookToKbPlayer), vec.normalized(throwPlayerToHook)));
  let kbVel = projectedVelocityInDirection(hooks[hid].vel, hookToKbPlayer, kb_minspeed, kb_maxspeed, hookspeed_max);

  let pInfo = playersInfo[pid];
  if (pInfo.knockback.dir) { //add onto previous kb
    kbVel = vec.add(vec.normalized(pInfo.knockback.dir, pInfo.knockback.speed), kbVel);
  }
  pInfo.knockback.dir = vec.normalized(kbVel);
  pInfo.knockback.speed = vec.magnitude(kbVel) * mult;
  pInfo.knockback.timeremaining = knockback_timeout;
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
/** ---------- HOOK FUNCTIONS ----------  */
// velocity of qVel projected onto motionDir, where qVelMax is the maximum possible qVel
//eg with player, velocity of player (pVel) projected onto motionDir
var projectedVelocityInDirection = (qVel, motionDir, minspeed, maxspeed, qVelMax = playerVel_max) => {
  motionDir = vec.normalized(motionDir);
  let playerVel_projectedOn_motionDir = vec.dot(qVel, motionDir);
  let motionSpeed = playerVel_projectedOn_motionDir;
  if (motionSpeed < 0) motionSpeed = 0;
  motionSpeed = minspeed + (motionSpeed / qVelMax) * (maxspeed - minspeed);
  return vec.normalized(motionDir, motionSpeed);
}

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
  h.nofriction_timeout = nofriction_timeout;
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
  let hookVel = projectedVelocityInDirection(p.vel, throwDir, playersInfo[pid_from].hooks.attached.size !== 0 ? hookspeed_min_hooked : hookspeed_min, hookspeed_max);
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


//updates velocity for when hook is in isResetting mode
// should call hook_reset_init before running this...
var hook_reset_velocity_update = (h) => {
  let reelDir = vec.sub(players[h.from].loc, h.loc);
  h.vel = vec.normalized(reelDir, hookspeed_reset);//projectedVelocityInDirection(players[h.from].vel, reelDir, hookspeed_reset, hookspeed_reset + playerVel_max);
}

// no need to call hook_detach before running this!!
var hookResetInit = (hid, setWaitTillExit) => {
  // if calling this, not gonna be deleting the hook so 2nd arg is false:
  hookDetach(hid, setWaitTillExit);
  let h = hooks[hid];
  h.isResetting = true;
  hook_reset_velocity_update(h);
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
var nofriction_timeout_decay = (h, dt) => {
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
  // console.log("players:", players);
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

const generateStartingLocation = () => {
  return { x: 20, y: 20 };
  // return { x: 10 + Math.random() * 1000, y: 10 + Math.random() * -1000 };
}

const generateRandomColor = () => {
  //get random from 
  return playerHookColorPalette[Math.floor(Math.random() * playerHookColorPalette.length)];
}

const createNewPlayerAndInfo = (username) => {
  let startLoc = generateStartingLocation();
  let [pCol, hCol, lineCol, bobberCol] = generateRandomColor();
  return [
    {// PLAYER:
      loc: startLoc,
      vel: { x: 0, y: 0 },
      username: username,
      color: pCol,
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
        defaultColors: [hCol, lineCol, bobberCol],
      },
      knockback: {
        speed: null,
        dir: null,
        timeremaining: null,
      }
    }
  ]
}


//if you want to understand the game, this is where to do it:
// fired when client connects
io.on('connection', (socket) => {
  console.log("player joining:", socket.id);

  //set what server does on different events
  socket.on('join', (username, callback) => {
    player_create(socket.id, username);
    callback(
      players,
      hooks,
      world,
      playerRadius,
      hookRadius_outer,
      hookRadius_inner,
      mapRadius,
    );
  });


  socket.on('disconnect', (reason) => {
    console.log("player disconnecting:", socket.id, reason);
    player_delete(socket.id);
  });


  socket.on('goindirection', (dir) => {// dir is up, down, left, or right
    let pInfo = playersInfo[socket.id];
    if (!pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.add(dir);
      walk_updateOnPress(pInfo, dir);
      boost_updateOnPress(pInfo, dir);
    }
  });


  socket.on('stopindirection', (dir) => {// dir is up, down, left, or right
    let pInfo = playersInfo[socket.id];
    if (pInfo.walk.keysPressed.has(dir)) {
      pInfo.walk.keysPressed.delete(dir);
      walk_updateOnRelease(pInfo, dir);
      boost_updateOnRelease(pInfo, dir);
    }
  });


  socket.on('leftclick', (hookDir) => {// hookDir is {x, y}
    // console.log('throwing hook');
    let pInfo = playersInfo[socket.id];
    if (pInfo.hooks.owned.size < maxHooksOut && !pInfo.hooks.throw_cooldown) {
      hookThrow(socket.id, hookDir);
    }
  });

  socket.on('rightclick', () => {
    // console.log('starting to reel')
    let pInfo = playersInfo[socket.id];
    if (!pInfo.hooks.reel_cooldown && pInfo.hooks.owned.size >= 1) {
      // console.log('reeling');
      hookReel(socket.id);
    }
  });


  socket.on('resethooks', () => {
    hook_resetAllOwned(socket.id, true);
  });



});

let a = 0;




// ---------- RUN GAME (socket calls do the updating, this just runs it) ----------
// 1. update positions based on previous info
// 2. update info 
const hooksTakenCareOf = new Set();
var prevtime = null;
const runGame = () => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  // console.log("dt:", dt);


  // update ALL hook locations if the hook isn't following a player
  for (let hid in hooks) {
    let h = hooks[hid];
    //if reeling a player, then decay the reel
    if (h.reelingPlayer)
      nofriction_timeout_decay(h, dt);
    else if (h.isResetting) //h.reelingPlayer will never be true when h.isResetting, since reelingPlayer requries h.to and resetting requires !h.to
      hook_reset_velocity_update(h);

    if (h.vel)
      h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
  }


  // update ALL player velocities and locations, confining them when necessary
  for (let pid in players) {
    let pInfo = playersInfo[pid];
    let p = players[pid];
    // cooldown
    reel_cooldown_decay(pInfo, dt);
    throw_cooldown_decay(pInfo, dt);
    // boost decay & kb decay & update velocity
    boost_velocity_decay(pInfo, dt);
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
    if (!vec.isContaining({ x: 0, y: 0 }, p.loc, mapRadius, playerRadius)) {
      p.loc = vec.normalized(p.loc, mapRadius - playerRadius);
      boostReset(pInfo);
      if (pInfo.hooks.followHook) {
        //if the player is following a hook, need to stop that reel if it's drilling the player into the wall
        let h = hooks[pInfo.hooks.followHook];
        if (vec.dot(h.loc, h.vel) > 0) //if velocity has towards-border velocity component, reset the reel
          hookStopReelingPlayer(h);
      }
      // knockbackReset(pInfo);
    }
  }


  // update all hooks following a player now that players have moved
  // also update all hook info based on player collisions
  for (let hid in hooks) {
    let h = hooks[hid];
    // --- DELETE HOOK IF TOO FAR --- 
    // if hook is too far, delete it
    if (!vec.isContaining(players[h.from].loc, h.loc, hookCutoffDistance, 0)) {
      hookDelete(hid);
      continue;
    }
    // --- UPDATE LOC OF HOOKS FOLLOWING A PLAYER --- 
    if (!h.vel) {
      let p = players[h.to]; //guaranteed to exist since !h.vel
      // if h.to doesn't contain hook anymore, project hook onto h.to
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let ptoh = vec.sub(h.loc, p.loc);
        h.loc = vec.add(p.loc, vec.normalized(ptoh, playerRadius));
      }
      // if following, then h.to, so don't care about collisions, already hooked
      continue;
    }
    // --- HANDLE COLLISIONS ---
    hooksTakenCareOf.clear(); //ensures two players dont try to delete the same hook
    for (let pid in players) { //pid = player to be hooked
      //player has exited hook, so remove it from waitTillExit
      if (!vec.isCollided(players[pid].loc, h.loc, playerRadius, 0)) {
        h.waitTillExit.delete(pid);
      }
      //do nothing if this hook already had something done to it due to a collision
      else if (hooksTakenCareOf.has(hid)) {
        continue;
      }
      // if colliding and not in waitTillExit
      else if (!h.waitTillExit.has(pid)) {
        //if player colliding with their own hook, delete
        if (h.from === pid && !h.to) {
          playersInfo[pid].hooks.throw_cooldown = null;
          hookDelete(hid);
          hooksTakenCareOf.add(hid);
        }
        //if hook has no to, then treat as if it's about to hook someone
        else if (!h.to) {
          // if the hook's owner is already hooking this player, it shouldnt have 2 hooks on the same player
          if (getHookedBy(pid).has(h.from)) {
            //reset old attached hook, and attach the new hook 
            let oldhook = getHookFrom_To_(h.from, pid);

            hookResetInit(oldhook, true);
            hooksTakenCareOf.add(oldhook);

            hookAttach(hid, pid);
            hooksTakenCareOf.add(hid);
          }
          //if two players hook each other, delete both hooks and knock each other back
          else if (getAttachedTo(pid).has(h.from)) {
            let hook_to_hfrom = getHookFrom_To_(pid, h.from);

            hookDelete(hook_to_hfrom);
            hooksTakenCareOf.add(hook_to_hfrom);

            knockbackAdd(hid, pid);
            hookDelete(hid);
            hooksTakenCareOf.add(hid);
            // hookResetInit(hook_to_hfrom, true);
            // hookAttach(hid, pid);
            // hookResetInit(hid, true);
          }
          // otherwise, just attach the hook!
          else {
            hookAttach(hid, pid);
            hooksTakenCareOf.add(hid);
          }
        }
      }
      //if colliding with sender and resetting, delete hook (takes care of quickreel problem)
      else if (h.isResetting && h.from === pid) {
        hookDelete(hid);
        hooksTakenCareOf.add(hid);
      }
    } //end for (players)
  } //end for (hooks)


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

  io.volatile.json.emit('serverimage', players, hooks);
}
setInterval(runGame, WAIT_TIME);