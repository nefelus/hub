//------------------------------------------------------------------------
//
// This is part of Nefelus
//
// Author    : Giannis Kosmas <kosmasgiannis@gmail.com>
// Date      : 2012-12-26
// Copyright : Nefelus INC,  2012-2014
//------------------------------------------------------------------------

/*
var memwatch = require('memwatch');
var heapdump = require('heapdump');
memwatch.on('stats', function(stats) {
  console.error(stats);
});
memwatch.on('leak', function(info) {
 console.error(info);
 var file = './tmp/myapp-' + process.pid + '-' + Date.now() + '.heapsnapshot';
 heapdump.writeSnapshot(file, function(err){
   if (err) console.error(err);
   else console.error('Wrote snapshot: ' + file);
  });
});
*/

var HUBversion = 'v1.5.0';

var NEFELUS_HUB_FEATURE = 'af04a46364987c32b0664750ea50d7df'; // Nefelus HUB 1.0

var constants  = require('constants');
var util       = require('util');
var path       = require('path');
var mysql      = require('mysql');
var SQL        = require('./sqlTemplates').sqlTemplates;
var crypto     = require('crypto');
var nconf      = require('nconf');
var nt         = require('./lib/tools');
var http       = require('http');
var https      = require('https');
var _          = require('lodash');
var fs         = require('fs');

var AWS = require('aws-sdk');

var dns           = require('./lib/dns');
var UUID       = require('node-uuid');
var exec       = require('child_process').exec;
var tmp        = require('tmp');
var time       = require('time')(Date);
var timediff   = require('timediff');
var async      = require('async');
var envconf    = new nconf.Provider();
var logger     = require('./lib/logging').logger;
var images = require('./lib/images');
var machines = require('./lib/machines');
var secgroups = require('./lib/secgroups');
var quotas = require('./lib/quotas');
var quotashares = require('./lib/quotashares');
var clouds = require('./lib/clouds');
var shares = require('./lib/shares');
var toolapps = require('./lib/toolapps');
var machines = require('./lib/machines');
var _nslm = require('./lib/nslmlib');

envconf.env();

var isJX = (path.basename(process.argv[0]) === 'jx');
var myargs = ((path.basename(process.argv[0]) === 'node') ||
              (path.basename(process.argv[0]) === 'jx')) ?
             process.argv.slice(2) : process.argv.slice(1);

logger.log('--------------------------------------------------');
logger.log('-             Nefelus HUB ' + HUBversion + '                 -');
logger.log('--------------------------------------------------');

if ((myargs[0] === '-V') || (myargs[0] === '--version')) {
  process.exit(0);
}

logger.log('CWD :' +  process.cwd());
logger.log('--------------------------------------------------');

var pendingWereNone = false;
var pendingNoneCnt  = 0;
var PENDING_NONE_TIMES_TO_SKIP = 20;
var RESTART_LIMIT = 5;
var DB_UPDATES  = true;
var mysqlPool = null;
var mysqlConfig = null;
var mystate     = null;
var Instances = [];
var Tickets = [];
var Sessions = [];

var skippedSessions = {} ;
var SKIP_CYCLES = 4;

tmp.setGracefulCleanup();

var runningMode = envconf.get('NODE_ENV') || 'production';
logger.log('Running Mode : ' + runningMode);

var configFilename = __dirname + '/config.json.in';
if (runningMode === 'production') {
  configFilename = __dirname + '/config.json';
}
logger.log('Config file : ' + configFilename);
if (! nt.isReadableSync(configFilename)) {
  logger.log('Configuration file '+configFilename+' not accessible. Exiting...');
  process.exit();
}

var HEALTH_CHECK_INTERVAL = 30000; // 30 secs
var CONSOLE_CHECK_INTERVAL = 5000; // 5 secs
var CONSOLE_CHECK_MAX_TIMES = 60;  // 60 times * 5 secs = 5 minutes
var env = process.env;
var mainconf = new nconf.Provider();

var sslOptions = false;
var sslMasterPack = false;
var masterScripts = false;
var aws;
var awsParams = {};
var r53info;
var dnsPostprocess;

var EC2_TIMEOUT;
var EC2_MAX_TRIES;

var keyName;
var securityGroup;
var workerUsername;
var setloginuser;
var setsecgroups;
var noVNCdebug;

var hubType;
var hubPort;
var hubHost;
var hubProtocol;

var timezone = null;
var vncLocalOnly;
var staticUserData;
var xtermSupport;
var logURLproto;
var vncURLproto;
var cmdURLproto;
var logURLport;
var vncURLport;
var cmdURLport;
var x11IdleTimeout;
var homeBlacklistPatterns = [];
var sessionsPath;
var ignoreOldSessions;
var MAX_RUNNING_JOBS_ALLOWED;
var db;
var timerID = null;
var masterDebug = false;
var adminEmail;
var MySQLParamsLoaded = false;
var lastUpdatedSettings = {'config' : null, 'frequency' : 6, 'count' : 0};
var ep; // EC2 endpoint
var EC2Params;
var ec2;
var r53;
var cancelHours = 0;
var forceCancelHours = 0;
var cancelHoursTimer = null;
var licserverInfo;
var nslm = null;
var nslmSessionIsActive = false;

loadConfig();

var hubSession = new nconf.Provider();
if (fs.existsSync(sessionsPath + '/hubSession.json')) {
  var stats = fs.lstatSync(sessionsPath + '/hubSession.json');

  if (stats.size == 0) {
    try {
      fs.unlinkSync(sessionsPath + '/hubSession.json');
    } catch (e) {}
  }
}
hubSession.file({file: sessionsPath + '/hubSession.json'});

//process.on('uncaughtException', function(err) {
  //logger.log('UNCAUGHT EXCEPTION!!!');
  //logger.log(util.inspect(err, { showHidden: true, depth: null }));
  ////SaveSession();
//});

function mayIExit() {
  if ((lmDispatcherIsRunning === false) && (dispatcherIsRunning === false)) {
    logger.log('See you later aligator...');
    process.exit();
  }
}


function sigintHandler() {
  logger.log('Got SIGINT or SIGTERM.');
  if (timerID !== null) {
    logger.log('Exiting...');
    clearInterval(timerID);
    if (mysqlPool) {
      logger.log('Pool connections: all:', mysqlPool._allConnections.length,
                 ' free:', mysqlPool._freeConnections.length,
                 'length:', mysqlPool._connectionQueue.length);
      mysqlPool.end(function() {
        if (nslm !== null) {
          nslm.end(function(err, data) {
            timerID = setInterval(mayIExit, 100);
          });
        } else {
          timerID = setInterval(mayIExit, 100);
        }
      });
    }
  }
}

process.on('SIGINT', sigintHandler);

process.on('SIGTERM', sigintHandler);

process.on('SIGHUP', function () {
  logger.log('Got SIGHUP, reloading config file:' + configFilename);
  loadConfig();
});

if (ignoreOldSessions !== true) {
  Instances = hubSession.get('Instances') || [];
  Tickets = hubSession.get('Tickets') || [];
  Sessions = hubSession.get('Sessions') || [];
}

var sessionStatusCodes = [
  'initialize',
  'initializing',
  'initialized',
  'download',
  'downloading',
  'downloaded',
  'downloadData',
  'downloadingData',
  'downloadedData',
  'downloadTool',
  'downloadingTool',
  'downloadedTool',
  'execute',
  'executing1',
  'executing2',
  'executed',
  'cancel',
  'canceling',
  'canceled',
  'upload',
  'uploading',
  'uploaded',
  'cleanup',
  'cleaningup',
  'cleanedup',
  'finished'
];

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function loadConfig() {
  mainconf.argv()
          .env()
          .file({file: configFilename})
          .defaults({
            hub : {
              port : 8585,
              host : 'localhost',
              ssl : false
            },
            ignoreOldSessions: false,
            sessionsPath : '/var/run/hub'
          });

  timezone = mainconf.get('timezone') || null;
  hubPort = mainconf.get('hub:port');
  hubHost = mainconf.get('hub:host');
  var ssl = mainconf.get('hub:ssl');
  hubProtocol = 'http';
  if (ssl !== false) {
    var sslKey = '';
    var sslCert = '';
    var sslCa = '';
    sslOptions = false;
    if ((ssl.key !== '') && (nt.isReadableSync(ssl.key))) {
      sslKey = fs.readFileSync(ssl.key);
    }
    if ((ssl.cert !== '') && (nt.isReadableSync(ssl.cert))) {
      sslCert = fs.readFileSync(ssl.cert);
    }
    if ((ssl.ca !== '') && (nt.isReadableSync(ssl.ca))) {
      sslCa = fs.readFileSync(ssl.ca);
    }
    if ((ssl.masterPack) && (ssl.masterPack !== '') &&
        (nt.isReadableSync(ssl.masterPack))) {
      sslMasterPack = fs.readFileSync(ssl.masterPack);
    }
    if ((sslKey !== '') && (sslCert !== '')) {
      hubProtocol = 'https';
      sslOptions = {
        //
        // This is the default secureProtocol used by Node.js, but it might be
        // sane to specify this by default as it's required if you want to
        // remove supported protocols from the list. This protocol supports:
        //
        // - SSLv2, SSLv3, TLSv1, TLSv1.1 and TLSv1.2
        //
        secureProtocol: 'SSLv23_method',
        //
        // Supply `SSL_OP_NO_SSLv3` constant as secureOption to disable SSLv3
        // from the list of supported protocols that SSLv23_method supports.
        //
        secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3,

        // Based on whitelist proposed at: https://bugs.ruby-lang.org/issues/9424
        // And SSL/TLS Best Practices: https://www.ssllabs.com/downloads/SSL_TLS_Deployment_Best_Practices_1.3.pdf
        // Node v0.10.x doesn't support ECDH ciphers, but this list allows them when upgrading to v0.12.
        ciphers: 'ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:RSA+AES:!aNULL:!MD5:!DSS',

        // When enabled, server chooses cipher, not client.
        honorCipherOrder: true,

        key: sslKey,

        cert: sslCert
      };

      if (sslCa !== '') {
        sslOptions['ca'] = sslCa;
      }
    }
  }
  aws = mainconf.get('aws');
  awsParams = {
    'accessKeyId' : mainconf.get('aws:ec2:accessKeyId'),
    'secretAccessKey' : mainconf.get('aws:ec2:secretAccessKey'),
    'region' : mainconf.get('aws:ec2:region') || 'us-east-1'
  }
  awsAccountId = mainconf.get('aws:ec2:accountId');
  dnsPostprocess = mainconf.get('aws:dnsPostprocess') || 'route53';
  r53info = mainconf.get('aws:route53') || null;

  if (nt.isEmpty(r53info)) {
    r53info = null;
  }

  AWS.config.update(awsParams);

  EC2Params = {};
  if (aws && aws.ec2 && aws.ec2.endPoint &&  (! nt.isEmpty(aws.ec2.endPoint))) {
    //'endpoint' : {'protocol' : 'http', 'host' : 'nefelus-master-radosgw.acmac.uoc.gr', 'port' : 80, 'path' : '/'}
    var endpoint;
    var _ep = aws.ec2.endPoint.endpoint;
    if (typeof _ep === 'string') {
      endpoint = _ep;
    } else {
      var epproto = _ep.protocol || 'http';
      var epport = ((_ep.port == 80) && (epproto == 'http')) ? '' : (((_ep.port == 443) && (epproto == 'https')) ? '' : ':'+_ep.port);
      endpoint = epproto + '://'+ _ep.host + epport+ (_ep.path || '/');
    }

    ep = new AWS.Endpoint(endpoint);

    if (ep !== null) {
      EC2Params['endpoint'] =  ep;
    }

    var signver = aws.ec2.endPoint.signatureVersion || null;
    if (signver !== null) {
      EC2Params['signatureVersion'] = signver;
    }
  }
  ec2 = new AWS.EC2(EC2Params);
  r53 = new AWS.Route53(EC2Params);

  EC2_TIMEOUT = mainconf.get('aws:ec2_timeout') || 10000;
  EC2_MAX_TRIES = mainconf.get('aws:ec2_max_tries') || 60;

  masterScripts = mainconf.get('nefelus:masterScripts') || false;
  if (masterScripts && (masterScripts !== '') && (nt.isReadableSync(masterScripts))) {
    masterScripts = fs.readFileSync(masterScripts);
  } else {
    masterScripts = false;
  }
  vncLocalOnly = nt.isTrue(mainconf.get('vncLocalOnly'));
  staticUserData = mainconf.get('staticUserData') || {};
  xtermSupport = mainconf.get('xterm') || 'NO';
  keyName = mainconf.get('aws:ec2:keyName') || null;
  securityGroup = mainconf.get('aws:ec2:securityGroup') || 'default';
  setloginuser = mainconf.get('setloginuser') || false;
  setsecgroups = mainconf.get('setsecgroups') || false;
  noVNCdebug = mainconf.get('noVNCdebug') || false;
  workerUsername = mainconf.get('nefelus:username');
  logURLproto = mainconf.get('nefelus:logURL:protocol');
  vncURLproto = mainconf.get('nefelus:vncURL:protocol');
  cmdURLproto = mainconf.get('nefelus:cmdURL:protocol');
  logURLport = mainconf.get('nefelus:logURL:port');
  vncURLport = mainconf.get('nefelus:vncURL:port');
  cmdURLport = mainconf.get('nefelus:cmdURL:port');
  x11IdleTimeout = mainconf.get('nefelus:x11IdleTimeout');
  homeBlacklistPatterns = mainconf.get('nefelus:homeBlacklistPatterns') || [];
  sessionsPath = mainconf.get('hub:sessionsPath');
  cancelHours = mainconf.get('hub:cancelHours') || 0;
  forceCancelHours = mainconf.get('hub:forceCancelHours') || ((cancelHours === 0) ? 0 : cancelHours + 2);
  if (cancelHours !== 0) {
    if (cancelHoursTimer == null) {
      cancelHoursTimer = setInterval(function() {
                                                   TerminateLongRunningSessions();
                                                }, 300000); // check every 5 minutes
    }
  } else {
    if (cancelHoursTimer !== null) {
      clearInterval(cancelHoursTimer);
      cancelHoursTimer = null;
    }
  }
  ignoreOldSessions = mainconf.get('ignoreOldSessions');
  adminEmail = mainconf.get('adminEmail');
  masterDebug = mainconf.get('nefelus:masterDebug') || false;
  MAX_RUNNING_JOBS_ALLOWED = mainconf.get('hub:maxRunningJobsAllowed') || 0;
  MAX_RUNNING_JOBS_ALLOWED = Number(MAX_RUNNING_JOBS_ALLOWED);
  db = mainconf.get('database');
  hubType = mainconf.get('hubType') || 'production';
  mysqlConfig = {
    'host'     : db.host,
    'user'     : db.user,
    'password' : db.password,
    'database' : db.database,
    'connectTimeout'  : db.connectTimeout || 30000,
    'acquireTimeout'  : db.acquireTimeout || 30000,
    'timezone' : 'Z'
  };
  SKIP_CYCLES = mainconf.get('hub:skipCycles') || 4;
  setupMySQL(mysqlConfig);
  emailTemplates = mainconf.get('emailTemplates') || [];
  MySQLParamsLoaded = false; // Quotas are loaded in main SQL loop.
  licserverInfo = mainconf.get('nslm') || null;
  if ((licserverInfo === null) ||
      (! ((licserverInfo.baseURL) && (typeof licserverInfo.baseURL === 'string') && (licserverInfo.baseURL !== '') &&
          (licserverInfo.accessKey) && (typeof licserverInfo.accessKey === 'string') && (licserverInfo.accessKey !== '') &&
          (licserverInfo.secretKey) && (typeof licserverInfo.secretKey === 'string') && (licserverInfo.secretKey !== '')))) {
    logger.raw.log('License Manager info not set correctly. Exiting...');
    process.exit(2);
  } else {
    if (nslm === null) {
      nslm = new _nslm({ licenseServer : licserverInfo.baseURL,
                         accessKey : licserverInfo.accessKey,
                         secretKey : licserverInfo.secretKey,
                         feature : NEFELUS_HUB_FEATURE
                       });
      nslm.start();
      nslm.on('active', function() {
        console.log('nslm is active');
        nslmSessionIsActive = true;
      });
      nslm.on('inactive', function() {
        console.log('nslm is inactive');
        nslmSessionIsActive = false;
      });
    } else {
      nslm.end(function(err, data) { // checkin old session and then start a new one.
        nslm.set('licenseServer', licserverInfo.baseURL);
        nslm.set('accessKey', licserverInfo.accessKey);
        nslm.set('secretKey', licserverInfo.secretKey);
        nslm.start();
      });
    }
  }
}

