
const socket = require('socket.io-client')('http://localhost');


var port = 1337;

var sendRate = 300; // 1/ping?
var fps = 30;

var loc = {x:0, y:0, z:0};

const pause = (ms) => new Promise((res, rej)=> setTimeout(res, ms));

// sends  loc: {x:, y:, z:}, 
const sendDefault = () => {
  const locBuffer = Buffer.from(JSON.stringify({loc: loc}));
  // const buf2 = Buffer.from('bytes');
  client.send([locBuffer, ], port, (err) => {
    console.error(err);
    // client.close();
  });
}

const clientRunGame = async () => {
  while (true) {

    //render

    // send to server
    sendDefault();
    
    await pause(1000/fps);
  }
}



socket.on('connect', function(){});
socket.on('event', function(data){});
socket.on('disconnect', function(){});
