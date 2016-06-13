module.exports = StatsD;

var _StatsD = require('node-statsd').StatsD;
var _ = require('underscore');


function StatsD(address, node_id, designation) {
    var self = this;

    if(!address || !node_id || !designation)
        throw new Error("StatsD wrapper missing arguments");

    console.log("Connecting to StatsD at",address.bold);
    self.statsd = new _StatsD({ host: address });

    self.designation = designation.toUpperCase();

    self.gauge = function (n, v) {

        if(_.isObject(n)) {
            var list = flatObject(n);
            _.each(list, function(v,_n) {
               self.statsd.gauge(self.designation + '.' + node_id + '.' + _n, v); 
            })
        }
        else {
        // console.log(address+': '+(designation+'.'+node_id+'.'+name).green.bold,' -> ',value.toString().bold);
            self.statsd.gauge(self.designation + '.' + node_id + '.' + n, v);
        }
    }

    self.timing = function (n, v) {

        if(_.isObject(n)) {
            var list = flatObject(n);
            _.each(list, function(v,_n) {
               self.statsd.timing(self.designation + '.' + node_id + '.' + _n, v); 
            })
        }
        else {
            self.statsd.timing(self.designation+'.'+node_id+ '.' + n, v);
        }
    }
}


/*
	flatObject - Flattens a given object

	{
		a : {
			b : 123
		}
	}

	results in graphite compatible k:v pairs

	{
		'a.b' : 123
	}
*/

function flatObject(v) {
	var data = { }

    function _R(v, path, init) {

    	_.each(v, function(v,k) {
    		if(init)
    			path = '';

    		if(_.isObject(v) || _.isArray(v)) {
    			var p = path+k+'.';
    			_R(v,p);
    		}
    		else {
    			var p = path+k;
    			data[p] = v;
    		}
    	})

    }

    _R(v,'', true);

    return data;
}
