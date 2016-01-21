var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
    var quotashares = {};

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

    var QueuePermits = function QueuePermits() {
      this.permits = [];

      this.clear = function () {
        this.permits.length = 0;
      }

      this.add = function (company, user, project, resourceType, resourceId, maxAllowed) {
        this.permits.push({'company' : company,
                           'user' : user,
                           'project' : project,
                           'resourceType' : resourceType,
                           'resourceId' : resourceId,
                           'maxAllowed' : maxAllowed
                          });
      };

      this.length = function () {
        return this.permits.length;
      }

      this.dump = function () {
        console.log('--- queue permits begin ---');
        for (var x = 0; x < this.permits.length; x++) {
          console.log(x, JSON.stringify(this.permits[x]));
        }
        console.log('--- queue permits end ---');
      }

      this.getPermittedResources = function (opt, rtypeStr, inherit) {
        var c = 0;
        var u = 0;
        var p = 0;
        var rtype = quotashares.resourceTypes[rtypeStr];
        var rids = null;
        if (opt) {
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

        var tmp = {};
        for (var i = 0; i < this.permits.length; i++) {
          if (
              ((! rtype) || (rtype === this.permits[i].resourceType)) && // All resource types or a specific one

              ((this.permits[i].company != 0) || (this.permits[i].project != 0) || (this.permits[i].user != 0)) && // Ignore system wide definitions

              ((c) && (c == this.permits[i].company)) && // Matches company

              ((p) && (p == this.permits[i].project)) && // Matches project

              //(((p) && (p == this.permits[i].project)) || ((inherit === true) && (this.permits[i].project == 0))) &&
              (((u) && (u == this.permits[i].user)) || ((inherit === true) && (this.permits[i].user == 0))) // Matches user or inherits from project level
            ) {
            if (! tmp[this.permits[i].resourceType]) {
              tmp[this.permits[i].resourceType] = [];
            }
            if (! tmp[this.permits[i].resourceType][this.permits[i].resourceId]) {
              tmp[this.permits[i].resourceType][this.permits[i].resourceId] = this.permits[i].maxAllowed;
            } else { // Be restrictive.
              if (tmp[this.permits[i].resourceType][this.permits[i].resourceId] > this.permits[i].maxAllowed) {
                tmp[this.permits[i].resourceType][this.permits[i].resourceId] = this.permits[i].maxAllowed;
              }
            }
          }
        }
        for (var key in tmp) {
          if (rids === null) {
            rids = {};
          }
          if (! rids[key]) {
            rids[key] = [];
          }
          for (var key2 in tmp[key]) {
            if (tmp[key][key2] != 0) {
              rids[key].push(key2);
            }
          }
        }
        return rids;
      }
    }

    quotashares.permits = new QueuePermits();

    quotashares.loadQuotaShares = function loadQuotaShares(mysqlClient, cb) {
      quotashares.permits.clear();

      var company;
      var user;
      var project;
      var resourceType;
      var resourceId;
      var maxallowed;
      try {
        mysqlClient.query(SQL.getquotashares, function(err, rows, fields) {

          if (err) {
            logger.log('Error from MYSQL query:');
            logger.log(err);
            cb(err);
            return;
          }

          var records = [];
          var i, j, record;
          if (rows.length !== 0) {
            for (i = 0; i < rows.length; i++) {
              company = rows[i]['COMPANY_ID'] || 0;
              user = rows[i]['USER_ID'] || 0;
              project = rows[i]['PROJECT_ID'] || 0;
              resourceType = rows[i]['RESOURCE_TYPE'] || '';
              resourceId = rows[i]['RESOURCE_ID'] || 0;
              maxallowed = rows[i]['MAX_ALLOWED'] || 0;
              switch (resourceType) {
                //case 'IP_DATA':
                case 'IP_DATA_LIB':
                case 'SHARED_DATA':
                case 'USER_DATA':
                case 'IP_DOCS':
                case 'TOOL_DOCS':
                  //console.log(company, user, project, resourceType, resourceId, maxallowed);
                  quotashares.permits.add(company, user, project, quotashares.resourceTypes[resourceType], resourceId, maxallowed);
                  break;
                default:
                  break;
              }
            }
          }
          cb(null, 'Quotashares loaded');
        });
      } catch (ex) {
        logger.log( util.inspect(ex, null));
        cb('Load quotashares FATAL ERROR:' + util.inspect(ex, null));
        return;
      }
    }

    // Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = quotashares;
    }
    // AMD / RequireJS
    else if (typeof define !== 'undefined' && define.amd) {
        define([], function () {
            return quotashares;
        });
    }
    // included directly via <script> tag
    else {
        root.quotashares = quotashares;
    }

}());
