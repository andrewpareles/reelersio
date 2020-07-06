//https://socket.io/docs/client-api/
const io = require('socket.io-client');
const { vec } = require('../common/vector.js');

const ADDRESS = 'http://localhost:3001';
const socket = io(ADDRESS);

/** ---------- VECTOR FUNCTIONS ---------- */
//vector functions on {x: , y:}:


/** ---------- GAME CONSTANTS ----------
 * these are initialized by server after player joins
 */
var players = null;
var playerid = null;
var world = null;


// up, down, left, right
var keysPressedLocal = new Set();

/** ---------- SENDING TO SERVER ---------- 
 * (receiving is at very bottom) 
 * */
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
  vel: null,

}

var send = {
  // sent when you join the game:
  join: async (callback) => {
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', 'user1', new_callback);
    await new_promise;
  },
  keypressed: (direction) => { // tells server that user just pressed a key (direction = "up|down|left|right")
    socket.emit('keypressed', direction);
  },
  keyreleased: (direction) => { // tells server that user just released a key (direction = "up|down|left|right")
    socket.emit('keyreleased', direction);
  },
  throwhook: (hookDir) => {
    socket.emit('throwhook', hookDir);
  },
}



/** ---------- KEYBOARD (ALL LOCAL) ---------- */
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




/** ---------- DRAWING / GRAPHICS ---------- */
function graphics_brightenColor(col, amt) {
  var usePound = false;
  if (col[0] == "#") {
    col = col.slice(1);
    usePound = true;
  }
  var num = parseInt(col, 16);
  var r = (num >> 16) + amt;
  if (r > 255) r = 255;
  else if (r < 0) r = 0;
  var b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255;
  else if (b < 0) b = 0;
  var g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255;
  else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);
}


var drawPlayer = (p) => {
  let color = p.color;
  let loc = p.loc;

  c.beginPath();
  c.lineWidth = 6;//isLocalPlayer ? 4 : 2;
  c.strokeStyle = color;
  c.arc(loc.x, -loc.y, playerRadius - c.lineWidth / 2, 0, 2 * Math.PI);
  c.stroke();

  // c.font = "10px Verdana";
  // c.textAlign = "center";
  // c.textBaseline = "top";
  // c.fillStyle = color;
  // c.fillText(username, loc.x, loc.y + playerRadius + 5);

}

var drawHook = (p, h) => {
  let pcolor = p.color;
  let ploc = p.loc;
  let hloc = h.loc;

  let outer_lw = 2;
  let inner_lw = 2;
  let hookRadius_inner = .7 * (hookRadius / Math.sqrt(2)); //square radius (not along diagonal)
  // draw the line
  c.beginPath();
  c.lineWidth = 1;
  c.strokeStyle = graphics_brightenColor(pcolor, 30);
  c.moveTo(ploc.x, -ploc.y);
  c.lineTo(hloc.x, -hloc.y);
  c.stroke();

  // draw the hook
  // inside bobber (square)
  c.beginPath();
  c.strokeStyle = graphics_brightenColor(pcolor, -20);
  c.lineWidth = inner_lw;
  c.rect(hloc.x - hookRadius_inner + inner_lw / 2, -(hloc.y - hookRadius_inner + inner_lw / 2), 2 * hookRadius_inner - inner_lw, -(2 * hookRadius_inner - inner_lw));
  c.stroke();

  // outside container (circle)
  c.beginPath();
  c.lineWidth = outer_lw;
  c.strokeStyle = graphics_brightenColor(pcolor, -50);
  c.arc(hloc.x, -hloc.y, hookRadius + outer_lw / 2, 0, 2 * Math.PI);
  c.stroke();
}

/** ---------- CANVAS / SCREEN CONSTANTS ---------- */
var canvas = document.getElementById("canvas");
const canv_top = canvas.getBoundingClientRect().top;
const canv_left = canvas.getBoundingClientRect().left;

var c = canvas.getContext("2d");

var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;

canvas.width = WIDTH;
canvas.height = HEIGHT;

var prevtime;
var starttime;
var currtime;

/** ---------- FUNCTION CALLED EVERY FRAME TO DRAW/CALCULATE ---------- */
let newFrame = (timestamp) => {
  if (starttime === undefined) {
    starttime = timestamp;
    prevtime = timestamp;
  }
  let dt = timestamp - prevtime;
  currtime = timestamp - starttime;
  prevtime = timestamp;

  // calculate fps
  let fps = Math.round(1000 / dt);
  // console.log("fps: ", fps);

  //Multiplier decay

  // console.log("effective, boostMult:", boostMultiplierEffective, boostMultiplier);
  //render:
  c.clearRect(0, 0, WIDTH, HEIGHT);

  for (let pid in players) {
    let p = players[pid];
    //update other players by interpolating velocity
    drawPlayer(p);

    // draw & update hooks
    console.log("hooks", p.hooks);
    for (let hid in p.hooks) {
      let h = p.hooks[hid];
      drawHook(p, h);
    }
  }


  window.requestAnimationFrame(newFrame);
}











/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  
  if (keysPressedLocal.has(key)) return;
  keysPressedLocal.add(key);
  
  let movementDir = keyDirections[key];

  if (movementDir) { //ie WASD was pressed, not some other key
    send.keypressed(movementDir);
  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();

  if (!keysPressedLocal.has(key)) return;
  keysPressedLocal.delete(key);

  let movementDir = keyDirections[key];

  if (movementDir) {
    send.keyreleased(movementDir);
  }
});


document.addEventListener('mousedown', function (event) {
  switch (event.button) {
    //left click:
    case 0:
      let mousePos = { x: event.clientX - canv_left, y: -(event.clientY - canv_top) };
      let hookDir = vec.add(vec.negative(players[playerid].loc), mousePos); //points from player to mouse
      send.throwhook(hookDir);
      break;
  }
});


document.addEventListener('contextmenu', event => event.preventDefault());




const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (serverPlayers, serverWorld, pRad, hRad) => {
    playerid = socket.id;
    players = serverPlayers;
    world = serverWorld;
    playerRadius = pRad;
    hookRadius = hRad;
  };
  await send.join(joinCallback);

  console.log("playerid", playerid);
  console.log("players", players);
  console.log("world", world);
  console.log("playerRadius", playerRadius);
  console.log("hookRadius", hookRadius);

  // once get here, know that everything is defined, so can start rendering  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const serverImage = (serverPlayers, serverWorld) => {
  players = serverPlayers;
  world = serverWorld;
}
socket.on('serverimage', serverImage);


const playerDisconnect = (playerid) => {
  console.log("player left", playerid);
  delete players[playerid];
  console.log("players", players);
}
socket.on('playerdisconnect', playerDisconnect);



socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
