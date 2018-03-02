/*
 *  Copyright (c) 2018 System73 Europe, SL - All Rights Reserved
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by the license that can be found
 *  in the LICENSE file in the root of the source tree.
 */

'use strict';

//==============================================================================
// Global definitions

// Size of chunks (bytes)
var chunkSize = 16 * 1024; // 16 KBytes

// Threshold for triggering the data channel workaround
var dataChannelWorkaroundThreshold = 512; // Megabytes

// Interval for polling the DataChannel's bufferedAmount (in milliseconds)
// Used only when the DataChannel does NOT support the 'bufferedamountlow' event
var dataChannelPollingInterval = 10; // Milliseconds

// Lower than this will impact performance!!!!
var displayTimerPeriod = 500; // milliseconds

// ICE servers
var peerConnectionConfig = { "iceServers": [ { "urls": "stun:52.214.21.200:3478" } ] };

// Size of the ping-pong message
var pingPongMessageSize = 4; // Bytes

//==============================================================================

// UI items
var uiSsUrl = document.querySelector('input#ssUrl');
var uiConnectToSsButton = document.querySelector('button#connectToSs');
var uiDestNodeId = document.querySelector('input#destNodeId');
var uiMegsToSend = document.querySelector('input#megsToSend');
var uiSimultaneousPeerConnections = document.querySelector('input#numPeerConnections');
var uiDataChannelsPerConnection = document.querySelector('input#numDataChannels');
var uiSendButton = document.querySelector('button#sendTheData');
//var uiOrderedCheckbox = document.querySelector('input#ordered');
//var uiWorkaroundCheckbox = document.querySelector('input#datachannelWorkaround');
var uiSendProgressBar = document.querySelector('progress#sendProgressBar');
var uiSendProgressMessage = document.querySelector('input#sendProgressMessage');
var uiReceiveProgressBar = document.querySelector('progress#receiveProgressBar');
var uiReceiveProgressMessage = document.querySelector('input#receiveProgressMessage');
var uiErrorMessage = document.querySelector('div#errorMsg');
var uiSsResultMessage = document.querySelector('div#ssResultMsg');
var uiPingPongCheckbox = document.querySelector('input#pingPongEnable');
var uiPingPongShareOptions = document.getElementsByName('pingPongShare');
var uiPingPongSendPeriod = document.querySelector('input#pingPongSendPeriod');
var uiPingPongMetricsPeriod = document.querySelector('input#pingPongMetricsPeriod');

uiSendButton.onclick = createSendingConnections;
uiConnectToSsButton.onclick = connectToSs;

// Other globals
var localNodeId;
var remoteNodeId;
var signalServerWs;
var connections = {};
var activeConnections = [];
var pingPongConnectionLabel;
var pingPongChannelLabel;
var sentSize = 0;
var receivedSize = 0;
var bytesToSend = 0;
var startTime = 0;
var totalConnections = 1;
var channelsPerConnection = 1;
var pingPongEnabled = false;
var pingPongDedicatedConnection = false;
var pingPongDedicatedChannel = false;
var pingPongSendingPeriod = 500; // Milliseconds
var pingPongMetricsPeriod = 1000; // Milliseconds

var pingPongSendTimer;
var metricsManager;
var displayTimer;

var chunkIdToSend = 0;
var totalExpectedChunks;
var receivedChunks = [];

var sendDataBurst;

//==============================================================================

function disableUI(items, disabled) {
    items.forEach(function (item) {
        item.disabled = disabled;
    });
}

function lockSignalServerUI(enabled) {
    enabled = !!enabled;

    var objs = [
        uiSsUrl,
        uiConnectToSsButton
    ];
    disableUI(objs, !enabled);
}

