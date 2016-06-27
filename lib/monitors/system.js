module.exports = SystemMonitor;

var _ = require('iris-underscore');
var os = require('os');
var exec = require('child_process').exec;

var winCPU = null;
if(os.platform() == 'win32') {
    try {
        winCPU = require("windows-cpu");
    }
    catch(ex) {
        winCPU = null;
    }
}

function SystemMonitor(options) {
    var self = this;
    self.ident = 'system';

    options = options || { };

    function getSystemStats(callback) {

        var data = {
            memory : {
                total : os.totalmem(),
                free : os.freemem()
            }
        }

        if(winCPU) {
            winCPU.totalLoad(function(err, results) {
                if(err)
                    return next();
                // data.load = results;
                var avg = _.reduce(results, function(m,n) { return m+n; }) / results.length;
                data.loadavg = {
                    '1m' : avg,
                    '5m' : avg,
                    '15m' : avg
                }

                next();
            })
        }
        else {
            var la = os.loadavg();
            data.loadavg = {
                '1m' : la[0],
                '5m' : la[1],
                '15m' : la[2]
            }
            next();
        }

        function next() {
            data.memory.used = data.memory.total - data.memory.free;

            options.verbose && console.log(data);

            callback(null, data);
        }
    }

    // ---

    self.update = getSystemStats;

    if(options.freq && _.isFunction(options.sink)) {
        function poll() {
            self.update(function(err, data) {
                options.sink(self.ident, data);
                dpc(options.freq, poll);
            })
        }

        dpc(poll);
    }

}
