//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
  var machines = {};

  // global on the server, window in the browser
  var root, previous_machines;

  root = this;
  if (root != null) {
    previous_machines = root.machines;
  }

  machines.noConflict = function () {
    root.machines = previous_machines;
    return machines;
  };

  machines.machineDefs = [];

  machines.length = function length() {
    return machines.machineDefs.length;
  };

  machines.dump = function dump() {
    console.log('--- machines begin ---');
    for (var x = 0; x < machines.machineDefs.length; x++) {
      console.log(x, JSON.stringify(machines.machineDefs[x]));
    }
    console.log('--- machines end ---');
  };

  machines.getName = function getName(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['name'];
      }
    }
    return null;
  };

  machines.getSpeed = function getSpeed(id) {
    var ret = machines.getName(id);
    return (ret) ? ret : '';
  };

  machines.getCloudId = function getCloudId(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['cloud_id'];
      }
    }
    return 0;
  };

  machines.exists = function exists(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return true;
      }
    }
    return false;
  };


  machines.getRootDiskSize = function getRootDiskSize(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['root_disk_size'] || null;
      }
    }
    return null;
  };

  machines.getSubnetId = function getSubnetId(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['subnet_id'] || null;
      }
    }
    return null;
  };

  machines.getEphemeral = function getEphemeral(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['ephemeral'];
      }
    }
    return 0;
  };

  machines.getAMItype = function getAMItype(id) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if (id == machines.machineDefs[i]['id']) {
        return machines.machineDefs[i]['virtualization'];
      }
    }
    return null;
  };

  machines.loadMachines = function loadMachines(mysqlClient, cb) {
    //SELECT * FROM MACHINE WHERE ACTIVE="Y" ORDER BY CLOUD, NAME;
    machines.machineDefs.length = 0;
    var record = {};
    try {
      mysqlClient.query(SQL.machines, function(err, rows, fields) {
        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name.toLowerCase()] = rows[i][fields[j].name];
            }
            machines.machineDefs.push(record);
          }
        }
        cb(null, rows.length+' machines loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load machines FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  };

  machines.machineSpeedtoMachineId = function machineSpeedtoMachineId(speed) {
    for (var i = 0; i < machines.machineDefs.length; i++) {
      if ((machines.machineDefs[i].name) && (machines.machineDefs[i].name === speed)) {
        return machines.machineDefs[i].id;
      }
    }
    return 0;
  };

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = machines;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return machines;
    });
  }
  // included directly via <script> tag
  else {
    root.machines = machines;
  }
}());