function lockDataTransferUI(enabled) {
    enabled = !!enabled;
    
    var objs = [
        uiDestNodeId,
        uiSendButton,
        uiMegsToSend,
//        uiOrderedCheckbox,
//        uiWorkaroundCheckbox,
        uiSimultaneousPeerConnections,
        uiDataChannelsPerConnection,
        uiPingPongCheckbox,
        uiPingPongShareOptions[0],
        uiPingPongShareOptions[1],
        uiPingPongShareOptions[2],
        uiPingPongSendPeriod,
        uiPingPongMetricsPeriod
    ];
    disableUI(objs, !enabled);
    if (enabled) {
        checkUIDependentLocks();
    }
}

function unlockDataTransferUI() {
    lockDataTransferUI(true);
}

function checkUIDependentLocks() {
    uiSendButton.disabled = !uiDestNodeId.value || !uiMegsToSend.value || parseInt(uiMegsToSend.value) <= 0;
    disableUI(uiPingPongShareOptions, !uiPingPongCheckbox.checked);
    uiPingPongSendPeriod.disabled = !uiPingPongCheckbox.checked;
    uiPingPongMetricsPeriod.disabled = !uiPingPongCheckbox.checked;
}

function displaySenderProgress(forced) {
    function doDisplay() {
        if (forced || displayTimer) {
            displayTimer = null;
            uiSendProgressBar.value = sentSize;
            var mbytes = Math.round(sentSize / 1024 / 1024 * 1e1) / 1e1;
            uiSendProgressMessage.value = 'ok ' + mbytes + ' Mb';
        }
    }
    
    if (forced) {
        displayTimer = null;
        doDisplay();
    } else if (!displayTimer) {
        displayTimer = setTimeout(doDisplay, displayTimerPeriod);
    }
}

function displayReceiverProgress(forced) {
    function doDisplay() {
        if (forced || displayTimer) {
            displayTimer = null;
            var totalTime = performance.now() - startTime;
            var downloadSpeed = receivedSize / 1024 / 1024 / (totalTime / 1000);
            var secs = Math.round(totalTime / 1000 * 1e1) / 1e1;
            var mbps = Math.round(downloadSpeed * 1e3) / 1e3;
            var mbytes = Math.round(receivedSize / 1024 / 1024 * 1e1) / 1e1;
            uiReceiveProgressBar.value = receivedSize;
            uiReceiveProgressMessage.value = 'Time ' + secs + ' s @ ' + mbps + ' Mb/s';
        }
    }

    if (forced) {
        displayTimer = null;
        doDisplay();
    } else if (!displayTimer) {
        displayTimer = setTimeout(doDisplay, displayTimerPeriod);
    }
}

uiDestNodeId.addEventListener('input', function () {
    if (this.value) {
        checkUIDependentLocks();
    } else {
        uiSendButton.disabled = true;
    }
});

uiMegsToSend.addEventListener('change', function () {
    if (this.value <= 0) {
        uiErrorMessage.innerHTML = '<div class="warning">Please enter a number greater than zero.</div>';
        uiSendButton.disabled = true;
    } else {
        uiErrorMessage.innerHTML = '';
        checkUIDependentLocks();
    }
});

uiPingPongCheckbox.addEventListener('change', function () {
    if (this.checked) {
        checkUIDependentLocks();
    } else {
        disableUI(uiPingPongShareOptions, true);
        uiPingPongSendPeriod.disabled = true;
        uiPingPongMetricsPeriod.disabled = true;
    }
});

checkUIDependentLocks();

//==============================================================================

function connectToSs() {
    trace('Connect to Signal Server');
    lockDataTransferUI();
    uiSsResultMessage.innerHTML = '';
    if (signalServerWs) {
        signalServerWs.close();
    }
    signalServerWs = new WebSocket(uiSsUrl.value);
    signalServerWs.onopen = function () {
        trace('WS is open!!!!');
        uiSsResultMessage.innerHTML = '<p>Connected to the Signal Server!</p>';
        lockSignalServerUI();
    };
    signalServerWs.onerror = function () {
        trace('WS error!!!!');
        uiSsResultMessage.innerHTML = '<div class="warning">Error connecting to the Signal Server.</div>';
        lockDataTransferUI();
    };
    signalServerWs.onclose = function () {
        trace('WS is closed!!!!');
    };
    signalServerWs.onmessage = function (e) {
        trace('WS received');
        trace(e.data);
        processMessageFromSs(e.data);
    };
}

