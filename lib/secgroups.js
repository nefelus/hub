//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;
var _ = require('lodash');

(function () {
  var secgroups = {};

  // global on the server, window in the browser
  var root, previous_secgroups;

  root = this;
  if (root != null) {
    previous_secgroups = root.secgroups;
  }

  secgroups.noConflict = function () {
    root.secgroups = previous_secgroups;
    return secgroups;
  };

  secgroups.secgroupsDefs = [];
  secgroups.projects = [];

  secgroups.length = function length() {
    return secgroups.secgroupsDefs.length;
  };

  secgroups.dump = function dump() {
    console.log('--- secgroups begin ---');
    for (var x = 0; x < secgroups.secgroupsDefs.length; x++) {
      console.log(x, JSON.stringify(secgroups.secgroupsDefs[x]));
    }
    console.log('--- secgroups end ---');
  };

  secgroups.getRules = function getRules(companyId, projectId) {
    if (! companyId) {
      companyId=0;
    }
    if (! projectId) {
      projectId=0;
    }
    if (_.findIndex(secgroups.projects, {company: companyId, project:  projectId}) === -1) {
      projectId=0;
      if (_.findIndex(secgroups.projects, {company: companyId, project:  projectId}) === -1) {
        companyId=0;
      }
    }
    var res = [];
    for (var i = 0; i < secgroups.secgroupsDefs.length; i++) {
      if ((companyId == secgroups.secgroupsDefs[i]['company_id']) && (projectId == secgroups.secgroupsDefs[i]['project_id'])) {
        res.push({
                   direction: secgroups.secgroupsDefs[i]['direction'],
                   interface: secgroups.secgroupsDefs[i]['interface'],
                   protocol: secgroups.secgroupsDefs[i]['protocol'],
                   address: secgroups.secgroupsDefs[i]['address'],
                   ports: secgroups.secgroupsDefs[i]['ports'],
                   condition: secgroups.secgroupsDefs[i]['condition']
                 });
      }
    }
    return res;
  };

  secgroups.loadSecGroups = function loadSecGroups(mysqlClient, cb) {
    secgroups.secgroupsDefs.length = 0;
    secgroups.projects.length = 0;
    var record = {};
    try {
      mysqlClient.query(SQL.secgroups, function(err, rows, fields) {
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
            }
            if (_.findIndex(secgroups.projects, {company: record.company_id, project:  record.project_id}) === -1) {
              secgroups.projects.push({company: record.company_id, project: record.project_id });
            }
            secgroups.secgroupsDefs.push(record);
          }
        }
        cb(null, 'SecGroups loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load secgroups FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  };

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = secgroups;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return secgroups;
    });
  }
  // included directly via <script> tag
  else {
    root.secgroups = secgroups;
  }
}());

