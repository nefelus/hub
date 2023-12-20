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

var program = require('commander');
var path = require('path');

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

if (myshell !== 'node') {
  process.argv.unshift(myshell);
}

//console.log(process.argv);

program.parse(process.argv);

//console.log(program);
if (!program.args.length) {
  program.help();
}
