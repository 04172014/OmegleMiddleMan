var Omegle = require('./omegle.js').Omegle;
var express = require('express');
var app = express();

app.use(express.static(__dirname + '/static'));

var http = require('http');
var https = require('https');
var httpServer = http.Server(app);
var io = require('socket.io')(httpServer);

var Cleverbot = require('./cleverbot.js');

app.get('/', function(req, res) {
    res.sendFile(__dirname+'/static/index.htm');
});

// Handle connections
io.on('connection', function(socket) {
    // List of omegle clients for this person
    var omegleClients = {};

    // List of clever bot clients
    var cleverClients = {};

    // Stores challenge omegle clients
    var challenges = {};

    var requiredConnections = [];
    var buildingConnection = false;
    var currentPain = null;
    function buildConnections() {
        // Any connections required?
        if(!buildingConnection && requiredConnections.length > 0) {
            // Stop multiple from happening
            buildingConnection = true;
            var args = requiredConnections.shift();

            // Store the current pain
            currentPain = args.painID;

            // Make a connection
            makeConnection(args, false);
        }
    }

    // Makes the actual connection
    function makeConnection(args, reconnect) {
        // Create the new omegle instance
        var om = new Omegle(args);

        // Store the args
        om.args = args;

        // A store for the clientID
        var realClientID;

        // Handle errors
        om.errorHandler(function(msg) {
            socket.emit('omegleError', args, msg);
        });

        om.on('newid', function(client_id) {
            // Store the client
            omegleClients[client_id] = om;

            // Send this ID to the user
            socket.emit('newOmegle', client_id, args);

            // Store client ID
            realClientID = client_id;
        });

        // Omegle has banned us
        om.on('antinudeBanned', function() {
            if(!reconnect) {
                // No longer building a connection
                buildingConnection = false;

                // Move on
                buildConnections();
            }

            // Send this ID to the user
            socket.emit('omegleBanned', args);
        });

        // There was an error
        om.on('error', function(err) {
            // Send this ID to the user
            socket.emit('omegleError', args, err);
        });

        // Omegle is finding a partner
        om.on('waiting', function() {
            // Tell the client
            socket.emit('omegleWaiting', realClientID);
        });

        // Omegle found us a partner
        om.on('connected', function(peerID) {
            // Tell the client
            socket.emit('omegleConnected', realClientID, peerID);

            // Make sure we're not reconnecting
            if(!reconnect) {
                // Give a brief delay before making a new connection
                setTimeout(function() {
                    // No current pain
                    currentPain = null;

                    // No longer building the connection
                    buildingConnection = false;

                    // Try to build any remaining connections
                    buildConnections();
                }, 100);
            }

        });

        // Omegle is telling us our common likes
        om.on('commonLikes', function(commonLikes) {
            // Tell the client
            socket.emit('omegleCommonLikes', realClientID, commonLikes);
        });

        // Omegle is sending us status info
        om.on('statusInfo', function(statusInfo) {
            // Tell the client
            socket.emit('omegleStatusInfo', statusInfo);
        });

        // Omegle is telling us our partner's college
        om.on('partnerCollege', function(college) {
            // Tell the client
            socket.emit('omeglePartnerCollege', realClientID, college);
        });

        // Omegle sent us a question
        om.on('question', function(question) {
            // Tell the client
            socket.emit('omegleQuestion', realClientID, question);
        });

        // Handle the capcha
        function handleCaptcha(code) {
            // Use the new captcha method
            socket.emit('omegleNewChallenge', args, code);

            // Don't run the old method
            return;

            // URL with challenge data
            var toFetch = 'https://www.google.com/recaptcha/api/challenge?k='+code+'&cahcestop='+Math.random();

            https.get(toFetch, function(res) {
                // Ensure the request worked
                if (res.statusCode !== 200) {
                    socket.emit('omegleError', args, 'Captcha failed.');
                    return;
                }

                // Process the event
                om.getAllData(res, function(data) {
                        // Make sure we got some data
                        if(data != null) {
                            // Copy important data
                            var a = data.indexOf('\'')+1;
                            var b = data.indexOf('\'', a)-1;

                            // Grab the challenge
                            var challenge = data.substring(a, b+1);

                            // Store it
                            challenges[challenge] = om;

                            // Send to client to solve
                            socket.emit('omegleChallenge', args, code, challenge);
                        } else {
                            // Failure
                            socket.emit('omegleError', args, 'Capcha, no data passed!');
                        }
                    });
                }).on('error', function(e) {
                    // Send to client
                    socket.emit('omegleError', args, 'Got capcha error: ' + e.message);
                });
            }

            // Recaptcha
            om.on('recaptchaRejected', handleCaptcha);
            om.on('recaptchaRequired', handleCaptcha);

            // Stranger has disconnected
            om.on('strangerDisconnected', function() {
                // Tell client
                socket.emit('omegleStrangerDisconnected', realClientID);
            });

            // A spy disconnected
            om.on('spyDisconnected', function(spy) {
                // Tell client
                socket.emit('omegleSpyDisconnected', realClientID, spy);
            });

            // Stranger sent us a message
            om.on('gotMessage', function(msg) {
                // Tell client
                socket.emit('omegleGotMessage', realClientID, msg);
            });

            // Got a spy message
            om.on('spyMessage', function(spy, msg) {
                // Tell client
                socket.emit('omegleSpyMessage', realClientID, spy, msg);
            });

            // We have disconnected
            om.on('disconnected', function() {
                // Tell client
                socket.emit('omegleDisconnected', realClientID);
            });

            // Stranger started typing
            om.on('typing', function() {
                // Tell client
                socket.emit('omegleTyping', realClientID);
            });

            // Stranger stopped typing
            om.on('stoppedTyping', function() {
                // Tell client
                socket.emit('omegleStoppedTyping', realClientID);
            });

            // Are we doing a reconnect?
            if(reconnect) {
                // Reconnect to a client
                om.reconnect(function(err) {
                    if (err) {
                        // Send to client
                        socket.emit('omegleError', args, 'Error reconnecting: ' + err);
                    }
                });
            } else {
                // Connect to a client
                om.start(function(err) {
                    if (err) {
                        // Send to client
                        socket.emit('omegleError', args, 'Error starting: ' + err);
                    }
                });
            }
    }

    // Creates a new connection
    function setupNewConnection(args) {
        // Ensure we have args
        if(args == null) args = {};

        // Another connection is required
        requiredConnections.push(args);

        // Set the connection up
        buildConnections();
    }

    // Client wants to fix broken search
    socket.on('omegleUnlock', function() {
        // No longer building the connection
        buildingConnection = false;

        // Try to build any remaining connections
        buildConnections();
    });

    // Cleanup a client when they disconnect
    socket.on('disconnect', function(){
        for(var key in omegleClients) {
            // Remove reference to it
            delete omegleClients[key];
        }

        for(var key in cleverClients) {
            if(cleverClients[key] != null) {
                delete cleverClients[key];
            }
        }
    });

    // Client wants us to disconnect a stranger
    socket.on('omegleDisconnect', function(client_id, painID) {
        // Check if the client even exists
        if(omegleClients[client_id] != null) {
            // Disconnect it
            omegleClients[client_id].disconnect();

            // Delete it
            omegleClients[client_id] = null;
        }

        // Remove any queued requests for this painID
        for(var i=0;i<requiredConnections.length;i++) {
            // Strip the solutions
            if(requiredConnections[i].painID == painID) {
                requiredConnections.splice(i--, 1);
            }
        }

        // Are we dealing with a pain at the moment?
        if(currentPain == painID) {
            // No current pain anymore
            currentPain = null;

            // No longer building the connection
            buildingConnection = false;

            // Try to build any remaining connections
            buildConnections();
        }
    });

    // Client wants to send a message to a stranger
    socket.on('omegleSend', function(client_id, msg) {
        var om = omegleClients[client_id];

        // Check if the client even exists
        if(om) {
            // Send the message
            om.send(msg, function(err) {
                if (err) {
                    // Send to client
                    socket.emit('omegleError', om.args, 'Error sending: ' + err);
                }
            });
        }
    });

    // Client is trying to answer a captcha
    socket.on('omegleChallenge', function(code, challenge, answer) {
        var om = challenges[challenge];

        if(om != null) {
            om.recaptcha(challenge, answer);
        }
    });

    // Client started typing
    socket.on('omegleTyping', function(client_id) {
        var om = omegleClients[client_id];

        // Check if the client even exists
        if(om) {
            // Send the message
            om.startTyping(function(err) {
                if(err) {
                    // Send to client
                    socket.emit('omegleError', om.args, 'Error typing: ' + err);
                }
            });
        }
    });

    // Client stopped typing
    socket.on('omegleStopTyping', function(client_id) {
        var om = omegleClients[client_id];

        // Check if the client even exists
        if(om) {
            // Send the message
            om.stopTyping(function(err) {
                if(err) {
                    // Send to client
                    socket.emit('omegleError', om.args, 'Error stopping typing: ' + err);
                }
            });
        }
    });

    // Client is asking for a new omegle client
    socket.on('newOmegle', function(args){
        // Setup a new connection
        setupNewConnection(args);
    });

    // Reconnects a client
    socket.on('reconnectOmegle', function(args) {
        // Attempt to reconnect
        makeConnection(args, true);
    });

    // Client is asking for a new clever client
    socket.on('newClever', function(args){
        // Find the first free clientID
        var i = 0;
        while(cleverClients['clever'+(++i)] != null) {};

        // Create the bot
        cleverClients['clever'+i] = new Cleverbot();

        // Forward the handler to them
        socket.emit('newClever', 'clever'+i, args);
    });

    // Send a message to clever bot
    socket.on('cleverSend', function(client_id, msg){
        // Check if the client even exists
        if(cleverClients[client_id]) {
            // Send the message
            cleverClients[client_id].write(msg, function(resp) {
                // Forward message to our client
                socket.emit('cleverGotMessage', client_id, resp['message']);
            });
        }
    });
});

var omeglePortNumber = 3000;
httpServer.listen(omeglePortNumber, function() {
    console.log('listening on *:'+omeglePortNumber);
});
