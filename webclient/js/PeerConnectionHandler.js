//==============================================================================
// PeerConnectionHandler:
//
// Manages an RTCPeerConnection.
// 
// Initialize with "params", an object holding the parameters.
// 
//      params.peerConnectionConfig
//          configuration options for the RTCPeerConnection
//
//      params.label
//          optional label for the PeerConnectionHandler object,
//          if not provided, it will be automatically generated
//
//      params.totalChannels
//          desired amount of channels for the sender side
//      
//      params.orderedData
//          indicates that packets are sent ordered
//          if omited, default is not ordered
//
//      params.pollingInterval
//          interval for polling the RTCDataChannel's bufferedAmount (milliseconds)
//          if omited, the feature is disabled
//
//      params.chunkSize
//          size of each chunk (bytes)
//
//      params.safetyLimit
//          optional safety limit for the amount of bytes sent (megabytes),
//          if omited, the feature is disabled
// 
//      params.role
//          role of this connection:
//              'transfer': to send chunks of data (default)
//              'pingpong': to send ping-pong messages
// 
// Methods:
//      
//      getParameters()
//          return an object with all configuration parameters
//          they can be used to create a similar PeerConnectionHandler instance
//      
//      getLabel()
//          return the assigned label
//      
//      getRole()
//          return the connection's role
//      
//      initSenderSide()
//          starts creating an SDP Offer for the other peer
//          
//      initReceiverSide(description)
//          get another peer's SDP Offer and starts creating an SDP Answer
//      
//      initPingPongSenderSide()
//          starts a ping-pong connection in the sender side
//      
//      createPingPongChannel()
//          create an exclusive channel for ping-pong messages
//      
//      addIceCandidate(iceCandidate)
//          add an RTCIceCandidate to the RTCPeerConnection
//      
//      setRemoteAnswer(description)
//          set an SDP Answer from the other peer as remote description of the RTCPeerConnection
//      
//      getPingPongChannel()
//          return the exclusive channel for ping-pong messages (if any)
//      
//      getReadyToSendChannels()
//          return a list of channels which are ready to send data (buffered amount is low)
//      
//      getChannels()
//          return a list of channels which are used to send or receive chunks
//      
//      findChannel(label)
//          return the channel with the specific label
//      
//      close()
//          close the RTCPeerConnection
//      
// Events:
// 
//      onLocalOffer(peerConnectionHandler, description)
//          called when the RTCPeerConnection got an SDP Offer to send to the other peer
//      
//      onLocalAnswer(peerConnectionHandler, description)
//          called when the RTCPeerConnection got an SDP Answer to send to the other peer
//      
//      onIceCandidate(peerConnectionHandler, candidate)
//          called when the RTCPeerConnection got a candidate to send to the other peer
//      
//      onMessage(peerConnectionHandler, dataChannelHandler, event)
//          called when any RTCDataChannel receives data from the other peer
//      
//      onOpen(peerConnectionHandler)
//          called when the desired channels are open at the sender side
//
//      onPingPongOpen(peerConnectionHandler)
//          called when the Ping-Pong channel is open at the sender side
//      
//      onClose(peerConnectionHandler)
//          called when the RTCPeerConnection gets closed
//
//      onReadyToSend(peerConnectionHandler)
//          called when any RTCDataChannel is available to send data
//
function PeerConnectionHandler(params) {

    //--------------------------------------------------------------------------
    // Properties initialization

    // Configuration options for the RTCPeerConnection
    var peerConnectionConfig = params.peerConnectionConfig;
    
    // Label for the PeerConnectionHandler
    var connectionLabel = params.label || generateConnectionLabel();

    // Desired amount of channels for the sender side
    var totalChannels = params.totalChannels;

    // Set of all channels used by this connection (except closed channels)
    var channels = {};
    
    // List of open channels (max size = totalChannels) to send or receive data
    var activeChannels = [];

    // Channel used exclusively for ping-pong messages
    var pingPongChannel;

    // Indicates that packets are sent ordered
    // If omited, default is not ordered
    var orderedData = params.orderedData || false;

    // Configuration for the RTCDataChannels created with RTCPeerConnection.createDataChannel()
    var dataChannelConfig = {
        ordered: orderedData
    };

    // Interval for polling the RTCDataChannel's bufferedAmount (milliseconds)
    // If omited, the feature is not used
    var pollingInterval = params.pollingInterval; // Milliseconds

    // Size of each chunk (bytes)
    var chunkSize = params.chunkSize; // Bytes

    // Safety limit for the amount of bytes sent (megabytes)
    // If omited, the feature is not used
    var safetyLimit = params.safetyLimit; // Megabytes

    // Role of this connection:
    //      'transfer': to send chunks of data (default)
    //      'pingpong': to send ping-pong messages
    var role = params.role || 'transfer';

    //--------------------------------------------------------------------------
    // Peer connection initialization

    // The RTCPeerConnection object
    var peerConnection = new RTCPeerConnection(peerConnectionConfig);

    //--------------------------------------------------------------------------
    // Methods

    function generateConnectionLabel() {
        return 'PeerConnection-' + Date.now() + Math.round(performance.now() * 1000) + Math.round(Math.random() * 1000);
    }

    function generateChannelLabel() {
        var dataChannelLabel = 'DataChannel-' + Date.now() + Math.round(performance.now() * 1000) + Math.round(Math.random() * 1000);
        return dataChannelLabel + '@' + connectionLabel;
    }

    var createSenderChannels = function(numChannels) {
        for (var n = 0; n < numChannels; ++n) {
            var dataChannel = peerConnection.createDataChannel(generateChannelLabel(), dataChannelConfig);
            var channel = new DataChannelHandler({
                dataChannel: dataChannel,
                pollingInterval: pollingInterval,
                chunkSize: chunkSize,
                safetyLimit: safetyLimit
            });
            channel.onOpen = onSenderChannelOpenCallback;
            channel.onClose = onSenderChannelCloseCallback;
            channel.onBufferedAmountLow = onBufferedAmountLowCallback;
            if (safetyLimit) {
                channel.onAboveSafetyLimit = onAboveSafetyLimitCallback;
            }
            channels[channel.getLabel()] = channel;
        }
    }.bind(this);

    var gotOffer = function(description) {
        trace('Got local offer for RTCPeerConnection \n' + description.sdp);
        peerConnection.setLocalDescription(description);
        if (this.onLocalOffer) {
            this.onLocalOffer(this, description);
        }
    }.bind(this);

    var gotAnswer = function(description) {
        trace('Got local answer for RTCPeerConnection \n' + description.sdp);
        peerConnection.setLocalDescription(description);
        if (this.onLocalAnswer) {
            this.onLocalAnswer(this, description);
        }
    }.bind(this);

    var iceCandidateCallback = function(event) {
        if (event && event.candidate && this.onIceCandidate) {
            trace('Got an ICE candidate: ' + JSON.stringify(event.candidate));
            this.onIceCandidate(this, event.candidate);
        }
    }.bind(this);
    
    var onIceConnectionStateChangeCallback = function() {
        if (!peerConnection) {
            return;
        }

        var state = peerConnection.iceConnectionState;
        switch (state) {
            case 'failed':
            case 'disconnected':
            case 'closed':
                trace('RTCPeerConnection ' + connectionLabel + ' ICE connection state is ' + state);
                activeChannels = [];
                channels = {};
                if (peerConnection) {
                    peerConnection = null;
                    if (this.onClose) {
                        this.onClose(this);
                    }
                }
                break;
        }
    }.bind(this);
    
    var onSenderChannelCloseCallback = function(channel) {
        trace('Sender data channel (' + channel.getLabel() + ') is closed');

        // Check that the closing was expected
        var unexpected = false;
        activeChannels.forEach(function (ch) {
            if (ch.getLabel() === channel.getLabel()) {
                unexpected = true;
            }
        });
        if (unexpected) {
            // Unexpected channel closing
            // Something went wrong, close the connection
            this.close();
        } else {
            // Remove channel
            delete channels[channel.getLabel()];
            if (Object.keys(channels).length === 0) {
                // All channels closed, close the connection
                if (peerConnection && peerConnection.signalingState !== 'closed') {
                    peerConnection.close();
                }
            }
        }
    }.bind(this);

    var onReceiverChannelCloseCallback = function(channel) {
        trace('Receiver data channel (' + channel.getLabel() + ') is closed');
        
        // Remove channel
        delete channels[channel.getLabel()];
        var n = activeChannels.indexOf(channel);
        if (n > -1) {
            activeChannels.splice(n, 1);
        }
        if (Object.keys(channels).length === 0) {
            // All channels closed, close the connection
            if (peerConnection && peerConnection.signalingState !== 'closed') {
                peerConnection.close();
            }
        }
    }.bind(this);

    var onMessageCallback = function(channel, event) {
        if (this.onMessage) {
            this.onMessage(this, channel, event);
        }
    }.bind(this);
    
    var onBufferedAmountLowCallback = function() {
        if (this.onReadyToSend) {
            this.onReadyToSend(this);
        }
    }.bind(this);

    var onAboveSafetyLimitCallback = function(channel) {
        // Create a channel to replace the one above the safety limit
        createSenderChannels(1);
    }.bind(this);

    var onSenderChannelOpenCallback = function(channel) {
        trace('Sender data channel (' + channel.getLabel() + ') is open');
        channel.onClose = onSenderChannelCloseCallback;
        channel.onMessage = onMessageCallback;
        channels[channel.getLabel()] = channel;
        if (activeChannels.length < totalChannels) {
            // Add new channel until we get the desired amount
            activeChannels.push(channel);
            if (activeChannels.length === totalChannels && this.onOpen) {
                this.onOpen(this);
            }
        } else {
            // Use an existing channel which was marked to be replaced
            for (var n = 0; n < activeChannels.length; ++n) {
                if (activeChannels[n].mustReplace()) {
                    activeChannels[n].close();
                    activeChannels[n] = channel;
                    break;
                }
            }
            if (this.onReadyToSend) {
                this.onReadyToSend(this);
            }
        }
    }.bind(this);

    var onSenderPingPongOpenCallback = function(channel) {
        trace('Sender Ping-Pong data channel (' + channel.getLabel() + ') is open');
        channel.onClose = onSenderChannelCloseCallback;
        channels[channel.getLabel()] = channel;
        if (this.onPingPongOpen) {
            this.onPingPongOpen(this);
        }
    }.bind(this);

    var onReceiverDataChannelOpenCallback = function(event) {
        var channel = new DataChannelHandler({
            dataChannel: event.channel,
            pollingInterval: pollingInterval,
            chunkSize: chunkSize,
            safetyLimit: safetyLimit
        });
        trace('Receiver data channel (' + channel.getLabel() + ') is open');
        channel.onClose = onReceiverChannelCloseCallback;
        channel.onMessage = onMessageCallback;
        channels[channel.getLabel()] = channel;
    }.bind(this);
    
    this.getParameters = function() {
        return {
            peerConnectionConfig: peerConnectionConfig,
            label: this.getLabel(),
            totalChannels: totalChannels,
            orderedData: orderedData,
            pollingInterval: pollingInterval,
            chunkSize: chunkSize,
            safetyLimit: safetyLimit,
            role: role
        };
    }.bind(this);
    
    this.getLabel = function() {
        return connectionLabel;
    }.bind(this);

    this.getRole = function() {
        return role;
    }.bind(this);
    
    this.initSenderSide = function() {
        createSenderChannels(totalChannels);
        peerConnection
                .createOffer()
                .then(gotOffer)
                .catch(function (error) {
                    console.error('Failed to create session description: ' + error.toString());
                });
    }.bind(this);

    this.initReceiverSide = function(description) {
        peerConnection.ondatachannel = onReceiverDataChannelOpenCallback;
        peerConnection.setRemoteDescription(description);
        peerConnection
                .createAnswer()
                .then(gotAnswer)
                .catch(function (error) {
                    console.error('Failed to create session description: ' + error.toString());
                });
    }.bind(this);

    this.initPingPongSenderSide = function() {
        this.createPingPongChannel();
        peerConnection
                .createOffer()
                .then(gotOffer)
                .catch(function (error) {
                    console.error('Failed to create session description: ' + error.toString());
                });
    }.bind(this);

    this.createPingPongChannel = function() {
        var dataChannel = peerConnection.createDataChannel(generateChannelLabel(), dataChannelConfig);
        pingPongChannel = new DataChannelHandler({
            dataChannel: dataChannel,
            chunkSize: chunkSize
        });
        pingPongChannel.onOpen = onSenderPingPongOpenCallback;
        pingPongChannel.onMessage = onMessageCallback;
        trace('Creating channel for ping-pong messages: ' + pingPongChannel.getLabel());
    }.bind(this);

    this.setRemoteAnswer = function(description) {
        peerConnection.setRemoteDescription(description);        
    }.bind(this);
    
    this.addIceCandidate = function(iceCandidate) {
        peerConnection
                .addIceCandidate(iceCandidate)
                .then(function () {
                    //trace('Added ICE candidate.');
                })
                .catch(function (error) {
                    console.error('Failed to add ICE candidate: ' + error.toString());
                });
    }.bind(this);
    
    this.getReadyToSendChannels = function() {
        return activeChannels.filter(function (channel) {
            return channel.isBufferedAmountLow();
        });
    }.bind(this);

    this.getPingPongChannel = function() {
        return pingPongChannel;
    }.bind(this);

    this.getChannels = function() {
        var ch = [];
        Object.keys(channels).forEach(function (key) {
            ch.push(channels[key]);
        });
        return ch;
    }.bind(this);
    
    this.findChannel = function(label) {
        if (pingPongChannel && pingPongChannel.getLabel() === label) {
            return pingPongChannel;
        } else {
            var found;
            Object.keys(channels).forEach(function (key) {
                if (channels[key].getLabel() === label) {
                    found = channels[key];
                }
            });
            return found;
        }
    }.bind(this);
    
    this.close = function() {
        if (pingPongChannel) {
            pingPongChannel.close();
            pingPongChannel = null;
        }
        activeChannels = [];
        Object.keys(channels).forEach(function(label) {
            channels[label].close();
        });
        channels = {};
        if (peerConnection.signalingState !== 'closed') {
            peerConnection.close();
        }
    }.bind(this);

    //--------------------------------------------------------------------------
    // RTCPeerConnection events

    peerConnection.onicecandidate = iceCandidateCallback;
    peerConnection.oniceconnectionstatechange = onIceConnectionStateChangeCallback;
    peerConnection.onicegatheringstatechange = function() {
        if (peerConnection) {
            //trace('ICE gathering state: ' + peerConnection.iceGatheringState);
        }
    };
    peerConnection.onsignalingstatechange = function() {
        if (peerConnection) {
            //trace('Signaling state: ' + peerConnection.signalingState);
        }
    };
}