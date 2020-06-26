//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
const socket = io(ADDRESS);

//vector functions on {x: , y:}:
// add vector a and b
var vector_add = (a, b) => {
  return { x: a.x + b.x, y: a.y + b.y };
}

// a*v, a is scalar, v is vector
var vector_scalar = (v, a) => {
  return { x: a * v.x, y: a * v.y };
}

// the magnitude of the vector
var vector_norm = (a) => {
  return Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
}

// neither vector is null, and they have same values
var vector_equals = (a, b) => {
  return !!a && !!b && a.x == b.x && a.y == b.y;
}

// vector is not null, and doesnt contain all null or 0 values
var vector_nonzero = (a) => {
  return !!a && (!!a.x || !!a.y)
}

// if unnormalizable, return the 0 vector. 
// Normalizes to a vector of size mag, or 1 if undefined
var vector_normalized = (a, mag) => {
  if (!mag && mag !== 0) mag = 1;
  let norm = vector_norm(a);
  return norm == 0 ? { x: 0, y: 0 } : vector_scalar(a, mag / norm);

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
var keyPressed = {
  up: false,
  down: false,
  left: false,
  right: false
}

// player info related to game mechanics
var loc = { x: 0, y: 0 }; //location
var vel = { x: 0, y: 0 }; //velocity

var playerRadius = 10

var walkspeed = 124 / 1000 // pix/ms

var directionPressed = { x: 0, y: 0 } //NON-NORMALIZED

let velocity_update = () => {
  vel = vector_add(vector_normalized(directionPressed, walkspeed), vector_normalized(boostDir, walkspeed * boostMultiplier));
}




// records the previous 3 values of directionPressed to determine boost
var recentDirs = []; //[3rd most recent movement dir, 2nd most recent movement dir, most recent movement dir]
var recentDirs_insert = (dir) => {
  recentDirs[0] = recentDirs[1];
  recentDirs[1] = recentDirs[2];
  recentDirs[2] = dir;
}

var boostEnabled = false;
var boostStreak = 0; // number of times someone got a boost in a row (LR=0, LRL=1, ...)
var boostMultiplier = 0; // this multiplies walkspeed
var boostDir = { x: 0, y: 0 } //direction of the boost

var boost_update = () => {
  console.log(recentDirs[0])
  console.log(recentDirs[1])
  console.log(recentDirs[2])
  console.log("")
  boostEnabled = vector_nonzero(recentDirs[0]) && vector_nonzero(recentDirs[1])
    && vector_equals(recentDirs[0], recentDirs[2]) 
    && !vector_equals(recentDirs[0], recentDirs[1])
  if (boostEnabled) {
    boostMultiplier = 1.5;
    if (boostStreak == 0) { //first boost in this direction
      boostDir = vector_normalized(vector_add(recentDirs[0], recentDirs[1]));
      console.log("boostDir", boostDir)
    }
    boostStreak++;
  } else {
    boostStreak = 0;
    boostMultiplier = 0;
  }
}


// sends  loc: {x:, y:, z:}, 
const sendDefault = () => {
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

let drawAndSend = (currtime) => {
  if (starttime === undefined) {
    starttime = currtime;
    prevtime = currtime;
  }
  let dt = currtime - prevtime;
  let elapsed = currtime - starttime;
  prevtime = currtime;

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

  if (movementDirChanged) {
    recentDirs_insert({ ...directionPressed });
    boost_update();
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
    recentDirs_insert({ ...directionPressed });
    boost_update();
  }

  velocity_update();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
