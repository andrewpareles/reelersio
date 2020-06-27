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
      else if (mag === 0) return {x:0, y:0};
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

var keyPressed = {
  up: false,
  down: false,
  left: false,
  right: false
}


// player info related to game mechanics
var loc = { x: 0, y: 0 }; //location
var vel = { x: 0, y: 0 }; //velocity. Note vel.y is UP, not down (unlike loc)

var playerRadius = 10

var walkspeed = 124 / 1000 // pix/ms

var directionPressed = { x: 0, y: 0 } //NON-NORMALIZED

let velocity_update = () => {
  console.log(boostDir);
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
var recentDirs = []; //[3rd, 2nd, 1st most recent movement dir (directionPressed)]
var dirBoost = false;
var recentDirs_insert = (dir) => {
  recentDirs[0] = recentDirs[1];
  recentDirs[1] = recentDirs[2];
  recentDirs[2] = dir;
}
//(1)
var recentKeys = []; //[3rd, 2nd, 1st most recent key pressed]
var keyBoost = false;
var keyBoostDir = null;
var recentKeys_insert = (key) => {
  console.log("replacing key", recentKeys[0])
  keyBoostDir = keyDirections[recentKeys[0]];
  recentKeys[0] = recentKeys[1];
  recentKeys[1] = recentKeys[2];
  recentKeys[2] = key;
}

var boostStreak = 0; // number of times someone got a boost in a row (LR=0, LRL=1, ...)
var boostMultiplier = 0; // this multiplies walkspeed
var boostDir = null //direction of the boost

var boost = {
  keyBoost_end: () => {
    console.log("ending")
    boostStreak = 0;
    boostMultiplier = 0;
    boostDir = null;

    keyBoost = false;
    keyBoostDir = null;
  },
  keyBoost_clear: () => {
    console.log("clearing")
    boostStreak = 0;
    boostMultiplier = 0;
    boostDir = null;

    recentKeys = [];
    keyBoost = false;
    keyBoostDir = null;
  },
  keyBoost_init: () => {
    boostDir = keyBoostDir;
  },
  dirBoost_init: () => {
    boostDir = vec.normalized(vec.add(recentDirs[0], recentDirs[1]));
  },
  keyBoost_inc: () => {
    boostMultiplier = 1.5;
    boostStreak++;
  },
  dirBoost_inc: () => {
    boostMultiplier = 1.5;
    boostStreak++;
  }
}

// Assuming that the 3rd value of recentKeys and recentDirs is not null, since 
// which is true since this is called after a WASD key is pressed.


var keyBoost_update_press = () => {
  console.log(recentKeys);
  keyBoost = recentKeys[0] === recentKeys[2] //don't need to check null, 1st statement takes care of this
    && recentKeys[0] !== recentKeys[1];

  if (keyBoost) {
    boost.keyBoost_inc();
    if (boostStreak == 1) { //first boost in this direction
      boost.keyBoost_init();
    }
  } 
  else if (boostStreak > 1) { //end the streak
    boost.keyBoost_end();
  }
}
var keyBoost_update_release = (keyReleased) => {
  //this if is for when a key is released to stop the boost:
  if (keyBoost && !!keyReleased && vec.equals(keyDirections[keyReleased], boostDir)) {
    boost.keyBoost_clear();
  }
}

var dirBoost_update = () => {
  if (keyBoost) console.log("dirBoost, but keyboost")
  if (keyBoost) return;

  dirBoost = vec.nonzero(recentDirs[0]) && vec.nonzero(recentDirs[1])
    && vec.equals(recentDirs[0], recentDirs[2])
    && !vec.equals(recentDirs[0], recentDirs[1]);

  if (dirBoost) {
    boost.dirBoost_inc();
    if (boostStreak == 1) { //first boost in this direction
      boost.dirBoost_init();
    }
  } else {
    boost.end();
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
      if (!keyPressed.up) {
        directionPressed.y += 1;
        keyPressed.up = true;
        movementDirChanged = true;
      }
      break;
    case keyBindings["down"]:
      if (!keyPressed.down) {
        directionPressed.y += -1;
        keyPressed.down = true;
        movementDirChanged = true;
      }
      break;
    case keyBindings["left"]:
      if (!keyPressed.left) {
        directionPressed.x += -1;
        keyPressed.left = true;
        movementDirChanged = true;
      }
      break;
    case keyBindings["right"]:
      if (!keyPressed.right) {
        directionPressed.x += 1;
        keyPressed.right = true;
        movementDirChanged = true;
      }
      break;
  }

  if (movementDirChanged) { //ie WASD was pressed, not some other key
    recentKeys_insert(key);
    keyBoost_update_press();

    // recentDirs_insert({ ...directionPressed });
    // dirBoost_update();
  }

  velocity_update();
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  let movementDirChanged = false;
  switch (key) {
    case keyBindings["up"]:
      directionPressed.y -= 1;
      keyPressed.up = false;
      movementDirChanged = true;
      break;
    case keyBindings["down"]:
      directionPressed.y -= -1;
      keyPressed.down = false;
      movementDirChanged = true;
      break;
    case keyBindings["left"]:
      directionPressed.x -= -1;
      keyPressed.left = false;
      movementDirChanged = true;
      break;
    case keyBindings["right"]:
      directionPressed.x -= 1;
      keyPressed.right = false;
      movementDirChanged = true;
      break;
  }


  if (movementDirChanged) {
    keyBoost_update_release(key);

    // recentDirs_insert({ ...directionPressed });
    // dirBoost_update();
  }

  velocity_update();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
