const { vec } = require('../common/vector.js');
const { consts: constsShared } = require('../common/constants.js');
var {
  mapRadius,
  playerRadius,
  hookRadius_outer,
  aimingspeed_hooked,
  hookCutoffDistance,
} = constsShared;


var players;
var playersInfo;
var hooks;
var hooksInfo;
var world;
var isClient;

const set = (ps, pIs, hs, w, client) => {
  [players, playersInfo, hooks, world] = [ps, pIs, hs, w];
  isClient = client;
}

const get = () => {
  return [players, playersInfo, hooks, world];
}


const generateRandomMapLoc = () => {
  let r = Math.sqrt(Math.random()) * mapRadius; //see CDF math in notebook
  let theta = Math.random() * 2 * Math.PI;
  let pos = { x: r * Math.cos(theta), y: -r * Math.sin(theta) };
  return pos;
}

// Update locations, then update states
// 1. update hooks with velocity (i.e update hooks not following a player), and confine them to world border 
// 2. update all player locations, and confine them to the hooks they're following (and confine to world border too)
// 3. update hooks based on confinement to player, distance to player, and aiming.
// 4. update hooks based on collisions (only for hooks with !h.to)
// 5. hole collisions
// ONLY DO 1-3 IF USER (and don't reset hook if too far)
const update = (dt) => {
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
          hook_StopReelingPlayer(h);
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
    if (!isClient && !vec.isContaining(players[h.from].loc, h.loc, hookCutoffDistance, 0)) {
      hookResetInit(hid, false);
    }
  }

  if (isClient) return;

  //4. collisions
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
        // player_delete(pid);
        //CONNECT
        // player_create(pid, 'respawned1');
      }
    }
  }
}

exports.game = {
  set,
  get,
  update,
  generateRandomMapLoc,

}
