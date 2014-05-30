//
// -- Zetta Toolkit - Utilities for interfacing with StatsD & Graphite
//
//  Copyright (c) 2011-2014 ASPECTRON Inc.
//  All Rights Reserved.
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy
//  of this software and associated documentation files (the "Software"), to deal
//  in the Software without restriction, including without limitation the rights
//  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//  copies of the Software, and to permit persons to whom the Software is
//  furnished to do so, subject to the following conditions:
// 
//  The above copyright notice and this permission notice shall be included in
//  all copies or substantial portions of the Software.
// 
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//  THE SOFTWARE.
//

var _ = require('underscore');
var _StatsD = require('node-statsd').StatsD;
var os = require('os');
var exec = require('child_process').exec;

function StatsD(address, node_id, designation) {
    var self = this;

    if(!address || !node_id || !designation)
        throw new Error("StatsD wrapper missing arguments");

    console.log("Connecting to StatsD at",address.bold);
    self.statsd = new _StatsD({ host: address });

    self.designation = designation.toUpperCase();

    self.gauge = function (name, value) {
        // console.log(address+': '+(designation+'.'+node_id+'.'+name).green.bold,' -> ',value.toString().bold);
        return self.statsd.gauge(self.designation + '.' + node_id + '.' + name, value);
    }

    self.timing = function (name, value) {
        return self.statsd.timing(self.designation+'.'+node_id+ '.' + name, value);
    }
}

function Profiler(statsd) {
    var profiler = this;
    profiler.stats = { }

    function create(ident) {
        var o = profiler.stats[ident] = {
            count: 0,
            freq: 0,
            err: 0,
            hits : 0,
            flush : true,
            lts: Date.now(),
        }
        return o;
    }

    function _Profiler(ident) {
        var self = this;

        var ts0 = Date.now();

        var o = profiler.stats[ident];
        if (!o)
            o = create(ident);

        o.count++;
        o.hits++;

        self.finish = function (err) {
            var ts1 = Date.now();

            var o = profiler.stats[ident];
            if(err)
                o.err++;

            var tdelta = ts1 - ts0;
            statsd.timing(ident + '-tdelta', tdelta);
        }
    }

    profiler.profile = function (ident) {
        return new _Profiler(ident);
    }

    profiler.hit = function(ident) {
        var ts = Date.now();
        var o = profiler.stats[ident];
        if (!o)
            o = create(ident);

        o.count++;
        o.hits++;
    }

    var lts = Date.now();
    function monitor() {

        setTimeout(monitor, 1000);  // loop

        var ts = Date.now();
        var tdelta = ts - lts;
        _.each(profiler.stats, function(o, ident) {
            if(o.hits || o.flush) {
                o.freq = o.hits / tdelta * 1000.0;
                statsd.gauge(ident + '-freq', o.freq);
                if(o.hits) {
                    o.flush = true;
                    o.hits = 0;
                }
                else
                    o.flush = false;
            }
        })
        lts = ts;
    }

    setTimeout(monitor, 1000);
}