function processMessageFromSs(message) {
    message = JSON.parse(message);
    switch (message.type) {
        case 'joinResponse':
            localNodeId = message.id;
            uiSsResultMessage.innerHTML = '<p>Connected to the Signal Server!</p><p>This Node ID = <b>' + message.id + '</b></p>';
            unlockDataTransferUI();
            break;
        case 'sdpOffer':
            switch (message.connection.role) {
                case 'transfer':
                    uiSendProgressBar.value = 0;
                    uiSendProgressMessage.value = '';
                    uiReceiveProgressBar.value = 0;
                    uiReceiveProgressMessage.value = 'Receiving...';
                    receivedSize = 0;
                    break;
            }

            remoteNodeId = message.from;
            bytesToSend = message.setup.transfer.bytesToSend;
            totalExpectedChunks = message.setup.transfer.chunksToSend;
            receivedChunks = new Array(totalExpectedChunks);
            receivedChunks.fill(false);
            displayTimer = null;
            uiSendProgressBar.max = bytesToSend;
            uiReceiveProgressBar.max = uiSendProgressBar.max;
            uiMegsToSend.value = bytesToSend / 1024 / 1024;
            totalConnections = message.setup.transfer.peerConnections;
            channelsPerConnection = message.setup.transfer.dataChannels;
            uiSimultaneousPeerConnections.value = totalConnections;
            uiDataChannelsPerConnection.value = channelsPerConnection;
//            uiWorkaroundCheckbox.checked = message.setup.transfer.enableDataChannelWorkaround;
//            uiOrderedCheckbox.checked = message.setup.transfer.orderedData;
            pingPongEnabled = message.setup.pingPong.enabled;
            uiPingPongCheckbox.checked = pingPongEnabled;
            pingPongDedicatedConnection = message.setup.pingPong.dedicatedConnection;
            pingPongDedicatedChannel = message.setup.pingPong.dedicatedChannel;
            var selected;
            if (pingPongDedicatedConnection && pingPongDedicatedChannel) {
                selected = 'connection-dedicated-channel-dedicated';
            } else if (!pingPongDedicatedConnection && pingPongDedicatedChannel) {
                selected = 'connection-share-channel-dedicated';
            } else if (!pingPongDedicatedConnection && !pingPongDedicatedChannel) {
                selected = 'connection-share-channel-share';
            }
            uiPingPongShareOptions.forEach(function(x) {
                if (x.value === selected) {
                    x.checked = true;
                }
            });
            pingPongSendingPeriod = message.setup.pingPong.sendingPeriod;
            uiPingPongSendPeriod.value = pingPongSendingPeriod;
            pingPongMetricsPeriod = message.setup.pingPong.metricsPeriod;
            uiPingPongMetricsPeriod.value = pingPongMetricsPeriod;
            lockDataTransferUI();

            var connection = new PeerConnectionHandler(message.connection);
            connection.onLocalAnswer = sendSdpAnswer;
            connection.onIceCandidate = sendIceCandidate;
            connection.onOpen = onReceiverConnectionOpened;
            connection.onMessage = onReceiverGotMessage;
            connection.onClose = onConnectionClosed;
            connection.initReceiverSide(message.description);
            connections[connection.getLabel()] = connection;
            break;
        case 'sdpAnswer':
            lockDataTransferUI();
            trace(message.description);
            connections[message.connection.label].setRemoteAnswer(message.description);
            break;
        case 'iceCandidate':
            lockDataTransferUI();
            var iceCandidate = new RTCIceCandidate(message.candidate);
            connections[message.connection.label].addIceCandidate(iceCandidate);
            trace('ICE candidate:');
            trace(iceCandidate);
            break;
        case 'pingPongSetup':
            lockDataTransferUI();
            trace('Ping-Pong setup:');
            trace(message);
            pingPongConnectionLabel = message.connection.label;
            pingPongChannelLabel = message.connection.channel ? message.connection.channel.label : null;
            if (pingPongConnectionLabel) {
                trace('Ping-Pong connection label: ' + pingPongConnectionLabel);
            }
            if (pingPongChannelLabel) {
                trace('Ping-Pong channel label: ' + pingPongChannelLabel);
            }
            break;
    }
}

