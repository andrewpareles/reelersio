//https://socket.io/docs/server-api/
var server = require('http').Server();
var io = require('socket.io')(server);

var users = {
  // socket.id0: {
  //   location: {x:0, y:0, z:0},
  // }
};
var world = {

};


const generateRandomLocation = () => {
  return {x: 10, y: 10};
}

//callback(world, users)
const onNewPlayer = socket => (username, callback) => {
  const loc = generateRandomLocation();
  users[socket.id] = {location: loc, username: username}
  
  console.log(`connected socket.id: ${socket.id}`);
  console.log(`users: ${JSON.stringify(users, null, 3)}`);

  callback(world, users);
}







// fired when client connects
 io.on('connection', (socket) => {
   //set what server does on different events
   
  socket.on('newplayer', onNewPlayer(socket));

  socket.on('message', (loc, ) => {
    console.log(`location (server end): ${JSON.stringify(loc)}`);
  });

  socket.on('disconnect', (reason) => {
    delete users[socket.id];
  });
});


server.listen(3000, function(){
  console.log('listening on *:3000');
});