function SaveSession(exit) {
  logger.log('Saving session');
  hubSession.set('Instances', Instances);
  hubSession.set('Tickets', Tickets);
  hubSession.set('Sessions', Sessions);
  hubSession.save(function(err) {
    if (err) {
      logger.log(err);
    }
    if (exit === true) {
      logger.log('See you later alligator...');
      process.exit();
    }
  });
}

function Ticket(id) {

  this.id = id;
  this.ticketStatus = 'OPEN';
  this.toolExitCode = '0';
  this.cancelled = false;
  this.cancelPending = false;
  this.sessionStatus = '';
  this.jobStatus = '';
  this.created = new Date();
  this.machineStarted = null;
  this.jobStarted = null;
  this.internalError = '';
  this.healthCheckTimer = null;
  this.consoleCheckTimer = null;
  this.consoleCheckTimes = CONSOLE_CHECK_MAX_TIMES;
  this.restartLimit = RESTART_LIMIT;
  this.sendAlert = true;
  this.XResolution = null;
  this.XDisplay = null;
  this.logConsole = null;
  this.vncConsole = null;
  this.loginuser = 'nefelus';
  this.useradmin = '';

  this.done = {
    'preinit' : false,
    'init' : false,
    'download' : false,
    'tool' : false,
    'data' : false,
    'exec' : false,
    'upload' : false,
    'clean' : false
  };

  this.uuid = UUID.v4();

  this.req = {
    sessionId : '',
    runas : '',
    machineId : 0,
    machineSpeed : '',
    machineCount : 1,
    threadCount : null,
    instanceType : null,
    ami : null,
    commandFile : '',
    runningDir : '',
    licenseManager : '',
    jobType : 'batch'
  };

  this.master = {
    instanceId : '',
    ip : '',
    publicIp : '',
    publicDnsName : '',
    aliasDnsName : '',
    socket : null
  };

  // --- Methods ---

  this.setRequest = function (name, value) {
    if (_.isArray(name)) {
      for (var key in name) {
        if ((key === 'length') || (!name.hasOwnProperty(key))) {
          continue;
        }
        this.req[key] = name[key];
        if (key === 'sessionId') {
          Sessions[name[key]] = 't' + this.id;
        }
        if (key === 'machineId') {
          this.req.machineSpeed = machines.getSpeed(this.req.machineId);
        }
        if ((key === 'sessionId') || (key === 'machineId')) {
          if ((this.req.sessionId !== '') && (this.req.machineId !== 0)) {
            var sid = nt.parseSessionId(this.req.sessionId);
            this.req.instanceType = machines.getAMItype(this.req.machineId);
            if (this.req.instanceType) {
              this.req.ami = images.getAMI(this.req.instanceType, sid.toolId, 0); // FIXME : cloud 0 and delete line bellow
            }
          }
        }
      }
    } else {
      this.req[name] = value;
      if (name === 'sessionId') {
        Sessions[value] = 't' + this.id;
      }
      if (name === 'machineId') {
          this.req.machineSpeed = machines.getSpeed(this.req.machineId);
      }
      if ((name === 'sessionId') || (name === 'machineId')) {
        if ((this.req.sessionId !== '') && (this.req.machineId !== 0)) {
          var sid = nt.parseSessionId(this.req.sessionId);
          this.req.instanceType = machines.getAMItype(this.req.machineId);
          if (this.req.instanceType) {
            this.req.ami = images.getAMI(this.req.instanceType, sid.toolId, 0); // FIXME : cloud 0 and delete line bellow
          }
        }
      }
    }
  }

  this.get = function (name) {
    return this[name];
  }

  this.set = function (name, value) {
    if (typeof this[name] !== 'undefined') {
      this[name] = value;
    }
  }

  this.getRequest = function (name) {
    if (typeof this.req[name] !== 'undefined') {
      return this.req[name];
    }
    return null;
  }

  this.setMaster = function (name, value) {
    this.master[name] = value;
    if (name === 'instanceId') {
      Instances[value] = 't' + this.id;
    }
  }

  this.getMaster = function (name) {
    if (typeof this.master[name] !== 'undefined') {
      return this.master[name];
    }
    return null;
  }

  this.deAssociate = function() {
    this.ticketStatus = 'CLOSED';
    if (this.consoleCheckTimer != null) {
      clearInterval(this.consoleCheckTimer);
      this.consoleCheckTimer = null;
    }
    if (this.healthCheckTimer != null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.req.sessionId != '') {
      Sessions[this.req.sessionId] = null;
      delete Sessions[this.req.sessionId];
    }
    if (this.master.instanceId != '') {
      Instances[this.master.instanceId] = null;
      delete Instances[this.master.instanceId];
    }
    Tickets['t' + this.id] = null;
    delete Tickets['t' + this.id];
  }

  Tickets['t' + id] = this;
}

function getSessionByInstanceId(id) {
  var t, s, i;
  if ((typeof Instances[id] !== 'undefined') && (Instances[id] != null)) {
    i = Instances[id];
    t = Tickets[i];
    if (t.req) {
      s = t.req.sessionId;
    }
    return s;
  }
  return null;
}

function getTicketIdBySessionId(id) {
  var s;
  if ((typeof Sessions[id] !== 'undefined') && (Sessions[id] != null)) {
    s = Sessions[id];
    return s;
  }
  return null;
}

function getTicketIdByInstanceId(id) {
  var i;
  if ((typeof Instances[id] !== 'undefined') && (Instances[id] != null)) {
    i = Instances[id];
    return i;
  }
  return null;
}

function recoverStatus(sqlpool, id, mystatus) {
  if (DB_UPDATES === false) {
    return;
  }
  var params = [mystatus, id];
  var q = 'update HUB_REQUEST set STATUS = ? where ID = ?';

  if (sqlpool !== null) {
    sqlpool.getConnection(function(err, client) {
      if (err) {
        logger.log(err);
        return;
      }
      client.query(q, params, function (err, result) {
        if (err) {
          logger.log('recoverStatus Error:' + util.inspect(err, { showHidden: true, depth: null }));
        } else {
          logger.log('recoverStatus REQUEST:' + id + ' Status: ' + mystatus);
        }
        client.release();
      });
    });
  } else {
    logger.log('Could not establish connection to mysql server');
  }
}

function updateStatus(sqlpool, id, mystatus, keys, values, cb) {
  var callback = cb || function() {};
  if (DB_UPDATES === false) {
    callback(null, true);
    return;
  }
  var q = '';
  var w = ' where ID = ?';
  var u = '';
  var glue;
  var params = [];
  var now = nt.getDateTimeNow(true, false);

  switch (mystatus) {
    case '':
      break;

    case 'SETUP':
    case 'RUNNING':
    case 'CLOSING':
      q = 'STATUS = ?, UPDATED = ? ';
      params = [mystatus, now];
      break;

    case 'ERROR':
    case 'ENDED':
    case 'CANCELED':
    case 'TERMINATED':
    case 'FORCEDOUT':
    case 'WARNING':
      q = 'STATUS = ?, COMPLETED = ?, UPDATED = ? ';
      params = [mystatus, now , now];
      break;

    default:
      q = 'STATUS = ? ';
      params = [mystatus];
      break;
  }

  if (typeof Tickets['t' + id] !== 'undefined') {
    if (Tickets['t' + id] != null) {
      Tickets['t' + id].jobStatus = mystatus;
      if ((mystatus === 'RUNNING') || (mystatus === 'SETUP')) {
        Tickets['t' + id].jobStarted = new Date();
      }
    }
  }

  if (q == '') {
    glue = '';
  } else {
    glue = ' , ';
  }
  if (keys !== undefined) {
    for (var k = 0; k < keys.length; k++) {
      u = u + glue + keys[k] + ' = ? ';
      params.push(values[k]);
      glue = ' , ';
    }
  }
  q = q + u;
  if (q !== '') {
    q = 'update HUB_REQUEST set ' + q + w;
    params.push(id);

    if (sqlpool !== null) {
      sqlpool.getConnection(function(err, client) {
        if (err) {
          logger.log(err);
          callback(err, null);
          return;
        }
        client.query(q, params, function (err, result) {
          if (err) {
            logger.log('updateStatus Error:' + util.inspect(err, { showHidden: true, depth: null }));
          } else {
            logger.log('updateStatus REQUEST:' + id + ' Status: ' + mystatus);
          }
          callback(err, result);
          client.release();
        });
      });
    } else {
      logger.log('Could not establish connection to mysql server');
      callback('Could not establish connection to mysql server', null);
    }
  } else {
    callback('No valid query', null);
  }
}

function setupMySQL(config) {
  if (mysqlPool == null) {
    logger.log('Creating mysql connection pool');
    mysqlPool = mysql.createPool(config);
    mysqlPool.on('connection', function(connection) {
      logger.log('Added a new connection to mysql server : ' +
                 config.host + '/' + config.database);
    });
  } else {
    mysqlPool.end(function(err) {
      if (err) {
        logger.log(err);
      } else {
        logger.log('Closed connection to mysql server : ' +
                   config.host + '/' + config.database);
      }
      setTimeout(function() {mysqlPool = null; setupMySQL(config); }, 100);
    });
  }
}

// --------------------------------------------------------------------

function TerminateSession(sessionId) {
  var t;
  var instance;
  var instances = [];
  var myticket = getTicketIdBySessionId(sessionId);

  if (myticket !== null) {
    t = Tickets[myticket];

    instance = t.getMaster('instanceId');
    instances.push(instance);

    //TerminateMachines(instances, function (err, data) {} // FIXME : DELETE
    KillMachines(instances, function (err, data) {
      if (err) {
        logger.log(sessionId + ': Failed to terminate some of the machines ' + instances.join());
      } else {
        logger.log(sessionId + ': Machine(s) ' + instances.join() + ' terminated');
      }
      dns.deleteCNAME(r53, r53info, t.getMaster('aliasDnsName'),
                      t.getMaster('publicDnsName'),
                      function(err, r53data) {
                        if (err) {
                          if (r53info) {
                            logger.log(sessionId + ': Failed to deregister ' + t.getMaster('aliasDnsName'));
                          }
                        } else {
                          logger.log(sessionId + ': ' + t.getMaster('aliasDnsName') + ' deregistered');
                        }
                        t.deAssociate();
                        t = null;
                        logger.log(sessionId + ': Session terminated. Ticket ' + myticket +
                                   ' closed.');
                      });
    });
  } else {
    logger.log(sessionId + ': Terminate Session : failed to get session ticket.');
  }
}

function forceRestartMaster(instanceId, sessionId) {
  var myticket = getTicketIdBySessionId(sessionId);
  if (myticket !== null) {
    var ticket = Tickets[myticket];
    if (ticket.healthCheckTimer != null) {
      clearInterval(ticket.healthCheckTimer);
    }
    // TerminateMachines(instanceId, function (err, data) {} // FIXME : DELETE
    KillMachines(instanceId, function (err, data) {
      if (err) {
        logger.log(sessionId + ': Failed to terminate instance ' + instanceId);
      } else {
        logger.log(sessionId + ': Machine ' + instanceId + ' terminated');
      }
      restartMaster(instanceId, sessionId);
    });
  } else {
    logger.warn('ForceRestart Master: Unable to find session ' + sessionId);
  }
}

