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
  // console.log("boostdir", boostDir);
  vel = vec.add(vec.normalized(directionPressed, walkspeed), vec.normalized(boostDir, walkspeed * boostMultiplier));
}
/** Boost mechanics:
 * Two ways to get a boost:
 * (1) Record the previous 2 keys pressed
 *     - Condition for boost: recentKeys = [K1 K2 K1] (Ki = key i)
 * (2) Record the previous 2 values of directionsPressed
 *     - Condition for boost: recentDirs = [D1 D2 D1] (Di = direction i)
 * If (1) and (2) both have boost conditions met, (1) overrights (2)
 * */
//(2)
//(1)
var recentKeys = []; //[3rd, 2nd, 1st most recent key pressed]
var hasBoost = false;
var recentKeys_insert = (key) => {
  recentKeys[0] = recentKeys[1];
  recentKeys[1] = recentKeys[2];
  recentKeys[2] = key;
}

var boostStreak = 0; // number of times someone got a boost in a row (LR=0, LRL=1, ...)
var boostMultiplier = 0; // this multiplies walkspeed
var boostDir = null; //direction of the boost
var boostKeys = new Set(); //keys that need to be held down for current boost to be active, i.e. keys not part of the cycle

var boost = {
  end: () => {
    console.log("ending")
    boostStreak = 0;
    boostMultiplier = 0;
    boostDir = null;
    boostKeys.clear();

    hasBoost = false;
  },
  clear: () => {
    console.log("clearing")
    boostStreak = 0;
    boostMultiplier = 0;
    boostDir = null;
    boostKeys.clear();

    recentKeys = [];
    hasBoost = false;
  },
  init: () => {
    // updates boostDir and boostKeys
    let dir = { x: 0, y: 0 };
    // if 1 key cycle, cycleSize = 1, else if 2 key cycle cycleSize = 2
    // TODO boostDir can't be up, down, left, or right (or else that's cheating, AD tap W)

    let cycleSize = keysPressed.size-1;
    console.log("cycleSize", cycleSize)
    console.log("KEYSPRESSED", keysPressed)
    if (cycleSize == 1) {
      // think SD with W tapping
      // boostDir = (SD + WSD)/2 
      keysPressed.forEach((key) => {
        console.log("KEY1", key);
        dir = vec.add(dir, keyDirections[key]);
        if (key !== recentKeys[0]) { //W in this case
          boostKeys.add(key);
        }
      });
    } else if (cycleSize == 2) {
      // think W with A and D tapping (alternating)
      // need 
      keysPressed.forEach((key) => {
        console.log("KEY1", key);
        dir = vec.add(dir, keyDirections[key]);
        if (key !== recentKeys[0] && key !== recentKeys[1]) boostKeys.add(key);
      });
    }
    dir = vec.normalized(dir);
    boostDir = dir;
  },
  inc: () => {
    boostMultiplier += 1 / 2;
    boostStreak++;
  },
  hasBoostKeysPressed: () => {
    if (!hasBoost) return true;
    for (let elt in boostKeys) {
      if (!keysPressed.has(elt)) return false;
    }
    return true;
  }
}

// Assuming that the 3rd value of recentKeys and recentDirs is not null, since 
// which is true since this is called after a WASD key is pressed.


var boost_update_onPress = () => {
  console.log("reckeys", recentKeys);
  hasBoost = recentKeys[0] === recentKeys[2] //don't need to check null, 1st statement takes care of this
    && (keysPressed.size == 2 || keysPressed.size == 3) //if not alternating between 2+ keys, can't possibly boost
    && boost.hasBoostKeysPressed(); //the required boost keys are pressed (or user doesn't yet have boost)

  if (hasBoost) {
    if (boostStreak == 0) { //first boost in this direction
      boost.init();
    }
    boost.inc();
  }
  else if (boostStreak > 1) { //end the streak
    boost.clear();
  }
}
var boost_update_onRelease = (keyReleased) => {
  //this if is for when a key is released to stop the boost:
  if (hasBoost && boostKeys.has(keyReleased)) {
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
    boost_update_onPress();
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
    boost_update_onRelease(key);

    // recentDirs_insert({ ...directionPressed });
    // dirBoost_update();
  }

  velocity_update();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
