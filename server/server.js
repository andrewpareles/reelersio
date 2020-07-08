//https://socket.io/docs/server-api/
const server = require('http').Server();
const io = require('socket.io')(server);
const { vec } = require('../common/vector.js');

const playerRadius = 20; //pix
const walkspeed = 124 / 1000; // pix/ms
const walkspeed_hooked = 24 / 1000; // pix/ms
const hookRadius = 10; //circle radius

const hookspeed = 200 / 1000;
const hookspeed_reset = 500 / 1000;
const hookspeedreel_player = 80 / 1000;
const hookspeedreel_noplayer = 300 / 1000;
const reel_cooldown = 1 * 1000;
const followHook_radius = 10;


const a0 = 1 / (160 * 16); // boost decay v^2 term
const b0 = 1 / (80 * 16); // boost decay constant term
const c0 = 1 / (37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started


//TODO: SEND ONLY WHAT YOU NEED (loc, not vel or anything else)
//TODO: MAKE SURE HOOK INVARIANTS ARE ALWAYS HELD, DETERMINE WHAT THEY ARE, SIMPLIFY, WAIT TILL HOOK LEAVES PLAYER TO DO ANYTHING
const boostMultEffective_max = 2.5;
const boostMult_max = 3;
const hookCutoffDistance = 500;

const WAIT_TIME = 16; // # ms to wait to broadcast players object



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
        owned: new Set(), //hook ids originating from this player
        attached: new Set(), //list of hook ids attached to this player (NOT necessarily owned by this player)
        followHook: hid, //most recent attached hook to follow
      }
    },
  */
}


var hooks = {
  /* 
  hid: {
    from, 
    to, 
    loc,
    vel,
    isResetting,
  }
  */
}


/*
Hook invariants:
  - if you're hooked by someone and you hit them with your hook, both hooks disappear 
  - player hooking speed is slower
  - player hooked speed is much slower and there's an allowed region within distance of the followHook you can go
  - player hooked hookthrow speed is faster
  - warning if hook is approaching the hookReset distance, and hook slows down / changes color too
  - when you reel, all hooks get reeled in and the reel cooldown starts
  - when you throw hook, your velocity adds only if it boost it (not if it slows it)
  - if attached, can't be resetting
  
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
    reel_cooldown: null, //time left till can reel again (resets if all hooks come in)
  }

  player loc = !followHook? player.loc: hook.loc bounded by radius, after updating hook.locs
  hook loc = !vel? to.loc : hook.loc

 */

var world = {};




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
      boostSet(pInfo, c, 1);
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
  const speed = followHook ? walkspeed : walkspeed_hooked;
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
var getOwned = (pid_from) => {
  return playersInfo[pid_from].hooks.attached;
}
var getAttached = (pid_to) => {
  return playersInfo[pid_to].hooks.attached;
}

var generateHID = () => {
  let hid;
  do {
    hid = Math.random().toString(36).substring(2);
  } while (hooks[hid]);
  return hid;
}

// returns [hook id, hook object]
var createNewHook = (pid_from, hookDir) => {
  let p = players[pid_from];
  hookDir = vec.normalized(hookDir);
  let playerVel_projectedOn_hookDir = vec.dot(p.vel, hookDir);
  let hook = {
    from: pid_from,
    to: null,
    loc: vec.add(p.loc, vec.normalized(hookDir, playerRadius + hookRadius)),
    vel: vec.normalized(hookDir, hookspeed + playerVel_projectedOn_hookDir),
    isResetting: false,
    cooldown: 0,
  };
  let hid = generateHID();
  return [hid, hook];
}


var hook_throw = (pid_from, hookDir) => {
  let [hid, hook] = createNewHook(pid_from, hookDir);
  hooks[hid] = hook;
  getOwned(pid_from).add(hid);
}


var hook_attach = (pid_to, hid) => {
  //update hooks[hid]'s to and player's attached
  hooks[hid].to = pid_to;
  hooks[hid].vel = null;
  hooks[hid].isResetting = false;
  getAttached(pid_to).add(hid);
}


var hook_reel = (pInfo) => {
  for (let hid of pInfo.hooks.owned) {
    let h = hooks[hid];
    let reelDir = vec.normalized(vec.sub(players[h.from].loc, h.loc));
    let playerVel_projectedOn_reelDir = vec.dot(players[h.from].vel, reelDir);
    if (playerVel_projectedOn_reelDir < 0) playerVel_projectedOn_reelDir = 0;

    let hookVel;
    if (h.to) {
      hookVel = vec.normalized(reelDir, hookspeedreel_player + playerVel_projectedOn_reelDir);
      playersInfo[h.to].hooks.followHook = hid;
    }
    else {
      hookVel = vec.normalized(reelDir, hookspeedreel_noplayer + playerVel_projectedOn_reelDir);
    }
    h.vel = hookVel;
  }
  pInfo.hooks.reel_cooldown = reel_cooldown;
}

var hook_detach_playersInfo = (hid) => {
  let h = hooks[hid];
  if (h.to) {
    getAttached(h.to).delete(hid);
    if (playersInfo[h.to].hooks.followHook === hid) {
      playersInfo[h.to].hooks.followHook = null;
    }
  }
}
//detach hid from everyone it's hooking
var hook_detach = (hid, setWaitTillExit) => {
  let h = hooks[hid];
  hook_detach_playersInfo(hid);
  if (h.to) {  //to = null, and waitTillExit
    if (setWaitTillExit) h.waitTillExit.add(h.to);
    h.to = null;
  }
}

