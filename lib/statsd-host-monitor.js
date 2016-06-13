module.exports = Monitor;

var _ = require('underscore');

function Monitor(statsd, _options) {
    var self = this;
    self.state = { }
    self.options = _options || { }

    var Monitors = {
        system : { ctor : require("./monitors/system"), freq : self.options.systemStatsFreq || 10 * 1000 },
        storage : { ctor : require("./monitors/storage"), freq : self.options.storageStatsFreq || 60 * 1000 },
        network : { ctor : require("./monitors/network"), freq : self.options.networkStatsFreq || 20 * 1000 },
    }

    self.monitors = { }
    _.each(Monitors, function(v,n) {
        self.monitors[n] = new v.ctor( { freq : v.freq, sink : sink });
    })


    self.update = function() {

        var list = _.map(self.monitors, function(v,n) { return { v: v, n: n }; });
        _.asyncMap(list, function(o, callback) {
            if(!o.v.update)
                return callback();

            o.v.update(function(err, data) {
                self.state[o.n] = data;
                callback();
            })
        }, function() {
            callback(null, self.state);
        })        
    }

    function sink(ident, data) {
        var o = { }
        o[ident] = data;
        statsd.gauge(o);
    }

}