function createSendingConnections() {
    var sz = uiMegsToSend.value * 1024 * 1024;
    if (sz <= 0) {
        return;
    }
    var id = uiDestNodeId.value;
    if (!id) {
        return;
    }
    lockSignalServerUI();
    lockDataTransferUI();
    totalConnections = uiSimultaneousPeerConnections.value * 1;
    channelsPerConnection = uiDataChannelsPerConnection.value * 1;
    bytesToSend = sz;
    remoteNodeId = id;
    pingPongEnabled = uiPingPongCheckbox.checked;
    var selected;
    uiPingPongShareOptions.forEach(function(x) {
        if (x.checked) {
            selected = x.value;
        }
    });
    switch (selected) {
        case 'connection-share-channel-share':
            pingPongDedicatedConnection = false;
            pingPongDedicatedChannel = false;
            break;
        case 'connection-share-channel-dedicated':
            pingPongDedicatedConnection = false;
            pingPongDedicatedChannel = true;
            break;
        case 'connection-dedicated-channel-dedicated':
            pingPongDedicatedConnection = true;
            pingPongDedicatedChannel = true;
            break;
    }
    pingPongSendingPeriod = uiPingPongSendPeriod.value * 1;
    pingPongMetricsPeriod = uiPingPongMetricsPeriod.value * 1;
    trace('Creating ' + totalConnections + ' sending connections...');
    connections = {};
    activeConnections = [];
    for (var n = 0; n < totalConnections; ++n) {
        var connection = new PeerConnectionHandler({
            peerConnectionConfig: peerConnectionConfig,
            totalChannels: channelsPerConnection,
            orderedData: false,
            pollingInterval: dataChannelPollingInterval,
            chunkSize: chunkSize,
            safetyLimit: null
        });
        trace('Creating sending connection: ' + connection.getLabel());
        connection.onLocalOffer = sendSdpOffer;
        connection.onIceCandidate = sendIceCandidate;
        connection.onOpen = onSenderConnectionOpened;
        connection.onClose = onConnectionClosed;
        connection.onMessage = onSenderGotMessage;
        connection.initSenderSide();
        connections[connection.getLabel()] = connection;
    }
}

function createPingPongConnection() {
    var connection = new PeerConnectionHandler({
        peerConnectionConfig: peerConnectionConfig,
        chunkSize: chunkSize,
        role: 'pingpong'
    });
    trace('Creating ping-pong connection: ' + connection.getLabel());
    connection.onLocalOffer = sendSdpOffer;
    connection.onIceCandidate = sendIceCandidate;
    connection.onMessage = onSenderGotMessage;
    connection.onPingPongOpen = onSenderPingPongReady;
    connection.initPingPongSenderSide();
    connections[connection.getLabel()] = connection;
    pingPongConnectionLabel = connection.getLabel();
    pingPongChannelLabel = connection.getPingPongChannel().getLabel();
}

function createPingPongChannel() {
    var connection = activeConnections[0];
    trace('Using existing connection for ping-pong: ' + connection.getLabel());
    connection.onMessage = onSenderGotMessage;
    connection.onPingPongOpen = onSenderPingPongReady;
    connection.createPingPongChannel();
    pingPongConnectionLabel = connection.getLabel();
    pingPongChannelLabel = connection.getPingPongChannel().getLabel();
}

function randomAsciiString(length) {
    var result = '';
    for (var i = 0; i < length; i++) {
        // Visible ASCII chars are between 33 and 126.
        result += String.fromCharCode(33 + Math.random() * 93);
    }
    return result;
}

