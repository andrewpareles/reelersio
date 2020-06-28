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
    return !!a && (!!a.x || !!a.y);
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
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}

var keyDirection_isOpposite = (key1, key2) => {
  let [d1, d2] = [keyDirections[key1], keyDirections[key2]];
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

var keysPressed_orthogonalTo = (k) => {
  let ret = [];
  switch (keyDirections[k]) {
    case "left":
    case "right":
      if (keysPressed.has(keyBindings["up"])) ret.push(keyBindings["up"]);
      if (keysPressed.has(keyBindings["down"])) ret.push(keyBindings["down"]);
      break;
    case "up":
    case "down":
      if (keysPressed.has(keyBindings["left"])) ret.push(keyBindings["left"]);
      if (keysPressed.has(keyBindings["right"])) ret.push(keyBindings["right"]);
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

// contains 'w', 'a', 's', or 'd'
var keysPressed = new Set();


// player info related to game mechanics
var loc = { x: 0, y: 0 }; //location
var vel = { x: 0, y: 0 }; //velocity. Note vel.y is UP, not down (unlike loc)

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


var boostMultiplier = 0; // fraction of walkspeed to add to velocity
var boostDir = null; // direction of the boost
var boostKey = null; // key that needs to be held down for current boost to be active, i.e. key not part of the cycle (if any)


// Can assume that the 2nd value of recentKeys is not null, since 
// which is true since this is called after a WASD key is pressed
// updates boostDir and boostKeyReq
var boost_updateOnPress = () => {
  let a = recentKeys[0];
  let b = recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  // c is the BOOST DIRECTION!!! (or null if no boost)
  let c = null;

  
  let boost =false;
  // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
  if (keyDirection_isOpposite(a, b)) {
    let orthogs = keysPressed_orthogonalTo(a);
    c = orthogs.length === 1 ? orthogs[0] : null;
    boost=true;
    console.log("boosting start", keyDirections[c]);

    // if c is null, there is no orthogonal key to a and b, or there are 2
  }
  // (2) continue boost into new direction
  else if (boostDir){
    if (keysPressed.size === 2){
      // one in new dir, key you just pressed is opposite of current boost dir
      if (keyDirection_isOpposite(b,))
    }
    if (keyDirection_isOpposite(b, boostKey)) c = a;
    console.log("boosting continue", keyDirections[c]);
  }

  // if we have a boost direction, go!
  if (c) {
    boostDir = keyVectors[c];
    boostKey = c;
    if (boost) boostMultiplier += .5;
  }
}

var boost_updateOnRelease = (keyReleased) => {
  // if (boostKeyReq) { // W and A/D boost
  //   if (keyReleased === boostKeyReq) boostMultiplier = 0;
  // }

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
