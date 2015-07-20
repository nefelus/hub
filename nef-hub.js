var program = require('commander');
var path = require('path');
var nconf = require('nconf');
var AWS = require('aws-sdk');
var Table = require('cli-table');
var io = require('socket.io-client');
var _ = require('lodash');
var env = process.env;
var nt = require(path.join(__dirname, './lib/tools'));
var ec2;
var ep = null;
var myname;
var socket = null;
var hubServer = null;

program
  .version('0.0.1')
  .usage('<command> [options]')
  .option('-c, --config <path>', 'set config path. defaults to ./config.json', path.join(__dirname, 'config.json'))
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

if ((myshell !== 'node') && (myshell !== 'jx')) {
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
  nconf.env().file({ file: program.config });
  var hubPort = nconf.get('hub:port') || 8585;
  var hubHost = nconf.get('hub:host') || '127.0.0.1';
  var ssl = nconf.get('hub:ssl') || false;
  var hubProtocol = 'http';
  if (ssl !== false) {
    if ((ssl.key !== '') && (nt.isReadableSync(ssl.key)) && (ssl.cert !== '') && (nt.isReadableSync(ssl.cert))) {
      hubProtocol = 'https';
    }
  }
  hubServer = program.hubServer || (hubProtocol+'://'+hubHost+':'+hubPort);
}

function _callHub(cmd, options) {
  //logger.log('Connecting to '+hubServer);
  var hubOptions = {reconnect: true};
  if (hubServer.substr(0,5) == 'https') {
    hubOptions['secure'] = true;
  }
  try {
    socket = io.connect(hubServer, hubOptions);
  } catch(e) {};

  if (socket) {
    socket.on('connect_failed', function (msg) {
      console.log(msg || 'Received an error');
    }).on('error', function (msg) {
      console.log(msg || 'Received an error');
    });

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
        console.log('('+j.status+'): '+j.message);
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
