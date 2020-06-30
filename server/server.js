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
  return { x: 10, y: 10 };
}

//callback(player, world, users)
const onJoin = socket => (username, callback) => {
  let loc = generateStartingLocation();
  let newPlayer = {
    loc: loc,
    vel: { x: 0, y: 0 },
    username: username,
    hooks: new Set(), //{loc: {x:, y:}, vel: {x:, y:}, hookedPlayer:"picklebob"}
    hookedBy: new Set(), //players you're hooked by
  };

  //to sender: (players doesn't include newPlayer)
  callback(newPlayer, players, world);

  players[socket.id] = newPlayer;

  //to all but sender: (players includes newPlayer)
  socket.broadcast.emit('playerjoin', socket.id, players[socket.id]);

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