function generateRandomChunkData(length) {
    var arrayBuffer = new ArrayBuffer(length);
    var dataView = new DataView(arrayBuffer);
    
    for (var offset = 0; offset < length; ++offset) {
        dataView.setUint8(offset, Math.floor(Math.random() * 256));
    }
    
    return {
        arrayBuffer: arrayBuffer,
        dataView: dataView
    };
}

function resumeSendingGeneratedData() {
    activeConnections.forEach(function (connection) {
        connection.onReadyToSend = sendDataBurst;
    });
    setTimeout(sendDataBurst);
}

function startSendingGeneratedData() {
    trace('Start sending data to receiver');
    
    chunkIdToSend = 0;
    sentSize = 0;
    displayTimer = null;
    uiSendProgressBar.max = bytesToSend;
    uiReceiveProgressBar.max = uiSendProgressBar.max;
    uiSendProgressBar.value = 0;
    uiSendProgressMessage.value = 'Sending...';
    uiReceiveProgressBar.value = 0;
    uiReceiveProgressMessage.value = '';

    var stringToSendRepeatedly = randomAsciiString(chunkSize);
    var chunk = generateRandomChunkData(chunkSize);
    var messageToSendRepeatedly = chunk.arrayBuffer;
    var messageDataView = chunk.dataView;

    sendDataBurst = function() {
        try {
            if (sentSize >= bytesToSend) {
                // We already finished in another burst
                return;
            }
            
            // Try to queue up a bunch of data and back off when the channel starts to
            // fill up. We don't setTimeout after each send since this lowers our
            // throughput quite a bit (setTimeout(fn, 0) can take hundreds of milli-
            // seconds to execute).
            while (sentSize < bytesToSend) {
                // Find ready-to-send channels
                var couldSend = false;
                activeConnections.forEach(function (connection) {
                    var channels = connection.getReadyToSendChannels();
                    channels.forEach(function (channel) {
                        if (sentSize < bytesToSend) {
                            couldSend = true;
                            messageDataView.setUint32(0, chunkIdToSend);
                            ++chunkIdToSend;
                            channel.send(messageToSendRepeatedly);
                            sentSize += chunkSize;
                        }
                    });
                });
                if (!couldSend) {
                    // No ready-to-send channels this time, wait for any
                    break;
                }
            }
            
            if (sentSize >= bytesToSend) {
                // We just finished in this burst
                trace('Finished sending data');
                displaySenderProgress(true);
                console.debug('Total chunks sent: ' + chunkIdToSend);
                unlockDataTransferUI();
                return;
            }
        } catch(error) {
            console.error(error);
        }
    };
    
    resumeSendingGeneratedData();
}

function sendSdpOffer(connection, description) {
    trace('Sending offer to SS');
    var message = {
        type: 'sdpOffer',
        from: localNodeId,
        to: remoteNodeId,
        connection: connection.getParameters(),
        description: description,
        setup: {
            transfer: {
                bytesToSend: bytesToSend,
                chunksToSend: Math.ceil(bytesToSend / chunkSize),
                peerConnections: totalConnections,
                dataChannels: channelsPerConnection,
                enableDataChannelWorkaround: false,
                orderedData: false
            },
            pingPong: {
                enabled: pingPongEnabled,
                dedicatedConnection: pingPongDedicatedConnection,
                dedicatedChannel: pingPongDedicatedChannel,
                sendingPeriod: pingPongSendingPeriod,
                metricsPeriod: pingPongMetricsPeriod
            }
        }
    };
    signalServerWs.send(JSON.stringify(message));
}

function sendSdpAnswer(connection, description) {
    trace('Sending answer to SS');
    var message = {
        type: 'sdpAnswer',
        from: localNodeId,
        to: remoteNodeId,
        connection: {
            label: connection.getLabel()
        },
        description: description
    };
    signalServerWs.send(JSON.stringify(message));
}

function sendIceCandidate(connection, candidate) {
    trace('Sending ICE candidate to SS');
    trace(candidate);

    var message = {
        type: 'iceCandidate',
        from: localNodeId,
        to: remoteNodeId,
        connection: {
            label: connection.getLabel()
        },
        candidate: candidate
    };
    signalServerWs.send(JSON.stringify(message));
}

