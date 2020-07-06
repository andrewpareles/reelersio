//https://socket.io/docs/server-api/
const server = require('http').Server();
const io = require('socket.io')(server);
const { vec } = require('../common/vector.js');

const playerRadius = 20; //pix
const walkspeed = 124 / 1000; // pix/ms
const hookRadius = 10; //circle radius
const hookspeed = 200 / 1000; //pix


const a0 = 1 / (160 * 16); // boost decay v^2 term
const b0 = 1 / (80 * 16); // boost decay constant term
const c0 = 1 / (37.5 * 16); // c / (boostMult + d) term
const d0 = 1 / (.5 * 16);
// Solution to dv/dt = -m(a v^2 + b + c / (v + d)) (if that's < 0, then 0)
// v0 = init boost vel, t = time since boost started
//TODO.

const boostMultEffective_max = 2.5;
const boostMult_max = 3;

const WAIT_TIME = 33; // # ms to wait to broadcast players object




var players = {
  /*
  "initialPlayer (socket.id)": {
    loc: generateStartingLocation(),
    vel: { x: 0, y: 0 },

    username: "billybob",
    color: "#...",

    //NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
    boost: {
      Dir: null, // direction of the boost (null iff no boost)
      Key: null, // key that needs to be held down for current boost to be active
      Multiplier: 0, // magnitude of boost in units of walkspeed
      MultiplierEffective: 0, // magnitude of boost in units of walkspeed that actually gets used
      recentKeys: [], //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
      recentKeysRepeat: false,
    },

    walk: {
      directionPressed: { x: 0, y: 0 }, //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)
      keysPressed: new Set(), // contains 'up', 'down', 'left', and 'right'
    }
  }
  */
};


var world = {};


var hooks = {
  /*
  "hookid": {
    loc: { x: 187, y: 56 },
    vel: { x: 1337, y: 42 },
    from: "playerid",
    to: null
  }
  */
};





//returns true iff key 1 is parallel and in the opposite direction to key 2 
var keyDirection_isOpposite = (d1, d2) => {
  switch (d1) {
    case "left": return d2 === "right";
    case "right": return d2 === "left";
    case "up": return d2 === "down";
    case "down": return d2 === "up";
  }
}

// assumes these are normalized
var keyVectors = {
  'up': { x: 0, y: 1 },
  'down': { x: 0, y: -1 }, //must = -up
  'left': { x: -1, y: 0 }, //must = -right
  'right': { x: 1, y: 0 }
}


// if k is null, there is no orthogonal key to a and b being pressed, or there are 2
// if k is not, it's the single key pressed that's orthogonal to key k
var keysPressed_singleOrthogonalTo = (p, d) => {
  let keysPressed = p.walk.keysPressed;
  let ret = null;
  switch (d) {
    case "left":
    case "right":
      if (keysPressed.has("up")) ret = "up";
      if (keysPressed.has("down")) {
        if (ret) ret = null;
        else {
          ret = "down";
        }
      }
      break;
    case "up":
    case "down":
      if (keysPressed.has("left")) ret = "left";
      if (keysPressed.has("right")) {
        if (ret) ret = null;
        else {
          ret = "right";
        }
      }
      break;
  }
  return ret;
}




var recentKeys_insert = (p, key) => {
  if (key === p.boost.recentKeys[1]) { //repeat
    p.boost.recentKeysRepeat = true;
  } else { // no repeat
    p.boost.recentKeysRepeat = false;
    p.boost.recentKeys[0] = p.boost.recentKeys[1];
    p.boost.recentKeys[1] = key;
  }
}
// stops player from being able to continue / initiate boost (they have to redo as if standing still with no keys pressed yet)
var boostReset = (p) => {
  p.boost.Multiplier = 0;
  p.boost.Dir = null;
  p.boost.Key = null;
  p.boost.recentKeys = [];
  p.boost.recentKeysRepeat = false;
}
// creates a boost in direction of key k, with boostMultipler increased by inc
var boostSet = (p, k, inc) => {
  p.boost.Multiplier += inc;
  if (p.boost.Multiplier <= 0) boostReset();
  else {
    p.boost.Dir = keyVectors[k];
    p.boost.Key = k;
  }
}





