//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var program = require('commander');
var path = require('path');
var fs = require('fs');
var toml = require('toml');
var nconf = require('nconf');
var io = require('socket.io-client');
var _ = require('lodash');
var env = process.env;
var nt = require(path.join(__dirname, './lib/tools'));
var myname;
var socket = null;
var hubServer = null;

program
  .version('0.0.1')
  .usage('<command> [options]')
  .option('-c, --config <path>', 'set config dir path.')
  .option('-H, --hub-server <url>', 'set hub location')
  .option('-A, --api-key <key>', 'set the API key')
  .option('-S, --api-secret <secret>', 'set the API secret')
  .option('-E, --api-endpoint <url>', 'set the API endpoint')
  .option('-R, --region <region>', 'set the region');

program
   .command('pause')
   .description('pause queue')
   .action(function(){
     callHub(program, "pause");
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s pause', program._name);
   });

program
   .command('resume')
   .description('resume queue')
   .action(function(){
     callHub(program, "resume");
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s resume', program._name);
   });

program
   .command('status')
   .description('show queue status')
   .action(function(){
     callHub(program, "status");
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s status', program._name);
   });

program
   .command('shutdown')
   .description('shutdown hub server')
   .action(function(){
     callHub(program, "shutdown");
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s shutdown', program._name);
   });

program
   .command('interval <interv>')
   .description('set queue check interval')
   .action(function(interv){
     callHub(program, "interval", interv);
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s interval 30 ', program._name);
   });

program
   .command('showsessions')
   .alias('sessions')
   .description('show sessions')
   .action(function(){
     callHub(program, "showsessions");
     hubSetup(program);
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ %s showsessions 30 ', program._name);
   });

var myshell = path.basename(process.argv[0]);

if (myshell !== 'node') {
  process.argv.unshift(myshell);
}

//console.log(process.argv);

myname=process.argv[1];
program.parse(process.argv);

//console.log(program);
if (!program.args.length) program.help();

function callHub(program, cmd, options) {
  var hubopts = options || [];
  if (! _.isArray(hubopts)) {
    hubopts = [hubopts];
  }
  hubSetup(program);
  switch (cmd) {
    case "interval" : 
    case "status" : 
    case "pause" : 
    case "resume" : 
    case "shutdown" : 
    case "showsessions" : 
      _callHub(cmd, [hubopts]);
      break;
    default :
      break;
  }
}

function hubSetup(program) {
  var isPkg = (process.versions.pkg !== undefined);

  var exepath;

  if (isPkg) {
    exepath = process.argv[0];
  } else if ((path.basename(process.argv[0]) === 'node')) {
    exepath = process.argv[1];
  } else {
    exepath = process.argv[0];
  }
  exepath = path.dirname(exepath);

  var commonConfigDir = program.config || '/usr/share/nefelus/conf';
  var appConfigDir = commonConfigDir;

  if (nt.isReadableSync(path.join(commonConfigDir, 'nefelus.conf')) === false) {
    console.log(path.join(commonConfigDir, 'nefelus.conf')+' not found. Falling back to '+ path.join(exepath, 'nefelus.conf'));
    commonConfigDir = exepath;
    if (nt.isReadableSync(path.join(commonConfigDir, 'nefelus.conf')) === false) {
      console.log(path.join(commonConfigDir, 'nefelus.conf')+' not found. Exiting.');
      process.exit(2);
    }
  }

  if (nt.isReadableSync(path.join(appConfigDir, 'hub.conf')) === false) {
    console.log(path.join(appConfigDir, 'hub.conf')+' not found. Falling back to '+ path.join(exepath, 'hub.conf'));
    appConfigDir = exepath;
    if (nt.isReadableSync(path.join(appConfigDir, 'hub.conf')) === false) {
      console.log(path.join(appConfigDir, 'hub.conf')+' not found. Exiting.');
      process.exit(2);
    }
  }

  var commonConfigData = fs.readFileSync(path.join(commonConfigDir, 'nefelus.conf'), 'utf-8');
  var appConfigData = fs.readFileSync(path.join(appConfigDir, 'hub.conf'), 'utf-8');
  var commonConfig;
  var appConfig;
  try {
    commonConfig = toml.parse(commonConfigData);
  } catch (e) {
    console.log('Error parsing '+ path.join(commonConfigDir, 'nefelus.conf'));
    console.log(util.inspect(e, {depth:null}));
  }
  try {
    appConfig = toml.parse(appConfigData);
  } catch (e) {
    console.log('Error parsing '+ path.join(appConfigDir, 'hub.conf'));
    console.log(util.inspect(e, {depth:null}));
  }

  nconf.env()
       .add('hub', {type: 'literal', store: appConfig})
       .add('nefelus', {type: 'literal', store: commonConfig})
       .defaults({
         port : 8585,
         host : 'localhost',
         ssl : false,
         ignoreInstallationIdInFilemanagerOps : false,
         hasAutoAssignFloatingIp : true
       });

  var hubPort = nconf.get('hub:port') || 8585;
  var hubHost = nconf.get('hub:host') || '127.0.0.1';
  var ssl = nconf.get('ssl') || false;
  if (nt.isEmpty(ssl)) {
    ssl = false;
  }
  var hubProtocol = 'http';
  if (ssl !== false) {
    if ((ssl.key !== '') && (nt.isReadableSync(ssl.key)) && (ssl.cert !== '') && (nt.isReadableSync(ssl.cert))) {
      hubProtocol = 'https';
    }
  }
  hubServer = program.hubServer || (hubProtocol+'://'+hubHost+':'+hubPort);
}

function _callHub(cmd, options) {
  //console.log('Connecting to '+hubServer);
  var hubOptions = {
      reconnection: true,
      reconnectionDelay:1000,
      reconnectionDelayMax:5000,
      reconnectionAttempts:Infinity
  };
  try {
    socket = io.connect(hubServer, hubOptions);
  } catch(e) {};

  var errorHandler = function errorHandler(error) {
    console.log('Received an error : '+util.inspect(error, {depth:null}) || 'no further info provided.');
  }

  if (socket) {
    socket.on('connect_error', errorHandler);
    socket.on('reconnect_error', errorHandler);

    socket.on('disconnect', function() {
      process.exit();
    });

    socket.on('connect', function() {
      var msg = { 'command' : cmd , 'args' : options};
      setTimeout(function() {
        socket.emit('admincmd', JSON.stringify(msg));
      }, 300);
    });

    socket.on('admincmd_finished', function (data) {
      if (nt.isSafeJSON(data)) {
        var j = JSON.parse(data);
        if (j.status == 'ok') {
          var m = JSON.parse(j.message);
          if (cmd == 'showsessions') {
            m.forEach(function(s, i) {
              if (i !== 0) {
                console.log('');
              }
              console.log('- '+i+' -');
              for (var key in s) {
               console.log(key+' = '+s[key]);
              }
            });
          } else {
            console.log('('+j.status+'): '+j.message);
          }
        } else {
          console.log('('+j.status+'): '+j.message);
        }
      } else {
        console.log('Got bogus message:'+data);
      }
      process.exit();
    });
  }
}

function range(val) {
  return val.split('..').map(Number);
}

function listNum(val) {
  return val.split(',').map(Number);
}

function list(val) {
  return val.split(',');
}

function collect(val, memo) {
  memo.push(val);
  return memo;
}

function increaseVerbosity(v, total) {
  return total + 1;
}
