//https://socket.io/docs/server-api/
var server = require('http').Server();
var io = require('socket.io')(server);

var players = {
  // socket.id0: {
  //   loc: {x:0, y:0},
  //   username: name,
  //
  // }
};
var world = {

};


const generateStartingLocation = () => {
  return { x: Math.random()*20, y: Math.random()*-100 };
}

const generateRandomColor = () => {
  return '#' + Math.floor(Math.random() * 16777215).toString(16);
}



// fired when client connects
io.on('connection', (socket) => {
  //set what server does on different events

  socket.on('join', (username, callback) => {
    let newPlayer = {
      loc: generateStartingLocation(),
      vel: { x: 0, y: 0 },
      username: username,
      color: generateRandomColor(),
      // hooks: new Set(), //{loc: {x:, y:}, vel: {x:, y:}, hookedPlayer:"picklebob"}
      // hookedBy: new Set(), //players you're hooked by
    };
    //to sender: (players doesn't include newPlayer)
    callback(newPlayer, players, world);

    players[socket.id] = newPlayer;

    //to all but sender: (players includes newPlayer)
    console.log("player[socket.id]:", players[socket.id]);
    socket.broadcast.emit('playerjoin', socket.id, players[socket.id]);

    // console.log(`connected socket.id: ${socket.id}`);
    // console.log(`players: ${JSON.stringify(players, null, 3)}`);
  });



  socket.on('updateloc', (loc, vel) => {
    let playerid = socket.id;
    players[playerid].loc = loc;
    players[playerid].vel = vel;
    // console.log(`location & vel update (server end) loc: ${JSON.stringify(players[playerid].loc)}, vel: ${JSON.stringify(players[playerid].vel)}`);
    socket.broadcast.emit('playermove', playerid, loc, vel);
  });



  socket.on('disconnect', (reason) => {
    delete players[socket.id];
    socket.broadcast.emit('playerdisconnect', socket.id);
  });
});




server.listen(3001, function () {
  console.log('listening on *:3001');
});