function restartMaster(instanceId, sessionId) {
  var myticket = getTicketIdBySessionId(sessionId);
  if (myticket !== null) {
    var ticket = Tickets[myticket];
    if (ticket.healthCheckTimer != null) {
      clearInterval(ticket.healthCheckTimer);
    }
    var rl = ticket.get('restartLimit');
    ticket.set('restartLimit', rl - 1);
    // Delete previous Route53 records, if any.
    dns.deleteCNAME(r53, r53info, ticket.getMaster('aliasDnsName'), ticket.getMaster('publicDnsName'), function(err, r53data) {
      if (err) {
        if (r53info) {
          logger.log(sessionId + ': Failed to deregister aliasDnsName');
        }
      } else {
        logger.log(sessionId + ': ' + ticket.getMaster('aliasDnsName') + ' deregistered');
      }
      startMaster(ticket, function (err, data) {
        if (err) {
          if (ticket.get('restartLimit') > 0) {
            logger.warn(sessionId + ': failed to restart master, will retry on next health check');
            setTimeout(function() {
              restartMaster(instanceId, sessionId);
            }, HEALTH_CHECK_INTERVAL);
          } else {
            logger.warn(sessionId + ': failed to restart master and restart limit exceeded.');
            var mysqlKeys = ['NOTE'];
            var mysqlValues = ['Error starting master, restart limit exceeded.'];
            var hubreqid = ticket.id;
            ticket.deAssociate();
            ticket = null;
            updateStatus(mysqlPool, hubreqid, 'ERROR', mysqlKeys, mysqlValues, function(err, data) {
              if (!err) {
                sendSessionStatusEmail(sessionId, hubreqid, mysqlPool);
              }
            });
          }
        } else {
          if ((data) && (data.length)) {
            ticket.set('restartLimit', RESTART_LIMIT);
            ticket.setMaster('instanceId', data[0].instanceId);
            ticket.setMaster('ip', data[0].ip);
            ticket.setMaster('publicIp', data[0].publicIp);
            ticket.setMaster('publicDnsName', data[0].dnsName);
            ticket.setMaster('aliasDnsName', '');
            switch (dnsPostprocess) {
              case 'none' :
                ticket.setMaster('aliasDnsName', dns.dnsNone(data[0].dnsName));
                break;
              case 'dnsresolve' :
                dns.dnsResolve(data[0].publicIp, mainconf.get('aws:dnsresolve:domainName'), function (err, data) {
                  if (! err) {
                    ticket.setMaster('aliasDnsName', data);
                  }
                });
                break;
              case 'dnstransform' :
                dns.dnsTransform(data[0].publicIp, mainconf.get('aws:dnstransform'), function (err, data) {
                  ticket.setMaster('aliasDnsName', data);
                });
                break;
              case 'dnsmap' :
                dns.dnsMap(data[0].publicIp, mainconf.get('aws:dnsmap:map'), function (err, data) {
                  ticket.setMaster('aliasDnsName', data);
                });
                break;
              case 'route53' :
              default :
                dns.createCNAME(r53, r53info, data[0].dnsName, function(err, r53data) {
                  if (err) {
                    if (r53info) {
                      logger.log(sessionId + ': ' + err);
                    }
                  } else {
                    logger.log(sessionId + ': Registered ' + data[0].dnsName + ' as ' + r53data);
                    ticket.setMaster('aliasDnsName', r53data);
                  }
                });
                break;
            }
            ticket.healthCheckTimer = setInterval(function() {
              InstanceHealthCheck(data[0].instanceId, sessionId, [
                {'state':'terminated', 'action':restartMaster},
                {'state':undefined, 'action':restartMaster},
                {'state':'error', 'action':forceRestartMaster}
              ]);
            }, HEALTH_CHECK_INTERVAL);
            logger.log(sessionId + ': Master ' + data[0].instanceId + ' restarted successfully');
          } else {
            if (data === null) {
              logger.warn(sessionId + ': failed to restart master due to limitted cloud resources, will retry on next health check');
              setTimeout(function() {
                restartMaster(instanceId, sessionId);
              }, HEALTH_CHECK_INTERVAL);
            } else {
              logger.log(sessionId + ': ERROR SETTING UP JOB');
              ticket.deAssociate();
              ticket = null;
              var mysqlKeys = ['NOTE'];
              var mysqlValues = ['Error setting up job'];
              updateStatus(mysqlPool, hubreqid, 'ERROR', mysqlKeys, mysqlValues, function(err, data) {
                if (!err) {
                  sendSessionStatusEmail(sessionId, hubreqid, mysqlPool);
                }
              });
            }
          }
        }
      });
    });
  } else {
    logger.warn('Restart Master: Unable to find session ' + sessionId);
  }
}

function ro2rw(s) {
  var m = s.match(/(^\s*ro\s*,*)|(\s*,*ro\s*$)|(\s*,\s*ro\s*,\s*)/);

  if (m) {
    var newstr = m[0].replace(/ro/,'rw');
    var r = s.replace(/(^\s*ro\s*,*)|(\s*,*ro\s*$)|(\s*,\s*ro\s*,\s*)/g, newstr);
    return r;
  }
  return s;
}


function startMaster(ticket, cb) {
  var userData = {};
  for (var sudKey in staticUserData) {
    userData[sudKey] = staticUserData[sudKey];
  }
  var sid = nt.parseSessionId(ticket.req.sessionId);

  var allShares = [];
  var allIds = [];
  var runasToolShares = null;
  var toolXtermSupport = toolapps.getXtermSupport(sid.toolId);
  var toolMountPoint = toolapps.getMountPoint(sid.toolId);
  var toolAdditionalMountPoints = toolapps.getAdditionalMountPoints(sid.toolId);

  if (toolMountPoint !== 0) {
    allIds.push(toolMountPoint);
  }

  if (toolAdditionalMountPoints !== 0) {
    allIds.push(toolAdditionalMountPoints.split(','));
  }

  var dataTypes;
  if (nt.isSetSessionParam(ticket.req.sessionId, '4d')) { // Allow only documentation viewing.
    dataTypes = ['IP_DOCS', 'TOOL_DOCS'];
  } else {
    dataTypes = ['SHARED_DATA', 'USER_DATA', 'IP_DATA_LIB'];
  }
  var Ids;
  dataTypes.forEach(function(dt) {
    Ids = quotashares.permits.getPermittedResources({company:sid.companyId, user:sid.clientId, project:sid.projectId}, dt, (dt !== 'USER_DATA'));
    if (Ids) {
      allIds = allIds.concat(Ids[dt]);
    }
  });

  var adminIds = [];
  // Get shares in order to allow company admin to have write access to companies SHARED_DATA mounts.
  if (ticket.useradmin == 'C') {
    adminIds = quotashares.permits.getPermittedResources({company:sid.companyId, user:sid.clientId, project:sid.projectId}, 'SHARED_DATA', true );
    if (adminIds) {
      adminIds=adminIds['SHARED_DATA'];
    } else {
      adminIds=[];
    }
  }

  var runasSid = nt.parseSessionId(ticket.req.runas);
  if (runasSid !== '') {
    var runasToolMountPoint = toolapps.getMountPoint(runasSid.toolId);
    var runasToolAdditionalMountPoints = toolapps.getAdditionalMountPoints(runasSid.toolId);

    if (runasToolMountPoint !== 0) {
      allIds.push(runasToolMountPoint);
    }

    if (runasToolAdditionalMountPoints !== 0) {
      allIds.push(runasToolAdditionalMountPoints.split(','));
    }

    dataTypes.forEach(function(dt) {
      Ids = quotashares.permits.getPermittedResources({company:runasSid.companyId, user:runasSid.clientId, project:runasSid.projectId}, dt, (dt !== 'USER_DATA'));
      if (Ids) {
        allIds = allIds.concat(Ids[dt]);
      }
    });

  }

  var projectShares = shares.getByIds(allIds); // FIXME : if multiple clouds are introduced, add cloudId.

  projectShares.forEach(function(n, i) {
    var notfound = true;
    var j;
    var mntp=n;

    if (ticket.useradmin == 'C') { // Allow company admin to have write access to companies SHARED_DATA mounts.
      if (adminIds.indexOf(''+n.id) !== -1) {
        mntp.mountParams = ro2rw(mntp.mountParams);
      }
    }

    for (j=0; j<allShares.length; j++) {
      if ((mntp.fstype == allShares[j].fstype) && (mntp.location == allShares[j].location) &&
          (mntp.mountPoint == allShares[j].mountPoint) && (mntp.mountParams == allShares[j].mountParams)) {
        notfound = false;
      }
    }
    if (notfound) {
      allShares.push(mntp);
    }
  });

  allShares = _.uniq(allShares, false, 'uuid');

  userData['reqSessionId'] = ticket.req.sessionId;
  userData['machineType'] = hubType;
  userData['hubServer'] = hubProtocol + '://' + hubHost + ':' + hubPort;
  if ((setloginuser) && (ticket.loginuser !== 'nefelus')) {
    userData['USERDEF'] = ticket.loginuser;
  }

  if (setsecgroups) {
    var iptables = secgroups.getRules(sid.companyId, sid.projectId);
    if (iptables.length > 0) {
      iptables.forEach(function(n, i) {
        //'sec_group_id':1,'company_id':0,'project_id':0,'id':1,'direction':'I','interface':'eth0','protocol':'tcp','address':'*','ports':'22','condition':'*'
        n.condition=n.condition.trim();
        logger.log(ticket.req.sessionId+': Sec Group Rule= '+ n.direction + ' ' + n.interface + ' ' + n.protocol + ' ' + n.address + ' ' + n.ports+ ' ' + n.condition);
        userData['sr' + i] = n.direction.toUpperCase() + ' ' + n.interface + ' ' + n.protocol + ' ' + n.address + ' ' + n.ports + ' ' + ((n.condition !== '') ? n.condition : '*');
      });
    }
    if (ticket.licenseManager !== '') {
      var lmp = ticket.licenseManager.replace(/@.*/,'');
      var lma = ticket.licenseManager.replace(/.*@/,'');
      userData['srLM'] = 'E eth0 tcp ' + lma + ' ' + lmp + ' *';
    }
  }

  if (! vncLocalOnly) {
    userData['vncLocalOnly'] = 'NO';
  }
  userData['xterm'] = toolXtermSupport;

  allShares.forEach(function(n, i) {
    if ((n.fstype !== '') && (n.location !== '') && (n.mountPoint !== '')) {
      //'fstype':'nfs','location':'10.0.0.2:/tools/icscape','mountParams':null,'mountPoint':'/tools/icscape'}
      logger.log(ticket.req.sessionId+': share = '+ n.location + ' ' + n.mountPoint + (((n.mountParams!==null) && (n.mountParams!=='')) ? (' ' + n.mountParams) : ''));
      userData[n.fstype + i] = n.location + ' '+ n.mountPoint + (((n.mountParams!==null) && (n.mountParams!=='')) ? (' ' + n.mountParams) : ' ro');
      userData['h' + n.fstype + i] = n.location;
      userData['c' + n.fstype + i] = n.mountPoint;
      userData['p' + n.fstype + i] = (((n.mountParams!==null) && (n.mountParams!=='')) ? (n.mountParams) : 'ro');
    }
  });

  // encrypt and send SSL certificates
  // FIXME : Run this in hub init.d : cat /var/log/messages > /dev/urandom; ifconfig > /dev/urandom
  if (ticket.req.ami === null) {
    logger.log(ticket.req.sessionId+': ERROR, AMI not defined');
    cb('ERROR, AMI not set.', null);
    return;
  }
  var _enckey = ticket.req.ami + ticket.req.machineSpeed + ticket.req.sessionId + '\n';
  var md5sum = crypto.createHash('md5');
  var enckey = md5sum.update(_enckey).digest('hex');

  nt.cryptData(masterScripts, enckey, function(mserr, msdata) {
    if (! mserr) {
      userData['masterscripts'] = msdata;
    }

    nt.cryptData(sslMasterPack, enckey, function(err, data) {
      if (! err) {
        userData['crt'] = data;
      }

      startMachines(ticket.req.ami, 1, ticket.req.machineId, ticket.req.sessionId, userData, function(err, data) {
        if (err) {
          logger.log('Failed to start instance for ' + ticket.req.sessionId);
          cb(err, null);
        } else {
          if (data) {
            getMachinesInfo(data, function(err, data) {
              if (err) {
                logger.log('Failed to get machine info for ' + ticket.req.sessionId);
                cb(err, null);
              } else {
                ticket.machineStarted = new Date();
                cb(null, data);
              }
            });
          } else {
            cb(null, null);
          }
        }
      });
    });
  });
}

function startMachines(image, count, machineId, sessionId, userData, cb) {
  var k;
  var ud = '';
  for (var k in userData) {
    ud = ud + '#%' + k + ':' + userData[k] + '\n';
  }
  var udb = new Buffer(ud);
  ud = udb.toString('base64');
  var speed = machines.getSpeed(machineId);

  var noOfEphemeralVols = machines.getEphemeral(machineId) || 0;
  var blockDeviceMappings = [];

  // If we want to resize the root volume we should add the following entry to the device mappings
  // by setting the VolumeSize accordingly.
  // {DeviceName : '/dev/sda1', Ebs : {VolumeSize : 15  }  }

  for (k = 0; k < noOfEphemeralVols; k++) {
    blockDeviceMappings.push({
      'DeviceName' : '/dev/sd' + String.fromCharCode('a'.charCodeAt(0) + k + 1),
      'VirtualName' : 'ephemeral' + k
    });
  }

  var args = {
    ImageId        : image,
    MinCount       : count,
    MaxCount       : count,
    UserData       : ud,
    SecurityGroups : [securityGroup],
    InstanceType   : speed
  };

  if (keyName !== null) {
    args['KeyName'] = keyName;
  }

  if (blockDeviceMappings.length) {
    args['BlockDeviceMappings'] = blockDeviceMappings;
  }

  var triescount = 0;
  var ready = false;
  var instanceIds;
  var noResources = false;

  async.whilst(
    function () { return ready === false && triescount < EC2_MAX_TRIES; },
    function (callback) {
      triescount++;
      ec2.runInstances(args, function(err, data) {
        instanceIds = [];
        if (err) {
          if ((err.statusCode) && (err.statusCode == 413) && (err.code) && (err.code === 'ResourceLimitExceeded')) {
            ready = true;
            noResources = true;
            logger.log('RunInstances: ' + ((err.message) ? err.message : 'unknown error'));
          } else {
            logger.log('RunInstances error ', JSON.stringify(err));
          }
        } else {
          if (data.Instances) {
            for (var m = 0; m < data.Instances.length; m++) {
              if (data.Instances[m].InstanceId) {
                instanceIds.push(data.Instances[m].InstanceId);
                ready = true;
              }
            }
          }
        }
      });
      setTimeout(callback, EC2_TIMEOUT);
    },
    function (err) {
      if (ready) {
        if (noResources) {
          cb(null, null);
        } else {
          instanceIds.forEach(function(id) {
            function _setMachineTags(callback, results) {
              setMachineTags(id, hubType, sessionId, function(err, data) {
                if (err) {
                  setTimeout(function() {callback({sessionId: sessionId, err: err, id : id});}, 60000);
                } else {
                  callback(null, '')
                }
              });
            }
            async.retry(5, _setMachineTags, function(err, result){
              if (err) {
                logger.log(err.sessionId + ' Warning: Could not set machine tags for instance ' + err.id);
                logger.log(err.sessionId + ' '+util.inspect(err.err));
              }
            });
          });
          cb(null, instanceIds);
        }
      } else {
        cb(err, null);
      }
    }
  );
}

function oldTerminateMachines(machines, cb) {
  var args = {
    InstanceIds : []
  };

  if ((typeof machines === 'string') && (machines.length > 0)) {
    args.InstanceIds.push(machines);
  } else if ((_.isArray(machines))  && (machines.length > 0)) {
    args.InstanceIds = machines;
  }
  ec2.terminateInstances(args, cb);
}

