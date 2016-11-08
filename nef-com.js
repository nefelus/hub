var program = require('commander');
var path = require('path');
var util = require('util');
var async = require('async');
var nconf = require('nconf');
var AWS = require('aws-sdk');
var _ = require('lodash');
var Table = require('cli-table');
var env = process.env;
var nt = require(path.join(__dirname, './lib/tools'));
var ec2;
var ep = null;
var myname;

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
   .command('showimages')
   .alias('images')
   .description('show current machine images')
   .option('-i, --images <ids>', 'show specific ids from a comma separated list', list, [])
   .action(function(options){
     awsSetup(program);

     var params = {};
     params = { Owners: ['self'] };
     if (options.images && options.images.length > 0) {
         params['ImageIds'] = options.images;
     }

     ec2.describeImages(params, function(err, data) {
       if (err) {
           console.log(err, err.stack); // an error occurred
       } else {
         //console.log(JSON.stringify(data,null,'  ')); // successful response
         var table = new Table({
           style : {'compact' : true, 'padding-left': 0, 'padding-right': 0},
           //colWidths: [12, 32, 5, 10, 8, 11],
           head: ['ImageId', 'Name', 'Virtualization', 'RootDeviceType', 'Architecture', 'State']
         });

         if (data.Images && data.Images.length) {
           data.Images.forEach(function (im) {
             table.push([im.ImageId || '',
                         im.Name || '',
                         im.VirtualizationType ? ((im.VirtualizationType==='paravirtual')?'pv':im.VirtualizationType) : '',
                         im.RootDeviceType || '',
                         im.Architecture || '',
                         im.State || '']);
           });
           console.log(table.toString());
         } else {
             console.log('No images found');
         }
       }
     });

   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef showimages');
    console.log('    $ nef showimages -i ami-a1b2c3d4,ami-e1f2a3b4');
   });

program
   .command('showinstances')
   .alias('instances')
   .description('show current machine instances')
   .option('-i, --instances <ids>', 'show specific ids from a comma separated list', list, [])
   .option('-f, --full', 'Display full details')
   .option('-k, --filterkey <fk>', 'Filter key ')
   .option('-v, --filtervalues <fv>', 'Filter values from a comma separated list', list, [])
   .action(function(options){
     awsSetup(program);

     var params = {};
     if (options.instances && options.instances.length > 0) {
         params['InstanceIds'] = options.instances;
     }
     if (options.filterkey && options.filterkey.length > 0 && options.filtervalues && options.filtervalues.length > 0) {
       params['Filters'] = [
         {
           Name : options.filterkey,
           Values : options.filtervalues
         }
       ];
     }

     ec2.describeInstances(params, function(err, data) {
       if (err) {
         console.log(err, err.stack); // an error occurred
       } else {
         //console.log(JSON.stringify(data,null,'  ')); // successful response
         var table = new Table({
             style : {'compact' : true, 'padding-left': 0, 'padding-right': 0},
             //colWidths: [10, 12, 25, 7, 43, 12, 24],
             head: ['InstanceId', 'ImageId', 'Name', 'State', 'PublicDNS/IP', 'PrivateIP', 'InstanceType', 'LaunchTime']
         });

         if (data.Reservations && data.Reservations.length) {
           data.Reservations.forEach(function (res) {
             res.Instances.forEach(function (inst) {
               if (options.full === true) {
                 console.log(JSON.stringify(inst,null,'  '));
               }
               var n = inst.PrivateDnsName || '';
               if (inst.Tags) {
                 inst.Tags.forEach(function(t) {
                   if (t.Key === 'Name') {
                     n = t.Value;
                   }
                 });
               }
               table.push([
                           inst.InstanceId || '',
                           inst.ImageId || '',
                           n,
                           (inst.State.Name || ''),
                           (inst.PublicDnsName || '') + (((inst.PublicDnsName) && (inst.PublicIpAddress) && (inst.PublicIpAddress!==inst.PublicDnsName)) ? ('\n'+(inst.PublicIpAddress)) : ''),
                           (inst.PrivateIpAddress),
                           inst.InstanceType || '',
                           inst.LaunchTime.toISOString() || ''
                          ]);
             });
           });
           //console.log(table);
           if (options.full !== true) {
             console.log(table.toString());
           }
         } else {
           console.log('No instances found');
         }
       }
     });

   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef showinstances');
    console.log('    $ nef showinstances -i i-a1b2c3d4,i-e1f2a3b4');
    console.log('    $ nef showinstances -fk private-ip-address -fv 10.0.0.5');
   });

