//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3001';
const socket = io(ADDRESS);

/** ---------- VECTOR FUNCTIONS ---------- */
//vector functions on {x: , y:}:
var vec = {
  // add vector a and b
  add: (...vecs) => {
    let x = 0, y = 0;
    for (let v of vecs) {
      x += v.x;
      y += v.y;
    }
    return { x: x, y: y };
  },

  // s*v, a is scalar, v is vector
  scalar: (v, s) => {
    return { x: s * v.x, y: s * v.y };
  },

  // the magnitude of the vector
  mag: (a) => {
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
    let norm = vec.mag(a);
    return norm == 0 ? { x: 0, y: 0 } : vec.scalar(a, mag / norm);
  },

  negative: (a) => {
    return vec.scalar(a, -1);
  },

  dot: (a, b) => {
    return a.x * b.x + a.y * b.y;
  }
}


/** ---------- GAME CONSTANTS ----------
 * these are initialized by server after player joins
 */
var world = null;
var players = null;
var hooks = null;




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


var drawPlayer = (color, loc) => {
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

var drawHook = (pcolor, ploc, hloc) => {
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

  //(1) draw & update others
  for (let p in players) {
    //update other players by interpolating velocity
    drawPlayer(players[p].color, players[p].loc);
  }

  //(2) draw & update me:
  // update location

  // console.log("loc: ", loc);
  drawPlayer(localPlayer.color, localPlayer.loc, true);


  // draw & update hooks
  for (let h of localPlayer.hooks) {
    drawHook(localPlayer.color, localPlayer.loc, h.loc);
  }

  window.requestAnimationFrame(newFrame);
}











/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  let movementDir = keyDirections[key];

  if (movementDir) { //ie WASD was pressed, not some other key
    send.keypressed(movementDir);
  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
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
      let hookDir = vec.normalized(vec.add(vec.negative(localPlayer.loc), mousePos)); //points from player to mouse
      send.throwhook(hookDir);
      break;
  }
});


document.addEventListener('contextmenu', event => event.preventDefault());


// TODO: test out moveTime in playermove and updateloc
/**
Socket events sent:
  join (username, callback):
  - server: calls callback, emits newplayer to all others
  - note that client must wait for callback since it initializes world, players, and localPlayer 
  updateloc (loc, vel):
  - server: updates player's loc & vel , emits loc & vel to all others

Socket events received:
  connect(whenConnect):
  - client: sends join to server, and waits for callback to be run
  playerjoin(playerid, username, loc):
  - client: adds player to players
  playermove(playerid, loc, vel):
  - client: sets playerid's loc to loc
  playerdisconnect(playersocketid):
  - client: removes playersocketid from players
*/



const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (playerobj, serverPlayers, serverWorld, pRad, wSpd, hRad, hSpd, serverA, serverB, serverC, serverD) => {
    localPlayer = playerobj;
    players = serverPlayers;
    world = serverWorld;
    playerRadius = pRad;
    walkspeed = wSpd;
    hookRadius = hRad;
    hookspeed = hSpd;
    a0 = serverA;
    b0 = serverB;
    c0 = serverC;
    d0 = serverD;
  };
  await send.join(joinCallback);

  console.log("localPlayer", localPlayer);
  console.log("players", players);
  console.log("world", world);
  console.log("playerRadius", playerRadius);
  console.log("walkspeed", walkspeed);
  console.log("hookRadius", hookRadius);
  console.log("hookspeed", hookspeed);
  console.log("a", a0);
  console.log("b", b0);
  console.log("c", c0);
  console.log("d", d0);
  // once get here, know that world, players, and loc are defined  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const playerJoin = (playerid, playerobj) => {
  console.log("player joining", playerid, playerobj);
  players[playerid] = playerobj;
  console.log("players", players);
}
socket.on('playerjoin', playerJoin);



const playerMove = (playerid, newLoc, newVel) => {
  console.log("player moved", playerid, newLoc, newVel);
  players[playerid].loc = newLoc;
  players[playerid].vel = newVel;
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
