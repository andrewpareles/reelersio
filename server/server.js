const server = require('http').createServer();
const io = require('socket.io')(server);

var port = 1337;

io.on('connection', (socket) => {
  socket.on('ferret', (name, fn) => {
    fn('woot');
  });
});


server.listen(port);

const receiveMessage = (client, data) => {

}

// server:
