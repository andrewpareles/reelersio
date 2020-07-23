const { vec } = require('../common/vector.js');
const { game } = require('../common/game.js');
var [players, playersInfo, hooks, world] = game.get();
const { consts } = require('../common/constants.js');
var {
  playerRadius,
} = consts;
const { consts: constsServer } = require('./constantsServer.js');
var {
  throw_cooldown,
  reel_cooldown,
  reel_nofriction_timeout,
  hookspeed_min,
  hookspeed_max,
  hookspeed_hooked,
  hookspeedreel_min,
  hookspeedreel_max,
} = constsServer;
const { hook: hookShared } = require('../common/hook.js');
var {
  getOwned,
  getAttached,
  getHookedBy,
  getAttachedTo,
  //metadata (helpers)
  hook_StopReelingPlayer,
  //called every dt
  hook_reset_velocity_update,
} = hookShared;
const { player: playerServer } = require('./playerServer.js')
var {
  //boost
  boostReset,
  //kb
  knockbackAdd,
} = playerServer;
const { player: playerShared } = require('../common/player.js')
var {
  //kb
  knockbackReset,
} = playerShared;






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
    : vec.parallelComponentSpecial(p.vel, throwDir, hookspeed_min, hookspeed_max);
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




/** 
 * ---------- Metafunctions (helpers to the below general functions) ---------- 
*/
// assumes h.vel NOT NULL (assume it gets set), and h.to
// pid starts reeling hook hid, which has a player attached (assumes h.to)
var hook_StartReelingPlayer = (pid_hookowner, hid, reelVel) => {
  let h = hooks[hid];
  playersInfo[h.to].hooks.followHook = hid;
  h.reelingPlayer = pid_hookowner;
  h.vel = reelVel;
  h.nofriction_timeout = reel_nofriction_timeout;
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


/** 
 * ---------- HOOK FUNCTIONS (for updating hooks' states) ---------- 
*/

var hookThrow = (pid_from, hookDir) => {
  let [hid, hook] = createNewHook(pid_from, hookDir);
  hooks[hid] = hook;
  hook.waitTillExit.add(pid_from);
  getOwned(pid_from).add(hid);
  //throw cooldown
  playersInfo[pid_from].hooks.throw_cooldown = throw_cooldown;
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
      hook_StopReelingPlayer(h);
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
        hook_StopReelingPlayer(hooks[hid2]);
      }
      let reelDir = vec.sub(players[h.from].loc, h.loc);
      let hookVel = vec.parallelComponentSpecial(players[h.from].vel, reelDir, hookspeedreel_min, hookspeedreel_max);
      hook_StartReelingPlayer(pid, hid, hookVel);
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

exports.hook = {
  //create
  createNewHook,

  //metadata (helpers)
  hook_StartReelingPlayer,
  hook_resetAllOwned,
  hook_resetAllAttached,
  hook_deleteAllOwned,

  //hook change state
  hookThrow,
  hookResetInit,
  hookDetach,
  hookAttach,
  hookReel,
  hookDelete,
}