var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
  var shares = {};

  // global on the server, window in the browser
  var root, previous_shares;

  root = this;
  if (root != null) {
    previous_shares = root.shares;
  }

  shares.noConflict = function () {
    root.shares = previous_shares;
    return shares;
  };

  shares.shareDefs = [];

  shares.length = function length() {
    return shares.shareDefs.length;
  }

  shares.assign = function assign(data) {
    shares.shareDefs = data;
  }

  shares.dump = function dump() {
    console.log('--- shares begin ---');
    for (var x = 0; x < shares.shareDefs.length; x++) {
      console.log(x, JSON.stringify(shares.shareDefs[x]));
    }
    console.log('--- shares end ---');
  }

  shares.getByIds = function getById(RIds, cloudId) {
    var self = shares;
    if ((typeof RIds === 'string') || (typeof RIds === 'number')) {
      var x = RIds; 
      RIds = [x];
    }
    var RShares = [];
    for (var j = 0; j < RIds.length; j++) {
      for (var i = 0; i < shares.shareDefs.length; i++) {
        if ((shares.shareDefs[i]['id'] == RIds[j]) &&
            ((cloudId === undefined) || (cloudId == shares.shareDefs[i]['cloud_id']))) {
          RShares.push({'id' : shares.shareDefs[i]['id'],
                        'fstype' : shares.shareDefs[i]['fs_type'].toLowerCase(),
                        'location' : shares.shareDefs[i]['location'],
                        'mountParams' : shares.shareDefs[i]['mount_params'],
                        'mountPoint' : shares.shareDefs[i]['mount_point'],
                        'uuid' : shares.shareDefs[i]['uuid']
                       });
        }
      }
    }
    return RShares;
  }

  shares.loadShares = function loadShares(mysqlClient, cb) {
    shares.shareDefs.length = 0
    var record = {};
    try {
      mysqlClient.query(SQL.shares, function(err, rows, fields) {
        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name.toLowerCase()] = rows[i][fields[j].name] || '';
              if (typeof record[fields[j].name.toLowerCase()] === 'object') {
                record[fields[j].name.toLowerCase()] += '';
              }
            }
            if ((record.location !== '') && (record.mount_point !== '') && (record.uuid !== '') &&
                (record.mount_params !== 'no')) {
              record.location = record.location.replace(/\/\/+/g,'/').replace(/\/$/,'');
              shares.shareDefs.push(record);
            }
          }
        }
        cb(null, 'Shares loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, {depth : null}));
      cb('Load shares FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  }

  shares.loadShares_old = function loadShares_old(mysqlClient, cb) {
    shares.shareDefs.length = 0;
    var record = {};
    try {
      mysqlClient.query(SQL.shares_old, function(err, rows, fields) {
        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name.toLowerCase()] = rows[i][fields[j].name] || '';
              if (typeof record[fields[j].name.toLowerCase()] === 'object') {
                record[fields[j].name.toLowerCase()] += '';
              }
            }
            shares.shareDefs.push(record);
          }
        }
        cb(null, 'Shares loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load shares FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  }

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = shares;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return shares;
    });
  }
  // included directly via <script> tag
  else {
    root.shares = shares;
  }
}());
