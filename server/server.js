//https://socket.io/docs/server-api/
var server = require('http').Server();
var io = require('socket.io')(server);

var players = {
  // socket.id0: {
  //   location: {x:0, y:0},
  // }
};
var world = {

};


const generateRandomLocation = () => {
  return { x: 10, y: 10 };
}

//callback(world, users, startLoc)
const onJoin = socket => (username, callback) => {
  let loc = generateRandomLocation();
  callback(world, players, loc);
  players[socket.id] = { loc: loc, username: username };
  socket.broadcast.emit('playerjoin', socket.id, username, loc);
  console.log(`connected socket.id: ${socket.id}`);
  console.log(`users: ${JSON.stringify(players, null, 3)}`);

}







// fired when client connects
io.on('connection', (socket) => {
  //set what server does on different events

  socket.on('join', onJoin(socket));

  socket.on('loc', (newLoc,) => {
    let playerid = socket.id;
    console.log(`location update (server end): ${JSON.stringify(newLoc)}`);
    players[playerid].loc = newLoc;
    socket.broadcast.emit('playermove', playerid, newLoc);
  });

  socket.on('disconnect', (reason) => {
    delete players[socket.id];
    socket.broadcast.emit('playerdisconnect', socket.id);
  });
});


server.listen(3001, function () {
  console.log('listening on *:3001');
});