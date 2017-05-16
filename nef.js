var program = require('commander');
var path = require('path');
var env = process.env;

program
  .version('0.0.1')
  .usage('<command> [options]')
  .command('com','desc for com')
  //.command('fs','desc for fs')
  .command('hub','desc for com')
  .option('-c, --config <path>', 'set config dir path.')
  .option('-H, --hub-server <url>', 'set hub location')
  .option('-A, --api-key <key>', 'set the API key')
  .option('-S, --api-secret <secret>', 'set the API secret')
  .option('-E, --api-endpoint <url>', 'set the API endpoint')
  .option('-R, --region <region>', 'set the region');

/*
program
   .command('fs')
   .action(function(){
     console.log(program);
     console.log(program.rawArgs);
//: [ 'node', '/Users/kosmas/work/nefelus/hub/nef', 'fs' ],

   });
*/

var myshell = path.basename(process.argv[0]);

if ((myshell !== 'node') && (myshell !== 'jx')) {
  process.argv.unshift(myshell);
}

//console.log(process.argv);

var myname=process.argv[1];
program.parse(process.argv);

//console.log(program);
if (!program.args.length) program.help();

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
