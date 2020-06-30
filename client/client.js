//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3001';
const socket = io(ADDRESS);

//vector functions on {x: , y:}:
var vec = {
  // add vector a and b
  add: (a, b) => {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  // a*v, a is scalar, v is vector
  scalar: (v, a) => {
    return { x: a * v.x, y: a * v.y };
  },

  // the magnitude of the vector
  norm: (a) => {
    return Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
  },

  // neither vector is null, and they have same values
  equals: (a, b) => {
    return !!a && !!b && a.x == b.x && a.y == b.y;
  },

  // vector is not null, and doesnt contain all falsy values (including 0)
  nonzero: (a) => {
    return !!a && (!!a.x || !!a.y);
  },

  // if unnormalizable, return the 0 vector. 
  // Normalizes to a vector of size mag, or 1 if undefined
  normalized: (a, mag) => {
    if (!mag) {
      if (mag !== 0) mag = 1;
      else return { x: 0, y: 0 };
    }
    let norm = vec.norm(a);
    return norm == 0 ? { x: 0, y: 0 } : vec.scalar(a, mag / norm);
  },

  negative: (a) => {
    return { x: -a.x, y: -a.y };
  }
}


const playerid = socket.id;

//both these are initialized by server after player joins
var world = null;
var players = null;
//players includes yourself
// 1. send 'join' event to server, server gives you players
// 2. on player join, add that new player to players
// once initialized, 
//players = {
//  otherplayer.socket.id: {
//    loc: {x:0, y:0},
//    vel: {x:0, y:0}, //velocity. Note vel.y is UP, not down (unlike loc)
//    username: user1,
//    hooks:
//  }, 
//  playerid: ...,
//}




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


var sent = {
  loc: null,

}

var send = {
  // sent when you join the game (join):
  join: async () => {
    const callback = (playerobj, serverWorld, serverPlayers) => {
      localPlayer = playerobj;
      players = serverPlayers;
      world = serverWorld;
    };
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', username, new_callback);
    await new_promise;
  },
  // sent to update your location to the server (loc):
  loc: () => { // sends  loc: {x:, y:},
    // const buf2 = Buffer.from('bytes');
    socket.emit('loc', loc);
  },
}




var keyBindings = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd'
}

var keyDirections = {
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}

// contains 'w', 'a', 's', or 'd' (movement keys, not something like 'p' unless keybindings are changed)
var keysPressed = new Set();

//returns true iff key 1 is parallel and in the opposite direction to key 2 
var keyDirection_isOpposite = (key1, key2) => {
  let [d1, d2] = [keyDirections[key1], keyDirections[key2]];
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

// if k is null, there is no orthogonal key to a and b being pressed, or there are 2
// if k is not, it's the single key pressed that's orthogonal to key k
var keysPressed_singleOrthogonalTo = (k) => {
  let ret = null;
  switch (keyDirections[k]) {
    case "left":
    case "right":
      if (keysPressed.has(keyBindings["up"])) ret = keyBindings["up"];
      if (keysPressed.has(keyBindings["down"])) {
        if (ret) ret = null;
        else {
          ret = keyBindings["down"];
        }
      }
      break;
    case "up":
    case "down":
      if (keysPressed.has(keyBindings["left"])) ret = keyBindings["left"];
      if (keysPressed.has(keyBindings["right"])) {
        if (ret) ret = null;
        else {
          ret = keyBindings["right"];
        }
      }
      break;
  }
  return ret;
}

// assumes these are normalized
var keyVectors = {
  'w': { x: 0, y: 1 },
  's': { x: 0, y: -1 }, //must = -up
  'a': { x: -1, y: 0 }, //must = -right
  'd': { x: 1, y: 0 }
}



var playerRadius = 10
var walkspeed = 124 / 1000 // pix/ms
var directionPressed = { x: 0, y: 0 } //NON-NORMALIZED

let velocity_update = () => {
  vel = vec.add(vec.normalized(directionPressed, walkspeed), vec.normalized(boostDir, walkspeed * boostMultiplier));
}

// --- BOOSTING ---
// Record the previous 2 keys pressed
var recentKeys = []; //[2nd, 1st most recent key pressed]
var recentKeys_insert = (key) => {
  recentKeys[0] = recentKeys[1];
  recentKeys[1] = key;
}

var boostMultiplier = 0, // fraction of walkspeed to add to velocity
  boostDir = null, // direction of the boost **this is null iff there is no boost**
  boostKey = null; // key that needs to be held down for current boost to be active, i.e. key not part of the cycle (if any)

var boostReset = () => {
  boostMultiplier = 0;
  boostDir = null;
  boostKey = null;
}
// creates a boost in direction of key k, with boostMultipler increased by inc
var boostAdd = (k, inc) => {
  boostDir = keyVectors[k];
  boostKey = k;
  boostMultiplier += inc || 0;
}

// Can assume that the 2nd value of recentKeys is not null, since 
// which is true since this is called after a WASD key is pressed
// updates boostDir and boostKey
var boost_updateOnPress = () => {
  let a = recentKeys[0];
  let b = recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  let c = null; // c is the key of the BOOST DIRECTION!!! (or null if no boost)
  let inc = null; // inc is the boostMultiplier increase if a boost is given

  // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
  if (keyDirection_isOpposite(a, b)) {
    c = keysPressed_singleOrthogonalTo(b);
    inc = .5;
  }
  // (2) continue boost into new direction
  // one key in new dir, key you just pressed is opposite of current boost dir
  else if (boostDir) {
    if (keyDirection_isOpposite(b, boostKey)) {
      c = keysPressed_singleOrthogonalTo(b);
    }
  }




  // if we have a boost direction, go!
  if (c) {
    // console.log("boost " + (inc ? "continue" : "start"), keyDirections[c]);
    // console.log("key:", c);
    boostAdd(c, inc);
  }
  //else, reset boost
  else {
    boostReset();
  }
}

var boost_updateOnRelease = (keyReleased) => {
  if (boostKey) { // W and A/D boost
    if (keysPressed.size === 0
      || (keyReleased === boostKey && keysPressed.size !== 1)) { //reset boost

      boostReset();
    }
  }
}






var drawPlayer = (color, loc, username) => {
  c.beginPath();
  c.strokeStyle = color;
  c.arc(loc.x, loc.y, playerRadius, 0, 2 * Math.PI);
  c.stroke();

  // c.font = "10px Verdana";
  // c.textAlign = "center";
  // c.textBaseline = "top";
  // c.fillStyle = color;
  // c.fillText(username, loc.x, loc.y + playerRadius + 5);

}

var canvas = document.getElementById("canvas");
var c = canvas.getContext("2d");

var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;

canvas.width = WIDTH;
canvas.height = HEIGHT;

var prevtime;
var starttime;
var currtime;

let runGame = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  currtime = timestamp - starttime;
  prevtime = timestamp;
  // console.log("currtime", currtime)

  // calculate fps
  let fps = Math.round(1000 / dt);
  // console.log("fps: ", fps);


  // update velocity from key presses
  velocity_update(currtime);

  // update location
  loc.x += vel.x * dt;
  loc.y += -vel.y * dt;
  // console.log("loc: ", loc);

  //render
  c.clearRect(0, 0, WIDTH, HEIGHT);

  // draw me
  drawPlayer("black", loc, username);

  //draw others
  for (let p in players) {
    drawPlayer("#FF0000", players[p].loc, players[p].username);
  }

  // if update position, send info to server
  if (!vec.equals(sent.loc, loc)) {
    console.log("sending loc");
    send.loc();
    sent.loc = { ...loc };
  }
  // console.log("world, players", world, players);

  window.requestAnimationFrame(runGame);
}





