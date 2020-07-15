//https://socket.io/docs/client-api/
const io = require('socket.io-client');
const { vec } = require('../common/vector.js');

// const ADDRESS = 'http://192.168.1.204:3001';
const ADDRESS = 'https://trussbucket.herokuapp.com/';
const socket = io(ADDRESS);

/** ---------- GAME CONSTANTS ----------
 * these are initialized by server after player joins
 */
var players = null;
var hooks = null;
var playerid = null;
var world = null;

var playerRadius = null;
var hookRadius_outer = null;
var hookRadius_inner = null;
var mapRadius = null;

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

var send = {
  // sent when you join the game:
  join: async (callback) => {
    const [new_callback, new_promise] = getWaitForExecutionPair(callback);
    socket.emit('join', 'user1', new_callback);
    await new_promise;
  },
  goindirection: (direction) => { // tells server that user just pressed a key (direction = "up|down|left|right")
    socket.emit('goindirection', direction);
  },
  stopindirection: (direction) => { // tells server that user just released a key (direction = "up|down|left|right")
    socket.emit('stopindirection', direction);
  },
  leftclick: (hookDir) => {
    socket.emit('leftclick', hookDir);
  },
  rightclick: () => {
    socket.emit('rightclick');
  },
  resethooks: () => {
    socket.emit('resethooks');
  },
}



/** ---------- KEYBOARD (ALL LOCAL) ---------- */
var keyDirections = {
  'w': "up",
  's': "down",
  'a': "left",
  'd': "right"
}
var keyActions = {
  'r': "resethooks",
  '/': "chat"
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
var midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 }; //in world coords

let updateCanvasSize = () => {
  WIDTH = window.innerWidth;
  HEIGHT = window.innerHeight;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  midScreen = { x: WIDTH / 2, y: -HEIGHT / 2 };
}


/** ---------- DRAWING / CAMERA / GRAPHICS ---------- */
//1. update camZoom and camLoc
//2. call updateCamView()
//3. when drawing, use getPosOnScreen.
var camZoom = 1;
var camLoc = null; //camera location in world

var getPosOnScreen = (locInWorld) => {
  let camToObj = vec.sub(locInWorld, camLoc);
  let screenPos = vec.normalized(camToObj, vec.magnitude(camToObj) / camZoom);
  let posWithNegY = vec.add(screenPos, midScreen);
  return { x: posWithNegY.x, y: -posWithNegY.y };
}

var playerCamera = {
  drawWorldBorder: () => {
    c.beginPath();
    c.lineWidth = 20;
    c.strokeStyle = 'green';
    let pos = getPosOnScreen({ x: 0, y: 0 });
    c.arc(pos.x, pos.y, (mapRadius + c.lineWidth / 2) / camZoom, 0, 2 * Math.PI);
    c.stroke();
  },

  drawPlayer: (pid) => {
    let color = players[pid].color;
    let loc = getPosOnScreen(players[pid].loc);

    c.beginPath();
    c.lineWidth = 6 / camZoom;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, (playerRadius - c.lineWidth / 2) / camZoom, 0, 2 * Math.PI);
    c.stroke();

    // c.font = "10px Verdana";
    // c.textAlign = "center";
    // c.textBaseline = "top";
    // c.fillStyle = color;
    // c.fillText(username, loc.x, loc.y + playerRadius + 5);
  },

  drawHook: (hid, pid_from) => {
    let ploc = getPosOnScreen(players[pid_from].loc);
    let hloc = getPosOnScreen(hooks[hid].loc);
    let [hcol, linecol, bobbercol] = hooks[hid].colors;
    let outer_lw = 2;
    let inner_lw = 2;
    // draw the line
    c.beginPath();
    c.lineWidth = 1 / camZoom;
    c.strokeStyle = linecol;
    c.moveTo(ploc.x, ploc.y);
    c.lineTo(hloc.x, hloc.y);
    c.stroke();

    // draw the hook
    // inside hook (square)
    c.beginPath();
    c.strokeStyle = hcol;
    c.lineWidth = inner_lw / camZoom;
    let hRad_inner = hookRadius_inner / camZoom;
    c.rect(hloc.x - hRad_inner + inner_lw / 2, hloc.y - hRad_inner + inner_lw / 2, 2 * hRad_inner - inner_lw, 2 * hRad_inner - inner_lw);
    c.stroke();

    // outside bobber (circle)
    c.beginPath();
    c.lineWidth = outer_lw / camZoom;
    c.strokeStyle = bobbercol;
    let hRad_outer = hookRadius_outer / camZoom;
    c.arc(hloc.x, hloc.y, hRad_outer + outer_lw / 2, 0, 2 * Math.PI);
    c.stroke();
  },

  drawHole: (hlid) => {
    let color = world.holes[hlid].color;
    let loc = getPosOnScreen(world.holes[hlid].loc);
    let radius = world.holes[hlid].radius / camZoom;

    c.beginPath();
    c.lineWidth = radius;
    c.strokeStyle = color;
    c.arc(loc.x, loc.y, radius - c.lineWidth / 2, 0, 2 * Math.PI);
    c.stroke();
  },
}