program
   .command('terminate')
   .alias('term')
   .description('terminate instances')
   .option('-i, --instances <ids>', 'terminate specific ids from a comma separated list', list, [])
   .action(function(options){
     awsSetup(program);

     var params = {};
     if (options.instances && options.instances.length > 0) {
       params['InstanceIds'] = options.instances;

       KillMachines(options.instances, function(err, data) {
         if (err) {
           console.log('Could not terminate machines');
         } else {
           console.log('Done!');
         }
       });
     }
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef terminate -i i-a1b2c3d4,i-e1f2a3b4');
   });

program
   .command('showvolumes')
   .alias('volumes')
   .description('show current volumes')
   .option('-v, --volumes <ids>', 'show specific ids from a comma separated list', list, [])
   .action(function(options){
     awsSetup(program);

     var params = {};
     //params = { Owners: ['self'] };
     //if (options.images && options.images.length > 0) {
         //params['ImageIds'] = options.images;
     //}

     ec2.describeVolumes(params, function(err, data) {
       if (err) {
           console.log(err, err.stack); // an error occurred
       } else {
         //console.log(JSON.stringify(data,null,'  ')); // successful response
         var table = new Table({
           style : {'compact' : true, 'padding-left': 0, 'padding-right': 0},
           colWidths: [12, 8, 10, 10, 24, 32, 9],
           head: ['VolumeId', 'Size', 'Zone', 'State', 'CreateTime', 'Attachment', 'Encrypted']
         });

         if (data.Volumes && data.Volumes.length) {
           data.Volumes.forEach(function (vol) {
             table.push([vol.VolumeId || '',
                         vol.Size || '',
                         vol.AvailabilityZone || '',
                         vol.State || '',
                         vol.CreateTime.toISOString() || '',
                         ((vol.Attachments.length) && (vol.Attachments[0].InstanceId)) ? (vol.Attachments[0].InstanceId+' as '+vol.Attachments[0].Device) : '',
                         ((vol.Encrypted) ? 'yes' : 'no') ]);
           });
           console.log(table.toString());
         } else {
             console.log('No volumes found');
         }
       }
     });

   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef showvolumes');
    console.log('    $ nef showvolumes -v vol-a1b2c3d4,vol-e1f2a3b4');
   });

program
   .command('createvolume')
   .alias('volume')
   .description('create a volume')
   .option('-z, --zone <name>', 'Availability zone name')
   .option('-s, --size <size>', 'The volume size in GB', parseInt)
   .action(function(options){

     if ((isNaN(options.size)) || (options.size <=0) || (options.size > 1024)) {
       console.log('Size must be a positive number not greater than 1024.');
       return;
     }
     if ((!options.zone) || (options.zone == '')) {
       console.log('Availability zone must be set.');
       return;
     }

     awsSetup(program);

     var params = {
       AvailabilityZone: options.zone, // required 
       Size: options.size // required
     };
     ec2.createVolume(params, function(err, data) {
       if (err) {
         console.log(err, err.stack); // an error occurred
       } else {
console.log(util.inspect(data, {depth:null}));
         //console.log('Snapshot ' + data.SnapshotId + ' for volume ' + data.VolumeId + ' ('+data.VolumeSize+'GB) started at : '+data.StartTime);
       }
     });
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef createvolume -s 10 -z "nova"');
   });

