//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
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

  shares.getByIds = function getByIds(mysqlClient, RIds, cloudId, cb) {
    var stmt = '';
    if (! cb) {
      cb = cloudId;
      cloudId = undefined;
    }
    if (mysqlClient === null) {
      cb('SQL Client not set', null);
      return;
    }
    if ((typeof RIds === 'string') || (typeof RIds === 'number')) {
      var x = RIds; 
      RIds = [x];
    }

    var RShares = [];

    if (RIds.length) {
      stmt += 'SELECT m.ID as ID, m.RESOURCE_TYPE as RESOURCE_TYPE, m.UUID as UUID, f.CLOUD_ID as CLOUD_ID, ';
      stmt += 'concat(f.LOCAL_IPV4,"@",v.MOUNT_POINT,"/",m.DIR) as LOCATION, m.MOUNT_POINT as MOUNT_POINT, ';
      stmt += 'm.MOUNT_PARAMS as MOUNT_PARAMS, m.FS_TYPE as FS_TYPE, m.CREDS as CREDS, m.ENCRYPTED as ENCRYPTED ';
      stmt += 'FROM MOUNT_POINTS as m, FILE_MANAGER as f, VOLUMES as v ';
      stmt += 'WHERE (m.ACTIVE is NULL or m.ACTIVE = "Y" or m.ACTIVE="") and v.ID = m.VOLUME_ID and v.FILEMANAGER_ID = f.ID and ';
      stmt += 'm.RESOURCE_TYPE in ("SHARED_DATA", "USER_DATA", "IP_DATA", "IP_DATA_LIB", "TOOLS_DATA", "IP_DOCS", "TOOL_DOCS") and ';
      stmt += 'm.ID in (';
      var idstr='';
      for (var i=0; i<RIds.length; i++) {
        idstr += ((idstr === '') ? '' : ',');
        idstr += RIds[i];
      }
      stmt += idstr + ')';
      if (cloudId) {
        stmt += ' and f.CLOUD_ID = '+cloudId;
      }
    }
    if (stmt !== '') {
      var record = {};
      var creds;
      try {
        mysqlClient.query(stmt, function(err, rows, fields) {
          if (err) {
            logger.log('Error from MYSQL query:');
            logger.log(err);
            cb(err, []);
            return;
          } else {
            for (var i = 0; i < rows.length; i++) {
              record = {};
              for (var j = 0; j < fields.length; j++) {
                record[fields[j].name.toLowerCase()] = rows[i][fields[j].name] || '';
                if ((typeof record[fields[j].name.toLowerCase()] === 'object') && (record[fields[j].name.toLowerCase()] !== null )) {
                  record[fields[j].name.toLowerCase()] += '';
                }
              }
              if ((record.location !== '') && (record.mount_point !== '') && (record.uuid !== '') &&
                  (record.mount_params !== 'no')) {
                record.fs_type = record.fs_type.toLowerCase();
                record.location = record.location.replace(/\/\/+/g,'/').replace(/\/$/,'');
                if (record.fs_type === 'cifs') {
                  record.location = '//'+record.location.replace(/@.*/,'/');
                  creds = record.creds.split('/');
                  record.location += creds[0];
                } else if (record.fs_type === 'nfs') {
                  record.location = record.location.replace(/@/,':');
                }
                RShares.push({'id' : record.id,
                              'fstype' : record.fs_type,
                              'location' : record.location,
                              'mountParams' : record.mount_params,
                              'mountPoint' : record.mount_point,
                              'creds' : record.creds,
                              'encrypted' : record.encrypted,
                              'uuid' : record.uuid
                             });
              }
            }
          }
          cb(null, RShares);
        });
      } catch (ex) {
        console.log(util.inspect(ex, {depth : null}));
        cb('Load shares FATAL ERROR:' + util.inspect(ex, null));
        return;
      }
    } else {
      cb(null, RShares);
    }
  };

  shares.getByIds_old = function getByIds_old(RIds, cloudId) {
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
                        'creds' : shares.shareDefs[i]['creds'],
                        'encrypted' : shares.shareDefs[i]['encrypted'],
                        'uuid' : shares.shareDefs[i]['uuid']
                       });
        }
      }
    }
    return RShares;
  };

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