// Can assume that the last entry in recentKeys is not null, since 
// which is true since this is called after a WASD key is pressed
// updates boost.Dir and boost.Key
var boost_updateOnPress = (p, key) => {

  recentKeys_insert(p, key);

  let a = recentKeys[0];
  let b = recentKeys[1];
  if (!a) return;
  //note b is guaranteed to exist since a key was just pressed

  let c = keysPressed_singleOrthogonalTo(p, b);  // c is the key of the BOOST DIRECTION!!! (or null if no boost)

  // have no boost yet, so initialize
  if (!boost.Dir) {
    // starting boost: no boost yet, so initialize 
    // (1) recentKeys(a,b) where a,b are // and opposite and c is pressed and orthogonal to a and b
    if (keyDirection_isOpposite(a, b) && c) {
      boostSet(p, c, .5);
    }
  }
  // currently have boost, continue it or lose it
  else {
    if (c === boost.Key && !recentKeysRepeat && keyDirection_isOpposite(a, b)) {
      boostSet(p, c, .5);
    }
    else if (c === boost.Key && recentKeysRepeat) {
      boostSet(p, c, -.1);
    }
    else if (c && keyDirection_isOpposite(b, boost.Key)) {
      boostSet(p, c, 0);
    }
    else {
      boostReset(p);
    }
  }

}

var boost_updateOnRelease = (p, keyReleased) => {
  if (p.boost.Key) { // W and A/D boost
    if (p.walk.keysPressed.size === 0
      || (keyReleased === p.boost.Key && p.walk.keysPressed.size !== 1)) { //reset boost

      boostReset(p);
    }
  }
}


var walk_updateOnPress = (p, dir) => {
  let keysPressed = p.walk.keysPressed;
  let directionPressed = p.walk.directionPressed;
  switch (dir) {
    case "up":
      if (!keysPressed.has(key)) {
        directionPressed.y += 1;
        keysPressed.add(key);
      }
      break;
    case "down":
      if (!keysPressed.has(key)) {
        directionPressed.y += -1;
        keysPressed.add(key);
      }
      break;
    case keyBindings["left"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += -1;
        keysPressed.add(key);
      }
      break;
    case keyBindings["right"]:
      if (!keysPressed.has(key)) {
        directionPressed.x += 1;
        keysPressed.add(key);
      }
      break;
  }
}



var walk_updateOnRelease = (p, dir) => {
  let keysPressed = p.walk.keysPressed;
  let directionPressed = p.walk.directionPressed;

  switch (key) {
    case "up":
      if (keysPressed.has(key)) {
        directionPressed.y -= 1;
        keysPressed.delete(key);
      }
      break;
    case "down":
      if (keysPressed.has(key)) {
        directionPressed.y -= -1;
        keysPressed.delete(key);
      }
      break;
    case "left":
      if (keysPressed.has(key)) {
        directionPressed.x -= -1;
        keysPressed.delete(key);
      }
      break;
    case "right":
      if (keysPressed.has(key)) {
        directionPressed.x -= 1;
        keysPressed.delete(key);
      }
      break;
  }
}



var velocity_update = (p) => {
  if (!p.boost.Dir) {
    return vec.normalized(p.walk.directionPressed, walkspeed);
  }
  else return vec.add(vec.normalized(p.walk.directionPressed, walkspeed),
    vec.normalized(p.boost.Dir, p.boost.MultiplierEffective * walkspeed)); // walk vel + boost vel
}



























