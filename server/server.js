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
const { game } = require('../common/game.js');

const { consts: constsShared } = require('../common/constants.js');
var {
  mapRadius,
  playerRadius,
  hookRadius_outer,
  hookRadius_inner,
  chat_maxMessageLen,
  maxHooksOut,
} = constsShared;


const { player: playerShared } = require('../common/player.js');
var {
  //aiming
  aimingStart,
  aimingStop,
  //chat
  chatAddMessage,
} = playerShared;

const { player: playerServer } = require('./playerServer.js');
var {
  player_create,
  player_delete,
  //boost
  boost_updateOnPress,
  boost_updateOnRelease,
  //walk
  walk_updateOnPress,
  walk_updateOnRelease,
} = playerServer;


const GAME_UPDATE_TIME = 0; // formerly WAIT_TIME # ms to wait to re-render & broadcast players object
const GAME_SEND_TIME = 100;

const createDummy = false;
const numHoles = 100;





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
const playerColorPalette = generateColorPalette();

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

// PLAYER INFO TO BE BROADCAST (GLOBAL)
var players = {
  /*
    "initialPlayer (socket.id)": {
      loc:...,
      vel: { x: 0, y: 0 },

      username: "billybob",
      color: "orange",
      messages:[m0, m1, ...]
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
      },
      
      chat: {
        timeouts: [t0, t1, ...], //list of time before message disappears, corresponding to each msg
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
    let hlLoc = game.generateRandomMapLoc();
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

game.set([players, playersInfo, hooks, world]);




/** ---------- SOCKET CALLS & FUNCTIONS ---------- */

const getRandomPlayerColors = () => {
  return playerColorPalette[Math.floor(Math.random() * playerColorPalette.length)];
}



//if you want to understand the game, this is where to do it:
// fired when client connects
io.on('connection', (socket) => {
  console.log("player joining:", socket.id);

  //set what server does on different events
  socket.on('join', (username, callback) => {
    player_create(socket.id, username, getRandomPlayerColors(), createDummy);
    callback(
      players,
      playersInfo,
      hooks,
      world,
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
    if (!pInfo.hooks.throw_cooldown) {
      //throw a new hook
      if (pInfo.hooks.owned.size < maxHooksOut)
        hookThrow(socket.id, hookDir);
    }
  });

  socket.on('rightclick', () => {
    // console.log('starting to reel')
    let pInfo = playersInfo[socket.id];
    if (pInfo.hooks.owned.size >= 1) {
      // console.log('reeling');
      if (!pInfo.hooks.reel_cooldown)
        hookReel(socket.id);
    }
  });


  socket.on('resethooks', () => {
    hook_deleteAllOwned(socket.id);
  });

  socket.on('startaiming', () => {
    aimingStart(socket.id);
  });

  socket.on('stopaiming', () => {
    aimingStop(socket.id);
  });

  socket.on('chatmessage', (msg) => {
    chatAddMessage(socket.id, msg);
  });



});


// ---------- RUN GAME (socket calls do the updating metadata, this just updates locations, etc) ----------
var prevtime = null;
const runGame = () => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  // console.log("dt:", dt);

  game.update();

}

game.set(players, playersInfo, hooks, world, false);

setInterval(() => {
  runGame();
}, GAME_UPDATE_TIME);

setInterval(() => {
  io.volatile.json.emit('serverimage', players, playersInfo, hooks);
}, GAME_SEND_TIME);