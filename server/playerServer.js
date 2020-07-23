const { vec } = require('../common/vector.js');
const { game } = require('../common/game.js');
const { consts: constsShared } = require('../common/constants.js');
var {
  chat_maxMessages,
  chat_maxMessageLen,
} = constsShared;
const { consts: constsServer } = require('./constantsServer.js');
var {
  chat_message_timeout,
  keyVectors,
  knockback_nofriction_timeout,
  knockbackspeed_min,
  knockbackspeed_max,
  percentPoolBallEffect,
} = constsServer;
const { hook: hookServer } = require('./hookServer.js');
var {
  //metadata (helpers)
  hook_resetAllAttached,
  hook_deleteAllOwned,
} = hookServer;
// uses no hook shared (duh)
// uses no player shared



const createNewPlayerAndInfo = (username, colors, pOptions = {}) => {
  let startLoc = { x: -500, y: 500 };
  let [pCol, hCol, lineCol, bobberCol] = colors;
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

/** ---------- CREATE / DELETE (takes care of metadata) ---------- */
var player_create = (pid, username, colors, createDummy) => {
  let [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username, colors);
  if (players[pid]) console.error('player already exists when joining', pid)
  if (playersInfo[pid]) console.error('playersInfo already exists when joining', pid)
  players[pid] = newPlayer;
  playersInfo[pid] = newPlayerInfo;

  if (createDummy) {
    [newPlayer, newPlayerInfo] = createNewPlayerAndInfo(username, colors, { loc: newPlayer.loc });
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

/** ---------- KEY PRESS, BOOST, & WALK FUNCTIONS ---------- */

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


/** ---------- KNOCKBACK FUNCTIONS ---------- */
// pid of player being kb'd, hid of hook knocking back player
var knockbackAdd = (hid, pid) => {
  let kbVel;
  let kbFromHookVel = vec.parallelComponentSpecial(hooks[hid].vel, hooks[hid].vel, knockbackspeed_min, knockbackspeed_max);
  //if hook is headed towards player (ie NOT FAR INSIDE PLAYER), incorporate pool ball effect:
  let hookToKbPlayer = vec.sub(players[pid].loc, hooks[hid].loc);
  if (vec.dot(hookToKbPlayer, hooks[hid].vel) > 0) { //ignores case where hookToKbPlayer = {0,0}
    let kbFromPoolEffect = vec.parallelComponentSpecial(hooks[hid].vel, hookToKbPlayer, knockbackspeed_min, knockbackspeed_max);
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

exports.player = {
  //create/delete
  createNewPlayerAndInfo,
  player_create,
  player_delete,

  //boost
  boost_updateOnPress,
  boost_updateOnRelease,

  //walk
  walk_updateOnPress,
  walk_updateOnRelease,

  //kb
  knockbackAdd,

  //chat
  chatAddMessage,
}