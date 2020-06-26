//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
const socket = io(ADDRESS);

//vector functions on {x: , y:}
var vector_add = (a, b) => {
  return {x: a.x + b.x, y: a.y + b.y};
}

// a is scalar, v is vector
var vector_scalar = (a, v) => {
  return {x: a * v.x, y: a * v.y};
}

var vector_norm = (a) => {
  return Math.sqrt(Math.pow(a.x,2)+Math.pow(a.y,2));
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

var directionPressed = {x:0, y:0} //NON-NORMALIZED

let velocity_update = () => {
  let directionPressedNorm = vector_norm(directionPressed);
  vel = directionPressedNorm == 0 ? {x:0, y:0} : vector_scalar(walkspeed/directionPressedNorm, directionPressed);
}

var walkspeed = 124/1000 // pix/ms


// player info related to game mechanics
var playerRadius = 10

var loc = {x:0, y:0}; //location
var vel = {x:0, y:0}; //velocity

// records the previous cycles of keys pressed to give a boost
// they key is keybindings[up|down|left|right]
var recentKeys = []; //[2nd most recent key pressed, most recent key pressed]
var hasBoost = false;
var recentKeys_insert = (key) => {
  recentKeys[0] = recentKeys[1];
  recentKeys[1] = key;
}
var boostStreak = 0; // number of times someone got a boost in a row (LR=0, LRL=1, ...)



// sends  loc: {x:, y:, z:}, 
const sendDefault = () => {
  const msg = {loc: loc};
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
  let fps = Math.round(1000/dt);

  // update location
  loc.x += vel.x * dt;
  loc.y += -vel.y * dt;
  console.log("loc: ", loc);

  //render
  c.clearRect(0, 0, WIDTH, HEIGHT);

  c.beginPath()
  c.arc(loc.x,loc.y,playerRadius,0,2*Math.PI);
  c.stroke();
  console.log("fps: ", fps);

  // if update position, send info to server
  sendDefault();
  // console.log("world, users", world, users);
  // document.getElementById("fpsbox").innerText = fps;

  window.requestAnimationFrame(drawAndSend);
} 






document.addEventListener('keydown', function(event) {
  let key = event.key.toLowerCase();
  switch(key) {
    case keyBindings["up"]:
      if (!keyPressed.up) {
        directionPressed.y += 1;
        keyPressed.up = true;

        hasBoost = recentKeys[0] === keyBindings["up"] && recentKeys[1] === keyBindings["down"];
        recentKeys_insert(keyBindings["up"]);
      }
      break;
    case keyBindings["down"]:
      if (!keyPressed.down) {
        directionPressed.y += -1;
        keyPressed.down = true;

        hasBoost = recentKeys[0] === keyBindings["down"] && recentKeys[1] === keyBindings["up"];
        recentKeys_insert(keyBindings["down"]);
      }
      break;
    case keyBindings["left"]:
      if (!keyPressed.left) {
        directionPressed.x += -1;
        keyPressed.left = true;

        hasBoost = recentKeys[0] === keyBindings["left"] && recentKeys[1] === keyBindings["right"];
        recentKeys_insert(keyBindings["left"]);
      }
      break;
    case keyBindings["right"]:
      if (!keyPressed.right) {
        directionPressed.x += 1;
        keyPressed.right = true;

        hasBoost = recentKeys[0] === keyBindings["right"] && recentKeys[1] === keyBindings["left"];
        recentKeys_insert(keyBindings["right"]);
      }
      break;
  }
  if (hasBoost) walkspeed = 500/1000;
  velocity_update();
});

document.addEventListener('keyup', function(event) {
  let key = event.key.toLowerCase();
  switch(key) {
    case keyBindings["up"]:
      directionPressed.y -= 1;
      keyPressed.up = false;
      break;
    case keyBindings["down"]:
      directionPressed.y -= -1;
      keyPressed.down = false;
      break;
    case keyBindings["left"]:
      directionPressed.x -= -1;
      keyPressed.left = false;
      break;
    case keyBindings["right"]:
      directionPressed.x -= 1;
      keyPressed.right = false;
      break;
  }
  velocity_update();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
