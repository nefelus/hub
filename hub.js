//------------------------------------------------------------------------
//
// This is part of Nefelus
//
// Author    : Giannis Kosmas <kosmasgiannis@gmail.com>
// Date      : 2012-12-26
//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
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

var NSLM_BYPASS = true; // NOTE: Setting it to false activates nslm license checks (!)
var NEFELUS_HUB_FEATURE = 'af04a46364987c32b0664750ea50d7df'; // Nefelus HUB 1.0

var thepackage = require('./package.json');
var HUBversion = 'v'+thepackage.version;
var constants  = require('constants');
var util       = require('util');
var path       = require('path');
var mysql      = require('mysql');
var SQL        = require('./sqlTemplates').sqlTemplates;
var crypto     = require('crypto');
var zlib       = require('zlib');
var nconf      = require('nconf');
var toml       = require('toml');
var nt         = require('./lib/tools');
var http       = require('http');
var https      = require('https');
var request = require('request');
var _          = require('lodash');
var fs         = require('fs');
var concat     = require('concat-stream');
var archiver   = require('archiver');

var AWS = require('aws-sdk');

var dns        = require('./lib/dns');
var UUID       = require('uuid/v4');
var tmp        = require('tmp');
var moment     = require('moment-timezone');
var timediff   = require('timediff');
var async      = require('async');
var logger     = require('./lib/logging').logger;
var images = require('./lib/images');
var secgroups = require('./lib/secgroups');
var quotas = require('./lib/quotas');
var quotashares = require('./lib/quotashares');
var clouds = require('./lib/clouds');
var shares = require('./lib/shares');
var toolapps = require('./lib/toolapps');
var machines = require('./lib/machines');
var _nslm = require('./lib/nslmlib');

var isPkg = (process.versions.pkg !== undefined);

var exepath;
var myargs;

if (isPkg) {
  exepath = process.argv[0];
  myargs = process.argv.slice(2);
} else if ((path.basename(process.argv[0]) === 'node')) {
  exepath = process.argv[1];
  myargs = process.argv.slice(2);
} else {
  exepath = process.argv[0];
  myargs = process.argv.slice(1);
}
exepath = path.dirname(exepath);

var mainconf = new nconf.Provider();
mainconf.argv({ c: { alias: 'config'}, V : {alias: 'version'} });

var commonConfigDir = mainconf.get('config') || '/usr/share/nefelus/conf';
var appConfigDir = commonConfigDir;

if (nt.isReadableSync(path.join(commonConfigDir, 'nefelus.conf')) === false) {
  logger.log(path.join(commonConfigDir, 'nefelus.conf')+' not found. Falling back to '+ path.join(exepath, 'nefelus.conf'));
  commonConfigDir = exepath;
  if (nt.isReadableSync(path.join(commonConfigDir, 'nefelus.conf')) === false) {
    logger.log(path.join(commonConfigDir, 'nefelus.conf')+' not found. Exiting.');
    process.exit(2);
  }
}

if (nt.isReadableSync(path.join(appConfigDir, 'hub.conf')) === false) {
  logger.log(path.join(appConfigDir, 'hub.conf')+' not found. Falling back to '+ path.join(exepath, 'hub.conf'));
  appConfigDir = exepath;
  if (nt.isReadableSync(path.join(appConfigDir, 'hub.conf')) === false) {
    logger.log(path.join(appConfigDir, 'hub.conf')+' not found. Exiting.');
    process.exit(2);
  }
}

logger.log('--------------------------------------------------');
logger.log('-             Nefelus HUB ' + HUBversion + '                 -');
logger.log('--------------------------------------------------');

if (mainconf.get('version')) {
  process.exit(0);
}

logger.log('PID :' +  process.pid);
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

var HEALTH_CHECK_INTERVAL = 30000; // 30 secs
var RESTART_INTERVAL = 120000; // 30 secs
var CONSOLE_CHECK_INTERVAL = 5000; // 5 secs
var CONSOLE_CHECK_MAX_TIMES = 60;  // 60 times * 5 secs = 5 minutes

var sslOptions = false;
var sslMasterPack = false;
var masterScripts = false;
var installationId = '';
var ignoreInstallationIdInFilemanagerOps = false;
var aws;
var awsParams = {};
var r53info;
var dnsPostprocess;

var EC2_TIMEOUT;
var EC2_SMALL_TIMEOUT;
var EC2_MAX_TRIES;

var keyName;
var securityGroup;
var defaultSubnetId;
var workerUsername;
var defaultRootVolumeSize;
var setloginuser;
var setsecgroups;
var hasAutoAssignFloatingIp;

var hubType;
var hubPort;
var hubHost;
var hubProtocol;
var filemanager;

var timezone = null;
var vncLocalOnly;
var staticUserData;
var logURLproto;
var vncURLproto;
var cmdURLproto;
var logURLport;
var vncURLport;
var cmdURLport;
var noVNCdebug;
var x11IdleTimeout;
var homeBlacklistPatterns = [];
var emailTemplates;
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
var deactivateNFSSharesOfOldInstancesTimer = null;
var useDynamicNFSShares = false;
var licserverInfo;
var nslm = null;
var nslmSessionIsActive = NSLM_BYPASS; // If we bypass license checking, it permits hub operations.

loadConfig();