document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      if (!keysPressed.has(key)) {
        directionPressed.y += 1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["down"]:
      if (!keysPressed.has(key)) {
        directionPressed.y += -1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["left"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += -1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["right"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += 1;
        keysPressed.add(key);
        movementDirChanged = true;
      }
      break;
  }

  if (movementDirChanged) { //ie WASD was pressed, not some other key
    recentKeys_insert(key);
    boost_updateOnPress();
  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      if (keysPressed.has(key)) {
        directionPressed.y -= 1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["down"]:
      if (keysPressed.has(key)) {
        directionPressed.y -= -1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["left"]:
      if (keysPressed.has(key)) {
        directionPressed.x -= -1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
    case keyBindings["right"]:
      if (keysPressed.has(key)) {
        directionPressed.x -= 1;
        keysPressed.delete(key);
        movementDirChanged = true;
      }
      break;
  }


  if (movementDirChanged) {
    boost_updateOnRelease(key);
  }
});







/**
Socket events sent:
  join (username):
  - server: calls callback, emits newplayer to all others, emits 'initplayer' to player
  - note that client must wait for callback since it initializes world, players, and localPlayer 
  loc (loc):
  - server: updates player's loc, emits loc to all others

Socket events received:
  connect(whenConnect):
  - client: sends join to server, and waits for callback to be run
  playerjoin(playerid, username, loc):
  - client: adds player to players
  playermove(playerid, loc):
  - client: sets playerid's loc to loc
  playerdisconnect(playersocketid):
  - client: removes playersocketid from players
*/



const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  await send.join();
  console.log("localPlayer", localPlayer);
  console.log("players", players);
  console.log("world", world);
  // once get here, know that world, players, and loc are defined  
  // 2. start game
  window.requestAnimationFrame(runGame);
}
socket.on('connect', whenConnect);



const playerJoin = (playerid, playerobj) => {
  console.log("player joining", playerid, playerobj);
  players[playerid] = playerobj;
  console.log("players", players);
}
socket.on('playerjoin', playerJoin);



const playerMove = (playerid, newLoc) => {
  // console.log("player moved", playerid, newLoc);
  players[playerid].loc = newLoc;
}
socket.on('playermove', playerMove);



const playerDisconnect = (playerid) => {
  console.log("player left", playerid);
  delete players[playerid];
  console.log("players", players);
}
socket.on('playerdisconnect', playerDisconnect);



socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
