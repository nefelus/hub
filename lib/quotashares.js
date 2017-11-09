//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var util = require('util');
var logger = require('./logging').logger;
//var sizeof = require('object-sizeof');

(function () {
    var quotashares = {};

    quotashares.iResourceTypes = {
                                  N  : 'NULL',
                                  S  : 'SESSIONS',
                                  M  : 'MACHINES',
                                  U  : 'USERS',
                                  T  : 'TOOLS',
                                  ID : 'IP_DATA',
                                  IR : 'IP_DATA_REF',
                                  IL : 'IP_DATA_LIB',
                                  SD : 'SHARED_DATA',
                                  UD : 'USER_DATA',
                                  IC : 'IP_DOCS',
                                  TT : 'TOOLS_DATA',
                                  TD : 'TOOL_DOCS'
                                };

    quotashares.resourceTypes = {
                                  NULL        : 'N',
                                  SESSIONS    : 'S',
                                  MACHINES    : 'M',
                                  USERS       : 'U',
                                  TOOLS       : 'T',
                                  IP_DATA     : 'ID',
                                  IP_DATA_REF : 'IR',
                                  IP_DATA_LIB : 'IL',
                                  SHARED_DATA : 'SD',
                                  USER_DATA   : 'UD',
                                  IP_DOCS     : 'IC',
                                  TOOLS_DATA  : 'TT',
                                  TOOL_DOCS   : 'TD'
                                };

    // global on the server, window in the browser
    var root, previous_quotashares;

    root = this;
    if (root != null) {
      previous_quotashares = root.quotashares;
    }

    quotashares.noConflict = function () {
        root.quotashares = previous_quotashares;
        return quotashares;
    };

    quotashares.prepareStatement = function (opt) {

      var c = 0;
      var u = 0;
      var p = 0;
      var rtypeStr = '';
      var inherit = true;
      var rtype;

      if (opt) {
        if (opt.rtype) {
          rtypeStr = opt.rtype;
        }
        if (opt.inherit !== undefined) {
          inherit = opt.inherit;
        }
        if (opt.company) {
          c = opt.company;
        }
        if (opt.user) {
          u = opt.user;
        }
        if (opt.project) {
          p = opt.project;
        }
      }

      if (inherit !== false) {
        inherit = true;
      }
      rtype = quotashares.resourceTypes[rtypeStr];

      var stmt = 'SELECT ID, COMPANY_ID, USER_ID, PROJECT_ID, RESOURCE_TYPE, RESOURCE_ID, MAX_ALLOWED FROM QUEUE_QUOTA';
      stmt += ' WHERE (ACTIVE is NULL or ACTIVE <> "N") and ';
      if ( ! rtype) {
        stmt += ' RESOURCE_TYPE in ("IP_DATA_LIB", "SHARED_DATA", "USER_DATA", "IP_DOCS", "TOOL_DOCS", "TOOLS_DATA") ';
      } else {
        stmt += ' RESOURCE_TYPE = "'+rtypeStr+'" ';
      }
      stmt += ' and ( COMPANY_ID is NOT NULL or PROJECT_ID is NOT NULL or USER_ID is NOT NULL) ';
      if ( c ) {
        stmt += ' and COMPANY_ID = '+c;
      }
      if ( p ) {
        stmt += ' and PROJECT_ID = '+p;
      }
      if ( u ) {
        stmt += ' and ( USER_ID = '+u;
        if (inherit === true) {
          stmt += ' OR USER_ID is NULL';
        }
        stmt += ' ) ';
      } else {
        if (inherit === true) {
          stmt += ' and USER_ID is NULL';
        }
      }
      return stmt;
    };

    quotashares.getPermittedResources = function (sqlClient, opts, cb) {
      var stmt = '';

      if (Object.prototype.toString.call(opts) !== '[object Array]') {
        opts = [ opts ];
      }
      for (var i=0; i<opts.length; i++) {
        if (i !== 0) {
          stmt += ' UNION ';
        }
        stmt += quotashares.prepareStatement(opts[i]);
      }

      if (stmt === '') {
        cb(null, null);
        return;
      }

      stmt += ' ORDER by COMPANY_ID,USER_ID,PROJECT_ID, RESOURCE_TYPE, RESOURCE_ID';

      var tmp = {};

      var resourceType;
      var r;
      var maxallowed;
      var resourceId;
      try {
        sqlClient.query(stmt, function(err, rows, fields) {

          if (err) {
            logger.log('Error from MYSQL query:');
            logger.log(util.inspect(err, {depth:null}));
            cb(err);
            return;
          }

          var rids = null;
          var i;
          if (rows.length !== 0) {
            for (i = 0; i < rows.length; i++) {
              resourceType = rows[i]['RESOURCE_TYPE'] || '';
              r = quotashares.resourceTypes[resourceType];
              resourceId = rows[i]['RESOURCE_ID'] || 0;
              maxallowed = rows[i]['MAX_ALLOWED'] || 0;
              switch (resourceType) {
                //case 'IP_DATA':
                case 'IP_DATA_LIB':
                case 'SHARED_DATA':
                case 'USER_DATA':
                case 'TOOLS_DATA':
                case 'IP_DOCS':
                case 'TOOL_DOCS':

                  if (! tmp[r]) {
                    tmp[r] = [];
                  }
                  if (! tmp[r][resourceId]) {
                    tmp[r][resourceId] = maxallowed;
                  } else { // Be restrictive.
                    if (tmp[r][resourceId] > maxallowed) {
                      tmp[r][resourceId] = maxallowed;
                    }
                  }
                  break;
                default:
                  break;
              }
            }
          }

          for (var key in tmp) {
            if (rids === null) {
              rids = {};
            }
            if (! rids[key]) {
              rids[quotashares.iResourceTypes[key]] = [];
            }
            for (var key2 in tmp[key]) {
              if (tmp[key][key2] != 0) {
                rids[quotashares.iResourceTypes[key]].push(key2);
              }
            }
          }
          cb(null, rids);
        });
      } catch (ex) {
        logger.log( util.inspect(ex, null));
        cb('Load quotashares FATAL ERROR:' + util.inspect(ex, null));
        return;
      }
    };

    if (typeof module !== 'undefined' && module.exports) { // Node.js
      module.exports = quotashares;
    } else if (typeof define !== 'undefined' && define.amd) { // AMD / RequireJS
      define([], function () {
        return quotashares;
      });
    } else { // included directly via <script> tag
      root.quotashares = quotashares;
    }

}());
