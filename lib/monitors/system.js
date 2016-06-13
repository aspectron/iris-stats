module.exports = SystemMonitor;

var _ = require('iris-underscore');
var os = require('os');
var exec = require('child_process').exec;

function SystemMonitor(options) {
    var self = this;
    self.ident = 'system';

    options = options || { };

    function getSystemStats(callback) {

        var la = os.loadavg();
        var data = {
            loadavg : {
                '1m' : la[0],
                '5m' : la[1],
                '15m' : la[2]
            },
            memory : {
                total : os.totalmem(),
                free : os.freemem()
            }
        }

        data.memory.used = data.memory.total - data.memory.free;

        options.verbose && console.log(data);

        callback(null, data);
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