program
   .command('createsnapshot')
   .alias('snapshot')
   .description('create a snapshot of a volume')
   .option('-v, --volume <id>', 'A volume id')
   .option('-n, --note [note]', 'Snapshot description note')
   .action(function(options){
     awsSetup(program);

     var params = {
       VolumeId: options.volume, // required 
       Description: options.note || '',
     };
     ec2.createSnapshot(params, function(err, data) {
       if (err) {
         console.log(err, err.stack); // an error occurred
       } else {
         console.log('Snapshot ' + data.SnapshotId + ' for volume ' + data.VolumeId + ' ('+data.VolumeSize+'GB) started at : '+data.StartTime);
       }
     });
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef createsnapshot -v vol-a1b2c3d4 -d "Snapshot description"');
   });

program
   .command('createtag')
   .alias('tag')
   .description('create a tag for a resource')
   .option('-r, --resource <id>', 'A resource id')
   .option('-k, --key [key]', 'The key')
   .option('-v, --value [value]', 'The value')
   .action(function(options){
     awsSetup(program);

     if (!options.resource) {
       console.log('Resource must be specified');
       return;
     }
     if (!options.key) {
       console.log('Key must be specified');
       return;
     }
     if (!options.value) {
       console.log('Value must be specified');
       return;
     }

     var params = {
       Resources : [ options.resource ],
       Tags : [ { Key : options.key, Value : options.value } ]
     };
     ec2.createTags(params, function(err, data) {
       if (err) {
         console.log(err, err.stack); // an error occurred
       } else {
console.log(util.inspect(data, {depth:null}));
         //console.log('Snapshot ' + data.SnapshotId + ' for volume ' + data.VolumeId + ' ('+data.VolumeSize+'GB) started at : '+data.StartTime);
       }
     });
   }).on('--help', function() {
    console.log('  Examples:');
    console.log('    $ nef createtag -r vol-a1b2c3d4 -k "Name" -v "My volume"');
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

function awsSetup(program) {
  nconf.env().file({ file: program.config });
  var aws = nconf.get('aws');
  var awsParams = {'accessKeyId'     : program.apiKey || nconf.get('aws:ec2:accessKeyId'),
                   'secretAccessKey' : program.apiSecret || nconf.get('aws:ec2:secretAccessKey'),
                   'region'          : program.region || nconf.get('aws:ec2:region') || 'us-east-1'
                  };

  AWS.config.update(awsParams);

  if (program.apiEndpoint) {
    ep = new AWS.Endpoint(program.apiEndpoint);
  } else if (! nt.isEmpty(aws.ec2.endPoint)) {
    var _ep = aws.ec2.endPoint.endpoint;
    var epproto = _ep.protocol || 'http';
    var epport = ((_ep.port == 80) && (epproto == 'http')) ? '' : (((_ep.port == 443) && (epproto == 'https')) ? '' : ':'+_ep.port);
    var endpoint = epproto + '://'+ _ep.host + epport+ (_ep.path || '/');

    ep = new AWS.Endpoint(endpoint);
  }
  var EC2Params = {};
  if (ep !== null) {
    EC2Params['endpoint'] =  ep;
  }
  var signver = nconf.get('aws:ec2:endPoint:signatureVersion') || null;
  if (ep !== null) {
    EC2Params['signatureVersion'] = signver;
  }
  ec2 = new AWS.EC2(EC2Params);
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
      console.log('Warning: Could not terminate machine(s):' + err.machines);
      console.log(util.inspect(err));
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
  ec2.terminateInstances(args, function(err, data) {
    if (err) {
      console.log(err, err.stack); // an error occurred
    //} else {
      //console.log(JSON.stringify(data,null,'  ')); // successful response
    }
    cb(err, data);
  });
}