function Monitor(statsd, _options) {
    var self = this;
    self.stats = { }
    self.options = _options || { }

    self.systemStatsFreq = self.options.systemStatsFreq || 10 * 1000;
    self.networkStatsFreq = self.options.networkStatsFreq || 20 * 1000;
    self.storageStatsFreq = self.options.storageStatsFreq || 60 * 1000;

    // -- SYSTEM

    function updateSystemStats() {

        self.stats.loadAvg = os.loadavg();
        self.stats.memory = {
            total : os.totalmem(),
            free : os.freemem(),
        }

        statsd.gauge('memory.free', self.stats.memory.free);
        statsd.gauge('memory.used', self.stats.memory.total - self.stats.memory.free);
        statsd.gauge('memory.total', self.stats.memory.total);
        statsd.gauge('loadAvg.5m', self.stats.loadAvg[0]);
        statsd.gauge('loadAvg.10m', self.stats.loadAvg[1]);
        statsd.gauge('loadAvg.15m', self.stats.loadAvg[2]);

        dpc(10000, updateSystemStats)
    }

    // -- NETWORK
    // var ifconfig_test_string = "eth0      Link encap:Ethernet  HWaddr 08:00:27:07:0f:39  \n          inet addr:1.2.3.4  Bcast:162.222.23.95  Mask:255.255.255.240\n          inet6 addr: fe80::a00:27ff:fe07:f39/64 Scope:Link\n          UP BROADCAST RUNNING MULTICAST  MTU:1500  Metric:1\n          RX packets:3992235 errors:0 dropped:5 overruns:0 frame:0\n          TX packets:3565896 errors:0 dropped:0 overruns:0 carrier:0\n          collisions:0 txqueuelen:1000 \n          RX bytes:1037464330 (1.0 GB)  TX bytes:913671804 (913.6 MB)\n\nlo        Link encap:Local Loopback  \n          inet addr:127.0.0.1  Mask:255.0.0.0\n          inet6 addr: ::1/128 Scope:Host\n          UP LOOPBACK RUNNING  MTU:65536  Metric:1\n          RX packets:1340867 errors:0 dropped:0 overruns:0 frame:0\n          TX packets:1340867 errors:0 dropped:0 overruns:0 carrier:0\n          collisions:0 txqueuelen:0 \n          RX bytes:207911488 (207.9 MB)  TX bytes:207911488 (207.9 MB)\n\n";

    function getNetworkStats(callback) {
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
        _.each(str_iface_list, function(str) {
            var lines = str.split('\n');

            // console.log(lines);

            var id = lines[0].split(/\s/g)[0];
            if(!id)
                return;

            var rx = { }
            var rx_info = lines[4].split(/\s/g);
            rx_info.shift();
            _.each(rx_info, function(v) {
                v = v.split(':');
                rx[v[0]] = parseInt(v[1]);
            })

            var tx = { }
            var tx_info = lines[4].split(/\s/g);
            tx_info.shift();
            _.each(tx_info, function(v) {
                v = v.split(':');
                tx[v[0]] = parseInt(v[1]);
            })

            var bytes_info = lines[7].split(/ +|:/g);
            rx.bytes = parseInt(bytes_info[2]);
            tx.bytes = parseInt(bytes_info[7]);

            ifaces[id] = {
                rx : rx,
                tx : tx
            }
        })

        return ifaces;
    }

    function ifconfigDelta(tdelta, A, B) {
        var ifaces = { }
        _.each(A, function(iface, name) {
            ifaces[name] = { }
            _.each(iface, function(info, dest) {
                ifaces[name][dest] = { }
                _.each(info, function(v, attr) {
                    ifaces[name][dest][attr] = (v - B[name][dest][attr]) / tdelta * 1000.0;
                })
            })
        })

        return ifaces;
    }

    function updateNetworkStats() {

        getNetworkStats(function(err, ifaces) {
            if(err)
                return dpc(self.networkStatsFreq, updateNetworkStats);

            var ts = Date.now();

            if(!self.prevIfaces)
                self.prevIfaces = ifaces;
            if(!self.prevNetworkStatsTS)
                self.prevNetworkStatsTS = ts - 1;

            var tdelta = ts - self.prevNetworkStatsTS;
            self.stats.ifaces = ifconfigDelta(tdelta, ifaces, self.prevIfaces);
            self.prevIfaces = ifaces;

            _.each(self.stats.ifaces, function(iface, ifaceName) {
                _.each(iface, function(info, direction) {
                    _.each(info, function(v, attr) {
                        statsd.gauge('network.'+ifaceName+'.'+direction+'.'+attr, v);
                        // statsd.gauge('network.'+ifaceName+'.'+direction+'-'+attr, v);
                    })
                })
            })

            dpc(self.networkStatsFreq, updateNetworkStats);
        })
    }

    // --- STORAGE
    // var df_test_string = "Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1      526250808 2857980 496637808   1% /\nnone                   4       0         4   0% /sys/fs/cgroup\nudev             1015120       4   1015116   1% /dev\ntmpfs             205048     360    204688   1% /run\nnone                5120       0      5120   0% /run/lock\nnone             1025220       0   1025220   0% /run/shm\nnone              102400       0    102400   0% /run/user\n";

    function getStorageStats(callback) {
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
            var dev = l.shift().replace(/^\//,'');
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

    function updateStorageStats() {

        getStorageStats(function(err, devs) {
            if(err)
                return dpc(self.storageStatsFreq, updateStorageStats);

            _.each(devs, function(o, device) {
                var dev = device.replace(/\//g,'-');
                var mount = o.mount == '/' ? 'root' : o.mount.replace(/^\//,'').replace(/\//g,'-');
                dev = dev+'_'+mount;
                statsd.gauge('storage.'+dev+'.used', o.used);
                statsd.gauge('storage.'+dev+'.bytesTotal', o.bytesTotal);
                statsd.gauge('storage.'+dev+'.bytesUsed', o.bytesUsed);
                statsd.gauge('storage.'+dev+'.bytesFree', o.bytesFree);
            })

            dpc(self.storageStatsFreq, updateStorageStats);
        })
    }

    // ---

    function startSystemStatsUpdates() {
        updateSystemStats();
    }

    function startNetworkStatsUpdates() {
        if(process.platform != 'linux')
            return console.log("zetta-stats: network stats updates are not running as they are supported under linux only.");
        dpc(updateNetworkStats);
    }

    function startStorageStatsUpdates() {
        if(process.platform != 'linux')
            return console.log("zetta-stats: storage stats updates are not running as they are supported under linux only.");
        dpc(updateStorageStats);
    }

    if(self.options.system)
        startSystemStatsUpdates();

    if(self.options.network)
        startNetworkStatsUpdates();

    if(self.options.storage)
        startStorageStatsUpdates();

}

module.exports = {
    StatsD : StatsD,
    Profiler : Profiler,
    Monitor : Monitor
}