function sendPingPongSetupMessage() {
    trace('Sending Ping-Pong setup to SS');

    var message = {
        type: 'pingPongSetup',
        from: localNodeId,
        to: remoteNodeId,
        enabled: pingPongEnabled,
        dedicatedConnection: pingPongDedicatedConnection,
        dedicatedChannel: pingPongDedicatedChannel,
        connection: {
            label: pingPongConnectionLabel,
            channel: {
                label: pingPongChannelLabel
            }
        }
    };
    signalServerWs.send(JSON.stringify(message));
}

function setupPingPongSenderSide() {
    pingPongConnectionLabel = null;
    if (pingPongEnabled) {
        // Setup a ping-pong connection
        if (pingPongDedicatedConnection) {
            // Create a dedicated connection
            createPingPongConnection();
        } else if (pingPongDedicatedChannel) {
            // Create a dedicated channel inside an existing connection
            createPingPongChannel();
        } else {
            // Share a connection and channel with chunks
            setTimeout(onSenderPingPongReady);
        }
    } else {
        // No need to setup the Ping-Pong
        setTimeout(startSendingGeneratedData);
    }
}

function onSenderGotMessage(connection, channel, event) {
    var id = getPingPongIdFromMessage(event.data);
    //trace('Ping received: ' + id);
    sendPingPongMessage(id);
}

function onReceiverGotMessage(connection, channel, event) {
    function endReception() {
        trace('Finished receiving data');
        var totalTime = performance.now() - startTime; // time to receive the message in milliseconds
        console.debug('Download time = ' + (totalTime / 1000) + ' s');
        console.debug('Download speed = ' + receivedSize / 1024 / 1024 / (totalTime / 1000) + ' MB/s');
        displayReceiverProgress(true);
        var totalReceivedChunks = 0;
        for (var n = 0; n < totalExpectedChunks; ++n) {
            if (receivedChunks[n]) {
                ++totalReceivedChunks;
            } else {
                console.error('\tmissing chunk ID: ' + n);
            }
        }
        console.debug('Total chunks received: ' + totalReceivedChunks + ' / ' + totalExpectedChunks);
        closeConnections();
    }
    
    function startReception() {
        trace('Start receiving data');
        uiReceiveProgressMessage.Value = 'Receiving...';
        receivedChunks = [];
        startTime = performance.now();
        if (pingPongEnabled && !isSendingPingPong()) {
            startSendingPingPong();
        }
    }
    
    var length = /*event.data.length !== undefined ? event.data.length :*/ event.data.byteLength;

    if (length === chunkSize) {
        // We got a chunk

        if (receivedSize === 0) {
            startReception();
        }

        receivedSize += length;
        var dataView = new DataView(event.data);
        var id = dataView.getUint32(0);
        receivedChunks[id] = true;

        if (receivedSize >= bytesToSend) {
            endReception();
        }
    } else {
        // We got a pong
        
        if (metricsManager) {
            var id = getPingPongIdFromMessage(event.data);
            //trace('Pong received: ' + id);
            metricsManager.pongReceived(id);
        }
    }
}

function onSenderPingPongReady() {
    trace('Sender Ping-Pong is ready');
    sendPingPongSetupMessage();
    startSendingGeneratedData();
}

function onAllSendingConnectionsOpened() {
    setupPingPongSenderSide();
}

function closeConnections() {
    trace('Closing connections');
    stopSendingPingPong();
    if (pingPongConnectionLabel) {
        pingPongConnectionLabel = null;
    }
    if (pingPongChannelLabel) {
        pingPongChannelLabel = null;
    }
    activeConnections = [];
    Object.keys(connections).forEach(function (label) {
        connections[label].onMessage = null;
        connections[label].close();
    });
}

function onSenderConnectionOpened(connection) {
    trace('Peer connection opened: ' + connection.getLabel());
    if (activeConnections.indexOf(connection) === -1) {
        activeConnections.push(connection);
        trace(activeConnections.slice());
        if (activeConnections.length === totalConnections) {
            onAllSendingConnectionsOpened();
        }
    }
}

