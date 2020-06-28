//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
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
    return !!a && (!!a.x || !!a.y)
  },

  // if unnormalizable, return the 0 vector. 
  // Normalizes to a vector of size mag, or 1 if undefined
  normalized: (a, mag) => {
    if (!mag) {
      if (mag !== 0) mag = 1;
      else if (mag === 0) return { x: 0, y: 0 };
    }
    let norm = vec.norm(a);
    return norm == 0 ? { x: 0, y: 0 } : vec.scalar(a, mag / norm);
  },

  negative: (a) => {
    return { x: -a.x, y: -a.y };
  }
}




//not including yourself
var users = {
  // socket.id0: {
  //   location: {x:0, y:0, z:0},
  //   username: user1
  // }
};
var world = {

};

//player info
var username = "user1";

var keyBindings = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd'
}

var keyDirections = {
  'w': { x: 0, y: 1 },
  's': { x: 0, y: -1 }, //must = -up
  'a': { x: -1, y: 0 }, //must = -right
  'd': { x: 1, y: 0 }
}

// contains 'w', 'a', 's', or 'd'
var keysPressed = new Set();


// player info related to game mechanics
var loc = { x: 0, y: 0 }; //location
var vel = { x: 0, y: 0 }; //velocity. Note vel.y is UP, not down (unlike loc)

var playerRadius = 10

var walkspeed = 124 / 1000 // pix/ms

var directionPressed = { x: 0, y: 0 } //NON-NORMALIZED

let velocity_update = () => {
  vel = vec.normalized(directionPressed, walkspeed * (1 + boostMultiplier));
}
/** Boost mechanics:
 * Record the previous 3 keys pressed
 * - Condition for boost: recentKeys = [K1 K2 K1] (Ki = key i)
 * */
var recentKeys = []; //[3rd, 2nd, 1st most recent key pressed]
var hasBoost = false;
var recentKeys_insert = (key) => {
  recentKeys[0] = recentKeys[1];
  recentKeys[1] = recentKeys[2];
  recentKeys[2] = key;
}
var recentKeys_hasCycle = () => {
  // returns true iff cycle of size 2 in recentKeys
  return recentKeys[0] === recentKeys[2] //don't need to check null, this takes care of this since recentkeys[2] not null
    && recentKeys[0] !== recentKeys[1]; //cycle size = 2 (don't need to check null, recentKeys[0] not null means recentKeys[1] not null)
}

var boostStreak = 0; // number of times user got a boost in a row (LR=0, LRL=1, ...)
var boostMultiplier = 0; // fraction of walkspeed to add to velocity
var boostDir = null; // direction of the boost
var boostKeyReq = null; // key that needs to be held down for current boost to be active, i.e. key not part of the cycle (if any)

var boost = {
  hasContinuedBoost: () => {
    return recentKeys_hasCycle()
      && (!boostKeyReq || keysPressed.has(boostKeyReq)); //the required boost key is pressed (if it existed)
  },
  //returns true if successfully initialized, false if didn't. (if false, doesn't change state)
  // sets boostDir and boostKeyReq
  tryToInit: () => {
    if (!recentKeys_hasCycle()) return false;
    //if 2 keys pressed are outside the cycle, return false
    let k = null, count = 0;
    for (let key of keysPressed) {
      if (key !== recentKeys[0] && key !== recentKeys[1]) { //if a key is not in the cycle
        k = key;
        count++;
        if (count === 2) return false;
      }
    }
    // think W with A and D tapping (alternating), or alternating W and D.
    // bad: A D A without k, or SD with A
    

    boostKeyReq = k;
  },
  inc: () => {
    boostMultiplier += 1 / 2;
    boostStreak++;
  },
  end: () => {
    console.log("ending")
    boostStreak = 0;
    boostMultiplier = 0;
    boostKeyReq = null;

    hasBoost = false;
  },
  clear: () => {
    console.log("clearing")
    boostStreak = 0;
    boostMultiplier = 0;
    boostKeyReq = null;

    recentKeys = [];
    hasBoost = false;
  },
}

// Assuming that the 3rd value of recentKeys and recentDirs is not null, since 
// which is true since this is called after a WASD key is pressed
var boost_updateOnPress = () => {
  // console.log("reckeys", recentKeys)

  if (hasBoost) { //continuing boost
    hasBoost = boost.hasContinuedBoost();
    if (hasBoost) {
      boost.inc();
    } else {
      boost.clear();
    }
  } else { //no boost
    hasBoost = boost.tryToInit();
    if (hasBoost) {
      boost.inc();
    } //note: no need to clear/end boost, since don't have it...
  }
}



var boost_updateOnRelease = (keyReleased) => {
  // if you released a required boost key, end the boost
  if (hasBoost) {
    if (!!boostKeyReq && boostKeyReq === keyReleased)
      boost.clear();
  }
}




// run game:
const sendDefault = () => { // sends  loc: {x:, y:},
  const msg = { loc: loc };
  // const buf2 = Buffer.from('bytes');
  socket.emit('message', loc, /*moreInfo, ... */
  );

}





// returns a new function to execute and a promise that resolves when the new function executes
// returns [new_fn, promise]
const waitForExecutionPair = (callback) => {
  let r;
  const promise = new Promise((res, rej) => { r = res; });
  let new_fn = (...args) => {
    callback(...args);
    r();
  }
  return [new_fn, promise];
}

const clientRunGame = async () => {
  // 1. tell server I'm a new player
  const callback = (serverWorld, serverUsers) => {
    world = serverWorld;
    users = serverUsers;
  };
  const [new_callback, newplayer_ack] = waitForExecutionPair(callback);
  socket.emit('newplayer', username, new_callback);

  await newplayer_ack;
  // once get here, know the callback was run  

  // 2. start game
  window.requestAnimationFrame(drawAndSend);
}





var canvas = document.getElementById("canvas");
var c = canvas.getContext("2d");

var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;

canvas.width = WIDTH;
canvas.height = HEIGHT;

var prevtime;
var starttime;

let drawAndSend = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  let currtime = timestamp - starttime;
  prevtime = timestamp;

  // calculate fps
  let fps = Math.round(1000 / dt);

  // update location
  loc.x += vel.x * dt;
  loc.y += -vel.y * dt;
  // console.log("loc: ", loc);

  //render
  c.clearRect(0, 0, WIDTH, HEIGHT);

  c.beginPath()
  c.arc(loc.x, loc.y, playerRadius, 0, 2 * Math.PI);
  c.stroke();
  // console.log("fps: ", fps);

  // if update position, send info to server
  sendDefault();
  // console.log("world, users", world, users);
  // document.getElementById("fpsbox").innerText = fps;

  window.requestAnimationFrame(drawAndSend);
}




// TODO fix S D S from start, REMOVE DIRBOOST,
// d d d d ... is the corresponding dirboost

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

  velocity_update();
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      directionPressed.y -= 1;
      keysPressed.delete(key);
      movementDirChanged = true;
      break;
    case keyBindings["down"]:
      directionPressed.y -= -1;
      keysPressed.delete(key);
      movementDirChanged = true;
      break;
    case keyBindings["left"]:
      directionPressed.x -= -1;
      keysPressed.delete(key);
      movementDirChanged = true;
      break;
    case keyBindings["right"]:
      directionPressed.x -= 1;
      keysPressed.delete(key);
      movementDirChanged = true;
      break;
  }


  if (movementDirChanged) {
    boost_updateOnRelease(key);

    // recentDirs_insert({ ...directionPressed });
    // dirBoost_update();
  }

  velocity_update();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