/** ---------- FUNCTION CALLED EVERY FRAME TO DRAW/CALCULATE ---------- */
var prevtime;
var starttime;
var currtime;
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

  //camera:
  camLoc = players[socket.id].loc;
  //render:


  c.clearRect(0, 0, WIDTH, HEIGHT);

  //draw holes:
  for (let hlid in world.holes) {
    playerCamera.drawHole(hlid);
  }

  //draw border:
  playerCamera.drawWorldBorder();

  //draw others:
  for (let pid in players) {
    if (pid === socket.id) continue;
    playerCamera.drawPlayer(pid);
  }
  //draw me last
  playerCamera.drawPlayer(socket.id);

  // draw hooks
  for (let hid in hooks) {
    playerCamera.drawHook(hid, hooks[hid].from);
  }


  window.requestAnimationFrame(newFrame);
}


/** ---------- LISTENERS ---------- */
document.addEventListener('keydown', function (event) {
  let key = event.key.toLowerCase();
  if (keysPressedLocal.has(key)) return;
  keysPressedLocal.add(key);

  // console.log('pressing', key);

  if (keyDirections[key]) { //ie WASD was pressed, not some other key
    let movementDir = keyDirections[key];
    send.goindirection(movementDir);

  } else if (keyActions[key]) {
    let actionKey = keyActions[key];
    switch (actionKey) {
      case "resethooks":
        send.resethooks();
        break;
    }

  }
});

document.addEventListener('keyup', function (event) {
  let key = event.key.toLowerCase();
  if (!keysPressedLocal.has(key)) return;
  keysPressedLocal.delete(key);

  // console.log('releasing', key);


  if (keyDirections[key]) {
    let movementDir = keyDirections[key];
    send.stopindirection(movementDir);
  }
});


document.addEventListener('mousedown', function (event) {
  switch (event.button) {
    //left click:
    case 0:
      let mousePos = { x: event.clientX - canv_left, y: -(event.clientY - canv_top) };
      let hookDir = vec.sub(mousePos, midScreen); //points from player to mouse
      send.leftclick(hookDir);
      break;
    //right click
    case 2:
      send.rightclick();
      break;

  }
});

document.addEventListener('wheel', event => {
  console.log(event);
  camZoom += event.deltaY / 1000;
  console.log('zoom', camZoom, 'dY', event.deltaY / 1000);
});

//anti right-click
document.addEventListener('contextmenu', event => event.preventDefault());

window.addEventListener('resize', () => {
  updateCanvasSize();
});


const whenConnect = async () => {
  console.log("initializing localPlayer");
  // 1. tell server I'm a new player
  const joinCallback = (serverPlayers, serverHooks, serverWorld, pRad, hRad_out, hRad_in, mapRad) => {
    playerid = socket.id;
    players = serverPlayers;
    hooks = serverHooks;
    world = serverWorld;
    playerRadius = pRad;
    hookRadius_outer = hRad_out;
    hookRadius_inner = hRad_in;
    mapRadius = mapRad;
  };
  await send.join(joinCallback);

  console.log("playerid", playerid);
  console.log("players", players);
  console.log("hooks", hooks);
  console.log("world", world);
  console.log("playerRadius", playerRadius);
  console.log("hookRadius", hookRadius_outer);

  // once get here, know that everything is defined, so can start rendering  
  // 2. start game
  window.requestAnimationFrame(newFrame);
}
socket.on('connect', whenConnect);



const serverImage = (serverPlayers, serverHooks) => {
  if (!players) console.log("too early");
  players = serverPlayers;
  hooks = serverHooks;
}
socket.on('serverimage', serverImage);


socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
