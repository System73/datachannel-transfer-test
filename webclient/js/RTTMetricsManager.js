/**
 * Copyright (C) System73 Europe, SL - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 * 2018 - present
 */

//==============================================================================
// RTTMetricsManager:
//
// Calculate and report RTT metrics.
// 
// Initialize with "params", an object holding the parameters.
// 
//      params.sendingPeriod
//          period of time for sending ping messages (milliseconds)
//          this is used for calculating jitter stats
//          if missing, use the mean of distances between received pong messages
// 
//      params.reportingPeriod
//          period of time for calculating and reporting new metrics (milliseconds)
//          the default value is 1000
//          the event onMetrics will be fired after each period
// 
// Methods:
//      
//      start()
//          start the periodic reporting of metrics
//      
//      stop()
//          stop the periodic reporting of metrics
//          
//      pingSent(messageId)
//          record when a ping message was sent
//      
//      pongReceived(messageId)
//          record when a pong message was received
//      
//      calculateFinalStats()
//          return object with aggregated stats of the full test
//      
// Events:
// 
//      onMetrics(metricsManager, metrics)
//          report newly calculated metrics
//          if there are no metrics in the current report window, it is undefined
//
function RTTMetricsManager(params) {

    //--------------------------------------------------------------------------
    // Properties initialization

    // Period of time for sending ping messages (milliseconds)
    // This is used for calculating jitter stats
    // If missing, use the mean of distances between received pong messages
    var sendingPeriod = params.sendingPeriod; // Milliseconds

    // Period of time for calculating and reporting new metrics (milliseconds)
    // The default value is 1000
    // The event onMetrics will be fired after each period
    var reportingPeriod = (params && params.reportingPeriod) ? params.reportingPeriod : 1000; // Milliseconds

    // Timer for calculating and reporting metrics
    var reportingTimer;

    // Holds RTT stats since the start of the test
    var allStats = {};

    // Holds RTT stats for the current reporting window
    var windowStats = {};
    
    //--------------------------------------------------------------------------
    // Methods

    // Simple helper math functions
    function fmin(a, b)    { return Math.min(a, b); }
    function fmax(a, b)    { return Math.max(a, b); }
    function faccum(a, b)  { return a + b;          }
    function faccum2(a, b) { return a + b * b;      }

    function calculateStats(v) {
        if (v && v.length > 0) {
            // Calculate minimum, maximum, mean, standard deviation
            var min = v.reduce(fmin, Infinity);
            var max = v.reduce(fmax, -Infinity);
            var mean = v.reduce(faccum, 0) / v.length;
            var std = Math.sqrt(v.reduce(faccum2, 0) / v.length - mean * mean);

            return {
                min: min,
                max: max,
                mean: mean,
                std: std
            };
        } else {
            // No data available
            return null;
        }
    }

    var calculateMetrics = function() {
        // Calculate stats for ping-pong messages which 
        // arrived inside the current reporting window
        var v = Object.keys(windowStats).map(function (key) {
            return windowStats[key].rtt;
        });
        var n = v.length;
        var meanRTT = v.reduce(faccum, 0) / n;
        windowStats = {};
        
        // Report current metrics
        var obj;
        if (n > 0) {
            obj = {
                meanRTT: meanRTT
            };
        }
        if (this.onMetrics) {
            setTimeout(function() {
                this.onMetrics(this, obj);
            }.bind(this), 0);
        }
    }.bind(this);

    this.start = function() {
        this.stop();
        allStats = {};
        windowStats = {};
        reportingTimer = setTimeout(function() {
            reportingTimer = setInterval(calculateMetrics, reportingPeriod);
        }, reportingPeriod);
    }.bind(this);
    
    this.stop = function() {
        if (reportingTimer) {
            clearTimeout(reportingTimer);
            clearInterval(reportingTimer);
            reportingTimer = null;
        }
    }.bind(this);
    
    this.pingSent = function(messageId) {
        var id = messageId.toString();
        var ts = performance.now();
        allStats[id] = {
            sentTs: ts
        };
    }.bind(this);
    
    this.pongReceived = function(messageId) {
        var id = messageId.toString();
        var obj = allStats[id];
        if (obj) {
            obj.receivedTs = performance.now();
            obj.rtt = obj.receivedTs - obj.sentTs;
            windowStats[id] = Object.assign({}, obj);
        }
    }.bind(this);
    
    this.calculateFinalStats = function() {
        // Get RTT values
        var vRTT = Object.keys(allStats).map(function (key) {
            if (!allStats[key].receivedTs) {
                trace('\tping message ' + key + ' without response');
            }
            return allStats[key].rtt;
        });
        vRTT = vRTT.filter(function(rtt) {
            return !!rtt;
        });
        
        // Get jitter values
        var vTsDiff = [];
        var vTs = Object.keys(allStats).map(function (key) {
            return allStats[key].receivedTs;
        }).sort(function(a, b) {
            return a - b;
        });
        for (var n = 1; n < vTs.length; ++n) {
            vTsDiff[n - 1] = Math.abs(vTs[n] - vTs[n - 1]);
        }
        var pongPeriod;
        if (sendingPeriod) {
            pongPeriod = sendingPeriod;
        } else {
            pongPeriod = vTsDiff.reduce(faccum, 0) / vTsDiff.length;
        }
        var vJitter = vTsDiff.map(function (x) {
            return Math.abs(x - pongPeriod);
        });

        // Calculate stats
        return {
            rtt: calculateStats(vRTT),
            jitter: calculateStats(vJitter)
        };
    }.bind(this);
}
