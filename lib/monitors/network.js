module.exports = NetworkMonitor;

var _ = require('iris-underscore');
var os = require('os');
var exec = require('child_process').exec;

function NetworkMonitor(options) {
    var self = this;
    self.ident = 'network';

    options = options || { };

    var filter = options.filter || [ ];
    self.filter = null;
    if(filter.length) {
        self.filter = { }
        _.each(filter, function(n) {
        self.filter[n] = true;
        })
    }

    // -- NETWORK
    // var ifconfig_test_string = "eth0      Link encap:Ethernet  HWaddr 08:00:27:07:0f:39  \n          inet addr:1.2.3.4  Bcast:162.222.23.95  Mask:255.255.255.240\n          inet6 addr: fe80::a00:27ff:fe07:f39/64 Scope:Link\n          UP BROADCAST RUNNING MULTICAST  MTU:1500  Metric:1\n          RX packets:3992235 errors:0 dropped:5 overruns:0 frame:0\n          TX packets:3565896 errors:0 dropped:0 overruns:0 carrier:0\n          collisions:0 txqueuelen:1000 \n          RX bytes:1037464330 (1.0 GB)  TX bytes:913671804 (913.6 MB)\n\nlo        Link encap:Local Loopback  \n          inet addr:127.0.0.1  Mask:255.0.0.0\n          inet6 addr: ::1/128 Scope:Host\n          UP LOOPBACK RUNNING  MTU:65536  Metric:1\n          RX packets:1340867 errors:0 dropped:0 overruns:0 frame:0\n          TX packets:1340867 errors:0 dropped:0 overruns:0 carrier:0\n          collisions:0 txqueuelen:0 \n          RX bytes:207911488 (207.9 MB)  TX bytes:207911488 (207.9 MB)\n\n";

    function getNetworkInfo(callback) {
        if(process.platform != 'linux')
            return callback("OS Not Supported");
/*
        var ifaces = ifconfigParse(ifconfig_test_string);
        return callback(null, ifaces);
*/
        exec('ifconfig', function(err, stdout) {
            if(err)
                return callback(err);

            var ifaces = null;
            try {
                ifaces = ifconfigParse(stdout);
            }
            catch(ex) {
                return callback(ex);
            }

            callback(null, ifaces);

        })
    }

    function ifconfigParse(str) {
        var str_iface_list = str.replace(/  +/g,' ').replace(/\n +/g,'\n').split('\n\n');
        var ifaces = { }
        _.each(str_iface_list, (str) => {
            var lines = str.split('\n');

            var id = lines[0].split(/\s/g)[0].replace(/\W/g,'');
            if(!id || id == 'lo')
                return;

            var rx = { }
            var rx_info = lines[4].split(/\s/g);
            rx.packets = rx_info[2];
            rx.bytes = rx_info[4];

            var tx = { }
            var tx_info = lines[6].split(/\s/g);
            tx.packets = tx_info[2];
            tx.bytes = tx_info[4];


            ifaces[id] = {
                rx : rx,
                tx : tx
            }
        })

        return ifaces;
    }

    function ifconfigDelta(tdelta, A, B) {
        var ifaces = { }
        _.each(A, (iface, name) => {

            if(self.filter && !self.filter[name])
                return;

            ifaces[name] = { }
            _.each(iface, (info, dest) => {
                ifaces[name][dest] = { }
                _.each(info, function(v, attr) {
                    ifaces[name][dest][attr] = (v - B[name][dest][attr]) / tdelta * 1000.0;
                })
            })
        })

        return ifaces;
    }

    function getNetworkStats(callback) {

        getNetworkInfo(function(err, ifaces) {
            if(err)
                return dpc(self.networkStatsFreq, updateNetworkStats);

            var ts = Date.now();

            if(!self.prevIfaces)
                self.prevIfaces = ifaces;
            if(!self.prevNetworkStatsTS)
                self.prevNetworkStatsTS = ts - 1;

            var tdelta = ts - self.prevNetworkStatsTS;
            self.prevNetworkStatsTS = ts - 1;

            var ifacesDelta = ifconfigDelta(tdelta, ifaces, self.prevIfaces);
            self.prevIfaces = ifaces;

            options.verbose && console.log(ifacesDelta);

            callback(null, ifacesDelta);
        })
    }

    // ---

    if(process.platform != 'linux') {
        console.log("network stats updates are not running as they are supported under linux only.");
        self.update = undefined; //function(callback) { callback(null, null); }
    }
    else {
        self.update = getNetworkStats;

        if(options.freq && _.isFunction(options.sink)) {
            const poll = () => {
                self.update((err, data) => {
                    options.sink(self.ident, data);
                    dpc(options.freq, poll);
                })
            }

            dpc(poll);
        }

    }
   
}
