/*
 * Simple Signal Server for the web client
 * 
 * Usage:
 *      node datatransfer-ss.js <port number>
 * 
 */

var ws = require('nodejs-websocket');

var args = process.argv.slice(2);

var port = args[0];

if (!port) {
    console.log('ERROR: Need a port number');
    process.exit(1);
}

var connectionsById = {};

var server = ws.createServer(function (conn) {
    var thisId = '' + Math.round(Math.random() * 10000);

    console.log('New connection: ' + conn.key + '\nNode ID = ' + thisId);

    connectionsById[thisId] = conn;
    console.log('Node information:');
    console.log(conn.headers);

    var handshakeMessage = {
        type: 'joinResponse',
        id: thisId
    };
    conn.sendText(JSON.stringify(handshakeMessage));

    conn.on('text', function (str) {
        console.log('From ' + thisId + ':\n' + str);
        var obj = JSON.parse(str);
        var ws = connectionsById[obj.to];
        if (ws) {
            ws.sendText(str);
        }
    });
    conn.on('close', function (code, reason) {
        console.log('Connection closed: ' + thisId);
        delete connectionsById[thisId];
    });
    conn.on('error', function() {
        console.log('Connection error: ' + thisId);
        delete connectionsById[thisId];
    });
});

console.log();
console.log('Listening to websocket connections on port ' + port);
console.log();
console.log('\t(Hit Ctrl+C to stop)');
console.log();

server.listen(port);
