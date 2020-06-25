//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
const socket = io(ADDRESS);

//vector functions on {x: , y:}
var vector_add = (a, b) => {
  return {x: a.x + b.x, y: a.y + b.y};
}

var vector_scalar = (scalar, vector) => {
  return {x: scalar * vector.x, y: scalar * vector.y};
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
var directionPressed = {x:0, y:0} //NON-NORMALIZED
var keypressed = {
  up: false,
  down: false,
  left: false,
  right: false
}
var walkspeed = 124/1000 // pix/ms


var player_radius = 10 


var loc = {x:0, y:0}; //location
var vel = {x:0, y:0}; //velocity
var username = "user1";






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
  c.arc(loc.x,loc.y,player_radius,0,2*Math.PI);
  c.stroke();
  // console.log(fps);

  

  // if update position, send info to server
  sendDefault();
  // console.log("world, users", world, users);
  // document.getElementById("fpsbox").innerText = fps;

  
  window.requestAnimationFrame(drawAndSend);
} 




let updateVelocity = () => {
  let directionPressedNorm = vector_norm(directionPressed);
  vel = directionPressedNorm == 0 ? {x:0, y:0} : vector_scalar(walkspeed/directionPressedNorm, directionPressed);
}

document.addEventListener('keydown', function(event) {
  let key = event.key.toLowerCase();
  switch(key) {
    case "w":
      if (!keypressed.up) {
        directionPressed.y += 1;
        keypressed.up = true;
      }
      break;
    case "a":
      if (!keypressed.left) {
        directionPressed.x += -1;
        keypressed.left = true;
      }
      break;
    case "s":
      if (!keypressed.down) {
        directionPressed.y += -1;
        keypressed.down = true;
      }
      break;
    case "d":
      if (!keypressed.right) {
        directionPressed.x += 1;
        keypressed.right = true;
      }
      break;
  }
  updateVelocity();
});

document.addEventListener('keyup', function(event) {
  let key = event.key.toLowerCase();
  switch(key) {
    case "w":
      directionPressed.y -= 1;
      keypressed.up = false;
      break;
    case "a":
      directionPressed.x -= -1;
      keypressed.left = false;
      break;
    case "s":
      directionPressed.y -= -1;
      keypressed.down = false;
      break;
    case "d":
      directionPressed.x -= 1;
      keypressed.right = false;
      break;
  }
  updateVelocity();
});






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