function mayIExit() {
  if (dispatcherIsRunning === false) {
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
  logger.log('Got SIGHUP, reloading configs...');
  loadConfig();
});

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

  logger.log('Loading configs : '+path.join(commonConfigDir, 'nefelus.conf')+', '+path.join(appConfigDir, 'hub.conf'));
  var commonConfigData = fs.readFileSync(path.join(commonConfigDir, 'nefelus.conf'), 'utf-8');
  var appConfigData = fs.readFileSync(path.join(appConfigDir, 'hub.conf'), 'utf-8');
  var commonConfig;
  var appConfig;
  var dbSSLkey = '';
  var dbSSLcert = '';
  var dbSSLca = '';
  try {
    commonConfig = toml.parse(commonConfigData);
  } catch (e) {
    logger.log('Error parsing '+ path.join(commonConfigDir, 'nefelus.conf'));
    logger.log(util.inspect(e, {depth:null}));
  }
  try {
    appConfig = toml.parse(appConfigData);
  } catch (e) {
    logger.log('Error parsing '+ path.join(appConfigDir, 'hub.conf'));
    logger.log(util.inspect(e, {depth:null}));
  }

  mainconf.env()
          .add('hub', {type: 'literal', store: appConfig})
          .add('nefelus', {type: 'literal', store: commonConfig})
          .defaults({
            port : 8585,
            host : 'localhost',
            ssl : false,
            ignoreInstallationIdInFilemanagerOps : false,
            hasAutoAssignFloatingIp : true,
            logHeartBeats : true
          });

  timezone = mainconf.get('timezone') || null;
  filemanager = mainconf.get('filemanager') || null;
  hubPort = mainconf.get('port');
  hubHost = mainconf.get('host');
  var ssl = mainconf.get('ssl');
  if (nt.isEmpty(ssl)) {
    ssl = false;
  }
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
      //sslCa = fs.readFileSync(ssl.ca);
      sslCa = [];
      var chain = fs.readFileSync(ssl.ca, 'utf8');
      chain = chain.split('\n');
      var cert = [];
      for (var l=0; l<chain.length; l++) {
        if (chain[l].length > 0) {
          cert.push(chain[l]);
          if (chain[l].match(/-END CERTIFICATE-/)) {
            sslCa.push(cert.join('\n'));
            cert = [];
          }
        }
      }
    }
    sslMasterPack = false;
    if ((sslKey !== '') || (sslCert !== '') || (sslCa !== '')) {
      var concatStream = concat( function (archiveBuffer) {
        sslMasterPack = archiveBuffer;
      });

      var archive = archiver('tar', {
        gzip: true,
        gzipOptions: {
          level: 1
        }
      });

      archive.on('error', function(err) {
        logger.log('Error creating SSL archive for VMs!!!');
        sslMasterPack = false;
      });

      archive.pipe(concatStream);

      if (sslKey !== '') {
        archive.append(sslKey, { name: 'key' });
      }
      if (sslCert !== '') {
        archive.append(sslCert, { name: 'cert' });
      }
      if (sslCa !== '') {
        var caBuf;
        if (typeof Buffer.from === 'function') {
          try {
            // Node 4.4.* Buffer.from already exists, but throws error
            caBuf = Buffer.from(sslCa);
          } catch (_error) {
            caBuf = new Buffer(sslCa);
          }
        } else {
          caBuf = new Buffer(sslCa);
        }
        archive.append(caBuf, { name: 'ca' });
      }
      archive.finalize();
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
  };
  dnsPostprocess = mainconf.get('aws:dnsPostprocess') || 'route53';
  r53info = mainconf.get('aws:route53') || null;

  if (nt.isEmpty(r53info)) {
    r53info = null;
  }

  AWS.config.update(awsParams);

  EC2Params = {};
  if (aws && aws.ec2 && aws.ec2.endpoint &&  (! nt.isEmpty(aws.ec2.endpoint))) {
    //'endpoint' : {'protocol' : 'http', 'host' : 'nefelus-master-radosgw.acmac.uoc.gr', 'port' : 80, 'path' : '/'}
    var endpoint;
    var _ep = aws.ec2.endpoint;
    if (typeof _ep === 'string') {
      endpoint = _ep;
    } else {
      if (typeof _ep.url === 'string') {
        endpoint = _ep.url;
      } else {
        var epproto = _ep.protocol || 'http';
        var epport = ((_ep.port == 80) && (epproto == 'http')) ? '' : (((_ep.port == 443) && (epproto == 'https')) ? '' : ':'+_ep.port);
        endpoint = epproto + '://'+ _ep.host + epport+ (_ep.path || '/');
      }
    }

    ep = new AWS.Endpoint(endpoint);

    if (ep !== null) {
      EC2Params['endpoint'] =  ep;
    }

    var signver = aws.ec2.endpoint.signatureVersion || aws.ec2.signatureVersion || null;
    if (signver !== null) {
      EC2Params['signatureVersion'] = signver;
    }
  }
  ec2 = new AWS.EC2(EC2Params);
  r53 = new AWS.Route53(EC2Params);

  EC2_TIMEOUT = mainconf.get('aws:ec2_timeout') || 10000;
  EC2_SMALL_TIMEOUT = mainconf.get('aws:ec2_small_timeout') || 5000;
  EC2_MAX_TRIES = mainconf.get('aws:ec2_max_tries') || 60;

  masterScripts = mainconf.get('masterScripts') || false;
  if (masterScripts && (masterScripts !== '') && (nt.isReadableSync(masterScripts))) {
    masterScripts = fs.readFileSync(masterScripts);
  } else {
    masterScripts = false;
  }
  installationId = mainconf.get('installationId') || '';
  ignoreInstallationIdInFilemanagerOps = mainconf.get('ignoreInstallationIdInFilemanagerOps');
  ignoreInstallationIdInFilemanagerOps = nt.isTrue(ignoreInstallationIdInFilemanagerOps);
  if (ignoreInstallationIdInFilemanagerOps) {
    installationId = '';
  }
  vncLocalOnly = nt.isTrue(mainconf.get('vncLocalOnly'));
  staticUserData = mainconf.get('staticUserData') || {};
  keyName = mainconf.get('aws:ec2:keyName') || null;
  securityGroup = mainconf.get('aws:ec2:securityGroup') || 'default';
  defaultSubnetId = mainconf.get('aws:ec2:SubnetId') || null;
  setloginuser = mainconf.get('setloginuser') || false;
  setsecgroups = mainconf.get('setsecgroups') || false;
  hasAutoAssignFloatingIp = mainconf.get('hasAutoAssignFloatingIp');
  logHeartBeats = mainconf.get('logHeartBeats');
  workerUsername = mainconf.get('vm:username');
  defaultRootVolumeSize = mainconf.get('vm:rootVolumeSize') || 0;
  defaultRootVolumeSize = parseInt(defaultRootVolumeSize, 10);
  if (isNaN(defaultRootVolumeSize)) {
    defaultRootVolumeSize = 0;
  }
  logURLproto = mainconf.get('vm:logURL:protocol');
  vncURLproto = mainconf.get('vm:vncURL:protocol');
  cmdURLproto = mainconf.get('vm:cmdURL:protocol');
  logURLport = mainconf.get('vm:logURL:port');
  vncURLport = mainconf.get('vm:vncURL:port');
  cmdURLport = mainconf.get('vm:cmdURL:port');
  noVNCdebug = mainconf.get('vm:vncURL:debug') || false;
  x11IdleTimeout = mainconf.get('vm:x11IdleTimeout');
  homeBlacklistPatterns = mainconf.get('vm:homeBlacklistPatterns') || [];
  cancelHours = mainconf.get('cancelHours') || 0;
  forceCancelHours = mainconf.get('forceCancelHours') || ((cancelHours === 0) ? 0 : cancelHours + 2);
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
  useDynamicNFSShares = mainconf.get('useDynamicNFSShares') || false;
  if (useDynamicNFSShares === true) {
    if (filemanager === null) {
      logger.log('WARNING: Filemanager in not defined.');
    }
    if (deactivateNFSSharesOfOldInstancesTimer === null) {
      deactivateNFSSharesOfOldInstancesTimer = setInterval(function() {deactivateNFSSharesOfOldInstances();}, 180000); // check every 3 minutes
    }
  } else {
    if (deactivateNFSSharesOfOldInstancesTimer !== null) {
      clearInterval(deactivateNFSSharesOfOldInstancesTimer);
      deactivateNFSSharesOfOldInstancesTimer = null;
    }
  }
  adminEmail = mainconf.get('adminEmail');
  masterDebug = mainconf.get('vm:masterDebug') || false;
  db = mainconf.get('database');
  hubType = mainconf.get('hubType') || 'production';
  mysqlConfig = {
    'host'     : db.host,
    'user'     : db.user,
    'password' : db.password,
    'database' : db.database,
    'connectTimeout'  : db.connectTimeout || 30000,
    'acquireTimeout'  : db.acquireTimeout || 30000,
    'multipleStatements' : true,
    'timezone' : 'Z'
  };
  if ((db.sslkey) && (db.sslkey !== '')) {
    if (nt.isReadableSync(db.sslkey)) {
      dbSSLkey = fs.readFileSync(db.sslkey);
    } else {
      logger.log('Warning: file '+db.sslkey+' is not readable.');
    }
  }
  if ((db.sslcert) && (db.sslcert !== '')) {
    if (nt.isReadableSync(db.sslcert)) {
      dbSSLcert = fs.readFileSync(db.sslcert);
    } else {
      logger.log('Warning: file '+db.sslcert+' is not readable.');
    }
  }
  if ((db.sslca) && (db.sslca !== '')) {
    if (nt.isReadableSync(db.sslca)) {
      dbSSLca = fs.readFileSync(db.sslca);
    } else {
      logger.log('Warning: file '+db.sslca+' is not readable.');
    }
  }
  if ((dbSSLkey !== '') || (dbSSLcert !== '') || (dbSSLca !== '')) {
    mysqlConfig.ssl = { key: dbSSLkey,
                        cert: dbSSLcert,
                        ca: dbSSLca
                      };
  }
  SKIP_CYCLES = mainconf.get('skipCycles') || 4;
  setupMySQL(mysqlConfig);
  emailTemplates = mainconf.get('emailTemplates') || [];
  MySQLParamsLoaded = false; // Quotas are loaded in main SQL loop.
  if (! NSLM_BYPASS) {
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
        nslm.on('change', function(active) {
          logger.log('nslm active =', active);
          nslmSessionIsActive = active;
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

  this.dynamicNFSShares = {
    activated : false,
    deactivated : true,
    allowedIPs : [],
    shares : []
  };

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
    var sid;
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
            sid = nt.parseSessionId(this.req.sessionId);
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
          sid = nt.parseSessionId(this.req.sessionId);
          this.req.instanceType = machines.getAMItype(this.req.machineId);
          if (this.req.instanceType) {
            this.req.ami = images.getAMI(this.req.instanceType, sid.toolId, 0); // FIXME : cloud 0 and delete line bellow
          }
        }
      }
    }
  };

  this.get = function (name) {
    return this[name];
  };

  this.set = function (name, value) {
    if (typeof this[name] !== 'undefined') {
      this[name] = value;
    }
  };

  this.getRequest = function (name) {
    if (typeof this.req[name] !== 'undefined') {
      return this.req[name];
    }
    return null;
  };

  this.setDynamicNFSShare = function (name, value) {
    switch (name) {
      case 'resetips' :
        this.dynamicNFSShares.allowedIPs = [];
        break;
      case 'resetshares' :
        this.dynamicNFSShares.shares = [];
        break;
      case 'ip' :
        if ((value !== undefined) && (value !== null) && (value !== '')) {
          this.dynamicNFSShares.allowedIPs.push(value);
        }
        break;
      case 'share' :
        if ((value !== undefined) && (value !== null)) {
          this.dynamicNFSShares.shares.push(value);
        }
        break;
      default:
        this.dynamicNFSShares[name] = value;
        break;
    }
  };

  this.setMaster = function (name, value) {
    this.master[name] = value;
    if (name === 'instanceId') {
      Instances[value] = 't' + this.id;
    }
  };

  this.getMaster = function (name) {
    if (typeof this.master[name] !== 'undefined') {
      return this.master[name];
    }
    return null;
  };

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
  };

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

