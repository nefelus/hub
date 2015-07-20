var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
    var quotas = {};

    // global on the server, window in the browser
    var root, previous_quotas;

    root = this;
    if (root != null) {
      previous_quotas = root.quotas;
    }

    quotas.noConflict = function () {
        root.quotas = previous_quotas;
        return quotas;
    };

    var QueueStats = function QueueStats() {
      this.statsarray = [];

      this.clear = function () {
        this.statsarray.length = 0;
      }

      this.add = function (company, user, project, tool, machine) {
        this.statsarray.push({'company' : company,
                              'user' : user,
                              'project' : project,
                              'tool' : tool,
                              'machine' : machine
                             });
      };

      this.length = function () {
        return this.statsarray.length;
      }

      this.dump = function () {
        console.log('--- queue stats begin ---');
        for (var x = 0; x < this.statsarray.length; x++) {
          console.log(x, JSON.stringify(this.statsarray[x]));
        }
        console.log('--- queue stats end ---');
      }

      this.getStats = function (opt) {
        var c = 0;
        var u = 0;
        var p = 0;
        var t = 0;
        var m = 0;
        var cnt = 0;
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
          if (opt.tool) {
            t = opt.tool;
          }
          if (opt.machine) {
            m = opt.machine;
          }
        }
        for (var i=0; i < this.statsarray.length; i++) {
          if (((c == 0) || (c == this.statsarray[i].company)) &&
              ((u == 0) || (u == this.statsarray[i].user)) &&
              ((p == 0) || (p == this.statsarray[i].project)) &&
              ((t == 0) || (t == this.statsarray[i].tool)) &&
              ((m == 0) || (m == this.statsarray[i].machine))) {
            cnt++;
          }
        }
        return cnt;
      }

    }

    var QueueLimits = function QueueLimits() {
      this.limits = [];

      this.clear = function () {
        this.limits.length = 0;
      }

      this.add = function (company, user, project, resourceType, resourceId, maxAllowed) {
        this.limits.push({'company' : company,
                          'user' : user,
                          'project' : project,
                          'resourceType' : resourceType,
                          'resourceId' : resourceId,
                          'maxAllowed' : maxAllowed
                         });
      };

      this.length = function () {
        return this.limits.length;
      }

      this.dump = function () {
        console.log('--- queue limits begin ---');
        for (var x = 0; x < this.limits.length; x++) {
          console.log(x, JSON.stringify(this.limits[x]));
        }
        console.log('--- queue limits end ---');
      }

      this.getLimits = function (opt, severity) {
        var c = 0;
        var u = 0;
        var p = 0;
        var t = 0;
        var rid = 0;
        //console.log(opt);
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
          if (opt.resourceType) {
            t = opt.resourceType;
          }
          if (opt.resourceId) {
            rid = opt.resourceId;
          }
        }

        if (severity === undefined) {
          severity = false;
        }
        var res = null;
        if (severity !== false) {
          res = [{'maxAllowed' : 0}];
        }

        for (var i=0; i < this.limits.length; i++) {
          if ((c == this.limits[i].company) && (u == this.limits[i].user) && (p == this.limits[i].project) &&
              (t == this.limits[i].resourceType) && ((rid == this.limits[i].resourceId) || (this.limits[i].resourceId == 0))
             ) {
            if (res === null) {
              res = [{'maxAllowed' : this.limits[i].maxAllowed}];
            } else {
              res.push({'maxAllowed' : this.limits[i].maxAllowed});
            }
          }
        }
        return res;
      }

      this.resolveLimits = function(opt) {
        var c = 0;
        var u = 0;
        var p = 0;
        var t = 0;
        var m = 0;
        //console.log("----", opt);
        var candidateOpts;

        candidateOpts = [{'resourceType' : 'SESSIONS', 'resourceId' : 0}, // Total system machines
                         {'company' : c, 'resourceType' : 'SESSIONS', 'resourceId' : 0}, // Total company machines
                         {'company' : c, 'user' : u, 'resourceType' : 'SESSIONS', 'resourceId' : 0}, // Total user machines
                         {'company' : c, 'project' : p, 'resourceType' : 'SESSIONS', 'resourceId' : 0}, // Total project machines
                         {'company' : c, 'user' : u, 'project' : p, 'resourceType' : 'SESSIONS', 'resourceId' : 0}, // Total project/user machines
                        ];

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
          if (opt.tool) {
            t = opt.tool;
            candidateOpts = [{'resourceType' : 'TOOLS', 'resourceId' : t}, // Total system tool licenses
                             {'company' : c, 'resourceType' : 'TOOLS', 'resourceId' : t}, // Total company tool licenses
                             {'company' : c, 'user' : u, 'resourceType' : 'TOOLS', 'resourceId' : t}, // Total user tool licenses
                             {'company' : c, 'project' : p, 'resourceType' : 'TOOLS', 'resourceId' : t}, // Total user tool licenses
                             {'company' : c, 'user' : u, 'project' : p, 'resourceType' : 'TOOLS', 'resourceId': t} // Total /project user tool licenses
                            ];
          }
          if (opt.machine) {
            m = opt.machine;
            candidateOpts = [{'resourceType' : 'MACHINES', 'resourceId' : m}, // Total system machines of machineType
                             {'company' : c, 'resourceType' : 'MACHINES', 'resourceId' : m}, // Total company machines of machineType
                             {'company' : c, 'user' : u, 'resourceType' : 'MACHINES', 'resourceId' : m}, // Total user machines of machineType
                             {'company' : c, 'project' : p, 'resourceType' : 'MACHINES', 'resourceId' : m}, // Total project machines of machineType
                             {'company' : c, 'user' : u, 'project' : p, 'resourceType' : 'MACHINES', 'resourceId' : m}, // Total project/user machines of machineType
                            ];
          }
        }

        var candidates = [];

        var q = null;

        for (var co = 0; co < candidateOpts.length; co++) {
          q = this.getLimits(candidateOpts[co]);

          if (q) {
            //console.log(candidateOpts[co]);
            //console.log(q);
            for (var qi = 0; qi < q.length; qi++) {
              candidates.push(q[qi]);
            }
          }
        }

        //console.log("===");
        //console.log(opt);
        //console.log(candidates);
        var res = -1;
        for (var i = 0; i < candidates.length; i++) {
          if ((candidates[i].maxAllowed < res) || (res == -1)) {
            res = candidates[i].maxAllowed;
          }
        }
        if (res == -1) {
          res = 0;
        }
        // console.log(res);
        return res;
      }

    }

    quotas.stats = new QueueStats();
    quotas.limits = new QueueLimits();

    quotas.loadQueueQuotas = function loadQueueQuotas(mysqlClient, defmax, cb) {
      quotas.limits.clear();

      if (cb === undefined) {
        cb = defmax;
        defmax = 0;
      }

      var company;
      var user;
      var project;
      var resourceType;
      var resourceId;
      var maxallowed;
      try {
        //'SELECT * FROM QUEUE_QUOTA WHERE ADMIN != "N" ORDER by COMPANY_ID,USER_ID,PROJECT_ID, RESOURCE_TYPE, RESOURCE_ID;
        mysqlClient.query(SQL.getqueuequotas, function(err, rows, fields) {

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
                case 'SESSIONS':
                case 'TOOLS':
                case 'MACHINES':
                  //console.log(company, user, project, resourceType, resourceId, maxallowed);
                  quotas.limits.add(company, user, project, resourceType, resourceId, maxallowed);
                  break;
                case 'SHARED_DATA':
                case 'USER_DATA':
                case 'IP_DATA':
                case 'IP_DATA_LIBS':
                case 'IP_DOCS':
                case 'TOOL_DOCS':
                  //console.log(company, user, project, resourceType, resourceId, maxallowed);
                  break;
                default:
                  break;
              }
            }
          } else {
            quotas.limits.add(0, 0, 0, 'SESSIONS', 0, defmax, true);
            quotas.limits.add(0, 0, 0, 'TOOLS', 0, defmax, true);
            quotas.limits.add(0, 0, 0, 'MACHINES', 0, defmax, true);
          }
          cb(null, 'Quotas loaded');
        });
      } catch (ex) {
        logger.log( util.inspect(ex, null));
        cb('Load quotas FATAL ERROR:' + util.inspect(ex, null));
        return;
      }
    }

    quotas.checkQueueQuota = function checkQueueQuota(companyId, userId, projectId, toolId, machineId, severity, debug) {

      if (severity === undefined) {
        severity = false;
      }

      var used = {
        systemSessions : this.stats.getStats({}),
        systemMachine : this.stats.getStats({machine : machineId}),
        systemTool : this.stats.getStats({tool : toolId}),

        companySessions : this.stats.getStats({company : companyId}),
        companyMachine : this.stats.getStats({company : companyId, machine : machineId}),
        companyTool : this.stats.getStats({company : companyId, tool : toolId}),

        userSessions : this.stats.getStats({company : companyId, user : userId}),
        userMachine : this.stats.getStats({company : companyId, user : userId, machine : machineId}),
        userTool : this.stats.getStats({company : companyId, user : userId, tool : toolId}),

        projectSessions : this.stats.getStats({company : companyId, project : projectId}),
        projectMachine : this.stats.getStats({company : companyId, project : projectId, machine : machineId}),
        projectTool : this.stats.getStats({company : companyId, project : projectId, tool : toolId}),

        userProjectSessions : this.stats.getStats({company : companyId, user : userId, project : projectId}),
        userProjectMachine : this.stats.getStats({company : companyId, user : userId, project : projectId, machine : machineId}),
        userProjectTool : this.stats.getStats({company : companyId, user : userId, project : projectId, tool : toolId}),
      }

      var limits = {
        systemSessions : this.limits.resolveLimits({}),
        systemMachine : this.limits.resolveLimits({machine : machineId}),
        systemTool : this.limits.resolveLimits({tool : toolId}),

        companySessions : this.limits.resolveLimits({company : companyId}),
        companyMachine : this.limits.resolveLimits({company : companyId, machine : machineId}),
        companyTool : this.limits.resolveLimits({company : companyId, tool : toolId}),

        userSessions : this.limits.resolveLimits({company : companyId, user : userId}),
        userMachine : this.limits.resolveLimits({company : companyId, user : userId, machine : machineId}),
        userTool : this.limits.resolveLimits({company : companyId, user : userId, tool : toolId}),

        projectSessions : this.limits.resolveLimits({company : companyId, project : projectId}),
        projectMachine : this.limits.resolveLimits({company : companyId, project : projectId, machine : machineId}),
        projectTool : this.limits.resolveLimits({company : companyId, project : projectId, tool : toolId}),

        userProjectSessions : this.limits.resolveLimits({company : companyId, user : userId, project : projectId}),
        userProjectMachine : this.limits.resolveLimits({company : companyId, user : userId, project : projectId, machine : machineId}),
        userProjectTool : this.limits.resolveLimits({company : companyId, user : userId, project : projectId, tool : toolId})
      };

      var checkResult = { session : {system : (used.systemSessions < limits.systemSessions),
                                     company : (used.companySessions < limits.companySessions),
                                     project : (used.projectSessions < limits.projectSessions),
                                     userProject : (used.userProjectSessions < limits.userProjectSessions),
                                     user : (used.userSessions < limits.userSessions)
                                    },
                             tool : {system : (used.systemTool < limits.systemTool),
                                     company : (used.companyTool < limits.companyTool),
                                     project : (used.projectTool < limits.projectTool),
                                     userProject : (used.userProjectTool < limits.userProjectTool),
                                     user : (used.userTool < limits.userTool)
                                    },
                          machine : {system : (used.systemMachine < limits.systemMachine),
                                     company : (used.companyMachine < limits.companyMachine),
                                     project : (used.projectMachine < limits.projectMachine),
                                     userProject : (used.userProjectMachine < limits.userProjectMachine),
                                     user : (used.userMachine < limits.userMachine)
                                    }
                        };

      if (debug != 0) {
        if ((debug==2) || ((debug==1) && (! checkResult.session.system))) {
          console.log('systemSessions: ', used.systemSessions, limits.systemSessions, checkResult.session.system);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.machine.system))) {
          console.log('systemMachine: ', used.systemMachine, limits.systemMachine, checkResult.machine.system);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.tool.system))) {
          console.log('systemTool: ', used.systemTool, limits.systemTool, checkResult.tool.system);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.session.company))) {
          console.log('companySessions: ', used.companySessions, limits.companySessions, checkResult.session.company);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.machine.company))) {
          console.log('companyMachine: ', used.companyMachine, limits.companyMachine, checkResult.machine.company);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.tool.company))) {
          console.log('companyTool: ', used.companyTool, limits.companyTool, checkResult.tool.company);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.session.user))) {
          console.log('userSessions: ', used.userSessions, limits.userSessions, checkResult.session.user);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.machine.user))) {
          console.log('userMachine: ', used.userMachine, limits.userMachine, checkResult.machine.user);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.tool.user))) {
          console.log('userTool: ', used.userTool, limits.userTool, checkResult.tool.user);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.session.project))) {
          console.log('projectSessions: ', used.projectSessions, limits.projectSessions, checkResult.session.project);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.machine.project))) {
          console.log('projectMachine: ', used.projectMachine, limits.projectMachine, checkResult.machine.project);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.tool.project))) {
          console.log('projectTool: ', used.projectTool, limits.projectTool, checkResult.tool.project);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.session.userProject))) {
          console.log('userProjectSessions: ', used.userProjectSessions, limits.userProjectSessions, checkResult.session.userProject);
        }
        if ((debug==2) || ((debug==1) && (!checkResult.machine.userProject))) {
          console.log('userProjectMachine: ', used.userProjectMachine, limits.userProjectMachine, checkResult.machine.userProject);
        }
        if ((debug==2) || ((debug==1) && (! checkResult.tool.userProject))) {
          console.log('userProjectTool : ', used.userProjectTool, limits.userProjectTool, checkResult.tool.userProject);
        }
      }

      var result = (checkResult.session.system &&
                    checkResult.session.company &&
                    checkResult.session.project &&
                    checkResult.session.userProject &&
                    checkResult.session.user &&
                    checkResult.tool.system &&
                    checkResult.tool.company &&
                    checkResult.tool.project &&
                    checkResult.tool.userProject &&
                    checkResult.tool.user &&
                    checkResult.machine.system &&
                    checkResult.machine.company &&
                    checkResult.machine.project &&
                    checkResult.machine.userProject &&
                    checkResult.machine.user);
      if (result) {
        return true;
      } else {
        return JSON.stringify(checkResult).replace(/false/g,'0').replace(/true/g,'1');
      }
    }

    // Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = quotas;
    }
    // AMD / RequireJS
    else if (typeof define !== 'undefined' && define.amd) {
        define([], function () {
            return quotas;
        });
    }
    // included directly via <script> tag
    else {
        root.quotas = quotas;
    }

}());
