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

var _ = require('underscore'),
    _StatsD = require('node-statsd').StatsD,
    os = require('os');

function StatsD(address, node_id, designation) {
    var self = this;

    if(!address || !node_id || !designation)
        throw new Error("StatsD wrapper missing arguments");

    console.log("Connecting to StatsD at",address.bold);
    self.statsd = new _StatsD({ host: address });

    self.gauge = function (name, value) {
        console.log(address+': '+(designation+'.'+node_id+'.'+name).green.bold,' -> ',value.toString().bold);
        return self.statsd.gauge(designation + '.' + node_id + '.' + name, value);
    }

    self.timing = function (name, value) {
        return self.statsd.timing(designation+'.'+node_id+ '.' + name, value);
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

module.exports = {
    StatsD : StatsD,
    Profiler : Profiler
}


