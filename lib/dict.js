var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;
var nt = require('./tools');

(function () {
  var dict = {};

  // global on the server, window in the browser
  var root, previous_dict;

  root = this;
  if (root != null) {
    previous_dict = root.dict;
  }

  dict.noConflict = function () {
    root.dict = previous_dict;
    return dict;
  };

  dict.dictDefs = [];

  dict.length = function length() {
    return dict.dictDefs.length;
  }

  dict.dump = function dump() {
    console.log('--- dict begin ---');
    for (var x = 0; x < dict.dictDefs.length; x++) {
      console.log(x, JSON.stringify(dict.dictDefs[x]));
    }
    console.log('--- dict end ---');
  }

  dict.loadDict = function loadDict(mysqlClient, cb) {
    //SELECT * FROM CLOUDS WHERE ACTIVE = 'Y' ORDER BY CLOUD_TYPE;
    dict.dictDefs = [];
    var record = {};
    try {
      mysqlClient.query(SQL.dict, function(err, rows, fields) {
        if (err) {
          console.log('Error from MYSQL query:');
          console.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name.toLowerCase()] = rows[i][fields[j].name];
            }
            dict.dictDefs.push(record);
          }
        }
        cb(null, 'Dict loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load dict FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  }

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dict;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return dict;
    });
  }
  // included directly via <script> tag
  else {
    root.dict = dict;
  }
}());
