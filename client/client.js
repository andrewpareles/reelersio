const io = require('socket.io-client');

const ADDRESS = 'http://localhost:3000';
const socket = io(ADDRESS);


var users = {
  // socket.id0: {
  //   location: {x:0, y:0, z:0},
  //   username: fatpiginmud
  // }

};

var fps = 30;
var loc = {x:0, y:0, z:0};
const pause = (ms) => new Promise((res, rej)=> setTimeout(res, ms));



// sends  loc: {x:, y:, z:}, 
const sendDefault = () => {
  const msg = {loc: loc};
  // const buf2 = Buffer.from('bytes');
  socket.emit('loc', loc, /*moreInfo, ... */
  );

}

const clientRunGame = async () => {

  // 1. pick username
  let username = "fatpiginmud";
  socket.emit('newplayer', username);
  
  // 2. loop
  while (true) {
    //render

    // if update position, send info to server
    loc.x += .1;
    sendDefault();
    
    await pause(1000/fps);
  }
}







socket.on('connect', clientRunGame);

socket.on('connect_error', (error) => {
  console.log("Connection error: " + JSON.stringify(error));
});