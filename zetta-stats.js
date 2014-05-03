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
        console.log((designation+'.'+node_id+'.'+name).green.bold,' -> ',value.toString().bold);
        return self.statsd.gauge(node_id + '.' + name, value);
    }

    self.timing = function (name, value) {
        return self.statsd.timing(group+'.'+node_id+ '.' + name, value);
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
        _.each(profiler.stats, function(o, ident) {
            var tdelta = ts - lts;
            o.freq = o.hits / tdelta * 1000.0;
            statsd.gauge(ident + '-freq', o.freq);
            o.hits = 0;
        })
        lts = ts;
    }
}

module.exports = {
    StatsD : StatsD,
    Profiler : Profiler
}