function KillMachines(machines, cb) {
  function _TerminateMachines(callback, results) {
    TerminateMachines(machines, function(err, data) {
      if (err) {
        setTimeout(function() {callback({machines : machines, err : err}, null);}, 3000);
      } else {
        callback(null, '')
      }
    });
  }

  async.retry(600, _TerminateMachines, function(err, result) {
    if (err) {
      try {err.machines = err.machines.join(); } catch (e) {}
      logger.log('Warning: Could not terminate machine(s):' + err.machines);
      logger.log(util.inspect(err));
    }
    cb(err, result);
  });
}

function TerminateMachines(machines, cb) {
  var args = {
    InstanceIds : []
  };

  if ((typeof machines === 'string') && (machines.length > 0)) {
    args.InstanceIds.push(machines);
  } else if ((_.isArray(machines))  && (machines.length > 0)) {
    args.InstanceIds = machines;
  }
  ec2.terminateInstances(args, cb);
}

function setMachineTags(instanceId, machineType, sessionId, cb) {
  var params = {
    'Resources' : [instanceId],
    'Tags' : [
      {'Key' : 'Name', 'Value' : sessionId},
      {'Key' : 'machineType', 'Value' : machineType},
      {'Key' : 'session', 'Value' : sessionId}
    ]
  };
  ec2.createTags(params, function(err, data) {
    if (err) {
      cb(err, null);
    } else {
      cb(null, 'ok');
    }
  });
}

function getMachinesInfo(machines, cb) {
  var count = 0;
  var machinesInfo = [];
  var machinesFound = 0;
  var instances;
  var mi;
  var machineCount = (machines) ? machines.length : 0;

  if (machineCount == 0) {
    cb('No machines to get info', machinesInfo);
    return;
  }

  async.whilst(
    function () { return machinesFound != machineCount && count < EC2_MAX_TRIES; },
    function (callback) {
      machinesFound = 0;
      count++;
      var args = {
        InstanceIds : machines
      };

      ec2.describeInstances(args, function(err, data) {
        machinesInfo = [];
        if (! err) {
          instances = extractInstances(data.Reservations);
          for (var m = 0; m < instances.length; m++) {
            mi = {};

            mi.instanceId = instances[m].InstanceId;
            mi.privateDnsName = instances[m].PrivateDnsName;
            mi.dnsName = instances[m].PublicDnsName;
            mi.ip = instances[m].PrivateIpAddress;
            mi.publicIp = instances[m].PublicIpAddress;
             //FIXME : If we associate an IP and do not rely on the stack to get the public IP then
             //        the following line should change.
            if ((instances[m].PublicIpAddress !== undefined) && (instances[m].PublicIpAddress !== null)) {
              machinesFound++;
              machinesInfo.push(mi);
            }
          }
        }
      });
      setTimeout(callback, EC2_TIMEOUT);
    },
    function (err) {
      if (machinesFound == machineCount) {
        cb(null, machinesInfo);
      } else {
        cb('Error or incomplete response', machinesInfo);
      }
    }
  );
}

function extractInstances(reservations) {
  var instances = [];
  reservations.forEach(function (r) {
    r.Instances.forEach(function(i) {
      instances.push(i);
    });
  });
  return instances;
}

function InstanceHealthCheck(instanceId, sessionId, actions) {
  getInstanceState(instanceId, function(state) {
    var i;
    var al = actions.length;
    for (i = 0; i < al; i++) {
      if (state == actions[i].state) {
        logger.log('Health check : session=' + sessionId + ', instance=' + instanceId + ', state=' + state);
        actions[i].action(instanceId, sessionId);
        return;
      }
    }
    logger.log('Health check : session=' + sessionId + ', instance=' + instanceId + ', unhandled state=' + state);
  });
}

function getInstanceState(instanceId, cb) {
  var state = 'undefined';
  var args = {InstanceIds : [instanceId]};
  ec2.describeInstances(args, function(err, data) {
    if (data) {
      var instances = extractInstances(data.Reservations);
      if (instances.length != 0) {
        state = instances[0].State.Name;
      }
    }
    cb(state);
  });
}

function recoverTicket(t, socket) {
  if (t) {
    if (typeof t === 'string') {
      t = JSON.parse(t);
    }
    if ((typeof Tickets['t' + t.id] == 'undefined') || (Tickets['t' + t.id] == null)) {
      var newticket = new Ticket(t.id);
      _.forOwn(t, function(v, k, o) {
        newticket[k] = _.cloneDeep(v);
      });
      newticket.setRequest('sessionId', newticket.req.sessionId); // hack to update Sessions table
      newticket.setMaster('instanceId', newticket.master.instanceId); // hack to update Instances table
      newticket.setMaster('socket', socket.id);
      logger.log('Recovered ticket #' + t.id + ' session=' + newticket.req.sessionId);
    }
  } else {
    logger.log('Failed to recover ticket');
  }
}

function dupTicket(id) {
  var t = null;
  if ((typeof Tickets['t' + id] !== 'undefined') && (Tickets['t' + id] != null)) {
    t = {};
    _.forOwn(Tickets['t' + id], function(v, k, o) {
      if (! _.isFunction(o[k])) {
        t[k] = _.cloneDeep(v);
      }
    });
    t.healthCheckTimer = null;
    t.master.socket = null; // Do not use setMaster here!!!
  }
  return t;
}

var parseAck = function(ack) {
// From master : Ack({'sessionId':sessionId, 'ticketId' : ticket.id, 'status' : 'xyz'}); // Acknowledge
  if (nt.isSafeJSON(ack)) {
    var msg = JSON.parse(ack);
    var myticket = getTicketIdBySessionId(msg.sessionId);
    if (myticket !== null) {
      if (_.indexOf(sessionStatusCodes, Tickets[myticket].get('sessionStatus')) < _.indexOf(sessionStatusCodes, msg.status)) {
        Tickets[myticket].set('sessionStatus', msg.status);
      }
    }
  } else {
    logger.log('Got bogus ack message:' + ack);
  }
}

//  ---------------------------------------------------------------------------------------------------------
//  MAIN PROGRAM
//  ---------------------------------------------------------------------------------------------------------

mystate = 'on';

var lmDispatcherIsRunning = false;
var lmDispatcher = function lmDispatcher() {
  if (lmDispatcherIsRunning) {
    return;
  }
  lmDispatcherIsRunning = true;
  var now = nt.getDateTimeNow(true, false);
  var query = 'SELECT * FROM atable';
  if (mysqlPool !== null) {
    mysqlPool.getConnection(function(err, mysqlClient) {
      if (err) {
        logger.log(err);
        lmDispatcherIsRunning = false;
        return;
      }

      mysqlClient.query(query, function(err, rows, fields) {

        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          lmDispatcherIsRunning = false;
          mysqlClient.release();
          return;
        }

        var records = [];
        var i, j, record;
        for (i = 0; i < rows.length; i++) {
          record = {};
          for (j = 0; j < fields.length; j++) {
            //if (fields[j].name == 'STATUS') {
            //}
            record[fields[j].name] = rows[i][fields[j].name];
          }
          records.push(record);
        }
        mysqlClient.release();
      });
    });
  }
  lmDispatcherIsRunning = false;
};

