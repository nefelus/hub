// ------------------------------------------------------------------------
// Copyright (C) 2012-2023 Nefelus Inc
// All rights reserved.
//
// SPDX-License-Identifier: BSD-3-Clause
//
// Author: Giannis Kosmas <kosmas@nefelus.com>
//
// This source code is licensed under the BSD-3-Clause license found in the
// LICENSE.txt file in the root directory of this source tree.
// ------------------------------------------------------------------------

//  ID int CLOUD_ID int TOOL_ID int VIRTUALIZATION AMI ACTIVE 
var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
  var toolapps = {};

  // global on the server, window in the browser
  var root, previous_toolapps;

  root = this;
  if (root != null) {
    previous_toolapps = root.toolapps;
  }

  toolapps.noConflict = function () {
    root.toolapps = previous_toolapps;
    return toolapps;
  };

  toolapps.toolappsDefs = [];

  toolapps.length = function length() {
    return toolapps.toolappsDefs.length;
  };

  toolapps.dump = function dump() {
    console.log('--- toolapps begin ---');
    for (var x = 0; x < toolapps.toolappsDefs.length; x++) {
      console.log(x, JSON.stringify(toolapps.toolappsDefs[x]));
    }
    console.log('--- toolapps end ---');
  };

  toolapps.get = function get(tool, key, def) {
    for (var i = 0; i < toolapps.toolappsDefs.length; i++) {
      if (tool == toolapps.toolappsDefs[i]['ID']) {
        return toolapps.toolappsDefs[i][key] || def;
      }
    }
    return 0;
  };

  toolapps.getVendor = function getVendor(tool) {
    var mp = toolapps.get(tool, 'VENDOR_ID', 0);
    return mp;
  };

  toolapps.getMountPoint = function getMountPoint(tool) {
    var mp = toolapps.get(tool, 'MOUNT_POINT_ID', 0);
    return mp;
  };

  toolapps.getAdditionalMountPoints = function getAdditionalMountPoints(tool) {
    var mp = toolapps.get(tool, 'ADDITIONAL_MOUNTPOINT_IDS', 0);
    if (mp !== 0) {
      mp = mp.replace(/ /g, '').replace(/,$/, '');
      if (mp.length == 0) {
        mp = 0;
      } else {
        mp = mp.split(',');
      }
    }
    return mp;
  };

  toolapps.getXtermSupport = function getXtermSupport(tool) {
    var xts = toolapps.get(tool, 'XTERM_SUPPORT', 'N');
    var rval = 'NO';
    switch (xts) {
      case 'N' : rval = 'NO'; break;
      case 'Y' : rval = 'YES'; break;
      case 'I' : rval = 'INSTALL'; break;
      case 'W' : rval = 'WINDOWMANAGER'; break;
      default  : break;
    }
    return rval;
  };

  toolapps.loadToolApps = function loadToolApps(mysqlClient, cb) {
    //SELECT * FROM IMAGES WHERE ACTIVE = 'Y' ORDER BY CLOUD_ID, TOOL_ID, VIRTUALIZATION;
    toolapps.toolappsDefs = [];
    var record = {};
    try {
      mysqlClient.query(SQL.toolapps, function(err, rows, fields) {
        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name] = rows[i][fields[j].name];
              if ((typeof record[fields[j].name] === 'object') && (record[fields[j].name] !== null)) {
                record[fields[j].name] += '';
              }
            }
            toolapps.toolappsDefs.push(record);
          }
        }
        cb(null, rows.length+' toolapps loaded');
      });
    } catch (ex) {
      logger.log( util.inspect(ex, null));
      cb('Load toolapps FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  };

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = toolapps;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return toolapps;
    });
  }
  // included directly via <script> tag
  else {
    root.toolapps = toolapps;
  }
}());
