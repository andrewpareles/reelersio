//https://socket.io/docs/client-api/
const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
const socket = io(ADDRESS);


//not including yourself
var users = {
  // socket.id0: {
  //   location: {x:0, y:0, z:0},
  //   username: user1
  // }
};
var world = {

};





var loc = {x:0, y:0, z:0};
var username = "user1";





// TODO: test this (fullscreen canvas)
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

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


let drawAndSend = (time_ms) => {
  // console.log("world, users", world, users);
  //render

  // if update position, send info to server
  console.log(loc);
  sendDefault();
  



  window.requestAnimationFrame(drawAndSend);
} 






socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});