function distillTicket(ticket) {
  var t = {};
  t.id = ticket.id;
  t.ticketStatus = ticket.ticketStatus;
  t.cancelPending = ticket.cancelPending;
  t.sessionStatus = ticket.sessionStatus;
  t.jobStatus = ticket.jobStatus;
  t.created = ticket.created;
  t.machineStarted = ticket.machineStarted;
  t.jobStarted = ticket.jobStarted;
  t.logConsole = ticket.logConsole;
  t.vncConsole = ticket.vncConsole;
  t.loginuser = ticket.loginuser;
  t.uuid = ticket.uuid;

  t.sessionId = ticket.req.sessionId;
  t.runas = ticket.req.runas;
  t.machineSpeed = ticket.req.machineSpeed;
  t.instanceType = ticket.req.instanceType;
  t.ami = ticket.req.ami;
  t.commandFile = ticket.req.commandFile;
  t.runningDir = ticket.req.runningDir;
  t.licenseManager = ticket.req.licenseManager;
  t.jobType = ticket.req.jobType;

  t.instanceId = ticket.master.instanceId;
  t.ip = ticket.master.ip;
  t.publicIp = ticket.master.publicIp;
  t.publicDnsName = ticket.master.publicDnsName;
  t.aliasDnsName = ticket.master.aliasDnsName;

  return t;
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
      if (keys !== undefined) {
        var tempTicket = dupTicket(id);
        var internalState = '';
        try {
          internalState = JSON.stringify(tempTicket);
        } catch (ej) {
          logger.log('Error on JSON.stringify');
          logger.log(ej);
          logger.log(util.inspect(tempTicket, {depth:null}));
        }
        keys.push('INTERNAL_STATE');
        values.push(internalState);
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

function deactivateNFSSharesOfOldInstances() {
  if (ec2 === undefined) {
    logger.log('EC2 is not defined yet.');
    return;
  }
  if (filemanager === null) {
    logger.log('WARNING: Filemanager in not defined.');
    return;
  }
  if (mysqlPool !== null) {
    mysqlPool.getConnection(function(err, mysqlClient) {
      if (err) {
        logger.log(err);
        return;
      }

      mysqlClient.query(SQL.deactivateNFSSharesOfOldInstances, function(err, rows, fields) {

        mysqlClient.release();

        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          return;
        }
        if (rows.length) {
          var NFSinstances = [];
          for (var i = 0; i < rows.length; i++) {
            NFSinstances.push(rows[i]['INSTANCE_ID']);
          }
          var args = {
            Filters : [ { Name : 'instance-id', Values : NFSinstances }]
          };
          var activeInstances=[];
          ec2.describeInstances(args, function(err, data) {
            for (var i=0; i<data.Reservations.length; i++) {
              for (var j=0; j<data.Reservations[i].Instances.length; j++) {
                activeInstances.push(data.Reservations[i].Instances[j].InstanceId);
              }
            }
            var deadInstances = _.difference(NFSinstances, activeInstances);
            if (deadInstances.length > 0) {
              var options = {
                method: 'POST',
                json: true,
                body: {instanceId: deadInstances},
                followRedirect: true,
                timeout : 10000,
                strictSSL : false,
                uri: filemanager + '/deactivateNFSshares'
              };

              request(options, function(error, response, body) {
                if (error) {
                  logger.log('deactivateNFSSharesOfOldInstances: ERROR sending request to filemanager.');
                  logger.log(util.inspect(error, {depth:null}));
                } else {
                  if ((String(response.statusCode) !== '200') || ((String(response.statusCode) === '200') && (body.status === 'error'))) {
                    logger.log('ERROR getting deactivateNFSshares response from filemanager. ('+response.statusCode+'), message: ' + body.message);
                    logger.log('deactivateNFSSharesOfOldInstances: ERROR getting response from filemanager.');
                    logger.log(util.inspect(body, {depth:null}));
                  }
                }
              });
            }
          });
        }
      });
    });
  } else {
    logger.log('ERROR: MySQL Pool has not been created.');
  }
}

function activateNFSShares(instanceId, sessionId) {
  var myticket = getTicketIdByInstanceId(instanceId);
  if (myticket !== null) {
    var ticket = Tickets[myticket];
    if ((ticket.dynamicNFSShares.activated === true) ||
        (ticket.master.instanceId === '') ||
        (ticket.dynamicNFSShares.allowedIPs.length === 0) ||
        (ticket.dynamicNFSShares.shares.length === 0)) {
        return;
    } else {
      // prepare mysql
      var ips = _.uniq(ticket.dynamicNFSShares.allowedIPs);
      var vals = [];
      var payload = { 'instanceId' : ticket.master.instanceId,
                      'shares' : ticket.dynamicNFSShares.shares,
                      'ips' : ips
                    };
      ips = ips.join(',');
      ticket.dynamicNFSShares.shares.forEach(function (u) {
        vals.push([u.uuid, u.mount_params, ticket.master.instanceId, ips, 'Y']);
      });

      if (mysqlPool !== null) {
        mysqlPool.getConnection(function(err, mysqlClient) {
          if (err) {
            logger.log(err);
            return;
          }

          mysqlClient.query(SQL.addNFSActiveMountpoints, [vals], function(err) {
            if (err) {
              logger.log(sessionId +': Error from MYSQL query:');
              logger.log(err);
            } else {
              var options = {
                method: 'POST',
                body: payload,
                json: true,
                followRedirect: true,
                timeout : 10000,
                strictSSL : false,
                uri: filemanager + '/activateNFSshares'
              };

              request(options, function(error, response, body) {
                if (error) {
                  logger.log(sessionId + ': ERROR sending activateNFSshares request to filemanager.');
                  logger.log(util.inspect(error, {depth:null}));
                } else {
                  if ((String(response.statusCode) !== '200') || ((String(response.statusCode) === '200') && (body.status === 'error'))) {
                    logger.log('ERROR getting activateNFSshares response from filemanager. ('+response.statusCode+'), message: ' + body.message);
                    logger.log(util.inspect(body, {depth:null}));
                  } else {
                    ticket.setDynamicNFSShare('activated', true);
                    ticket.setDynamicNFSShare('deactivated', false);
                  }
                }
              });
            }
            mysqlClient.release();
            return;
          });
        });
      } else {
        logger.log('ERROR: MySQL Pool has not been created.');
      }
    }
  } else {
    logger.warn('Activate NFS Shares : Unable to find instance ' + instanceId);
  }
}

function deactivateNFSShares(instanceId) {
  var myticket = getTicketIdByInstanceId(instanceId);
  if (myticket !== null) {
    var ticket = Tickets[myticket];
    if ((ticket.dynamicNFSShares.deactivated === true) ||
        (ticket.master.instanceId === '') ||
        (ticket.dynamicNFSShares.allowedIPs.length === 0) ||
        (ticket.dynamicNFSShares.shares.length === 0)) {
        return;
    } else {
      var sessionId = ticket.getRequest('sessionId') || 'unknown';
      var options = {
        method: 'POST',
        body: {instanceId: [instanceId]},
        json: true,
        followRedirect: true,
        timeout : 10000,
        strictSSL : false,
        uri: filemanager + '/deactivateNFSshares'
      };

      request.get(options, function(error, response, body) {
        if (error) {
          logger.log(sessionId + ': ERROR sending deactivateNFSshares request to filemanager.');
          logger.log(util.inspect(error, {depth:null}));
        } else {
          if (String(response.statusCode) !== '200') {
            logger.log(sessionId + ': ERROR getting deactivateNFSshares response from filemanager. ('+response.statusCode+')');
            logger.log(util.inspect(body, {depth:null}));
          } else {
            ticket.setDynamicNFSShare('deactivated', true);
            ticket.setDynamicNFSShare('activated', false);
          }
        }
      });
    }
  } else {
    logger.warn('Deactivate NFS Shares : Unable to find instance ' + instanceId);
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
    if (useDynamicNFSShares === true) {
      deactivateNFSShares(instanceId);
    }
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
        var mysqlKeys;
        var mysqlValues;
        if (err) {
          if (ticket.get('restartLimit') > 0) {
            logger.warn(sessionId + ': failed to restart master, will retry in 2 mins');
            setTimeout(function() {
              restartMaster(instanceId, sessionId);
            }, RESTART_INTERVAL);
          } else {
            logger.warn(sessionId + ': failed to restart master and restart limit exceeded.');
            mysqlKeys = ['NOTE'];
            mysqlValues = ['Error starting master, restart limit exceeded.'];
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
            ticket.setDynamicNFSShare('resetips', null);
            ticket.setDynamicNFSShare('ip', data[0].ip);
            ticket.setDynamicNFSShare('ip', data[0].publicIp);
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
            if (useDynamicNFSShares === true) {
              activateNFSShares(data[0].instanceId, sessionId);
            }
            ticket.healthCheckTimer = setInterval(function() {
              InstanceHealthCheck(data[0].instanceId, sessionId, [
                {'state':'terminated', 'action':restartMaster},
                {'state':'undefined', 'action':restartMaster},
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
              mysqlKeys = ['NOTE'];
              mysqlValues = ['Error setting up job'];
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
  var adminIds = [];
  var toolXtermSupport = toolapps.getXtermSupport(sid.toolId);
  var toolMountPoint = toolapps.getMountPoint(sid.toolId);
  var toolAdditionalMountPoints = toolapps.getAdditionalMountPoints(sid.toolId);
  var toolVendor = toolapps.getVendor(sid.toolId);

  if (toolMountPoint !== 0) {
    allIds.push(toolMountPoint);
  }

  if (toolAdditionalMountPoints !== 0) {
    allIds = allIds.concat(toolAdditionalMountPoints);
  }

  var dataTypes;
  if (nt.isSetSessionParam(ticket.req.sessionId, '4d')) { // Allow only documentation viewing.
    dataTypes = ['IP_DOCS', 'TOOL_DOCS'];
  } else {
    dataTypes = ['SHARED_DATA', 'USER_DATA', 'IP_DATA_LIB', 'TOOLS_DATA'];
  }
  var permittedResourcesFilters = [];
  dataTypes.forEach(function(dt) {
    permittedResourcesFilters.push({company:sid.companyId, user:sid.clientId, project:sid.projectId, rtype: dt, inherit:(dt !== 'USER_DATA')});
  });

  var runasSid = nt.parseSessionId(ticket.req.runas);
  var runasToolVendor = null;
  if (runasSid !== '') {
    var runasToolMountPoint = toolapps.getMountPoint(runasSid.toolId);
    var runasToolAdditionalMountPoints = toolapps.getAdditionalMountPoints(runasSid.toolId);
    runasToolVendor = toolapps.getVendor(runasSid.toolId);

    if (runasToolMountPoint !== 0) {
      allIds.push(runasToolMountPoint);
    }

    if (runasToolAdditionalMountPoints !== 0) {
      allIds = allIds.concat(runasToolAdditionalMountPoints);
    }

    dataTypes.forEach(function(dt) {
      permittedResourcesFilters.push({company:runasSid.companyId, user:runasSid.clientId, project:runasSid.projectId, rtype: dt, inherit:(dt !== 'USER_DATA')});
    });
  }

  if (mysqlPool !== null) {
    mysqlPool.getConnection(function(err, mysqlClient) {
      if (err) {
        logger.log(err);
        cb(err, null);
        return;
      }

      quotashares.getPermittedResources(mysqlClient, permittedResourcesFilters, function(err, data) {
        if (err) {
          logger.log('ERROR: There was an error while fetching quotashares. Machine might launch without all external disks');
        }
        if (data) {
          for (var prkey in data) {
            allIds = allIds.concat(data[prkey]);
          }
        }
        permittedResourcesFilters = [];
        if (ticket.useradmin == 'C') {
          permittedResourcesFilters.push({company:sid.companyId, user:sid.clientId, project:sid.projectId, rtype:'SHARED_DATA', inherit: true});
        }
        // Get shares in order to allow company admin to have write access to companies SHARED_DATA mounts.
        quotashares.getPermittedResources(mysqlClient, permittedResourcesFilters, function (err, admindata) {
          if (err) {
            logger.log('ERROR: There was an error while fetching quotashares. Machine might launch without all external disks');
          }
          if (admindata) {
            adminIds = admindata['SHARED_DATA'] || [];
          }

          allIds = _.uniq(allIds);

          shares.getByIds(mysqlClient, allIds, function(err, projectShares) { // FIXME : if multiple clouds are introduced, add cloudId.

            mysqlClient.release();

            if (projectShares) {

              projectShares.forEach(function(n, i) {
                var notfound = true;
                var j;
                var mntp=n;

                if (ticket.useradmin == 'C') { // Allow company admin to have write access to companies SHARED_DATA mounts.
                  if (adminIds.indexOf(''+n.id) !== -1) {
                    mntp.mountParams = ro2rw(mntp.mountParams);
                  }
                }

                // Allow tool Vendor to access tool mountpoints as r/w
                if (sid.companyId == toolVendor) {
                  if (n.id == toolMountPoint) {
                    mntp.mountParams = ro2rw(mntp.mountParams);
                  }
                }
                if (runasSid !== '') {
                  if ((runasToolVendor) && (sid.companyId == runasToolVendor)) {
                    if (n.id == runasToolMountPoint) {
                      mntp.mountParams = ro2rw(mntp.mountParams);
                    }
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

              allShares = _.uniqWith(allShares, function(a, b) { return a.uuid === b.uuid;});

              userData['reqSessionId'] = ticket.req.sessionId;
              userData['machineType'] = hubType;
              userData['hubServer'] = hubProtocol + '://' + hubHost + ':' + hubPort;
              if ((setloginuser) && (ticket.loginuser !== 'nefelus')) {
                userData['USERDEF'] = ticket.loginuser;
              }
              userData['UUID'] = ticket.uuid;
              userData['JOBTYPE'] = ticket.req.jobType;
              userData['RESOLUTION'] = ticket.XResolution;
              userData['DISPLAY'] = ticket.XDisplay;

              if (setsecgroups) {
                var iptables = secgroups.getRules(sid.companyId, sid.projectId); // FIXME : if multiple clouds are introduced, add cloudId.
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

              userData['totalshares'] = allShares.length;
              ticket.setDynamicNFSShare('resetshares', null);
              allShares.forEach(function(n, i) {
                var fstype = '@';
                var fsExtraParams = '';
                var creds;
                if ((n.fstype !== '') && (n.location !== '') && (n.mountPoint !== '')) {
                  //'fstype':'nfs','location':'10.0.0.2:/tools/icscape','mountParams':null,'mountPoint':'/tools/icscape'
                  logger.log(ticket.req.sessionId+': share = '+ n.location + ' ' + n.mountPoint + (((n.mountParams!==null) && (n.mountParams!=='')) ? (' ' + n.mountParams) : ''));

                  if (n.fstype === 'nfs') {
                    fstype = 'n';
                    //TODO: if (n.encrypted === 'Y') { }
                    fsExtraParams = mainconf.get('vm:shares:nfsMountParams') || '';
                    ticket.setDynamicNFSShare('share', {uuid: n.uuid, mount_params: (((n.mountParams!==null) && (n.mountParams!=='')) ? (n.mountParams) : 'ro')});
                  } else if (n.fstype === 'cifs') {
                    fstype = 'c';
                    fsExtraParams = mainconf.get('vm:shares:cifsMountParams') || '';
                    creds = n.creds.split('/');
                    if (fsExtraParams !== '') {
                      fsExtraParams += ',';
                    }
                    if ((! n.mountParams) || (n.mountParams === '') || (n.mountParams.match(/(^|[,])(ro)($|[,])/) !== null)) {
                      fsExtraParams += 'username='+creds[3]+',password='+creds[4];
                    } else {
                      fsExtraParams += 'username='+creds[1]+',password='+creds[2];
                    }
                    if (n.encrypted === 'Y') {
                      if (fsExtraParams.match(/(^|[,])(seal)($|[,])/) === null) {
                        fsExtraParams += ',seal';
                      }
                    }
                  }
                  if (fsExtraParams !== '') {
                    fsExtraParams = ','+fsExtraParams;
                  }
                  userData['h' + fstype + 'fs' + i] = n.location;
                  userData['c' + fstype + 'fs' + i] = n.mountPoint;
                  userData['p' + fstype + 'fs' + i] = (((n.mountParams!==null) && (n.mountParams!=='')) ? (n.mountParams) : 'ro')+fsExtraParams;
                }
              });

              // encrypt and send SSL certificates
              // FIXME : Run this in hub init.d : cat /var/log/messages > /dev/urandom; ifconfig > /dev/urandom
              if (ticket.req.ami === null) {
                logger.log(ticket.req.sessionId+': ERROR, AMI not defined');
                cb('ERROR, AMI not set.', null);
                return;
              }

              var denckey = nt.mkKey('sha256', [ ticket.req.ami, ticket.req.machineSpeed, ticket.req.sessionId]);
              var enckey = nt.mkKey('sha256', [ ticket.req.ami, ticket.req.machineSpeed]);

              nt.cryptData(masterScripts, denckey, function(mserr, msdata) {
                if (! mserr) {
                  userData['masterscripts'] = msdata;
                }

                nt.cryptData(sslMasterPack, denckey, function(sslmperr, sslmpdata) {
                  if (! sslmperr) {
                    userData['crt'] = sslmpdata;
                  }

                  //TODO : replace old style userdata format with json. Needs changes in VM and master.js
                  //var _userDataStr = JSON.stringify(userData);
                  var _userDataStr = '';
                  var k;
                  for (k in userData) {
                    _userDataStr = _userDataStr + '#%' + k + ':' + userData[k] + '\n';
                  }

                  nt.cryptData(_userDataStr, enckey, function (err, encdata) {
                    var header;
                    var zdata;
                    header = '#NFUDPP2#';
                    if (err) {
                      zdata = _userDataStr;
                      header = '#NFUDP';
                    } else {
                      zdata = encdata;
                      header = '#NFUDE';
                    }
                    zlib.gzip(zdata, function (zerr, buf) {
                      var userDataStr;
                      if (! zerr) {
                        header += 'Z2#';
                        userDataStr = header+buf.toString('base64');
                      } else {
                        header += 'P2#';
                        userDataStr = header+zdata;
                      }

                      startMachines(ticket.req.ami, 1, ticket.req.machineId, ticket.req.sessionId, userDataStr, function(err, data) {
                        if (err) {
                          logger.log('Failed to start instance for ' + ticket.req.sessionId);
                          cb(err, null);
                        } else {
                          if (data) {

                            async.each(data, function(item, callback) {

                              associateNextFreeAddress(item, hasAutoAssignFloatingIp, function(err, resp) {
                                if (err === null) {
                                  logger.log(ticket.req.sessionId + ': IP '+resp.address+' associated to '+resp.instance);
                                  callback();
                                } else {
                                  logger.log(ticket.req.sessionId + ': Error while associating IP address to : '+resp.instance+' : '+util.inspect(err, {depth:null}));
                                  callback(err);
                                }
                              });

                            },
                            function (err) {
                              if (err) {
                                // One of the associations produced an error. Kill machines and let system retry later.
                                KillMachines(data, function (err, killedMachines) {
                                  if (err) {
                                    logger.log(ticket.req.sessionId + ': Failed to terminate instance ' + data.join());
                                  } else {
                                    logger.log(ticket.req.sessionId + ': Machines ' + data.join() + ' terminated');
                                  }
                                  cb(null, null); // This will cause to retry session later due to limited resources
                                });
                              } else {
                                getMachinesInfo(data, function(err, machineinfo) {
                                  if (err) {
                                    logger.log('Failed to get machine info for ' + ticket.req.sessionId);
                                    cb(err, null); // FIXME: check err, data value
                                  } else {
                                    ticket.machineStarted = new Date();
                                    cb(null, machineinfo);
                                  }
                                });
                              }
                            });
                          } else {
                            cb(null, null);
                          }
                        }
                      });
                    });
                  });
                });
              });
            } else {
              logger.log('ERROR: There was an error while fetching shares. Machine might launch without external disks');
            }
          });
        });
      });
    });
  } else {
    logger.log('Could not establish connection to mysql server');
    cb('Could not establish connection to mysql server', null);
  }
}

function startMachines(image, count, machineId, sessionId, userData, cb) {
  var k;
  var udb;

  if (typeof Buffer.from === 'function') {
    try {
      // Node 4.4.* Buffer.from already exists, but throws error
      udb = Buffer.from(userData);
    } catch (_error) {
      udb = new Buffer(userData);
    }
  } else {
    udb = new Buffer(userData);
  }

  var speed = machines.getSpeed(machineId);
  var noOfEphemeralVols = machines.getEphemeral(machineId) || 0;
  var blockDeviceMappings = [];

  // Setting root volume size is currently applicable only at Amazon deployments
  var rootVolumeSize = parseInt(machines.getRootDiskSize(machineId), 10) || defaultRootVolumeSize;
  if (rootVolumeSize !== 0) {
    blockDeviceMappings.push({'DeviceName' : '/dev/sda1',
                              'Ebs' : { 'DeleteOnTermination' : true, 'VolumeSize': rootVolumeSize}
                             });
  }

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
    UserData       : udb.toString('base64'),
    InstanceType   : speed
  };

  if (defaultSubnetId !== null) {
    args['SubnetId'] = machines.getSubnetId(machineId) || defaultSubnetId;
    args['SecurityGroupIds'] = [securityGroup];
  } else {
    args['SecurityGroups'] = [securityGroup];
  }

  if (defaultSubnetId !== null) {
    args['SubnetId'] = defaultSubnetId;
  }

  if (keyName !== null) {
    args['KeyName'] = keyName;
  }

  if (defaultRootVolumeSize !== 0) {
    blockDeviceMappings.push({ 'DeviceName' : '/dev/sda1',
                               'Ebs' : { 'DeleteOnTermination' : true, 'VolumeSize': defaultRootVolumeSize}
                             });
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
          if (((err.statusCode) && (err.statusCode == 413) && (err.code) && (err.code === 'ResourceLimitExceeded')) ||
              ((err.statusCode) && (err.statusCode == 403) && (err.code) && (err.code === 'Forbidden') && (err.message) && (err.message.match(/^Quota exceeded/) !== null))) {
            ready = true;
            noResources = true;
            logger.log('RunInstances: ' + ((err.message) ? err.message : 'unknown error'));
            callback(null);
            return;
          } else {
            logger.log('RunInstances error ', JSON.stringify(err));
            setTimeout(function() {callback(null);}, EC2_TIMEOUT);
            return;
          }
        } else {
          if (data.Instances) {
            for (var m = 0; m < data.Instances.length; m++) {
              if (data.Instances[m].InstanceId) {
                instanceIds.push(data.Instances[m].InstanceId);
                ready = true;
              }
            }
          } else {
            noResources = true;
          }
          if (ready) {
            callback(null);
            return;
          } else {
            setTimeout(function() {callback(null);}, EC2_TIMEOUT);
            return;
          }
        }
      });
    },
    function (err) {
      if (ready) {
        if (noResources) {
          cb(null, null);
        } else {
          instanceIds.forEach(function(id) {
            logger.log(sessionId + ' Machine '+id+' spawned.');
            function _setMachineTags(callback, results) {
              setMachineTags(id, hubType, sessionId, function(err, data) {
                if (err) {
                  setTimeout(function() {callback({sessionId: sessionId, err: err, id : id});}, 60000);
                } else {
                  callback(null, '');
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

function KillMachines(machines, cb) {
  function _TerminateMachines(callback, results) {
    TerminateMachines(machines, function(err, data) {
      if (err) {
        setTimeout(function() {callback({machines : machines, err : err}, null);}, 3000);
      } else {
        callback(null, '');
      }
    });
  }

  async.retry(600, _TerminateMachines, function(err, result) {
    if (err) {
      try {
        err.machines = err.machines.join();
      } catch (e) {
        // empty line
      }
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
    logger.log('No machines to get info');
    cb('No machines to get info', machinesInfo);
    return;
  }

  async.whilst(
    function () { return (machinesFound != machineCount) && (count < EC2_MAX_TRIES); },
    function (callback) {
      machinesFound = 0;
      count++;
      var args = {
        InstanceIds : machines
      };

      ec2.describeInstances(args, function(err, data) {
        machinesInfo = [];
        if (err === null) {
          instances = extractInstances(data.Reservations);
          for (var m = 0; m < instances.length; m++) {
            if ((instances[m].PublicIpAddress !== undefined) && (instances[m].PublicIpAddress !== null) && (instances[m].PublicIpAddress !== '')) {
              mi = {};
              mi.instanceId = instances[m].InstanceId;
              mi.privateDnsName = instances[m].PrivateDnsName;
              mi.dnsName = instances[m].PublicDnsName;
              mi.ip = instances[m].PrivateIpAddress;
              mi.publicIp = instances[m].PublicIpAddress;
              machinesFound++;
              machinesInfo.push(mi);
            }
          }
          if (machinesFound === machineCount) {
            callback(null);
            return;
          } else {
            setTimeout(function() {callback(null);}, EC2_SMALL_TIMEOUT);
          }
        } else {
          logger.log(util.inspect(err, {depth:null}));
          setTimeout(function() {callback(null);}, EC2_TIMEOUT);
        }
      });
    },
    function (err) {
      if (machinesFound == machineCount) {
        cb(null, machinesInfo);
      } else {
        logger.log('Error or incomplete response');
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

function associateNextFreeAddress(instanceId, auto, cb) {

  // passthrough
  if (auto === true) {
    cb(null, {instance: instanceId, address: 'auto'});
    return;
  }

  getFreeAddress(function(err, address) {
    if (err) {
      cb(err, {instance: instanceId, address: false});
      return;
    } else {

      if (address === null) {
        cb('Free IP not available', {instance: instanceId, address: null});
        return;
      }

      var count = 0;
      var addressAssociated = false;

      async.whilst(
        function () { return ((addressAssociated === false) && (count < 5)); },
        function (callback) {
          count++;
          var args = {
              InstanceId : instanceId,
              PublicIp   : address
          };

          ec2.associateAddress(args, function(err, data) {
            if (! err) {
              addressAssociated = true;
              callback(null);
            } else {
              setTimeout(function() {callback(null);}, EC2_TIMEOUT);
            }
          });
        },
        function (err) {
          if (addressAssociated === true) {
            cb(null, {instance: instanceId, address: address});
          } else {
            cb('Error or incomplete response', {instance: instanceId, address: false});
          }
        }
      );
    }
  });
}

function getFreeAddress(cb) {
  var count = 0;
  var address = null;
  var addressFound = false;

  async.whilst(
    function () { return ((addressFound === false) && (count < 5)); },
    function (callback) {
      count++;
      var args = {
        //Filters : [{ Name : 'instance-id', Values : ['']}] // WARNING: on Openstacks's ec2api this does not work
      };

      ec2.describeAddresses(args, function(err, data) {
        if (! err) {
          if ((data.Addresses) && (data.Addresses.length)) {
            var _Addresses = _.filter(data.Addresses, function(o) { return typeof o.InstanceId === 'undefined'; });
            if ((_Addresses) && (_Addresses.length)) {
              addressFound = true;
              var x = _.sample(_Addresses);
              address = x.PublicIp;
            }
          }
          if (addressFound) {
            callback(null);
          } else {
            setTimeout(function() {callback(null);}, EC2_TIMEOUT);
          }
        } else {
          setTimeout(function() {callback(null);}, EC2_TIMEOUT);
        }
      });
    },
    function (err) {
      cb (((addressFound === true) ? null : 'Error or incomplete response'), address);
    }
  );
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
      if ((k === 'healthCheckTimer') || (k === 'consoleCheckTimer')) {
        t[k] = null;
      } else {
        if (! _.isFunction(o[k])) {
          t[k] = _.cloneDeep(v);
        }
      }
    });
    t.master.socket = null; // Do not use setMaster here!!!
  }
  return t;
}

function recoverTicketFromInternalState(mysqlPool, key, id, cb) {
  if (mysqlPool !== null) {
    mysqlPool.getConnection(function(err, mysqlClient) {
      if (err) {
        logger.log(err);
        cb(err, null);
        return;
      }

      mysqlClient.query(SQL.getInternalState + ' WHERE ' + key + ' = ?;', [id], function(err, rows, fields) {

        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          mysqlClient.release();
          cb(err, null);
          return;
        }

        var intState = null;
        if (rows.length) {
          intState = rows[0].INTERNAL_STATE || null;
          if (intState !== null) {
            try {
              intState = JSON.parse(intState);
            } catch(e) {
              intState = null;
            }
          }
        }
        mysqlClient.release();
        cb(null, intState);
        return;
      });
    });
  }
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
};

//  ---------------------------------------------------------------------------------------------------------
//  MAIN PROGRAM
//  ---------------------------------------------------------------------------------------------------------

mystate = 'on';

var dispatcherIsRunning = false;
var dispatcher = function dispatcher () {
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
          if (MySQLParamsLoaded === false) {
            logger.log('(re)loading params');
            loadMySQLParams(mysqlClient, lastUpdatedSettings.config, function(err, data) {
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
        var pendingSessions = [];
        var pendingExecCompanyIds = [];

        quotas.stats.clear();

        for (i = 0; i < rows.length; i++) {
          pendingFound = false;
          machineId = rows[i]['MACHINE_ID'] || 0;
          switch (rows[i]['STATUS']) {
            case 'PENDING' :
              if ( rows[i]['COMMAND'].substr(0,5) == 'EXEC_') {
                if (machineId !== 0 ) {
                  pendingExecCompanyIds.push(rows[i]['COMPANY_ID']);
                  pendingSessions.push({ c : rows[i]['COMPANY_ID'] || 0,
                                         u : rows[i]['USER_ID'] || 0,
                                         p : rows[i]['PROJECT_ID'] || 0,
                                         t : rows[i]['TOOL_ID'] || 0,
                                         m : machineId,
                                         s : machines.getCloudId(machineId)});
                } else {
                  logger.log('ERROR: MACHINE_ID found 0 or NULL. #' + rows[i]['ID']);
                }
              }
              pendingFound = true;
              break;
            case 'SETUP'   :
            case 'RUNNING' :
            case 'CLOSING' :
              if ( rows[i]['COMMAND'].substr(0,5) == 'EXEC_') {
                if (machineId !== 0 ) {
                  //var cursid = nt.parseSessionId(rows[i]['SESSION_ID']);
                  //quotas.stats.add(Number(cursid.companyId), Number(cursid.clientId), Number(cursid.projectId), Number(cursid.toolId), machineId);
                  quotas.stats.add(rows[i]['COMPANY_ID'] || 0,
                                   rows[i]['USER_ID'] || 0,
                                   rows[i]['PROJECT_ID'] || 0,
                                   rows[i]['TOOL_ID'] || 0,
                                   machineId,
                                   machines.getCloudId(machineId));
                } else {
                  logger.log('ERROR: MACHINE_ID found 0 or NULL. #' + rows[i]['ID']);
                }
              }
              totalRunningFound++;
              break;
            default: break;
          }

          if (pendingFound) {
            record = {};
            for (j = 0; j < fields.length; j++) {
              record[fields[j].name] = rows[i][fields[j].name];
            }
            records.push(record);
          }
        }

        getCompaniesCredit(mysqlPool, pendingExecCompanyIds, function(err, companyCredits) {
          quotas.loadQueueQuotas(mysqlClient, pendingSessions, function(err, queueQuotaData){
            if (err === null) {

              machineId = 0;
              totalPendingFound = records.length;
              if (totalPendingFound > 0) {
                pendingWereNone = false;
                pendingNoneCnt  = 0;
                logger.log(records.length + ' pending and ' + totalRunningFound + ' running jobs. State=' + mystate + ((! NSLM_BYPASS) ? (', license=' + (nslmSessionIsActive ? 'ok' : 'NOT ok')) : ''));
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
                              if (realTicket.getMaster('instanceId') != '') {
                                realTicket.set('sessionStatus', 'finished');
                                logger.log(records[i].SESSION_ID + ': Canceling instance '+realTicket.getMaster('instanceId'));
                                TerminateSession(records[i].SESSION_ID);
                                updateStatus(mysqlPool, realTicket.id, 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                                updateStatus(mysqlPool, records[i].ID, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
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

                    case 'exec_batch':
                    case 'exec_interactive':
                    case 'exec_prompt':
                      jobType = records[i].COMMAND.toLowerCase().replace(/^exec_/, '');
                      if (mystate === 'on') {
                        var isCancelPending = checkForPendingUserTerminate(records, records[i].SESSION_ID);
                        if (isCancelPending !== null) {

                          logger.log(records[i].SESSION_ID + ': is being canceled as requested.');
                          updateStatus(mysqlPool, records[i].ID , 'CANCELED', [], [], function(err, data) {}); // Don't send emails in such cases.
                          updateStatus(mysqlPool, isCancelPending.id, 'ENDED', [], [], function(err, data) {}); // Don't send emails in such cases.
                          records[isCancelPending.index].STATUS = 'ENDED';
                        } else {
                          if (nslmSessionIsActive) {
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
                                var hasCredit = companyCredits[currentSid.companyId] || false;
                                if (hasCredit === true) { // Carry on

                                  machineId = records[i].MACHINE_ID || 0;
                                  logger.log('Total running=' + totalRunningFound + ' MAX ALLOWED=' + quotas.limits.resolveLimits({cloud: machines.getCloudId(machineId)}));
                                  var machineType = machines.getSpeed(machineId);
                                  if ((! machines.exists(machineId)) || (machineId === 0)) {
                                    logger.log('WARNING: Undefined machine '+machineType+' '+machineId);
                                    machineType = '';
                                  } else {
                                    runOrNot = quotas.checkQueueQuota(currentSid.companyId, currentSid.clientId, currentSid.projectId, currentSid.toolId, machineId, machines.getCloudId(machineId), false, 1);
                                  }

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
                                          quotas.stats.add(companyId || 0, userId || 0, projectId || 0, toolId || 0, machineId, machines.getCloudId(machineId));

                                          startMaster(t, function(err, data) {
                                            var mysqlKeys;
                                            var mysqlValues;
                                            if (err) {
                                              logger.log(sessionId + ': ERROR STARTING MASTER');
                                              mysqlKeys = ['NOTE'];
                                              mysqlValues = ['Error starting master'];
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
                                                t.setDynamicNFSShare('ip', data[0].ip);
                                                t.setDynamicNFSShare('ip', data[0].publicIp);
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
                                                if (useDynamicNFSShares === true) {
                                                  activateNFSShares(data[0].instanceId, sessionId);
                                                }
                                                t.healthCheckTimer = setInterval(function() {
                                                  InstanceHealthCheck(data[0].instanceId, sessionId, [
                                                    {'state' : 'terminated', 'action':restartMaster},
                                                    {'state' : 'undefined', 'action':restartMaster},
                                                    {'state' : 'error', 'action':forceRestartMaster}
                                                  ]);
                                                }, HEALTH_CHECK_INTERVAL);
                                                var now = nt.getDateTimeNow(true, false);
                                                mysqlKeys = ['LAUNCHED', 'INSTANCE_ID']; // INSTANCE_ID was MACHINE_NAME
                                                mysqlValues = [now, data[0].instanceId];
                                                mysqlKeys.push('CUUID');
                                                mysqlValues.push(t.get('uuid'));
                                                updateStatus(mysqlPool, hubreqid, 'SETUP', mysqlKeys, mysqlValues);
                                                logger.log(sessionId + ': Master ' + data[0].instanceId + ' started successfully');
                                              } else {
                                                t.deAssociate();
                                                t = null;
                                                if (data === null) {
                                                  // if startMaster returns null data put back in queue
                                                  // FIXME : skip for some cycles...
                                                  skippedSessions[sessionId] = SKIP_CYCLES;
                                                  updateStatus(mysqlPool, hubreqid, 'PENDING', ['QUEUE_INFO'], ['{"message":"Cloud resources exhausted"}']);
                                                  logger.warn(sessionId + ': failed to start master due to limitted cloud resources, will retry on next check');
                                                } else {
                                                  logger.log(sessionId + ': ERROR SETTING UP JOB, startMachines returned empty value');
                                                  mysqlKeys = ['NOTE'];
                                                  mysqlValues = ['Error setting up job'];
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
                                      var activeTicket = Tickets[isSessionActive];
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
                                  updateStatus(mysqlPool, records[i].ID, 'NOCREDIT', [], []);
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
                  logger.log('0 pending and ' + totalRunningFound + ' running jobs. State=' + mystate + ((! NSLM_BYPASS) ? (', license=' + (nslmSessionIsActive ? 'ok' : 'NOT ok')) : ''));
                  showProcessStats();
                }
                pendingWereNone = true;
                pendingNoneCnt++;
              }
            }

            mysqlClient.release();

          });
        });
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
} else {
  logger.log('SSL not enabled');
  server = http.createServer();
}

io = require('socket.io').listen(server, {maxHttpBufferSize: Infinity, transports:['websocket', 'polling']});

server.listen(hubPort);

logger.log('Socket.io listening on ' + hubProtocol + '://' + hubHost + ':' + hubPort);

io.on('connection', function (socket) {

  logger.log('Got a new connection, socket=' + socket.id + ', remoteAddress=' + ((socket.handshake) ? (socket.handshake.address) : ''));

  socket.on('disconnect', function () {
    logger.log('Host ' + ((socket.nefinstanceId) ? socket.nefinstanceId : 'unknown') + ' disconnected, socket=' + socket.id +
               ', session=' + ((socket.nefsessionId) ? socket.nefsessionId : 'unknown') +
               ', remoteAddress=' + ((socket.handshake) ? (socket.handshake.address) : ''));

    var sessionId = socket.nefsessionId;
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
      if (logHeartBeats === true) {
        logger.log('Got HEARTBEAT from socket '+socket.id+' instance "' + instance + '"' + ((sessionId !== '') ? ' serving session "' + sessionId + '"' : ''));
      }
      //logger.log('instance', socket.nefinstanceId || '');
      //logger.log('session', socket.nefsessionId || '');
      //logger.log('hostname', socket.nefhostname || '');
      if (sessionId !== '') {
        myticket = getTicketIdBySessionId(sessionId);
        var masterTicket = msg.ticket || null;
        if (myticket == null) {
          recoverTicket(masterTicket, socket);
          myticket = getTicketIdBySessionId(sessionId);
        }
        if (myticket !== null) {
          var mysocket = Tickets[myticket].getMaster('socket');
          if ((mysocket == null) || (mysocket !== socket.id)) {
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
          var instanceId = lastMsgData.instanceId;
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
          var vncURLargs = '/#autoconnect=true&password=' + Tickets[myticket].get('uuid') + '&title=Nefelus%20-%20' + (sessionId.split('_')[4] || 'VNC.Console');
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

          Tickets[myticket].consoleCheckTimer = setInterval(function consoleCheckTimerFunc() {
            nt.isAliveUrl({'url' : ((Tickets[myticket].vncConsole !== '') ? Tickets[myticket].vncConsole : Tickets[myticket].logConsole),
                           'timeout' : 3500},
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
                              clearInterval(Tickets[myticket].consoleCheckTimer);
                              Tickets[myticket].consoleCheckTimer = null;
                              updateStatus(mysqlPool, reqID, 'RUNNING', mysqlKeys, mysqlValues);
                              logger.log(sessionId + ': LOG URL: ' + Tickets[myticket].logConsole);
                              if (Tickets[myticket].vncConsole !== '') {
                                logger.log(sessionId + ': VNC VIEWER: ' + Tickets[myticket].vncConsole);
                              }
                            }
                          });
            return consoleCheckTimerFunc;
          }(), CONSOLE_CHECK_INTERVAL);
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
      var status = msg.status || '';
      logger.log(sessionId + ': Got DOWNLOAD_FINISHED with status : ' + status);
      if (msg.sizes) {
        logger.log(sessionId + ': DOWNLOADED home='+msg.sizes.home+ ',data='+msg.sizes.data+',tool='+msg.sizes.tool+' bytes.');
        logger.log(sessionId + ': DOWNLOADED home='+msg.sizes.homecnt+ ',data='+msg.sizes.datacnt+',tool='+msg.sizes.toolcnt+' files.');
        var t = parseInt(msg.sizes.total, 10) / 1024.0; // Kilobytes
        var e = parseInt(msg.elapsed, 10) / 1.0;
        if (e !== 0) {
          logger.log(sessionId + ': DOWNLOADED total='+msg.sizes.total+' bytes, '+msg.sizes.totalcnt+' files in '+msg.elapsed+' secs, rate='+Math.round(t/e)+' KBps.');
        } else {
          logger.log(sessionId + ': DOWNLOADED total='+msg.sizes.total+' bytes, '+msg.sizes.totalcnt+' files in '+msg.elapsed+' secs. So fast!');
        }
      }

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
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      logger.log(sessionId + ': Got TOOL_DOWNLOAD_FINISHED with status : ' + status);

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
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      logger.log(sessionId + ': Got DATA_DOWNLOAD_FINISHED with status : ' + status);

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
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var cancelled = msg.cancelled || '';
      logger.log(sessionId + ': Got EXECUTE_FINISHED ' + ((cancelled) ? '[terminated] ' : '') + 'with status : ' + status);

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
      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      logger.log(sessionId + ': Got UPLOAD_FINISHED with status : ' + status);
      if (msg.sizes) {
        logger.log(sessionId + ': UPLOADED home='+msg.sizes.home+ ',data='+msg.sizes.data+' bytes.');
        logger.log(sessionId + ': UPLOADED home='+msg.sizes.homecnt+ ',data='+msg.sizes.datacnt+' files.');
        var t = parseInt(msg.sizes.total, 10) / 1024.0; // Kilobytes
        var e = parseInt(msg.elapsed, 10) / 1.0;
        if (e !== 0) {
          logger.log(sessionId + ': UPLOADED total='+msg.sizes.total+' bytes, '+msg.sizes.totalcnt+' files in '+msg.elapsed+' secs, rate='+Math.round(t/e)+' KBps.');
        } else {
          logger.log(sessionId + ': UPLOADED total='+msg.sizes.total+' bytes, '+msg.sizes.totalcnt+' files in '+msg.elapsed+' secs. So fast!');
        }
      }

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
          mysqlValues.push(nt.createSessionPath(sessionId, installationId) + 'out');
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

      var sessionId = msg.sessionId || '';
      var status = msg.status || '';
      var masterTicket = msg.ticket || null;
      logger.log(sessionId + ': Got READY with status : ' + status);

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

      var instanceId = msg.instanceId || '';
      logger.log('Got HELLO from master: ' + instanceId);
      var myticket = getTicketIdByInstanceId(instanceId);

      handleHello(socket, instanceId, myticket, msg);

    } else {
      logger.log('Got bogus message:' + data);
    }
  });

  socket.on('admincmd', function (data) {
    logger.log('Got ADMINCMD : ' + data);
    socket.nefinstanceId = '-';
    socket.nefsessionId = 'admin';
    socket.nefhostname = '-';
    if (nt.isSafeJSON(data)) {
      var cmd = JSON.parse(data);
      var mesg = {status:'', message : ''};
      switch (cmd.command) {
        case 'showsessions' :
          mesg.status = 'ok';
          var T = [];
          for (var key in Tickets) {
            var ticket = Tickets[key];
            if (ticket !== null) {
              T.push(distillTicket(ticket));
            }
          }
          mesg.message = JSON.stringify(T);
          T = null;
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
      logger.log(sid + ': SENT ' + type + ' to '+peer);
      if (msgParams) {
        for (var attr in msgParams) {
          msg[attr] = msgParams[attr];
        }
      }

      // Send to particular socket
      // for new socket.io see : https://github.com/socketio/socket.io/issues/1618
      // or io.to(peer).emit() might work...
      if (io.sockets.connected[peer]) {
        io.sockets.connected[peer].emit(type, JSON.stringify(msg), parseAck);
      } else {
        try {
          io.to(peer).emit(type, JSON.stringify(msg), parseAck);
        } catch (eio) {
          logger.log('Socket '+peer+' is not found in connected peers.');
        }
      }
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

  for (i = emailTemplates.length - 1; i >= 0; i--) {
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
            if (moment.tz.names().indexOf(timezone) === -1) {
              timezone = 'UTC';
            }
            if ((record.started) && (record.started !== '') && (record.started !== 'null')) {
              var dts = moment( ((record.started).replace(/\//g, '-'))).tz(timezone);
              record.started = dts.format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ (z)');
            } else {
              record.started = 'N/A';
            }
            if ((record.completed) && (record.completed !== '') && (record.completed !== 'null')) {
              var dtc = moment( ((record.completed).replace(/\//g, '-'))).tz(timezone);
              record.completed = dtc.format('ddd MMM DD YYYY HH:mm:ss [GMT]ZZ (z)');
            } else {
              record.completed = 'N/A';
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

  var instanceId = Tickets[ticket].getMaster('instanceId');
  if (useDynamicNFSShares === true) {
    deactivateNFSShares(instanceId);
  }

  Tickets[ticket].set('sessionStatus', 'cleanup');

  if (status !== 'error') {
    mysqlKeys = ['OUTPUT_DIR'];
    if (status === 'ok') {
      mysqlValues.push(nt.createSessionPath(sessionId, installationId) + 'out');
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
  logger.log(sessionId + ': SENT DOWNLOAD');
  socket.emit('download', JSON.stringify(mesg), parseAck);
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
    var aws2master = {
                      ec2_max_tries : EC2_MAX_TRIES,
                      ec2_timeout : EC2_TIMEOUT,
                      s3 : aws.s3
                     };
    aws2master.s3.endPoint = {};
    aws2master.s3.endPoint.endpoint = aws.s3.endpoint;

    var encrypted = cipher.update(JSON.stringify(aws2master), 'utf8', 'hex') +
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
    if (installationId !== '') {
      cipher = crypto.createCipher('aes256', instanceId);
      encrypted = cipher.update(installationId, 'utf8', 'hex') +
                  cipher.final('hex');
      mesg['installationId'] = encrypted;
    }
    if (Tickets[ticket].get('XResolution')) {
      mesg['XResolution'] = Tickets[ticket].get('XResolution');
    }
    if (Tickets[ticket].get('XDisplay')) {
      mesg['XDisplay'] = Tickets[ticket].get('XDisplay');
    }
    logger.log(sessionId + ': servername: ' + servername + ' uuid: ' + uuid);
    if (servername !== '') {
      if (reqID !== null) {
        mysqlKeys = ['SERVERNAME'];
        mysqlValues = [servername];
        updateStatus(mysqlPool, reqID, '', mysqlKeys, mysqlValues);
      }
    }

    socket.nefinstanceId = instanceId;
    socket.nefsessionId = sessionId;
    socket.nefhostname = servername;
    if (Tickets[ticket].get('cancelPending') === false) {
      socket.emit('welcome', JSON.stringify(mesg), parseAck);
    }
  } else {
    recoverTicketFromInternalState(mysqlPool, 'INSTANCE_ID', instanceId, function (err, data) {
      if (data === null) {
        if (useDynamicNFSShares === true) {
          deactivateNFSShares(instanceId);
        }
        logger.log('ERROR: Could not find corresponding session for Instance ' + instanceId);
        if (reqID !== null) {
          mysqlKeys = ['NOTE'];
          mysqlValues = ['ERROR: Could not find corresponding session for Instance ' + instanceId];
          updateStatus(mysqlPool, reqID, 'ERROR', mysqlKeys, mysqlValues);
          //FIXME: no sessionId so no mail to user?
        }
      } else {
        recoverTicket(data, socket);
        var myticket = getTicketIdByInstanceId(instanceId);
        handleHello(socket, instanceId, myticket, msg);
      }
    });
  }
}

function loadMySQLParams(mysqlClient, lastUpdatedConfig, cb) {
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
                      if ((lastUpdatedConfig['IMAGES']) && (lastUpdatedConfig['IMAGES']['reload'])) {
                        images.loadImages(mysqlClient, function(err, imageData) {
                          err && logger.log('Images', err);
                          if (imageData) {
                            logger.log(imageData);
                            var nowDate = new Date();
                            lastUpdatedConfig['IMAGES']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['IMAGES']['reload'] = false;
                          }
                          callback(err, machineData, imageData);
                        });
                      } else {
                        callback(null, machineData, 'No need to reload images');
                      }
                    },
                    function(machineData, imageData, callback) {
                      if ((lastUpdatedConfig['CLOUD']) && (lastUpdatedConfig['CLOUD']['reload'])) {
                        clouds.loadClouds(mysqlClient, function(err, cloudData) {
                          err && logger.log('Clouds', err);
                          if (cloudData) {
                            logger.log(cloudData);
                            var nowDate = new Date();
                            lastUpdatedConfig['CLOUD']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['CLOUD']['reload'] = false;
                          }
                          callback(err, machineData, imageData, cloudData);
                        });
                      } else {
                        callback(null, machineData, imageData, 'No need to reload clouds');
                      }
                    },
                    function(machineData, imageData, cloudData, callback) {
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
                          callback(err, machineData, imageData, cloudData, toolappsData);
                        });
                      } else {
                        callback(null, machineData, imageData, cloudData, 'No need to reload toolapps');
                      }
                    },
                    function(machineData, imageData, cloudData, toolappsData, callback) {
                      if ((lastUpdatedConfig['SEC_GROUP_RULES']) && (lastUpdatedConfig['SEC_GROUP_RULES']['reload'])) {
                        secgroups.loadSecGroups(mysqlClient, function(err, secgroupsData) {
                          err && logger.log('SecGroups', err);
                          if (secgroupsData) {
                            logger.log(secgroupsData);
                            var nowDate = new Date();
                            lastUpdatedConfig['SEC_GROUP_RULES']['timestamp'] = Number(nowDate.valueOf());
                            lastUpdatedConfig['SEC_GROUP_RULES']['reload'] = false;
                          }
                          callback(err, machineData, imageData, cloudData, toolappsData, secgroupsData);
                        });
                      } else {
                        callback(null, machineData, imageData, cloudData, toolappsData, 'No need to reload secgroups');
                      }
                    }
                  ],
                  function(err, machineData, imageData, cloudData, toolappsData, secgroupsData) {
                    if (err) {
                      logger.log('Loading from MySQL failed, will retry shortly...');
                      setTimeout(function() { callback(err, {'1' : machineData || null,
                                                             '2' : imageData || null,
                                                             '3' : cloudData || null,
                                                             '4' : toolappsData || null,
                                                             '5' : secgroupsData || null,
                                                            }); }, DBTIMEOUT);
                    } else {
                      logger.log('Loading from MySQL completed');
                      callback(err, {'machines' : machineData || null,
                                     'images' : imageData || null,
                                     'clouds' : cloudData || null,
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
        logger.log('Error from MYSQL query:');
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
      return { index : i, id : recs[i].ID};
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
          logger.log(ticket.req.sessionId+': WARNING: Session excided running time limit. Sending cancel message to terminate.');
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

function getCompaniesCredit(sqlpool, companyIds, cb) {
  if (companyIds.length === 0) {
    cb(null, {});
    return;
  }
  var res = {};
  if (sqlpool !== null) {
    sqlpool.getConnection(function(err, client) {
      if (err) {
        logger.log(err);
        cb(err, res);
        return;
      }
      client.query(SQL.availableCredit, [companyIds], function (err, rows, fields) {
        if (err) {
          logger.log(err);
          cb(err, res);
          return;
        } else {
          var companyId, availableCredit, i, total, dueAmount, amount, discount, chargedAmount, remainingAmount;
          for (i=0; i < rows.length; i++) {
            availableCredit = false;
            companyId =  rows[i]['COMPANY_ID'];
            remainingAmount = rows[i]['REMAINING_AMOUNT'];
            amount = rows[i]['AMOUNT'];
            dueAmount = rows[i]['DUE_AMOUNT'];
            discount = rows[i]['DISCOUNT'];
            chargedAmount = rows[i]['CHARGED_AMOUNT'];
            total = amount + discount;
            remainingAmount = total - chargedAmount - dueAmount;
            if (remainingAmount > 0) {
              availableCredit = true;
            } else {
              var p = 100 * remainingAmount / total;
              if (p < 10) {
                availableCredit = true;
              }
            }
            res[companyId] = availableCredit;
          }
          cb(err, res);
        }
        client.release();
      });
    });
  } else {
    logger.log('Could not establish connection to mysql server');
    cb('Could not establish connection to mysql server', {});
    return;
  }

}
