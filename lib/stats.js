var _ = require("underscore");

function Stats(core, options){
	var self = this;
    self.db = {};
    var dataCache = {};
    options = _.extend({
        flushInterval: 10 * 1000,
        collectionPrefix: "stats-"
    }, options || {})

    self.push = function(uuid, name, value){
        var list = name;
        if (_.isString(list)){
            list = {};
            list[name] = value
        }
        var cache = dataCache[uuid];
        if (!cache){
            dataCache[uuid] = _.extend({}, list);
            return;
        }
        cache = _.extend({}, cache);
        _.each(list, function(v, k){
            if (_.isUndefined(cache[k])){
                cache[k] = v;
                return;
            }
            //console.log("cache[k]".greenBG, cache[k], v, (cache[k] + v) / 2)
            cache[k] = (cache[k] + v) / 2;
        });
        dataCache[uuid] = cache;
    }

    /*******
    * @param names mixed
    *    Array ["memory_total", "memory_used"]  or object {key:name}
    *    {
    *        memory_total:"Total",
    *        memory_used: function(item, name, items, index){ return {name:"Used", value: Math.round(item.value) } }
    *    }
    *****/
    self.get = function(uuid, names, startTs, endTS, count, callback){
        self._getCollection(uuid, function(err, collection){
            if (err)
                return callback(err);

            self._get(collection, uuid, names, startTs, endTS, count, callback);
        });
    }

    self.removeAllStats = function(uuid, callback){
        var db = options.database || core.db._database;
        db.dropCollection(options.collectionPrefix+uuid, function(err){
            if (err)
                return callback(err);

            callback(null, {success: true});
        });
    }

    self._getCollection = function(uuid, callback){
        var collection = self.db[options.collectionPrefix+uuid];
        if (collection)
            return callback(null, collection);

        self._bindDatabaseConfig(options.database || core.db._database, [{collection: options.collectionPrefix+uuid, indexes:"name|uuid"}], function(err, db){
            if (err)
                return callback(err);

            _.extend(self.db, db);

            collection = self.db[options.collectionPrefix+uuid];
            callback(null, collection);
        });
    }

    self._bindDatabaseConfig = function(db, _config_list, callback) {
        var o = { _database : db }
        var config_list = _config_list.slice();

        bind_collection();

        function bind_collection() {
            var config = config_list.shift();
            if(!config)
                return callback(null, o);

            db.collection(config.collection, function(err, collection) {
                if(err)
                    return callback(err);

                o[config.collection] = collection;

                if(config.indexes) {
                    var indexes = config.indexes.split('|');

                    bind_indexes(collection, indexes, function(err) {
                        if(err)
                            return callback(err);
                        bind_collection();
                    });
                }
                else
                    bind_collection();
            })
        }

        function bind_indexes(collection, indexes, callback) {

            bind_index();

            function bind_index() {
                var index = indexes.shift();
                if(!index)
                    return callback();

                index = index.split('->');

                var args = [ ]
                var index_name = { }
                var names = index.shift();
                _.each(names.split('&'), function(name) {
                    if(name && name.length)
                        index_name[name] = 1;
                })
                args.push(index_name);

                var options = { }
                var arg = index.shift();
                while(arg) {

                    arg = arg.split(':');
                    if(arg.length == 1)
                        arg.push(true);

                    if(arg[1] == 'true')
                        arg[1] = true;
                    else
                    if(arg[1] == 'false')
                        arg[1] = false;

                    options[arg[0]] = arg[1];

                    arg = index.shift();
                }
                args.push(options);
                args.push(function(err) {
                    if(err)
                        return callback(err);
                    bind_index();
                })

                collection.ensureIndex.apply(collection, args);
            }
        }
    }

    self._pushToDb = function(uuid, list){
        self._getCollection(uuid, function(err, collection){
            if (err)
                return logError(err);

            self._insert(collection, uuid, list);
        });
    }

    self._insert = function(collection, uuid, list){
        var ts = Date.now();
        _.each(list, function(v, k){
            collection.insert({name:k, value:v, ts:ts}, function(err){
                if (err){
                    logError({error: "unable to insert new stats", uuid:uuid, name:k, value:v})
                    return logError(err)
                }
            })
        });
    }

    self._get = function(collection, uuid, names, startTS, endTS, count, callback){
        var spacing     = Math.round( (endTS - startTS) / count);
        var nameMapping = {};
        if (_.isObject(names)){
            nameMapping = names;
        }else{
            _.each(names, function(name){
                nameMapping[name] = name;
            })
        }

        var tsName = nameMapping.ts ? nameMapping.ts : "ts";
        delete nameMapping.ts;
        names = _.keys(nameMapping);

        /*
        console.log(
            "\nuuid:".greenBG, uuid,
            "\nnames:".greenBG, names,
            "\nstartTS:".greenBG, startTS,
            "\nendTS:".greenBG, endTS,
            "\ncount:".greenBG, count
        )
        */
        var $match = {
            ts: {$gt: startTS}
        };
        var $project = {
            tsgroup: { $subtract: [ { $divide:["$ts", spacing] }, {$mod:[ {$divide:["$ts", spacing]}, 1] }] },
            ts: "$ts",
            value: "$value"
        };
        var $group = {
            _id : {ts: "$tsgroup"},
            "ts": {$first: "$ts"},
            "value" : { $avg : "$value" }
        };
        var $sort   = {"_id.ts":1};

        var records = {};
        var itemCount = 0;

        _.each(names, function(name){
            collection.aggregate([
                {$match: self._getQuery({name: name}, $match)},
                {$project: $project},
                {$group: $group},
                {$sort: $sort}
            ], function(err, items){
                if (err){
                    logError(err);
                    records[name] = {error: err};
                    return combine();
                }

                records[name] = items;

                itemCount++;
                dpc(10, combine);
            });
        });

        var combined = false;
        function combine(){
            if (combined || itemCount < names.length)
                return;

            combined = true;
            self._combine(uuid, tsName, nameMapping, records, callback);
        }
    }

    self._getQuery = function _getQuery(q, $match){
        return _.extend({}, $match, q);
    }

    self._combine = function _combine(uuid, tsName, nameMapping, records, callback){
        var names = _.keys(nameMapping);

        var error = false;
        _.find(names, function(name){
            if(records[name].error){
                error = records[name].error;
                return true;
            }
        });

        if (error)
            return callback(error);

        var items = [];

        var itemTSMap = {};
        _.each(records, function(items, name){
            itemTSMap[name] = {};
            _.each(items, function(item){
                itemTSMap[name][item.ts] = item;
            });
        });

        var firstVarItems = records[names[0]], d, k;
        //console.log("firstVarItems".greenBG, firstVarItems)
        _.each(firstVarItems, function(item, index){
            d = {};
            if (_.isFunction(tsName)){
                k = tsName(item, names[0], items, index);
                d[k.name] = k.value;
            }else{
                d[tsName] = new Date(item.ts).toISOString()
            }
            _.each(names, function(name){
                if (!d)
                    return;
                if(!itemTSMap[name][item.ts]){
                    d = false;
                    return
                }
                if (_.isFunction(nameMapping[name])){
                    k = nameMapping[name](itemTSMap[name][item.ts], name, items, index);
                    d[k.name] = k.value;
                }else{
                    d[nameMapping[name]] = +itemTSMap[name][item.ts].value;
                }
            });

            if (!d)
                return;

            items.push(d);
        });
        /*
        console.log(
            "self._getNodeStats: items.memory",
            items[0],
            items.length,
            _result.memory_used.length,
            "spacing:"+spacing
        );
        */
        callback(null, items)
    }

    function digestCache(){
        var cacheCopy = dataCache;
        dataCache = {};

        _.each(cacheCopy, function(list, uuid){
            self._pushToDb(uuid, list);
        });

        dpc(options.flushInterval, digestCache);
    }

    dpc(options.flushInterval, digestCache);

    function logError(err){
        console.error(err);
    }
}

module.exports = Stats;