function onReceiverConnectionOpened(connection) {
    trace('Peer connection opened: ' + connection.getLabel());
    activeConnections.push(connection);
}

function onConnectionClosed(connection) {
    trace('Peer connection closed: ' + connection.getLabel());
    for (var n = 0; n < activeConnections.length; ++n) {
        if (activeConnections[n].getLabel() === connection.getLabel()) {
            activeConnections.splice(n);
            break;
        }
    }
    delete connections[connection.getLabel()];
    if (Object.keys(connections).length === 0) {
        unlockDataTransferUI();
    }
}

var pingPongMessage = 0;

function getPingPongMessageFromId(id) {
    var message = new ArrayBuffer(pingPongMessageSize);
    var data = new DataView(message);
    data.setUint32(0, parseInt(id));
    return message;
}

function getPingPongIdFromMessage(message) {
    var data = new DataView(message);
    return data.getUint32(0);
}

function sendPingPongMessage(id) {
    // Format the message data
    var message = getPingPongMessageFromId(id);
    
    // Find a channel to send the message
    var destChannel;
    if (pingPongConnectionLabel) {
        // Use a specific connection
        var connection = connections[pingPongConnectionLabel];
        if (connection) {
            if (pingPongChannelLabel) {
                // Use a specific channel
                var channel = connection.findChannel(pingPongChannelLabel);
                if (channel) {
                    destChannel = channel;
                }
            } else {
                // Use any regular data channel
                var ch = connection.getChannels();
                if (ch.length > 0) {
                    destChannel = ch[Math.floor(Math.random() * ch.length)];
                }
            }
        }
    } else {
        // Use any regular connection & channel
        var keys = Object.keys(connections);
        var key = keys[Math.floor(Math.random() * keys.length)];
        if (key) {
            var ch = connections[key].getChannels();
            if (ch.length > 0) {
                destChannel = ch[Math.floor(Math.random() * ch.length)];
            } else {
                console.error('connection had no data channels to send ping-pong messages');
            }
        } else {
            console.error('no connection was found to send ping-pong messages');
        }
    }
    if (destChannel) {
        destChannel.send(message);
    } else {
        console.error('no data channel was found to send ping-pong messages');
    }
}

function isSendingPingPong() {
    return !!pingPongSendTimer;
}

function startSendingPingPong() {
    pingPongMessage = 0;
    pingPongSendTimer = setInterval(function() {
        if (metricsManager) {
            metricsManager.pingSent(pingPongMessage);
        }
        sendPingPongMessage(pingPongMessage++);
    }, pingPongSendingPeriod);
    if (metricsManager) {
        metricsManager.stop();
        metricsManager = null;
    }
    metricsManager = new RTTMetricsManager({
        sendingPeriod: pingPongSendingPeriod,
        reportingPeriod: pingPongMetricsPeriod
    });
    metricsManager.onMetrics = onReportedMetrics;
    metricsManager.start();
}

function stopSendingPingPong() {
    if (isSendingPingPong()) {
        clearInterval(pingPongSendTimer);
        pingPongSendTimer = null;
    }
    if (metricsManager) {
        metricsManager.stop();
        var out = 'Final stats from raw samples: (units = ms)\n';
        var stats = metricsManager.calculateFinalStats();
        Object.keys(stats).forEach(function (keyStats) {
            out += '\t' + keyStats + ':\n';
            if (stats[keyStats]) {
                Object.keys(stats[keyStats]).forEach(function (key) {
                    out += '\t\t' + key + ': ' + stats[keyStats][key] + '\n';
                });
            } else {
                out += '\t\tno data\n';
            }
        });
        console.debug(out);
        metricsManager = null;
    }
}

function onReportedMetrics(obj, metrics) {
    if (metrics) {
        trace('Mean RTT: ' + metrics.meanRTT + ' ms');
    } else {
        trace('Mean RTT: no data');
    }
}
