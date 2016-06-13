module.exports = StorageMonitor;

var _ = require('iris-underscore');
var os = require('os');
var exec = require('child_process').exec;
var Monitor = require('./monitor');


function StorageMonitor(options) {
    var self = this;
    self.ident = 'storage';

    var filter = self.options.filter || [ ];
    self.filter = null;
    if(filter.length) {
        self.filter = { }
        _.each(filter, function(n) {
	    self.filter[n] = true;
        })
    }

    // --- STORAGE
    // var df_test_string = "Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1      526250808 2857980 496637808   1% /\nnone                   4       0         4   0% /sys/fs/cgroup\nudev             1015120       4   1015116   1% /dev\ntmpfs             205048     360    204688   1% /run\nnone                5120       0      5120   0% /run/lock\nnone             1025220       0   1025220   0% /run/shm\nnone              102400       0    102400   0% /run/user\n";

    function getStorageInfo(callback) {
        if(process.platform != 'linux')
            return callback("OS Not Supported");
/*
        var devs = dfParse(df_test_string);
        return callback(null, devs);
*/
        exec('df --block-size=1', function(err, stdout) {
            if(err)
                return callback(err);

            var devs = null;
            try {
                devs = dfParse(stdout);
            }
            catch(ex) {
                return callback(ex);
            }

            callback(null, devs);

        })
    }

    function dfParse(str) {
        var devs = { }
        var lines = str.replace(/  +/g,' ').split('\n');
        lines.shift();
        _.each(lines, function(line) {
            var l = line.split(' ');
            if(l[0].match(/none|udev/))
                return;
            var dev = l.shift();
            if(!dev)
                return;

            var o = {
                bytesTotal : parseInt(l.shift()),
                bytesUsed : parseInt(l.shift()),
                bytesFree : parseInt(l.shift()),
                percentUsed : parseInt(l.shift()),
                mount : l.join(' '),
            }

            o.used = o.bytesUsed / (o.bytesTotal);

            devs[dev] = o;
        })

        return devs;
    }

    function getStorageStats(callback) {
        getStorageInfo(function(err, devs) {
            if(err)
                return callback(err);

            var data = { }

            _.each(devs, function(o, device) {
        		var dev = device;
        		if(self.filter && (!self.filter[dev] && !self.filter[o.mount]))
        			return;

                data[dev] = o;

                options.verbose && console.log(o);
            })

            callback(null, data)
        })

    }

    // ---

    if(process.platform != 'linux') {
        console.log("storage stats updates are not running as they are supported under linux only.");
        self.update = undefined;
    }
    else {
        self.update = getStorageStats;        

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

}