var dispatcherIsRunning = false;
var dispatcher = function dispatcher () {
  //SELECT * from HUB_REQUEST where status in ('PENDING', 'SETUP', 'RUNNING');
  if (dispatcherIsRunning) {
    return;
  }
  dispatcherIsRunning = true;
  if (mysqlPool !== null) {

    mysqlPool.getConnection(function(err, mysqlClient) {
      if (err) {
        logger.log(err);
        dispatcherIsRunning = false;
        return;
      }

      if (lastUpdatedSettings.count === 0) {
        checkForUpdatedConfigs(mysqlClient, lastUpdatedSettings.config, function(err, data, shouldreload) {
          if (!err) {
            lastUpdatedSettings.config = data;
            if(shouldreload) {
              MySQLParamsLoaded = false;
            }
            lastUpdatedSettings.count = lastUpdatedSettings.frequency;
          } else {
            logger.log('checkForUpdatedConfigs: '+err);
          }
          if (MySQLParamsLoaded == false) {
            logger.log('(re)loading params');
            loadMySQLParams(mysqlClient, lastUpdatedSettings.config, MAX_RUNNING_JOBS_ALLOWED, function(err, data) {
              if (! err) {
                MySQLParamsLoaded = true;
              } else {
                lastUpdatedSettings.count = 0;
              }
              mysqlClient.release();
            });
          } else {
            mysqlClient.release();
          }
        });
        return;
      } else {
        lastUpdatedSettings.count--;
      }

      mysqlClient.query(SQL.hubQueue, function(err, rows, fields) {

        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          mysqlClient.release();
          dispatcherIsRunning = false;
          return;
        }

        var records = [];
        var i, j, record;
        var totalPendingFound;
        var totalRunningFound = 0;
        var pendingFound = false;
        var isSessionActive;
        var jobType;
        var machineId;
        quotas.stats.clear();
        for (i = 0; i < rows.length; i++) {
          record = {};
          pendingFound = false;
          for (j = 0; j < fields.length; j++) {
            if (fields[j].name == 'STATUS') {
              switch (rows[i][fields[j].name]) {
                case 'PENDING' :
                  pendingFound = true;
                  break;
                case 'SETUP'   :
                case 'RUNNING' :
                case 'CLOSING' :
                  if ( rows[i]['COMMAND'].substr(0,5) == 'EXEC_') {
                    machineId = rows[i]['MACHINE_ID'] || 0;
                    if (machineId !== 0 ) {
                      //var cursid = nt.parseSessionId(rows[i]['SESSION_ID']);
                      //quotas.stats.add(Number(cursid.companyId), Number(cursid.clientId), Number(cursid.projectId), Number(cursid.toolId), machineId);
                      quotas.stats.add(rows[i]['COMPANY_ID'] || 0,
                                       rows[i]['USER_ID'] || 0,
                                       rows[i]['PROJECT_ID'] || 0,
                                       rows[i]['TOOL_ID'] || 0,
                                       machineId);
                    } else {
                      logger.log('ERROR: MACHINE_ID found 0 or NULL. #' + rows[i]['ID']);
                    }
                  }
                  totalRunningFound++;
                  break;
                default: break;
              }
            }
            record[fields[j].name] = rows[i][fields[j].name];
          }
          if (pendingFound) {
            records.push(record);
          }
        }
        machineId = 0;
        totalPendingFound = records.length;
        if (totalPendingFound > 0) {
          pendingWereNone = false;
          pendingNoneCnt  = 0;
          logger.log(records.length + ' pending and ' + totalRunningFound + ' running jobs. State=' + mystate + ', license=' + (nslmSessionIsActive ? 'ok' : 'NOT ok'));
          showProcessStats();
          for (i = 0; i < records.length; i++) {
            jobType = 'batch';
            switch (records[i].COMMAND.toLowerCase()) {

              case 'user_terminate' :
                (function() {
                  if (records[i].STATUS === 'PENDING') { // Check again because it might be changed previously in the loop.
                    var realSession = getTicketIdBySessionId(records[i].SESSION_ID);
                    if (realSession) {
                      var realTicket = Tickets[realSession];
                      if (realTicket.jobStatus == 'SETUP') {
                        realTicket.set('sessionStatus', 'finished');
                        updateStatus(mysqlPool, records[i].ID, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
                        if (realTicket.getMaster('instanceId') != '') {
                          logger.log(records[i].SESSION_ID + ': Canceling instance '+realTicket.getMaster('instanceId'));
                          TerminateSession(records[i].SESSION_ID);
                          updateStatus(mysqlPool, realTicket.id, 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                        } else {
                          logger.log(records[i].SESSION_ID + ': Scheduled for cancel.');
                          realTicket.cancelPending = true;
                        }
                      } else if (realTicket.jobStatus == 'RUNNING') {
                        middleSessionOperation('cancel', records[i].ID, records[i].SESSION_ID, mysqlPool, 'ENDED', {});
                      } else {
                        updateStatus(mysqlPool, records[i].ID, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
                      }
                    } else {
                      updateStatus(mysqlPool, records[i].ID, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
                    }
                  } else {
                    logger.log(records[i].SESSION_ID + ': should have beed canceled already.');
                  }
                })();
                break;

              case 'system_data_pull' :
                (function() {
                  middleSessionOperation('data_pull', records[i].ID, records[i].SESSION_ID, mysqlPool, 'RUNNING', {'debugInfo' : '1'});
                })();
                break;

              case 'system_data_push' :
                (function() {
                  middleSessionOperation('data_push', records[i].ID, records[i].SESSION_ID, mysqlPool, 'RUNNING', {'debugInfo' : '1'});
                })();
                break;

              case 'exec_prompt':
                if (jobType === 'batch') {
                  jobType = 'prompt';
                }
              case 'exec_interactive':
                if (jobType === 'batch') {
                  jobType = 'interactive';
                }
              case 'exec_batch':
                if (mystate === 'on') {
                  var isCancelPending = checkForPendingUserTerminate(records, records[i].SESSION_ID);
                  if (isCancelPending !== null) {

                    logger.log(records[i].SESSION_ID + ': is being canceled as requested.');
                    updateStatus(mysqlPool, records[i].ID , 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                    updateStatus(mysqlPool, isCancelPending.id, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
                    records[isCancelPending.index].STATUS = 'ENDED';
                  } else {
                    if (nslmSessionIsActive) {
                      logger.log('Total running=' + totalRunningFound + ' MAX ALLOWED=' + quotas.limits.resolveLimits({}));
                      isSessionActive = getTicketIdBySessionId(records[i].SESSION_ID);
                      var currentSid = nt.parseSessionId(records[i].SESSION_ID);
                      var runOrNot = false;

                      if ((skippedSessions[records[i].SESSION_ID] !== undefined) && (skippedSessions[records[i].SESSION_ID] !== 0)) {
                        skippedSessions[records[i].SESSION_ID] = skippedSessions[records[i].SESSION_ID] - 1;
                      } else {

                        var justnowDate = new Date();
                        var justnow = Number(justnowDate.valueOf());

                        var scheduledDateStr = records[i].SCHEDULED || null;
                        var scheduledDate = new Date(scheduledDateStr);
                        if (! nt.isValidDate(scheduledDate)) {
                          scheduledDate = justnowDate;
                        }
                        var scheduled = Number(scheduledDate.valueOf());

                        if (scheduled - justnow <= 0 ) {

                          machineId = records[i].MACHINE_ID || 0;
                          var machineType = machines.getSpeed(machineId);
                          if ((! machines.exists(machineId)) || (machineId === 0)) {
                            logger.log('WARNING: Undefined machine '+machineType+' '+machineId);
                            machineType = '';
                          } else {
                            runOrNot = quotas.checkQueueQuota(currentSid.companyId, currentSid.clientId, currentSid.projectId, currentSid.toolId, machineId, false, 1);
                          }

                          //FIXME: //if ((totalRunningFound < quotas.limits.resolveLimits({})) || (MAX_RUNNING_JOBS_ALLOWED == 0)) {}

                          if (runOrNot === true) {
                            if (isSessionActive == null) {
                              totalRunningFound++;

                              (function() {
                                var companyId = records[i]['COMPANY_ID'];
                                var userId = records[i]['USER_ID'];
                                var projectId = records[i]['PROJECT_ID'];
                                var toolId = records[i]['TOOL_ID'];
                                var sessionId = records[i].SESSION_ID;
                                var runas = records[i].RUN_AS || '';
                                var hubreqid = records[i].ID;
                                var machineId = records[i].MACHINE_ID || 0;
                                var machineSpeed = machines.getSpeed(machineId);
                                var threadCount = records[i].CPU_COUNT || null;
                                var machineCount = '1'; //FIXME
                                machineCount = parseInt(machineCount, 10);
                                if (isNaN(machineCount)) {
                                  machineCount = 1;
                                }
                                var command = records[i].COMMAND;
                                var commandFile = records[i].COMMAND_FILE; // was INPUT_DIR
                                var runningDir = records[i].DATA_LOCATION;
                                var XDisplay = records[i].DISPLAY || null;
                                var XResolution = records[i].RESOLUTION || null;
                                var loginuser = records[i].LOGIN_NAME || 'nefelus';
                                var useradmin = records[i].USER_ADMIN || '';
                                var licenseManager = records[i].LICENSE_MANAGER || '';
                                var t = new Ticket(hubreqid);
                                t.setRequest('sessionId', sessionId);
                                t.setRequest('runas', runas);
                                t.setRequest('machineId', machineId);
                                t.setRequest('threadCount', threadCount);
                                t.setRequest('machineCount', machineCount);
                                t.setRequest('machineSpeed', machineSpeed); // FIXME : not really necessary
                                t.setRequest('commandFile', commandFile);
                                t.setRequest('runningDir', runningDir);
                                t.setRequest('licenseManager', licenseManager);
                                t.setRequest('jobType', jobType);
                                t.set('XDisplay', XDisplay);
                                t.set('XResolution', XResolution);
                                t.set('useradmin', useradmin);
                                if (setloginuser) {
                                  t.set('loginuser', loginuser);
                                }

                                logger.log(sessionId + ': Processing  ' + command + ' machineCount=' + machineCount + ' machineSpeed=' + machineSpeed);

                                if ((machineCount > 0) && (machineSpeed !== '')) {

                                  logger.log(sessionId + ': New Ticket : ID = t' + hubreqid);
                                  logger.log(sessionId + ': Ticket : ' + JSON.stringify(t));

                                  updateStatus(mysqlPool, hubreqid, 'SETUP', ['QUEUE_INFO'], ['']);
                                  // Add Stats here and do not wait until machine is started!
                                  quotas.stats.add(companyId || 0, userId || 0, projectId || 0, toolId || 0, machineId);

                                  startMaster(t, function(err, data) {
                                    if (err) {
                                      logger.log(sessionId + ': ERROR STARTING MASTER');
                                      var mysqlKeys = ['NOTE'];
                                      var mysqlValues = ['Error starting master'];
                                      t.deAssociate();
                                      t = null;
                                      updateStatus(mysqlPool, hubreqid, 'ERROR', mysqlKeys, mysqlValues, function(err, data) {
                                        if (!err) {
                                          sendSessionStatusEmail(sessionId, hubreqid, mysqlPool);
                                        }
                                      });
                                    } else {
                                      if ((data) && (data.length)) {
                                        t.setMaster('instanceId', data[0].instanceId);
                                        t.setMaster('ip', data[0].ip);
                                        t.setMaster('publicIp', data[0].publicIp);
                                        t.setMaster('publicDnsName', data[0].dnsName);
                                        t.setMaster('aliasDnsName', '');
                                        switch (dnsPostprocess) {
                                          case 'none' :
                                            t.setMaster('aliasDnsName', dns.dnsNone(data[0].dnsName));
                                            break;
                                          case 'dnsresolve' :
                                            dns.dnsResolve(data[0].publicIp, mainconf.get('aws:dnsresolve:domainName'), function (err, data) {
                                              if (! err) {
                                                t.setMaster('aliasDnsName', data);
                                              }
                                            });
                                            break;
                                          case 'dnstransform' :
                                            dns.dnsTransform(data[0].publicIp, mainconf.get('aws:dnstransform'), function (err, data) {
                                              t.setMaster('aliasDnsName', data);
                                            });
                                            break;
                                          case 'dnsmap' :
                                            dns.dnsMap(data[0].publicIp, mainconf.get('aws:dnsmap:map'), function (err, data) {
                                              t.setMaster('aliasDnsName', data);
                                            });
                                            break;
                                          case 'route53' :
                                          default :
                                            // Create Route53 record
                                            dns.createCNAME(r53, r53info, data[0].dnsName, function(err, r53data) {
                                              if (err) {
                                                if (r53info) {
                                                  logger.log(sessionId + ': ' + err);
                                                }
                                              } else {
                                                logger.log(sessionId + ': Registered ' + data[0].dnsName + ' as ' + r53data);
                                                t.setMaster('aliasDnsName', r53data);
                                              }
                                            });
                                            break;
                                        }
                                        t.healthCheckTimer = setInterval(function() {
                                          InstanceHealthCheck(data[0].instanceId, sessionId, [
                                            {'state' : 'terminated', 'action':restartMaster},
                                            {'state' : undefined, 'action':restartMaster},
                                            {'state' : 'error', 'action':forceRestartMaster}
                                          ]);
                                        }, HEALTH_CHECK_INTERVAL);
                                        var now = nt.getDateTimeNow(true, false);
                                        var mysqlKeys = ['LAUNCHED', 'INSTANCE_ID']; // INSTANCE_ID was MACHINE_NAME
                                        var mysqlValues = [now, data[0].instanceId];
                                        mysqlKeys.push('UUID');
                                        mysqlValues.push(t.get('uuid'));
                                        updateStatus(mysqlPool, hubreqid, 'SETUP', mysqlKeys, mysqlValues);
                                        logger.log(sessionId + ': Master ' + data[0].instanceId + ' started successfully');
                                        if (t.get('cancelPending')) {
                                          logger.log(sessionId + ': Was scheduled for cancel.');
                                          TerminateSession(sessionId);
                                          updateStatus(mysqlPool, hubreqid, 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                                        }
                                      } else {
                                        if (data === null) {
                                          // if startMaster returns null data put back in queue
                                          // FIXME : skip for some cycles...
                                          if (t.get('cancelPending')) {
                                            logger.log(sessionId + ': Was scheduled for cancel.');
                                            updateStatus(mysqlPool, hubreqid, 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                                          } else {
                                            skippedSessions[sessionId] = SKIP_CYCLES;
                                            updateStatus(mysqlPool, hubreqid, 'PENDING', ['QUEUE_INFO'], ['{"message":"Cloud resources exhausted"}']);
                                          }
                                          logger.warn(sessionId + ': failed to start master due to limitted cloud resources, will retry on next check');
                                        } else {
                                          logger.log(sessionId + ': ERROR SETTING UP JOB, startMachines returned empty value');
                                          var mysqlKeys = ['NOTE'];
                                          var mysqlValues = ['Error setting up job'];
                                          t.deAssociate();
                                          t = null;
                                          updateStatus(mysqlPool, hubreqid, 'ERROR', mysqlKeys, mysqlValues, function(err, data) {
                                            if (!err) {
                                              sendSessionStatusEmail(sessionId, hubreqid, mysqlPool);
                                            }
                                          });
                                        }
                                      }
                                    }
                                  });
                                } else {
                                  logger.log(sessionId + ': ERROR SETTING UP JOB : machines requested =' + machineCount + ' ' + machineSpeed );
                                  var mysqlKeys = ['NOTE'];
                                  var mysqlValues = ['Error setting up job'];
                                  t.deAssociate();
                                  t = null;
                                  updateStatus(mysqlPool, hubreqid, 'ERROR', mysqlKeys, mysqlValues, function(err, data) {
                                    if (!err) {
                                      sendSessionStatusEmail(sessionId, hubreqid, mysqlPool);
                                    }
                                  });
                                }
                              })();
                            } else {
                              activeTicket = Tickets[isSessionActive];
                              logger.warn(records[i].SESSION_ID + ': Trying to start an active session! This should not have happened.');
                              logger.warn(records[i].SESSION_ID + ': Trying to recover last valid status.');
                              if (activeTicket.jobStatus !== '') {
                                recoverStatus(mysqlPool, records[i].ID, activeTicket.jobStatus);
                              }
                            }
                          } else {
                            // Log the reason why it is left on queue.
                            if (runOrNot !== false) {
                              var previousQueueInfo = records[i].QUEUE_INFO || '';
                              if (previousQueueInfo !== runOrNot) {
                                updateStatus(mysqlPool, records[i].ID, 'PENDING', ['QUEUE_INFO'], [runOrNot]);
                              }
                              logger.log(records[i].SESSION_ID + ': Left in Queue: '+runOrNot);
                            }
                          }
                        } else {
                          logger.log(records[i].SESSION_ID + ': Session is scheduled for '+scheduledDate);
                        }
                      }
                    }
                  }
                }
                break;

              default :
                if (mystate === 'on') {
                  //updateStatus(mysqlPool, records[i].ID, 'processing');
                  logger.log('Unhandled command ' + records[i].COMMAND);
                }
                break;
            }
          }
        } else {
          if ((pendingWereNone === false) || ((pendingNoneCnt % PENDING_NONE_TIMES_TO_SKIP) == 0)) {
            logger.log('0 pending and ' + totalRunningFound + ' running jobs. ' + 'State=' + mystate + ', license=' + (nslmSessionIsActive ? 'ok' : 'NOT ok'));
            showProcessStats();
          }
          pendingWereNone = true;
          pendingNoneCnt++;
        }
        mysqlClient.release();
      });
    });
  }
  dispatcherIsRunning = false;
};

if (timerID === null) {
  process.nextTick(dispatcher);
}
timerID = setInterval(dispatcher, db.queryinterval);

var server;
var io;

if (sslOptions !== false) {
  logger.log('SSL enabled');
  server = https.createServer(sslOptions);
  sslOptions['destroy buffer size'] = Infinity;
  io = require('socket.io').listen(server, sslOptions);
} else {
  logger.log('SSL not enabled');
  server = http.createServer();
  io = require('socket.io').listen(server, {'destroy buffer size': Infinity});
}

//var io = require('socket.io').listen(hubPort);
//server.listen(hubPort, hubHost); // Does not work!
server.listen(hubPort);

logger.log('Socket.io listening on ' + hubProtocol + '://' + hubHost + ':' + hubPort);

io.configure('production', function() {
  io.enable('browser client etag');
  io.set('log level', 1);
  io.set('transports', [
      'websocket'
  //, 'flashsocket'
  //, 'htmlfile'
  //, 'xhr-polling'
  //, 'jsonp-polling'
  ]);
});

io.configure('development', function() {
  io.enable('browser client etag');
  io.set('log level', 1);
  io.set('transports', ['websocket']);
});

io.sockets.on('connection', function (socket) {

  logger.log('Got a new connection, socket=' + socket.id + ', remoteAddress=' +
             ((socket.manager && socket.manager.handshaken && socket.manager.handshaken[socket.id]) ? (socket.manager.handshaken[socket.id].address.address
             +':'+socket.manager.handshaken[socket.id].address.port) : ''));

  socket.on('disconnect', function () {
    logger.log('Host ' + ((socket.instance) ? socket.instance : 'unknown') +
               ' disconnected, socket=' + socket.id + ', session=' +
               ((socket.sessionId) ? socket.sessionId : 'unknown') + ', remoteAddress=' +
               ((socket.manager && socket.manager.handshaken && socket.manager.handshaken[socket.id]) ? (socket.manager.handshaken[socket.id].address.address
               +':'+socket.manager.handshaken[socket.id].address.port) : ''));

    var sessionId = socket.sessionId;
    if (sessionId) {
      var myticket = getTicketIdBySessionId(sessionId);
      if (myticket !== null) {
        Tickets[myticket].setMaster('socket', null);
      }
    }
  });

  socket.on('heartbeat', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var sessionId = msg.sessionId || '';
      var instance = msg.instance || '';
      var lastMsg = msg.lastMsg || {};
      var lastMsgData = lastMsg.data || {};
      var myticket;
      logger.log('Got HEARTBEAT from socket '+socket.id+' instance "' + instance + '"' + ((sessionId !== '') ? ' serving session "' + sessionId + '"' : ''));
      //logger.log('instance', socket.instance || '');
      //logger.log('session', socket.session || '');
      //logger.log('hostname', socket.hostname || '');
      if (sessionId !== '') {
        myticket = getTicketIdBySessionId(sessionId);
        var masterTicket = msg.ticket || null;
        if (myticket == null) {
          recoverTicket(masterTicket, socket);
          myticket = getTicketIdBySessionId(sessionId);
        }
        if (myticket !== null) {
          if (Tickets[myticket].getMaster('socket') == null) {
            Tickets[myticket].setMaster('socket', socket.id);
          }
          if (masterTicket !== null) {
            if (_.indexOf(sessionStatusCodes, Tickets[myticket].sessionStatus) < _.indexOf(sessionStatusCodes, masterTicket.sessionStatus)) {
              Tickets[myticket].set('sessionStatus', masterTicket.sessionStatus);
            }
            // Check session status and if previous state is completed send message to master to continue to next step.
            switch (masterTicket.sessionStatus) {
              case 'initialized' :
                handleInitialized(socket, sessionId, myticket, lastMsgData);
                break;
              case 'downloaded' :
                handleDownloadFinished(socket, sessionId, myticket, lastMsgData);
                break;
              case 'downloadedData' :
                handleDataDownloadFinished(socket, sessionId, myticket, lastMsgData);
                break;
              case 'downloadedTool' :
                handleToolDownloadFinished(socket, sessionId, myticket, lastMsgData);
                break;
              case 'executed' :
                handleExecuteFinished(socket, sessionId, myticket, lastMsgData);
                break;
              case 'uploaded' :
                handleUploadFinished(socket, sessionId, myticket, lastMsgData);
                break;
              case 'cleanedup' :
                handleCleanupFinished(socket, sessionId, myticket, lastMsgData);
                break;
              default :
                break;
            }
          }
        }
      } else {
        if (lastMsg.code === 'hello') {
          instanceId = lastMsgData.instanceId;
          myticket = getTicketIdByInstanceId(instanceId);
          handleHello(socket, instanceId, myticket, lastMsgData);
        } else {
          logger.log('ERROR handling (' + lastMsg.code + ') ' +
                     'Could not find session ' + sessionId);
        }
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('set_viewers', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        Tickets[myticket].set('sessionStatus', 'executing2');
        reqID = Tickets[myticket].id;
        var aliasDnsName = Tickets[myticket].getMaster('aliasDnsName');
        var logURL = aliasDnsName || Tickets[myticket].getMaster('publicDnsName') || Tickets[myticket].getMaster('publicIp');
        var vncURL = aliasDnsName || Tickets[myticket].getMaster('publicDnsName') || Tickets[myticket].getMaster('publicIp');
        var jobType = Tickets[myticket].getRequest('jobType') || 'batch';
        logURL = (logURL != '') ?  logURLproto + '://' + logURL + ':' + logURLport + '?token=' + Tickets[myticket].get('uuid') : '';

        if (jobType == 'interactive') {
          var vncURLargs = '?password=' + Tickets[myticket].get('uuid') + '&title=Nefelus%20-%20' + (sessionId.split('_')[4] || 'VNC.Console');
          vncURLargs += (noVNCdebug === true) ? '&logging=debug' : '';
          vncURL = (vncURL != '') ?  vncURLproto + '://' + vncURL + ':' + vncURLport + vncURLargs : '';
        } else if (jobType == 'prompt') {
          vncURL = (vncURL != '') ?  cmdURLproto + '://' + vncURL + ':' + cmdURLport + '?key=' + Tickets[myticket].get('uuid') : '';
        } else {
          vncURL = '';
        }

        Tickets[myticket].logConsole = logURL;
        Tickets[myticket].vncConsole = vncURL;

        // Check if consoles are active first and then inform the frontend.
        if ((logURL !== '') || (vncURL !== '')) {

          Tickets[myticket].consoleCheckTimer = setInterval(function() {
            nt.isAliveUrl({'url' : ((Tickets[myticket].vncConsole !== '') ? Tickets[myticket].vncConsole : Tickets[myticket].logConsole),
                           'timeout' : 2000},
                          function(err, data) {
                            var cct = Tickets[myticket].get('consoleCheckTimes');
                            var mysqlKeys = ['LOG_VIEWER', 'VNC_VIEWER', 'LOCAL_IP', 'PUBLIC_IP']; // LOG_VIEWER was RUN_DIR
                            var mysqlValues = [Tickets[myticket].logConsole, Tickets[myticket].vncConsole,
                                               Tickets[myticket].getMaster('ip'), Tickets[myticket].getMaster('aliasDnsName') || Tickets[myticket].getMaster('publicDnsName')];
                            var jobType = Tickets[myticket].getRequest('jobType') || 'batch';
                            if ((! vncLocalOnly) && (jobType == 'interactive')) {
                              mysqlKeys.push('VNCPORT');
                              mysqlValues.push(5901); // Ooops hardcoded!
                              mysqlKeys.push('DISPLAY');
                              mysqlValues.push(':1'); // Ooops hardcoded!
                            }

                            if ((cct % 5 ) == 0 ) {
                              logger.log(sessionId + ': Waiting console to become ready ' + cct);
                            }
                            Tickets[myticket].set('consoleCheckTimes', cct - 1);
                            if ((!err) || (cct === 0)) {
                              Tickets[myticket].set('consoleCheckTimes', CONSOLE_CHECK_MAX_TIMES);
                              clearInterval(Tickets[myticket].consoleCheckTimer)
                              Tickets[myticket].consoleCheckTimer = null;
                              updateStatus(mysqlPool, reqID, 'RUNNING', mysqlKeys, mysqlValues);
                              logger.log(sessionId + ': LOG URL: ' + Tickets[myticket].logConsole);
                              if (Tickets[myticket].vncConsole !== '') {
                                logger.log(sessionId + ': VNC VIEWER: ' + Tickets[myticket].vncConsole);
                              }
                            }
                          });
          }, CONSOLE_CHECK_INTERVAL);
        } else {
          var mysqlKeys = ['LOG_VIEWER', 'VNC_VIEWER', 'LOCAL_IP', 'PUBLIC_IP']; // LOG_VIEWER was RUN_DIR
          var mysqlValues = [Tickets[myticket].logConsole, Tickets[myticket].vncConsole,
                             Tickets[myticket].getMaster('ip'), Tickets[myticket].getMaster('aliasDnsName') || Tickets[myticket].getMaster('publicDnsName')];
          if ((! vncLocalOnly) && (jobType == 'interactive')) {
            mysqlKeys.push('VNCPORT');
            mysqlValues.push(5901); // Ooops hardcoded!
            mysqlKeys.push('DISPLAY');
            mysqlValues.push(':1'); // Ooops hardcoded!
          }
          updateStatus(mysqlPool, reqID, 'RUNNING', mysqlKeys, mysqlValues);
          logger.log(sessionId + ': LOG URL: ' + Tickets[myticket].logConsole);
          if (Tickets[myticket].vncConsole !== '') {
            logger.log(sessionId + ': VNC VIEWER: ' + Tickets[myticket].vncConsole);
          }
        }
      } else {
        logger.log('ERROR: (set_viewers) Could not find session ' + sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('download_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var sessionId = msg.sessionId || '';
      var APIversion = msg.APIversion || '1.0';
      var status = msg.status || '';
      var message = msg.message || '';
      logger.log(sessionId + ': Got DOWNLOAD_FINISHED with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleDownloadFinished(socket, sessionId, myticket, msg);
      } else {
        logger.log('ERROR: (download_finished) Could not find session ' + sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('tool_download_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      logger.log(sessionId + ': Got TOOL_DOWNLOAD_FINISHED with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleToolDownloadFinished(socket, sessionId, myticket, msg);
      } else {
        logger.log('ERROR: (tool_download_finished) Could not find session ' + sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('data_download_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      logger.log(sessionId + ': Got DATA_DOWNLOAD_FINISHED with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleDataDownloadFinished(socket, sessionId, myticket, msg);
      } else {
        logger.log('ERROR: (data_download_finished) Could not find session ' + sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('execute_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      var cancelled = msg.cancelled || '';
      logger.log(sessionId + ': Got EXECUTE_FINISHED ' + ((cancelled) ? '[terminated] ' : '') + 'with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleExecuteFinished(socket, sessionId, myticket, msg);
      } else {
        logger.log(sessionId + ': Error can not find ticket.');
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('upload_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      logger.log(sessionId + ': Got UPLOAD_FINISHED with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleUploadFinished(socket, sessionId, myticket, msg);
      } else {
        logger.log(sessionId + ': Error can not find ticket.');
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('data_pull_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      var reqID = msg.reqId || '';
      logger.log(sessionId + ': Got DATA_PULL_FINISHED with status : ' + status);

      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }

      var mysqlKeys = ['NOTE'];
      var mysqlValues = [];
      if (status !== 'error') {
        if (status === 'ok') {
          mysqlValues.push('');
        } else if (status === 'warning') {
          mysqlValues.push(message);
        }
        status = 'ENDED';
      } else {
        logger.log(sessionId + ': Error uploading data to S3 : ' + message);
        mysqlValues.push('Error uploading data: ' + message);
        status = 'ERROR';
      }
      if (reqID !== '') {
        updateStatus(mysqlPool, reqID, status, mysqlKeys, mysqlValues);
      } else {
        logger.log('Could not update DB, empty reqID received');
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('data_push_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      var reqID = msg.reqId || '';
      logger.log(sessionId + ': Got DATA_PUSH_FINISHED with status : ' + status);

      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }

      var mysqlKeys = [];
      var mysqlValues = [];
      if (status !== 'error') {
        mysqlKeys = ['OUTPUT_DIR'];
        if (status === 'ok') {
          mysqlValues.push(nt.createSessionPath(sessionId) + 'out');
        } else if (status === 'warning') {
          mysqlValues.push('');
        }
        if (reqID !== '') {
          updateStatus(mysqlPool, reqID, 'ENDED', mysqlKeys, mysqlValues);
        } else {
          logger.log('Could not update DB, empty reqID received');
        }
      } else {
        logger.log(sessionId + ': Error uploading data to S3 : ' + message);
        mysqlKeys = ['NOTE'];
        mysqlValues = ['Error uploading data: ' + message];
        if (reqID !== '') {
          updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
        } else {
          logger.log('Could not update DB, empty reqID received');
        }
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('cleanup_finished', function (data) {
    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);
      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      logger.log(sessionId + ': Got CLEANUP_FINISHED with status : ' + status);
      var myticket = getTicketIdBySessionId(sessionId);
      var masterTicket = msg.ticket || null;
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleCleanupFinished(socket, sessionId, myticket, msg);
      } else {
        // If ticket is not null, TerminateSession is called from handleCleanupFinished.
        TerminateSession(sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('ready', function (data) {

    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);

      var APIversion = msg.APIversion || '1.0';
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var message = msg.message || '';
      var masterTicket = msg.ticket || null;
      logger.log(sessionId + ': Got READY with status : ' + status);

      var reqID = null;
      var myticket = getTicketIdBySessionId(sessionId);
      if (myticket == null) {
        recoverTicket(masterTicket, socket);
        myticket = getTicketIdBySessionId(sessionId);
      }
      if (myticket !== null) {
        handleInitialized(socket, sessionId, myticket, msg);
      } else {
        logger.log('ERROR: (ready) Could not find session ' + sessionId);
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('hello', function (data) {

    if (nt.isSafeJSON(data)) {
      var msg = JSON.parse(data);

      var APIversion = msg.APIversion || '1.0';
      var sessionId = null;
      var reqID = null;
      var instanceId = msg.instanceId || '';
      var reqSessionId = msg.reqSessionId || '';
      logger.log('Got HELLO from master: ' + instanceId);
      var myticket = getTicketIdByInstanceId(instanceId);

      handleHello(socket, instanceId, myticket, msg);

    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('admincmd', function (data) {
    logger.log('Got ADMINCMD : ' + data);
    socket.set('instance', '', function () {});
    socket.set('session', 'admin', function () {});
    if (nt.isSafeJSON(data)) {
      var cmd = JSON.parse(data);
      var mesg = {status:'', message : ''};
      switch (cmd.command) {
        case 'showsessions' :
          mesg.status = 'ok';
          mesg.message = JSON.stringify(Tickets);
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        case 'shutdown' :
          mesg.status = 'ok';
          mesg.message = 'Shuting down';
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          sigintHandler();
          break;
        case 'status' :
          mesg.status = 'ok';
          mesg.message = 'Status = ' + mystate;
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        case 'reload' :
          loadConfig();
          logger.log('Config reloaded.');
          mesg.status = 'ok';
          mesg.message = 'Config reloaded.';
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        case 'pause' :
          mystate = 'off';
          logger.log('Operations paused.');
          mesg.status = 'ok';
          mesg.message = 'Operations paused.';
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        case 'resume' :
          mystate = 'on';
          logger.log('Operations resumed.');
          mesg.status = 'ok';
          mesg.message = 'Operations resumed.';
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        case 'interval' :
          var newtimeout = parseInt(cmd.args[0]);
          if (isNaN(newtimeout)) {
            newtimeout = 0;
          } else {
            if (newtimeout < db.queryinterval) {
              newtimeout = 0;
            }
          }
          if (newtimeout > 0) {
            mesg.status = 'ok';
            mesg.message = 'Interval set to ' + newtimeout;
            clearInterval(timerID);
            timerID = setInterval(dispatcher, newtimeout);
          } else {
            mesg.status = 'error';
            mesg.message = 'Interval either small or NaN. Min allowed=' + db.queryinterval;
          }
          logger.log(mesg.message);
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
        default :
          mesg.status = 'error';
          mesg.message = 'Unknown command '+cmd.command;
          socket.emit('admincmd_finished', JSON.stringify(mesg));
          break;
      }
    } else {
      logger.log('Got bogus message:' + data);
    }
  });

});

function middleSessionOperation(type, id, sid, sqlpool, status,  msgParams) {
  var mysqlKeys;
  var mysqlValues;
  var isSessionActive = getTicketIdBySessionId(sid);

  logger.log('Processing ' + type + ' for session #' + id + ' : ' + sid);
  if (isSessionActive !== null) {
    var activeTicket = Tickets[isSessionActive];
    var peer = activeTicket.getMaster('socket');
    var masterTicket = dupTicket(activeTicket.get('id'));
    if (peer !== null) {
      var msg = {'reqId' : id, 'sessionId' : sid, 'ticket' : masterTicket};
      logger.log(sid + ': SENT ' + type + ' to '+peer)
      if (msgParams) {
        for (var attr in msgParams) {
          msg[attr] = msgParams[attr];
        }
      }
      io.sockets.socket(peer).emit(type, JSON.stringify(msg), parseAck);
      updateStatus(sqlpool, id, status);
    } else {
      logger.log('Remote socket for session ' + sid + ' not found');
      mysqlKeys = ['NOTE'];
      mysqlValues = ['Remote socket for session ' + sid + ' not found'];
      updateStatus(sqlpool, id, 'ERROR', mysqlKeys, mysqlValues);
    }
  } else {
    logger.log('Session ' + sid + ' not found');
    mysqlKeys = ['NOTE'];
    mysqlValues = ['Session ' + sid + ' not found'];
    updateStatus(sqlpool, id, 'ERROR', mysqlKeys, mysqlValues);
  }
}

function sendSessionStatusEmail(sessionId, reqID, sqlpool) {
  var i;
  var subject = null;
  var record = {
    'firstname' : '',
    'ID' : '',
    'toolname' : '',
    'blockname' : '',
    'projectname' : '',
    'email' : '',
    'started' : '',
    'completed' : '',
    'status' : ''
  };

  var templateIndex = -1;
  var templateName = 'session-status';

  for (var i = emailTemplates.length - 1; i >= 0; i--) {
    if (emailTemplates[i].name == templateName) {
      templateIndex = i;
      break;
    }
  }

  if (templateIndex !== -1) {
    record = emailTemplates[templateIndex].context || record;
    subject = emailTemplates[templateIndex].subject || null;
  }

  extractParams4SessionStatusEmail(sessionId, record, reqID, sqlpool, function(err, args) {
    if (err) {
      logger.log('Error getting email params');
    } else {
      var bcc = '';
      if (args.status == 'ERROR') {
        bcc = adminEmail;
      }
      queueHUBMail(sqlpool, templateName, args.email, '', bcc, subject, args);
    }
  });
}

function extractParams4SessionStatusEmail(sessionId, record, reqID, sqlpool, cb) {

  var i, j;

  var sid = nt.parseSessionId(sessionId);

  //SELECT us.ID as ID,
  //       up.BLOCK as blockname,
  //       up.NAME as projectname,
  //       ul.FIRST_NAME as firstname,
  //       concat(concat(ul.FIRST_NAME, ' '), ul.LAST_NAME) as fullname,
  //       ul.EMAIL as email,
  //       hr.STARTED as started,
  //       hr.COMPL_TARGET as completed,
  //       hr.STATUS as status,
  //       ta.NAME as toolname
  //       FROM TOOL_APPS as ta, HUB_REQUEST as hr, USER_SESSION as us, USER_PROJECT as up, USER_LOGIN as ul
  //       WHERE us.TASK_ID = ? and ul.ID = ? and up.ID = ? and us.USER_ID=ul.ID and hr.ID = ? and ta.ID = ?;
  var emailqueryparams = [];

  emailqueryparams.push(sid.taskId);
  emailqueryparams.push(sid.clientId);
  emailqueryparams.push(sid.projectId);
  emailqueryparams.push(reqID);
  emailqueryparams.push(sid.toolId);

  if (sqlpool !== null) {
    sqlpool.getConnection(function(err, client) {
      if (err) {
        logger.log(err);
        return;
      }
      client.query(SQL.notificationInfo, emailqueryparams, function(err, rows, fields) {
        if (err) {
          cb(err, null);
        } else {

          for (i = 0; i < rows.length; i++) {
            for (j = 0; j < fields.length; j++) {
              record[fields[j].name] = rows[i][fields[j].name];
              if (typeof record[fields[j].name] === 'object') {
                record[fields[j].name] += '';
              }
            }
          }
          if (timezone) {
            if ((record.started) && (record.started !== '')) {
              var dts = new Date(record.started);
              dts.setTimezone(timezone);
              record.started = dts.toString();
            } else {
              record.started = 'N/A'
            }
            if ((record.completed) && (record.completed !== '')) {
              var dtc = new Date(record.completed);
              dtc.setTimezone(timezone);
              record.completed = dtc.toString();
            } else {
              record.completed = 'N/A'
            }
          }
          cb(null, record);
        }
        client.release();
      });
    });
  } else {
    logger.log('Could not establish connection to mysql server');
  }
}

function queueHUBMail(sqlpool, templateName, recipients, cc, bcc, subject, args) {
  var now = nt.getDateTimeNow(true, false);
  var params = {
    'CREATED'       : now,
    'STATUS'        : 'PENDING',
    'SERVICE'       : 'HUB',
    'TO'            : recipients,
    'SUBJECT'       : subject,
    'CC'            : cc,
    'BCC'           : bcc,
    'TEMPLATE_NAME' : templateName,
    'PARAMS'        : JSON.stringify(args)
  };
  var q = 'INSERT INTO MAIL_QUEUE SET ?';

  if (sqlpool !== null) {
    sqlpool.getConnection(function(err, client) {
      if (err) {
        logger.log(err);
        client.release();
        return;
      }
      client.query(q, params, function (err, result) {
        if (err) {
          logger.log('queueHUBMail : Error:' + util.inspect(err, { showHidden: true, depth: null }));
        } else {
          logger.log('queueHUBMail : Request added to mail queue.');
        }
        client.release();
      });
    });
  } else {
    logger.log('Could not establish connection to mysql server');
  }
}

function showProcessStats() {
  var m = process.memoryUsage();
  var mrss = (m.rss / 1048576).toFixed(2);
  var mheapTotal = (m.heapTotal / 1048576).toFixed(2);
  var mheapUsed = (m.heapUsed / 1048576).toFixed(2);
  var uptime = (process.uptime() / 60).toFixed(2);
  logger.log('Process info : pid=' + process.pid + ', uptime=' + uptime +
             'mins, rss=' + mrss + 'MB, heapTotal=' + mheapTotal +
             'MB, heapUsed=' + mheapUsed + 'MB');
}

function handleDownloadFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket;
  var mysqlKeys = [];
  var mysqlValues = [];
  var status = msg.status || '';
  var message = msg.message || '';
  var mesg;

  if (status === 'error') {
    logger.log(sessionId + ': Error is : ' + message);

    mysqlKeys = ['NOTE'];
    mysqlValues = [message];
    updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
    // do not permit further execution upload logs and terminate
    Tickets[ticket].set('internalError', 'DOWNLOAD');
    logger.log(sessionId + ': SENT UPLOAD (to get error logs)');

    Tickets[ticket].set('sessionStatus', 'upload');
    masterTicket = dupTicket(reqID);

    mesg = {'sessionId' : sessionId, 'ticket' : masterTicket};
    socket.emit('upload', JSON.stringify(mesg), parseAck);
  } else {
    var now = nt.getDateTimeNow(true, false);
    mysqlKeys = ['STARTED'];
    mysqlValues = [now];
    updateStatus(mysqlPool, reqID, 'SETUP', mysqlKeys, mysqlValues);
    var jobType = Tickets[ticket].getRequest('jobType') || 'batch';
    var commandFile = Tickets[ticket].getRequest('commandFile') || '';
    var runningDir = Tickets[ticket].getRequest('runningDir') || '';
    var machineCount = Tickets[ticket].getRequest('machineCount') || '1';
    var threadCount = Tickets[ticket].getRequest('threadCount') || null;
    Tickets[ticket].set('sessionStatus', 'execute');
    masterTicket = dupTicket(reqID);
    var licenseManager = Tickets[ticket].getRequest('licenseManager') || '';
    mesg = {
      'sessionId' : sessionId,
      'jobType' : jobType,
      'runningDir' : runningDir,
      'commandFile' : commandFile,
      'licenseManager' : licenseManager,
      'machineCount' : machineCount,
      'threadCount' : threadCount,
      'x11IdleTimeout' : x11IdleTimeout,
      'ticket' : masterTicket
    };
    logger.log(sessionId + ': SENT EXECUTE ' + JSON.stringify(mesg));

    socket.emit('execute', JSON.stringify(mesg), parseAck);
    logger.log(sessionId + ': EXECUTION STARTED at ' + now);
  }
}

function handleDataDownloadFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket;
  var mysqlKeys;
  var mysqlValues;
  var status = msg.status || '';
  var message = msg.message || '';
  var mesg;

  if (status === 'error') {
    logger.log(sessionId + ': Error is : ' + message);

    mysqlKeys = ['NOTE'];
    mysqlValues = [message];
    updateStatus(mysqlPool, reqID, 'RUNNING', mysqlKeys, mysqlValues);
    // do not permit further execution upload logs and terminate
    Tickets[ticket].set('internalError', 'DATA_DOWNLOAD');

    Tickets[ticket].set('sessionStatus', 'upload');

    masterTicket = dupTicket(reqID);
    logger.log(sessionId + ': SENT UPLOAD (to get error logs)');
    mesg = {'sessionId' : sessionId, 'ticket' : masterTicket};
    socket.emit('upload', JSON.stringify(mesg), parseAck);
  } else {
    Tickets[ticket].set('sessionStatus', 'downloadTool');
    masterTicket = dupTicket(reqID);

    var jobType = Tickets[ticket].getRequest('jobType') || 'batch';
    mesg = {
      'sessionId' : sessionId,
      'jobType' : jobType,
      'ticket' : masterTicket
    };
    logger.log(sessionId + ': SENT DOWNLOAD TOOL');
    socket.emit('tool_download', JSON.stringify(mesg), parseAck);
  }
}

function handleToolDownloadFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket;
  var mesg;
  var mysqlKeys = [];
  var mysqlValues = [];
  var status = msg.status || '';
  var message = msg.message || '';

  if (status === 'error') {
    logger.log(sessionId + ': Error is : ' + message);
    mysqlKeys = ['NOTE'];
    mysqlValues = [message];
    updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
    // do not permit further execution upload logs and terminate
    Tickets[ticket].set('internalError', 'TOOL_DOWNLOAD');
    logger.log(sessionId + ': SENT UPLOAD (to get error logs)');

    Tickets[ticket].set('sessionStatus', 'upload');
    masterTicket = dupTicket(reqID);

    mesg = {'sessionId' : sessionId, 'ticket' : masterTicket};
    socket.emit('upload', JSON.stringify(mesg), parseAck);
  } else {
    var now = nt.getDateTimeNow(true, false);
    mysqlKeys = ['STARTED'];
    mysqlValues = [now];
    updateStatus(mysqlPool, reqID, 'SETUP', mysqlKeys, mysqlValues);
    var jobType = Tickets[ticket].getRequest('jobType') || 'batch';
    var commandFile = Tickets[ticket].getRequest('commandFile') || '';
    var runningDir = Tickets[ticket].getRequest('runningDir') || '';
    var machineCount = Tickets[ticket].getRequest('machineCount') || '1';
    var threadCount = Tickets[ticket].getRequest('threadCount') || null;
    Tickets[ticket].set('sessionStatus', 'execute');
    masterTicket = dupTicket(reqID);
    mesg = {
      'sessionId' : sessionId,
      'jobType' : jobType,
      'runningDir' : runningDir,
      'commandFile' : commandFile,
      'machineCount' : machineCount,
      'threadCount' : threadCount,
      'x11IdleTimeout' : x11IdleTimeout,
      'ticket' : masterTicket
    };
    logger.log(sessionId + ': SENT EXECUTE ' + JSON.stringify(mesg));

    socket.emit('execute', JSON.stringify(mesg), parseAck);
    logger.log(sessionId + ': EXECUTION STARTED at ' + now);
  }
}

function handleUploadFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket;
  var mesg;
  var mysqlKeys = [];
  var mysqlValues = [];
  var status = msg.status || '';
  var message = msg.message || '';

  Tickets[ticket].set('sessionStatus', 'cleanup');

  if (status !== 'error') {
    mysqlKeys = ['OUTPUT_DIR'];
    if (status === 'ok') {
      mysqlValues.push(nt.createSessionPath(sessionId) + 'out');
    } else if (status === 'warning') {
      mysqlValues.push('');
    }
    updateStatus(mysqlPool, reqID, 'CLOSING', mysqlKeys, mysqlValues);
  } else {
    logger.log(sessionId + ': Error uploading data to S3 : ' + message);
    mysqlKeys = ['NOTE'];
    mysqlValues = ['Error uploading data: ' + message];
    // do not permit further execution upload logs and terminate
    Tickets[ticket].set('internalError', 'UPLOAD');
    updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
  }
  masterTicket = dupTicket(reqID);
  mesg = {
    'param' : '', // can be 'data' to cleanup only data
                  //        'tool' to cleanup only tool
                  //     or '' to cleanup everything
    'sessionId' : sessionId,
    'ticket' : masterTicket
  };
  setTimeout(function() {
    logger.log(sessionId + ': SENT CLEANUP');
    socket.emit('cleanup', JSON.stringify(mesg), parseAck);
  }, 2000);
}

function handleExecuteFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket;
  var mesg;
  var mysqlKeys = [];
  var mysqlValues = [];
  var now = nt.getDateTimeNow(true, false);
  var status = msg.status || '';
  var message = msg.message || '';

  var cancelled = msg.cancelled || '';
  var errorlines = Number(msg.errorlines) || 0;
  var warninglines = Number(msg.warninglines) || 0;
  var errorOrWarningLines = '';
  if ((errorlines > 0) || (warninglines > 0)) {
    errorOrWarningLines = errorlines + ' errors and ' +  warninglines + ' warnings.';
  }

  if (status === 'error') {
    var execRC = msg.errorcode || 'X';
    mysqlKeys = ['COMPL_TARGET', 'NOTE', 'EXIT_CODE', 'NO_OF_ERRORS']; // NO_OF_ERRORS was LIBS_LOCATION
    Tickets[ticket].set('toolExitCode', execRC);
    Tickets[ticket].set('cancelled', cancelled);
    mysqlValues = [now, message, execRC, errorOrWarningLines];
    updateStatus(mysqlPool, reqID, 'CLOSING', mysqlKeys, mysqlValues);
    logger.log(sessionId + ': EXECUTION FINISHED with error at ' + now);
    logger.log(sessionId + ': Error is : ' + message);
  } else {
    if (message !== '') {
      logger.log(sessionId + ': Execute Message: ' + message);
    }
    mysqlKeys = ['COMPL_TARGET', 'EXIT_CODE', 'NO_OF_ERRORS']; // NO_OF_ERRORS was LIBS_LOCATION
    mysqlValues = [now, '0', errorOrWarningLines];
    Tickets[ticket].set('toolExitCode', '0');
    Tickets[ticket].set('cancelled', cancelled);
    updateStatus(mysqlPool, reqID, 'CLOSING', mysqlKeys, mysqlValues);
    logger.log(sessionId + ': EXECUTION FINISHED at ' + now);
  }
  var consoleCheckTimer = Tickets[ticket].get('consoleCheckTimer');
  if (consoleCheckTimer != null) {
    clearInterval(consoleCheckTimer);
    Tickets[ticket].set('consoleCheckTimer', null);
  }
  // IN ANY CASE, trigger upload
  // but delay for some seconds in order to give time to finish
  // log.io output.

  Tickets[ticket].set('sessionStatus', 'upload');
  masterTicket = dupTicket(reqID);
  mesg = {'sessionId' : sessionId, 'ticket' : masterTicket};
  setTimeout(function() {
    logger.log(sessionId + ': SENT UPLOAD');
    socket.emit('upload', JSON.stringify(mesg), parseAck);
  }, 10000);

}

function handleCleanupFinished(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var status = 'ENDED';

  Tickets[ticket].set('sessionStatus', 'finished');
  if (Tickets[ticket].get('internalError') === '') {
    if (Tickets[ticket].get('cancelled') === true) {
      status = 'TERMINATED';
    } else if (Tickets[ticket].get('toolExitCode') != '0') {
      status = 'WARNING';
    }
  } else {
    status = 'ERROR';
  }
  updateStatus(mysqlPool, reqID, status, [], [], function(err, data) {
    if (!err) {
      sendSessionStatusEmail(sessionId, reqID, mysqlPool);
    }
  });
  TerminateSession(sessionId);
}

function handleInitialized(socket, sessionId, ticket, msg) {
  var reqID = Tickets[ticket].id;
  var masterTicket = dupTicket(reqID);
  var mesg;
  var APIversion = msg.APIversion || '1.0';

  Tickets[ticket].set('sessionStatus', 'downloadData');
  var runas = Tickets[ticket].getRequest('runas');
  var jobType = Tickets[ticket].getRequest('jobType') || 'batch';
  mesg = {
    'sessionId' : sessionId,
    'runas' : runas,
    'jobType' : jobType,
    'ticket' : masterTicket
  };
  mesg['homeBlacklistPatterns'] = homeBlacklistPatterns;
  switch (APIversion) {
    case '1.0' :
      logger.log(sessionId + ': SENT DOWNLOAD DATA');
      socket.emit('data_download', JSON.stringify(mesg), parseAck);
      break;
    case '1.1' :
    default :
      logger.log(sessionId + ': SENT DOWNLOAD');
      socket.emit('download', JSON.stringify(mesg), parseAck);
      break;
  }
}

function handleHello(socket, instanceId, ticket, msg) {
  var sessionId = (ticket) ? getSessionByInstanceId(instanceId) : null;
  var reqID = (ticket) ? Tickets[ticket].id : null;
  var servername = msg.servername || '';
  var mysqlKeys;
  var mysqlValues;
  if (sessionId !== null) {
    var jobType = Tickets[ticket].getRequest('jobType') || 'batch';
    if (Tickets[ticket].healthCheckTimer) {
      clearInterval(Tickets[ticket].healthCheckTimer);
      Tickets[ticket].healthCheckTimer = null;
    }

    Tickets[ticket].setMaster('socket', socket.id);
    var uuid = Tickets[ticket].get('uuid');
    var cipher = crypto.createCipher('aes256', instanceId);
    var encrypted = cipher.update(JSON.stringify(aws), 'utf8', 'hex') +
                    cipher.final('hex');
    Tickets[ticket].set('sessionStatus', 'initialize');
    var runas = Tickets[ticket].getRequest('runas');
    var masterTicket = dupTicket(reqID);
    var dnsname = Tickets[ticket].getMaster('aliasDnsName') || Tickets[ticket].getMaster('publicDnsName');
    var mesg = {
      'dnsname' : dnsname,
      'sessionId' : sessionId,
      'jobType' : jobType,
      'uuid' : uuid,
      'runas' : runas,
      'masterDebug' : masterDebug,
      'aws' : encrypted,
      'ticket' : masterTicket
    };
    if (Tickets[ticket].get('XResolution')) {
      mesg['XResolution'] = Tickets[ticket].get('XResolution');
    }
    if (Tickets[ticket].get('XDisplay')) {
      mesg['XDisplay'] = Tickets[ticket].get('XDisplay');
    }
    logger.log(sessionId + ': ' + servername + ' ' + uuid);
    if (servername !== '') {
      if (reqID !== null) {
        mysqlKeys = ['SERVERNAME'];
        mysqlValues = [servername];
        updateStatus(mysqlPool, reqID, '', mysqlKeys, mysqlValues);
      }
    }

    socket.set('instance', instanceId, function () {});
    socket.set('session', sessionId, function () {});
    socket.set('hostname', servername, function () {});
    socket.emit('welcome', JSON.stringify(mesg), parseAck);
  } else {
    // FIXME: recover ticket from somewhere!
    logger.log('ERROR: Could not find corresponding session for Instance ' + instanceId);
    if (reqID !== null) {
      mysqlKeys = ['NOTE'];
      mysqlValues = ['ERROR: Could not find corresponding session for Instance ' + instanceId];
      updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
      //FIXME: no sessionId so no mail to user?
    }
  }
}

function loadMySQLParams(mysqlClient, lastUpdatedConfig, MAX_RUNNING_JOBS_ALLOWED, cb) {
  if (!lastUpdatedConfig) {
    cb('Not ready yet', null);
    return;
  }
  var DBTIMEOUT = 5000;
  var DBMAXTRIES = 24;
  async.retry(DBMAXTRIES,
              function(callback, results) {
                async.waterfall(
                  [
                    function(callback) {
                      if ((lastUpdatedConfig['MACHINE']) && (lastUpdatedConfig['MACHINE']['reload'])) {
                        machines.loadMachines(mysqlClient, function(err, machineData) {
                          err && logger.log('Machines', err);
                          if (machineData) {
                            logger.log(machineData);
                            var nowDate = new Date();
                            lastUpdatedConfig['MACHINE']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['MACHINE']['reload'] = false;
                          }
                          callback(err, machineData);
                        });
                      } else {
                        callback(null, 'No need to reload machines');
                      }
                    },
                    function(machineData, callback) {
                      if ((lastUpdatedConfig['QUEUE_QUOTA']) && (lastUpdatedConfig['QUEUE_QUOTA']['reload'])) {
                        quotas.loadQueueQuotas(mysqlClient, MAX_RUNNING_JOBS_ALLOWED, function(err, queueQuotaData) {
                          err && logger.log('QueueQuotas', err);
                          if (queueQuotaData) {
                            logger.log(queueQuotaData);
                            quotashares.loadQuotaShares(mysqlClient, function(err, queueQuotaData) {});
                            var nowDate = new Date();
                            lastUpdatedConfig['QUEUE_QUOTA']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['QUEUE_QUOTA']['reload'] = false;
                          }
                          callback(err, machineData, queueQuotaData);
                        });
                      } else {
                        callback(null, machineData, 'No need to reload quotas');
                      }
                    },
                    function(machineData, queueQuotaData, callback) {
                      if ((lastUpdatedConfig['IMAGES']) && (lastUpdatedConfig['IMAGES']['reload'])) {
                        images.loadImages(mysqlClient, function(err, imageData) {
                          err && logger.log('Images', err);
                          if (imageData) {
                            logger.log(imageData);
                            var nowDate = new Date();
                            lastUpdatedConfig['IMAGES']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['IMAGES']['reload'] = false;
                          }
                          callback(err, machineData, queueQuotaData, imageData);
                        });
                      } else {
                        callback(null, machineData, queueQuotaData, 'No need to reload images');
                      }
                    },
                    function(machineData, queueQuotaData, imageData, callback) {
                      if ((lastUpdatedConfig['CLOUD']) && (lastUpdatedConfig['CLOUD']['reload'])) {
                        clouds.loadClouds(mysqlClient, function(err, cloudData) {
                          err && logger.log('Clouds', err);
                          if (cloudData) {
                            logger.log(cloudData);
                            var nowDate = new Date();
                            lastUpdatedConfig['CLOUD']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['CLOUD']['reload'] = false;
                          }
                          callback(err, machineData, queueQuotaData, imageData, cloudData);
                        });
                      } else {
                        callback(null, machineData, queueQuotaData, imageData, 'No need to reload clouds');
                      }
                    },
                    function(machineData, queueQuotaData, imageData, cloudData, callback) {
                      if (((lastUpdatedConfig['VOLUMES']) && (lastUpdatedConfig['VOLUMES']['reload'])) ||
                          ((lastUpdatedConfig['MOUNT_POINTS']) && (lastUpdatedConfig['MOUNT_POINTS']['reload'])) ||
                          ((lastUpdatedConfig['FILE_MANAGER']) && (lastUpdatedConfig['FILE_MANAGER']['reload']))) {
                        shares.loadShares(mysqlClient, function(err, sharesData) { //FIXME
                          err && logger.log('Shares', err);
                          if (sharesData) {
                            logger.log(sharesData);
                            var nowDate = new Date();
                            lastUpdatedConfig['VOLUMES'] && ((lastUpdatedConfig['VOLUMES']['timestamp'] = Number(nowDate.valueOf())))
                            lastUpdatedConfig['VOLUMES'] && (!(lastUpdatedConfig['VOLUMES']['reload'] = false))
                            lastUpdatedConfig['MOUNT_POINTS'] && ((lastUpdatedConfig['MOUNT_POINTS']['timestamp'] = Number(nowDate.valueOf())))
                            lastUpdatedConfig['MOUNT_POINTS'] && (!(lastUpdatedConfig['MOUNT_POINTS']['reload'] = false))
                            lastUpdatedConfig['FILE_MANAGER'] && ((lastUpdatedConfig['FILE_MANAGER']['timestamp'] = Number(nowDate.valueOf())))
                            lastUpdatedConfig['FILE_MANAGER'] && (!(lastUpdatedConfig['FILE_MANAGER']['reload'] = false))
                          }
                          callback(err, machineData, queueQuotaData, imageData, cloudData, sharesData);
                        });
                      } else {
                        callback(null, machineData, queueQuotaData, imageData, cloudData, 'No need to reload shares');
                      }

                    },
                    function(machineData, queueQuotaData, imageData, cloudData, sharesData, callback) {
                      if (((lastUpdatedConfig['TOOL_APPS']) && (lastUpdatedConfig['TOOL_APPS']['reload'])) ||
                          ((lastUpdatedConfig['LICENSE_MANAGER']) && (lastUpdatedConfig['LICENSE_MANAGER']['reload']))) {
                        toolapps.loadToolApps(mysqlClient, function(err, toolappsData) {
                          err && logger.log('ToolApps', err);
                          if (toolappsData) {
                            logger.log(toolappsData);
                            var nowDate = new Date();
                            lastUpdatedConfig['TOOL_APPS']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['TOOL_APPS']['reload'] = false;
                            lastUpdatedConfig['LICENSE_MANAGER']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['LICENSE_MANAGER']['reload'] = false;
                          }
                          callback(err, machineData, queueQuotaData, imageData, cloudData, sharesData, toolappsData);
                        });
                      } else {
                        callback(null, machineData, queueQuotaData, imageData, cloudData, sharesData, 'No need to reload toolapps');
                      }
                    },
                    function(machineData, queueQuotaData, imageData, cloudData, sharesData, toolappsData, callback) {
                      if ((lastUpdatedConfig['SEC_GROUP_RULES']) && (lastUpdatedConfig['SEC_GROUP_RULES']['reload'])) {
                        secgroups.loadSecGroups(mysqlClient, function(err, secgroupsData) {
                          err && logger.log('SecGroups', err);
                          if (secgroupsData) {
                            logger.log(secgroupsData);
                            var nowDate = new Date();
                            lastUpdatedConfig['SEC_GROUP_RULES']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['SEC_GROUP_RULES']['reload'] = false;
                          }
                          callback(err, machineData, queueQuotaData, imageData, cloudData, sharesData, toolappsData, secgroupsData);
                        });
                      } else {
                        callback(null, machineData, queueQuotaData, imageData, cloudData, sharesData, 'No need to reload secgroups');
                      }
                    }
                  ],
                  function(err, machineData, queueQuotaData, imageData, cloudData, sharesData, toolappsData, secgroupsData) {
                    if (err) {
                      logger.log('Loading from MySQL failed, will retry shortly...');
                      setTimeout(function() { callback(err, {'1' : machineData || null,
                                                             '2' : queueQuotaData || null,
                                                             '3' : imageData || null,
                                                             '4' : cloudData || null,
                                                             '5' : sharesData || null,
                                                             '5' : toolappsData || null,
                                                             '6' : secgroupsData || null
                                                            }); }, DBTIMEOUT);
                    } else {
                      logger.log('Loading from MySQL completed');
                      callback(err, {'machines' : machineData || null,
                                     'queueQuotas' : queueQuotaData || null,
                                     'images' : imageData || null,
                                     'clouds' : cloudData || null,
                                     'shares' : sharesData || null,
                                     'toolapps' : toolappsData || null,
                                     'secgroups' : secgroupsData || null
                                    });
                    }
                  }
                );
              },
              function (err, results) {
                if (err) {
                  logger.log('Fatal error loading from MySQL. Exiting...');
                //} else {
                  //results && logger.log('retry', results);
                }
                cb(err, results);
              }
  );
}

function checkForUpdatedConfigs(mysqlClient, lastupdatedConfigs, cb) {
  if ((typeof lastupdatedConfigs === 'undefined') || (lastupdatedConfigs === null)) {
    lastupdatedConfigs = {};
  }
  try {
    mysqlClient.query(SQL.lastupdated, function(err, rows, fields) {
      if (err) {
        console.log('Error from MYSQL query:');
        cb(err, null);
        return;
      } else {
        var needsReloading = false;
        for (var i = 0; i < rows.length; i++) {
          var record = {};
          for (var j = 0; j < fields.length; j++) {
            record[fields[j].name] = rows[i][fields[j].name];
          }
          var lastupdatedDate = new Date(record.UPDATED);
          var lastupdated = Number(lastupdatedDate.valueOf());

          if (lastupdatedConfigs[record.TABNAME] === undefined) {
            lastupdatedConfigs[record.TABNAME] = {'timestamp' : 0, 'reload' : true};
            needsReloading = true;
          }
          var diff = lastupdatedConfigs[record.TABNAME].timestamp - lastupdated;
          if (diff <= 0) {
            lastupdatedConfigs[record.TABNAME].reload = true;

            //var nowDate = new Date();
            //var now = Number(nowDate.valueOf());
            //lastupdatedConfigs[record.TABNAME].timestamp = now;

            needsReloading = true;
          } else {
            lastupdatedConfigs[record.TABNAME].reload = false;
          }
        }
      }
      cb(null, lastupdatedConfigs, needsReloading);
    });
  } catch (ex) {
    cb(util.inspect(ex, null), null);
    return;
  }
}

function checkForPendingUserTerminate(recs, sessionId) {
  for (var i = 0; i < recs.length; i++) {
    if ((recs[i].COMMAND === 'USER_TERMINATE') && (recs[i].SESSION_ID === sessionId) && (recs[i].STATUS === 'PENDING')) {
      return { index : i, id : recs[i].ID}
    }
  }
  return null;
}

function TerminateLongRunningSessions() {
  logger.log('Checking for long running jobs...');
  for (var key in Tickets) {
    var ticket = Tickets[key];
    if (ticket !== null) {

      //middleSessionOperation('cancel', ticket.id, ticket.sessionId, mysqlPool, 'TERMNINATED', {});
      var checktime = null;
      if (ticket.machineStarted) {
        checktime = ticket.machineStarted;
      }
      if (ticket.jobStarted) {
        checktime = ticket.jobStarted;
      }
      var td = timediff(checktime, 'now', 'Hm');
      if (cancelHours !== 0) {
        if ((((td.hours * 60) + td.minutes) > (cancelHours * 60)) && (((td.hours * 60) + td.minutes) < (forceCancelHours * 60))) {
          logger.log(ticket.req.sessionId+': WARNING: Session excided running time limit. Sending cancel message to terminate.')
          middleSessionOperation('cancel', ticket.id, ticket.req.sessionId, mysqlPool, 'FORCEDOUT', {});
        } else if (((td.hours * 60) + td.minutes) > (forceCancelHours * 60)) {
          logger.log(ticket.req.sessionId+': WARNING: Session was forced to cancel but it is still running. Forcing Termination');
          TerminateSession(ticket.req.sessionId);
          updateStatus(mysqlPool, ticket.id, 'FORCEDOUT', [], [], function(err, data) {}); // Don't send emails in such cases.
        }
      }
    }
  }
}