var prevtime = null;
const runGame = () => {
  if (!prevtime) {
    prevtime = Date.now();
    return;
  }
  let dt = Date.now() - prevtime;
  prevtime = Date.now();
  console.log("dt:", dt);

  for (let pid in players) {
    let p = players[pid];

    //boost decay
    p.boost.Multiplier -= dt * (a0 * Math.pow(p.boost.Multiplier, 2) + b0 + c0 / (p.boost.Multiplier + d0));
    if (p.boost.Multiplier <= 0) p.boost.Multiplier = 0;
    else if (p.boost.Multiplier > boostMult_max) p.boost.Multiplier = boostMult_max;
    p.boost.MultiplierEffective = p.boost.Multiplier > boostMultEffective_max ? boostMultEffective_max : p.boost.Multiplier;

    // update player location
    p.loc = vec.add(p.loc, vec.scalar(p.vel, dt));
  }

  for (let hid in hooks) {
    let h = hooks[hid];
    // update hook location
    h.loc = vec.add(h.loc, vec.scalar(h.vel, dt));
  }
}
setInterval(runGame, WAIT_TIME);



const generateStartingLocation = () => {
  return { x: 10 + Math.random() * 20, y: 10 + Math.random() * -100 };
}

const generateRandomColor = () => {
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

const generateNewPlayer = (username) => {
  return {
    loc: generateStartingLocation(),
    vel: { x: 0, y: 0 },

    username: username,
    color: generateRandomColor(),

    //NOTE: here by "key" I MEAN DIRECTION KEY (up/down/left/right)
    boost: {
      Dir: null, // direction of the boost (null iff no boost)
      Key: null, // key that needs to be held down for current boost to be active
      Multiplier: 0, // magnitude of boost in units of walkspeed
      MultiplierEffective: 0, // magnitude of boost in units of walkspeed that actually gets used
      recentKeys: [], //[2nd, 1st most recent key pressed] (these are unique, if a user presses same key twice then no update, just set recentKeysRepeat to true)
      recentKeysRepeat: false,
    },
    walk: {
      directionPressed: { x: 0, y: 0 }, //NON-NORMALIZED. This multiplies walkspeed to give a walking velocity vector (which adds to the boost vector)
      keysPressed: new Set(), // contains 'up', 'down', 'left', and 'right'
    }
  }
}


// fired when client connects
io.on('connection', (socket) => {

  //set what server does on different events
  socket.on('join', (username, callback) => {
    let newPlayer = generateNewPlayer(username);

    players[socket.id] = newPlayer;

    callback(
      players,
      hooks,
      world,
      playerRadius,
      hookRadius,
    );


    console.log("players:", players);
    // console.log(`connected socket.id: ${socket.id}`);
    // console.log(`players: ${JSON.stringify(players, null, 3)}`);
  });



  socket.on('keypressed', (dir) => {// dir is up, down, left, or right
    let p = players[socket.id];
    walk_updateOnPress(p, dir);
    boost_updateOnPress(p, dir);
    velocity_update(p);
  });

  socket.on('keyreleased', (dir) => {// dir is up, down, left, or right
    let p = players[socket.id];
    walk_updateOnRelease(p, dir);
    boost_updateOnRelease(p, dir);
    velocity_update(p);
  });

  socket.on('throwhook', (hookDir) => {// hookDir is {x, y}
    let p = players[socket.id];
    hookDir = vec.normalized(hookDir);
    let playerVel_projectedOn_hookDir = vec.dot(p.vel, hookDir);
    let hook = {
      vel: vec.normalized(hookDir, hookspeed + playerVel_projectedOn_hookDir),
      loc: vec.add(p.loc, vec.normalized(hookDir, playerRadius)),
    };
    hooks.push(hook);
  });

  socket.on('disconnect', (reason) => {
    delete players[socket.id];
    socket.broadcast.emit('playerdisconnect', socket.id);
  });
});




server.listen(3001, function () {
  console.log('listening on *:3001');
});