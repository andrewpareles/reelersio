var server = require('http').Server();
var io = require('socket.io')(server);


io.on('connection', function (socket) {
  socket.emit('news', { hello: 'world' });
  socket.on('my other event', function (data) {
    console.log(data);
  });
});


var users = {
  // socket.id0: {
  //   location: {x:0, y:0, z:0},
  // }
};

// fired when client connects
 io.on('connection', (socket) => {
   
  //set what sockets do on different events
  socket.on('newplayer', (username) => {
    console.log(`connected socket.id: ${socket.id}`);
    users[socket.id] = { username };
  });

  socket.on('loc', (loc) => {
    console.log(`location: ${JSON.stringify(loc)}`);
  });
});


server.listen(3000, function(){
  console.log('listening on *:3000');
});