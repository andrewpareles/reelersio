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

const playerRadius = 30; //pix
const walkspeed = 124 / 1000; // pix/ms
const walkspeed_hooked = 100 / 1000; // pix/ms
const hookRadius = 10; //circle radius

const boostMultEffective_max = 2.5;
const boostMult_max = 3;

const playerVel_max = (1 + boostMultEffective_max) * walkspeed;

const a0 = 1 / (160 * 16); // boost decay v^2 term
const b0 = 1 / (80 * 16); // boost decay constant term
const c0 = 1 / (37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// ^ Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started

const hookspeed_reset = 500 / 1000;

const hookspeed_max = playerVel_max + 50 / 1000;
const hookspeed_min = 300 / 1000;
const hookspeed_min_hooked = hookspeed_max;

const hookspeedreel_min = 200 / 1000; //230 / 1000;
const hookspeedreel_max = 350 / 1000; //280 / 1000;
const reel_cooldown = 1.2 * 1000;
const nofriction_timeout = .5 * 1000;

const maxHooksOut = 2; //per player
const hookCutoffDistance = 600;

// constant decay of reeling in player
const a0h = 1 / (160 * 16); // v^4 term
const b0h = 1 / (1000 * 16);
const c0h = 1 / (30 * 16); // c / (speedMult + d) term
const d0h = 1 / (.015 * 16);


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
// hooks follow players the same way players follwo hooks
// string turns green when ready to reel
// hook turns red if almost too far
// world is sent once at beginning, callback does not do anything with players or hooks
// hooks push you back

const WAIT_TIME = 8; // # ms to wait to broadcast players object


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

  - player hooking speed is slower
  - player hooked speed is much slower and there's an allowed region within distance of the followHook you can go
  - player hooked hookthrow speed is faster
  - warning if hook is approaching the hookReset distance, and hook slows down / changes color too
  - if hookCutoffDistance is exceeded, player hooking stays within that radius of the hook
  
  hooks[hid]: {
    from, // NEVER null
    to, // always the player the hook is latched onto (or null)
    loc, // NEVER null
    vel, // null iff !!to and not reeling anyone in, i.e. when just attached and following someone (when hook onto player and not the one reeling, lose velocity and track that player).
    isResetting, //while true, reel in fast and always towards h.from, and can't reel (unless collides with player, then set to false). never isResetting if someone is attached ie !!to.
    waitTillExit: new Set(), //the players that this hook will ignore (not latch onto/disappear) (when the hook exits a player, it should remove that player)
  }

  playersInfo[pid].hooks: {
    owned: // contains every hook the person owns (typically 1)
    attached: // contains every hook being attached to this player
    followHook: //contains the most recent h.from hid that reeled this h.to player
    nofriction_timeout: null, // not null ==> followHook not null (not vice versa). time left to follow followHook (starts from top whenever gets reeled, resets to null whenever followHook becomes detached), and then hook decays, and then hook follows player and player stops following hook
    reel_cooldown: null, //time left till can reel again (starts from top whenever reel, resets to null if all hooks come in)
    hookedBy: // pids this player is hooked by (redundant info, makes stuff faster but info is already contained in attached)
    attachedTo: // pids this player is hooking (redundant info, makes stuff faster but info is already contained in attached)
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

var velocity_decay = (pInfo, dt) => {
  //boost decay
  if (pInfo.boost.Dir) {
    pInfo.boost.Multiplier -= dt * (a0 * Math.pow(pInfo.boost.Multiplier, 2) + b0 + c0 / (pInfo.boost.Multiplier + d0));
    if (pInfo.boost.Multiplier <= 0) pInfo.boost.Multiplier = 0;
    else if (pInfo.boost.Multiplier > boostMult_max) pInfo.boost.Multiplier = boostMult_max;
  }
}

var velocity_update = (pInfo, p, followHook) => {
  const speed = followHook ? walkspeed_hooked : walkspeed;
  //calculate velocity
  if (!pInfo.boost.Dir) {
    p.vel = vec.normalized(pInfo.walk.directionPressed, speed);
  }
  else {
    let pBoostMultiplierEffective = pInfo.boost.Multiplier > boostMultEffective_max ? boostMultEffective_max : pInfo.boost.Multiplier;
    p.vel = vec.add(vec.normalized(pInfo.walk.directionPressed, speed),
      vec.normalized(pInfo.boost.Dir, pBoostMultiplierEffective * speed)); // walk vel + boost vel
  }
}


/** ---------- HOOK FUNCTIONS ----------  */
//velocity of player (pVel) projected onto motionDir
var projectedVelocityInDirection = (pVel, motionDir, minspeed, maxspeed) => {
  motionDir = vec.normalized(motionDir);
  let playerVel_projectedOn_motionDir = vec.dot(pVel, motionDir);
  let motionSpeed = playerVel_projectedOn_motionDir;
  if (motionSpeed < 0) motionSpeed = 0;
  motionSpeed = minspeed + (motionSpeed / playerVel_max) * (maxspeed - minspeed);
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

var hnum = 0;
var generateHID = () => {
  return 'h' + hnum++;
}


// returns [hook id, hook object]
var createNewHook = (pid_from, throwDir) => {
  let p = players[pid_from];
  let hookVel = projectedVelocityInDirection(p.vel, throwDir, playersInfo[pid_from].hooks.attached.size !== 0 ? hookspeed_min_hooked : hookspeed_min, hookspeed_max);
  let hook = {
    from: pid_from,
    to: null,
    loc: vec.add(p.loc, vec.normalized(throwDir, playerRadius)),
    vel: hookVel,
    isResetting: false,
    waitTillExit: new Set(),
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
    h.to = null;
    getAttached(to).delete(hid);
    if (playersInfo[to].hooks.followHook === hid) {
      playersInfo[to].hooks.followHook = null;
      playersInfo[to].hooks.nofriction_timeout = null;
    }
    getHookedBy(to).delete(from);
    // delete playersInfo of h.from:
    getAttachedTo(from).delete(to);
    if (setWaitTillExit) h.waitTillExit.add(to);
  }
  if (getOwned(h.from).size === 0)
    playersInfo[h.from].hooks.reel_cooldown = null;
}

var hookThrow = (pid_from, hookDir) => {
  let [hid, hook] = createNewHook(pid_from, hookDir);
  hooks[hid] = hook;
  hook.waitTillExit.add(pid_from);
  getOwned(pid_from).add(hid);
}

//attach hook hid to player pid_to
//update hooks[hid]'s to and player's attached
var hookAttach = (hid, pid_to) => {
  hooks[hid].to = pid_to;
  hooks[hid].vel = null;
  hooks[hid].isResetting = false;
  getAttached(pid_to).add(hid);
  getHookedBy(pid_to).add(hooks[hid].from);
  getAttachedTo(hooks[hid].from).add(pid_to);
}


//reels all hooks owned by pid
var hookReel = (pid) => {
  console.log('reeling');
  for (let hid of getOwned(pid)) {
    let h = hooks[hid];
    if (h.to) {
      let reelDir = vec.sub(players[h.from].loc, h.loc);
      let hookVel = projectedVelocityInDirection(players[h.from].vel, reelDir, hookspeedreel_min, hookspeedreel_max);
      playersInfo[h.to].hooks.followHook = hid;
      playersInfo[h.to].hooks.nofriction_timeout = nofriction_timeout;
      //for all other hooks attached to player, start following the player
      for (let hid2 of getAttached(h.to)) hooks[hid2].vel = null;
      h.vel = hookVel;
    }
    else {
      hookResetInit(hid, true);
    }
  }
  playersInfo[pid].hooks.reel_cooldown = reel_cooldown;
  console.log('hooks', hooks)
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
  h.vel = projectedVelocityInDirection(players[h.from].vel, reelDir, hookspeed_reset, hookspeed_reset + playerVel_max);
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


var nofriction_timeout_decay = (pInfo, dt) => {
  // decrease cooldown
  if (pInfo.hooks.nofriction_timeout) {
    pInfo.hooks.nofriction_timeout -= dt;
    if (pInfo.hooks.nofriction_timeout <= 0) {
      pInfo.hooks.nofriction_timeout = null;
    }
  }
  // decay hook now that cooldown is over
  else if (pInfo.hooks.followHook) {
    let h = hooks[pInfo.hooks.followHook];
    if (h.vel) { // dont need to check && h.to, since followHook ==> h.to
      let hSpeedMultiplier = vec.magnitude(h.vel) / hookspeed_max;
      hSpeedMultiplier -= dt * (a0h * Math.pow(hSpeedMultiplier, 2) + b0h + c0h / (hSpeedMultiplier + d0h));
      if (hSpeedMultiplier > 0)
        h.vel = vec.normalized(h.vel, hSpeedMultiplier * hookspeed_max);
      else {
        //player stops following hook and hook starts following player
        pInfo.hooks.followHook = null;
        h.vel = null;
      }
    }
  }
}

/** ---------- EVENT HELPERS ---------- */
var player_create = (pid, username) => {
  let [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username);
  if (players[pid]) console.error('player already exists when joining', pid)
  if (playersInfo[pid]) console.error('playersInfo already exists when joining', pid)
  players[pid] = newPlayer;
  playersInfo[pid] = newPlayerInfo;
  console.log("players:", players);
  console.log("hooks:", hooks);
}


var player_delete = (pid) => {
  console.log('DELETING', pid);
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
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

const createNewPlayerAndInfo = (username) => {
  return [
    {// PLAYER:
      loc: generateStartingLocation(),
      vel: { x: 0, y: 0 },
      username: username,
      color: generateRandomColor(),
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
        hookedBy: new Set(),
        attachedTo: new Set(),
      }
    }
  ]
}


//if you want to understand the game, this is where to do it:
// fired when client connects
io.on('connection', (socket) => {
  console.log("player joining");

  //set what server does on different events
  socket.on('join', (username, callback) => {
    player_create(socket.id, username);
    callback(
      players,
      hooks,
      world,
      playerRadius,
      hookRadius,
    );
  });


  socket.on('disconnect', (reason) => {
    console.log("player disconnecting");
    console.log('reason:', reason);
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
    if (pInfo.hooks.owned.size < maxHooksOut) {
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






// ---------- RUN GAME (socket calls do the updating, this just runs it) ----------
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

  for (let pid in players) {
    let pInfo = playersInfo[pid];
    let p = players[pid];
    // cooldown
    reel_cooldown_decay(pInfo, dt);
    nofriction_timeout_decay(pInfo, dt);
    // boost decay & update velocity
    velocity_decay(pInfo, dt);
    velocity_update(pInfo, p, pInfo.hooks.followHook);
    // update player location (even if hooked, lets player walk within hook bubble)
    p.loc = vec.add(p.loc, vec.scalar(p.vel, dt));
  }

  for (let hid in hooks) {
    let h = hooks[hid];
    // --- HANDLE COLLISIONS ---
    //if outside cutoff range, start resetting
    if (vec.magnitude(vec.sub(players[h.from].loc, h.loc)) > hookCutoffDistance) {
      hookResetInit(hid, true);
    } else {
      hooksTakenCareOf.clear(); //ensures two players dont try to delete the same hook
      for (let pid in players) { //pid = player to be hooked
        //player has exited hook, so remove it from waitTillExit
        if (!vec.isCollided(players[pid].loc, h.loc, playerRadius, hookRadius)) {
          h.waitTillExit.delete(pid);
        }
        //do nothing if this hook already had something done to it due to a collision
        else if (hooksTakenCareOf.has(hid)) {
        }
        // if colliding and not in waitTillExit
        else if (!h.waitTillExit.has(pid)) {
          //if player colliding with their own hook, delete
          if (h.from === pid && !h.to) {
            hookDelete(hid);
            hooksTakenCareOf.add(hid);
          }
          //if hook has no to, then treat as if it's about to hook someone
          else if (!h.to) {
            // if the hook's owner is already hooking this player, it shouldnt have 2 hooks on the same player
            if (getHookedBy(pid).has(h.from)) {
              // hookResetInit(hid, true);
              // hooksTakenCareOf.add(hid);
            }
            //if two players hook each other, delete both hooks
            else if (getAttachedTo(pid).has(h.from)) {
              let hook_to_hfrom = getHookFrom_To_(pid, h.from);

              // hookResetInit(hook_to_hfrom, true);
              hookDelete(hook_to_hfrom);
              hooksTakenCareOf.add(hook_to_hfrom);

              // hookAttach(hid, pid);
              // hookResetInit(hid, true);
              hookDelete(hid);
              hooksTakenCareOf.add(hid);
            }
            // otherwise, just attach the hook!
            else {
              hookAttach(hid, pid);
              hooksTakenCareOf.add(hid);
            }
          }
        }
        //if colliding with sender and resetting, delete hook
        else if (h.isResetting && h.from === pid) {
          hookDelete(hid);
          hooksTakenCareOf.add(hid);
        }
      } //end for (players)
    }// end if (cutoff range)

    // --- PROCESS RESULTS OF COLLISION ---
    //reset hook
    if (h.isResetting) {
      hook_reset_velocity_update(h);
    }
    // update hook location if it's not tracking someone
    if (h.vel)
      h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
  } //end for (hooks)


  for (let pid in players) {
    // update players confined to hook radius
    let pInfo = playersInfo[pid];
    if (pInfo.hooks.followHook) {
      let p = players[pid];
      let h = hooks[pInfo.hooks.followHook];
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let htop = vec.sub(p.loc, h.loc);
        boostReset(pInfo);
        p.loc = vec.add(h.loc, vec.normalized(htop, playerRadius));
      }
    }
  }

  for (let hid in hooks) {
    // update hooks confined to player
    let h = hooks[hid];
    if (!h.vel) {
      let p = players[h.to]; //guaranteed to exist since !h.vel
      if (!vec.isContaining(p.loc, h.loc, playerRadius, 0)) {
        let ptoh = vec.sub(h.loc, p.loc);
        h.loc = vec.add(p.loc, vec.normalized(ptoh, playerRadius));
      }
    }
  }


  for (let hlid in world.holes) {
    let hl = world.holes[hlid];
    for (let pid in players) {
      if (vec.isContaining(hl.loc, players[pid].loc, hl.radius, playerRadius)) {
        // DISCONNECT
        player_delete(pid);
        //CONNECT
        player_create(pid, 'respawned1');
      }
    }
  }

  io.volatile.json.emit('serverimage', players, hooks, world);
}
setInterval(runGame, WAIT_TIME);