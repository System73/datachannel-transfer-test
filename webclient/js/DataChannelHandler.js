/**
 * Copyright (C) System73 Europe, SL - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 * 2018 - present
 */

//==============================================================================
// DataChannelHandler:
//
// Manages an RTCDataChannel.
// 
// Initialize with "params", an object holding the parameters.
//
//      params.dataChannel
//          a recently created RTCDataChannel object,
//          either from RTCPeerConnection.createDataChannel()
//          or an RTCPeerConnection.ondatachannel() event
//      
//      params.pollingInterval
//          interval for polling the RTCDataChannel's bufferedAmount (milliseconds)
//          if omited, default is 500 milliseconds
//      
//      params.chunkSize
//          size of each chunk (bytes)
//      
//      params.safetyLimit
//          safety limit for the amount of bytes sent (megabytes)
//          if omited, the feature is disabled
//
// Methods:
// 
//      getLabel()
//          return the RTCDataChannel assigned label
//
//      getBufferedAmount()
//          return the current buffered amount of the RTCDataChannel
//
//      getBufferFullThreshold()
//          return the value of the buffer full threshold
//
//      isBufferedAmountLow()
//          return whether the buffered amount of the RTCDataChannel is low
//
//      isOverSafetyLimit()
//          return whether the bytesSent are above the safety limit
//
//      send(data)
//          send data through the RTCDataChannel, updating bytesSent
//
//      close()
//          close the RTCDataChannel
//
//      mustReplace()
//          return whether the channel is marked to be replaced
//
// Events:
//
//      onOpen(dataChannelHandler)
//          called when the RTCDataChannel gets opened
//        
//      onClose(dataChannelHandler)
//          called when the RTCDataChannel gets closed
//
//      onMessage(dataChannelHandler, event)
//          called when the RTCDataChannel receives data from the other peer
//
//      onBufferedAmountLow(dataChannelHandler)
//          called when the RTCDataChannel buffered amount is low
//
//      onAboveSafetyLimit(dataChannelHandler)
//          called when the channel has just been marked to be replaced
//
function DataChannelHandler(params) {

    //--------------------------------------------------------------------------
    // Properties initialization

    // The RTCDataChannel object
    var dataChannel = params.dataChannel;
    
    // Indicates that we are using polling
    var usePolling = true; // By default, use polling
    
    // interval for polling the RTCDataChannel's bufferedAmount (milliseconds)
    // if omited, default is 10 milliseconds
    var pollingInterval = params.pollingInterval || 10; // Milliseconds
    
    // Size of each chunk (bytes)
    var chunkSize = params.chunkSize; // Bytes
    
    // Safety limit for the amount of bytes sent (megabytes)
    // If omited, the feature is disabled
    var safetyLimit = params.safetyLimit; // Megabytes
    
    // Max allowed RTCDataChannel buffer size
    var bufferFullThreshold = 20 * chunkSize; // Bytes
    
    // Counts the amount of bytes sent
    var bytesSent = 0;
    
    // Set to true when bytesSent is above the safety limit
    // so it will be replaced with a fresh one
    var replace = false;

    //--------------------------------------------------------------------------
    // RTCDataChannel initialization
    
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = function (event) {
        if (!usePolling) {
            dataChannel.addEventListener('bufferedamountlow', bufferedAmountListener);
        }
        if (this.onOpen) {
            this.onOpen(this);
        }
    }.bind(this);

    dataChannel.onclose = function (event) {
        if (this.onClose) {
            this.onClose(this);
        }
    }.bind(this);

    dataChannel.onmessage = function (event) {
        if (this.onMessage) {
            this.onMessage(this, event);
        }
    }.bind(this);
    
    dataChannel.onerror = function (event) {
        console.error('ERROR', event);
    }.bind(this);

    if (typeof dataChannel.bufferedAmountLowThreshold === 'number') {
        trace('Using the bufferedamountlow event for flow control');
        usePolling = false;

        // Reduce the buffer fullness threshold, since we now have more efficient
        // buffer management.
        bufferFullThreshold = chunkSize / 2;

        // This is "overcontrol": our high and low thresholds are the same.
        dataChannel.bufferedAmountLowThreshold = bufferFullThreshold;
    } else {
        trace('Using polling for flow control');
    }

    //--------------------------------------------------------------------------
    // Methods

    var pollingCheckerTimer = null;

    var bufferedAmountListener = function() {
        if (this.onBufferedAmountLow) {
            this.onBufferedAmountLow(this);
        }
    }.bind(this);

    this.getLabel = function() {
        return dataChannel.label;
    }.bind(this);

    this.getBufferedAmount = function() {
        return dataChannel.bufferedAmount;
    }.bind(this);

    this.getBufferFullThreshold = function() {
        return bufferFullThreshold;
    }.bind(this);

    this.isBufferedAmountLow = function() {
        return dataChannel.bufferedAmount < bufferFullThreshold;
    }.bind(this);

    this.isOverSafetyLimit = function() {
        return safetyLimit && (bytesSent / 1024 / 1024 >= safetyLimit);
    }.bind(this);
    
    this.send = function(data) {
        try {
            if (dataChannel.readyState !== 'open') {
                return;
            }

            dataChannel.send(data);
            bytesSent += data.length;

            // Arm an event to detect when it is ready to send again
            if (usePolling && !pollingCheckerTimer) {
                pollingCheckerTimer = setInterval(function() {
                    if (this.isBufferedAmountLow()) {
                        clearInterval(pollingCheckerTimer);
                        pollingCheckerTimer = null;
                        if (this.onBufferedAmountLow) {
                            this.onBufferedAmountLow(this);
                        }
                    }
                }.bind(this), pollingInterval);
            }

            // Check if we are above the safety limit
            if (this.onAboveSafetyLimit && this.isOverSafetyLimit()) {
                var old = replace;
                replace = true;
                if (!old) {
                    this.onAboveSafetyLimit(this);
                }
            }
        } catch (ex) {
            console.error(ex);
        }
    }.bind(this);

    this.close = function() {
        if (pollingCheckerTimer) {
            clearInterval(pollingCheckerTimer);
            pollingCheckerTimer = null;
        }
        if (!usePolling) {
            dataChannel.removeEventListener('bufferedamountlow', bufferedAmountListener);
        }
        dataChannel.close();
    }.bind(this);
    
    this.mustReplace = function() {
        return replace;
    }.bind(this);
}