//updates velocity for when hook is in isResetting mode
// it's a good idea to call hook_detach before running this...
var hook_reset_velocity_update = (h) => {
  h.vel = vec.normalized(vec.sub(players[h.from].loc, h.loc), hookspeed_reset);
}

//delete hook from hooks, from.owned, and to.attached, and followHook
//note: don't need to call detach, it happens here (and more efficiently)
var hook_delete = (hid) => {
  let h = hooks[hid];
  //delete from owned, attached, followHook, and hooks
  getOwned(h.from).delete(hid); //from (owned)
  //to (attached) & followHook (this could be replaced with hook_detach, but detach has a little more we don't need)
  hook_detach_playersInfo(hid);
  delete hooks[hid]; //hooks
  console.log('hooks after delete', hooks);
}


var cooldown_decay = (pInfo, dt) => {
  if (pInfo.reel_cooldown) {
    pInfo.reel_cooldown -= dt;
    if (pInfo.reel_cooldown <= 0)
      pInfo.reel_cooldown = null;
  }
}


/** ---------- SOCKET CALLS & FUNCTIONS ---------- */

const generateStartingLocation = () => {
  return { x: 10 + Math.random() * 20, y: 10 + Math.random() * -100 };
}

const generateRandomColor = () => {
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

const createNewPlayerAndInfo = (username) => {
  return [
    {// PLAYER:
      loc: generateStartingLocation(),
      vel: { x: 0, y: 0 },
      followHook: null,
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
      }
    }
  ]
}


//if you want to understand the game, this is where to do it:
// fired when client connects
io.on('connection', (socket) => {

  //set what server does on different events
  socket.on('join', (username, callback) => {
    let [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username);
    players[socket.id] = newPlayer;
    playersInfo[socket.id] = newPlayerInfo;
    callback(
      players,
      hooks,
      world,
      playerRadius,
      hookRadius,
    );
    console.log("players:", players);
    console.log("hooks:", hooks);
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


  socket.on('throwhook', (hookDir) => {// hookDir is {x, y}
    console.log('throwing hook');
    console.log('hooks', hooks);
    let pInfo = playersInfo[socket.id];
    if (pInfo.hooks.owned.size < 1) {
      hook_throw(socket.id, hookDir);
    }
  });

  socket.on('reelhooks', () => {
    let pInfo = playersInfo[socket.id];
    if (!pInfo.hooks.reel_cooldown && pInfo.hooks.owned.size >= 1) {
      hook_reel(pInfo);
    }
  });


  socket.on('disconnect', (reason) => {
    // delete all hooks that were from player
    for (let hid of getOwned(socket.id)) {
      hook_delete(hid);
    }
    // detach & pull in all hooks that are attached to player
    for (let hid of getAttached(socket.id)) {
      hook_detach(hid, true);
      hooks[hid].isResetting = true;
    }
    delete players[socket.id];
    socket.broadcast.emit('playerdisconnect', socket.id);
  });
});




server.listen(3001, function () {
  console.log('listening on *:3001');
});



// ---------- RUN GAME (socket calls do the updating, this just runs it) ----------

var prevtime = null;
const runGame = () => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  // console.log("dt:", dt);

  /*
  player loc = !followHook? player.loc: hook.loc bounded by radius, after updating hook.locs
  hook loc = !vel? to.loc : hook.loc
  */
  let followHookPlayers = new Set();

  for (let pid in players) {
    let pInfo = playersInfo[pid];
    let p = players[pid];
    // cooldown
    cooldown_decay(pInfo, dt);
    // boost decay & update velocity
    velocity_decay(pInfo, dt);
    velocity_update(pInfo, p, pInfo.followHook);
    // update player location
    if (!pInfo.followHook) {
      p.loc = vec.add(p.loc, vec.scalar(p.vel, dt));
    } else {
      followHookPlayers.add(pid);
    }
  }


  for (let hid in hooks) {
    let h = hooks[hid];
    if (!h.vel) { //if the hook is following someone
      h.loc = players[h.to].loc;
    }
    //if too far, start resetting
    else if (vec.magnitude(vec.sub(players[h.from].loc, h.loc)) > hookCutoffDistance) {
      hook_detach(hid, true);
      hooks[hid].isResetting = true;
    }
    else {
      //check for collisions
      for (let pid in players) {
        let p = players[pid];
        if (vec.isCollided(p.loc, h.loc, playerRadius, hookRadius)) {
          if (!h.waitTillExit.has(pid)) {
            if (pid === h.from) { //if the hook collided with its sender, delete it
              hook_delete(hid);
            } else if (!h.to) { //attach it
              hook_attach(pid, hid);
            }
          }
        } else { //player just exited hook, so remove it from waitTillExit
          h.waitTillExit.delete(pid);
        }
      }
    }

    //if too far, reset hook
    if (h.isResetting) {
      hook_reset_velocity_update(h);
    }

    // update hook location
    h.loc = h.vel ? vec.add(h.loc, vec.scalar(h.vel, dt)) : players[h.to].loc;
  }




  io.emit('serverimage', players, hooks, world);
}
setInterval(runGame, WAIT_TIME);
