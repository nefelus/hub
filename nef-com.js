//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var program = require('commander');
var fs = require('fs');
var path = require('path');
var util = require('util');
var async = require('async');
var toml = require('toml');
var nconf = require('nconf');
var AWS = require('aws-sdk');
var mysql = require('mysql');
var _ = require('lodash');
var Table = require('cli-table2');
var nt = require(path.join(__dirname, './lib/tools'));
var ec2;
var ep = null;
var mysqlPool = null;
var mysqlConfig = null;

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
   .command('addimage')
   .description('Add a machine image in nefelus arsenal')
   .option('-i, --image <imageid>', 'the ec2 image id to be used for launching machines')
   .option('-t, --tools [toolids]', 'set list of tool ids, default is all tools (0)', listOfInts, [0])
   .option('-v, --virtualization [type]', 'set virtualization type', /^(pv|hvm)$/i, 'pv')
   .option('-l, --cloud [cloudid]', 'set the cloud id, default is #1', parseInt, 1)
   .option('-d, --description [description]', 'set a small description')
   .option('-a, --activate', 'set active flag')
   .action(function(options){

     if (options.description === undefined) {
       options.description = '';
     }
     if ((options.tools === undefined) || (options.tools.length === 0)) {
       options.tools = [0];
     }
     if (options.image !== undefined) {
       awsSetup(program);
       var params = {};
       params = { Owners: ['self'] };
       if (options.images && options.images.length > 0) {
           params['ImageIds'] = [options.image];
       }

       ec2.describeImages(params, function(err, data) {
         if (err) {
           console.log(err, err.stack); // an error occurred
         } else {
           if (data.Images && data.Images.length) {
             var lines = [];
             options.tools.forEach(function(t) {
               lines.push([options.image, t, options.cloud, options.virtualization, options.description, ((options.activate) ? 'Y' : 'N')]);
             });

             dbSetup(program);
             mysqlPool = mysql.createPool(mysqlConfig);
             mysqlPool.on('connection', function(connection) {
             // console.log('new connection');
             });

             if (mysqlPool !== null) {

               mysqlPool.getConnection(function(err, mysqlClient) {
                 if (err) {
                   console.log(err);
                   process.exit(2);
                   return;
                 }

                 var stmt = 'INSERT INTO IMAGES (AMI, TOOL_ID, CLOUD_ID, VIRTUALIZATION, DESCRIPTION, ACTIVE) VALUES ?';
                 mysqlClient.query(stmt, [lines], function(err) {
                   var exitCode = 0;
                   if (err) {
                     exitCode = 2;
                     console.log(err);
                   } else {
                     console.log('Done');
                   }
                   mysqlClient.release();
                   setTimeout(function(){mysqlPool.end(function(err) {process.exit(exitCode);});}, 1000);
                 });
               });
             }
           } else {
             console.log('The specified image is not found');
           }
         }
       });
     } else {
       console.log('You have to specify a valid ec2 image id');
       process.exit(2);
     }
   });

program
   .command('activateimage')
   .description('Activate image')
   .option('-i, --ids <ids>', 'Activate images specified by their db ids from a comma separated list', listOfInts, [])
   .action(function(options){
     if (options.ids && options.ids.length > 0) {
       var id;
       var ids = '';
       if ( options.ids.length == 1) {
         ids = ' = '+id;
       } else {
         for (var i = 0; i < options.ids.length; i++) {
           if (ids != '') {
             ids += ',';
           }
           ids += id;
         }
         if (ids !== '') {
           ids = ' IN ('+ids+')';
         } else {
           console.log('You have to specify at least a valid image id');
           process.exit(2);
         }
       }

       dbSetup(program);
       mysqlPool = mysql.createPool(mysqlConfig);
       mysqlPool.on('connection', function(connection) {
       // console.log('new connection');
       });

       if (mysqlPool !== null) {

         mysqlPool.getConnection(function(err, mysqlClient) {
           if (err) {
             console.log(err);
             process.exit(2);
             return;
           }

           var stmt = 'UPDATE IMAGES SET ACTIVE = "Y" where ID '+ids;
           mysqlClient.query(stmt, function(err) {
             var exitCode = 0;
             if (err) {
               exitCode = 2;
               console.log(err);
             } else {
               console.log('Done');
             }
             mysqlClient.release();
             setTimeout(function(){mysqlPool.end(function(err) {process.exit(exitCode);});}, 1000);
           });
         });
       }
     } else {
       console.log('You have to specify at least one image id');
     }
   });

program
   .command('deactivateimage')
   .description('Deactivate image')
   .option('-i, --ids <ids>', 'Deactivate images specified by their db ids from a comma separated list', listOfInts, [])
   .action(function(options){
     if (options.ids && options.ids.length > 0) {
       var id;
       var ids = '';
       if ( options.ids.length == 1) {
         ids = ' = '+id;
       } else {
         for (var i = 0; i < options.ids.length; i++) {
           if (ids != '') {
             ids += ',';
           }
           ids += id;
         }
           ids = ' IN ('+ids+')';
       }

       dbSetup(program);
       mysqlPool = mysql.createPool(mysqlConfig);
       mysqlPool.on('connection', function(connection) {
       // console.log('new connection');
       });

       if (mysqlPool !== null) {

         mysqlPool.getConnection(function(err, mysqlClient) {
           if (err) {
             console.log(err);
             process.exit(2);
             return;
           }

           var stmt = 'UPDATE IMAGES SET ACTIVE = "N" where ID '+ids;
           mysqlClient.query(stmt, function(err) {
             var exitCode = 0;
             if (err) {
               exitCode = 2;
               console.log(err);
             } else {
               console.log('Done');
             }
             mysqlClient.release();
             setTimeout(function(){mysqlPool.end(function(err) {process.exit(exitCode);});}, 1000);
           });
         });
       }
     } else {
       console.log('You have to specify at least one valid image id');
     }
   });

program
   .command('showimages')
   .alias('images')
   .description('show current machine images')
   .option('-i, --images <ids>', 'show specific ids from a comma separated list', list, [])
   .option('-n, --nefelus', 'show images used for running enduser sessions')
   .option('-a, --active', 'show only active images if --nefelus option is selected')
   .action(function(options){

     if (! options.nefelus) {
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
     } else {
       dbSetup(program);
       mysqlPool = mysql.createPool(mysqlConfig);
       mysqlPool.on('connection', function(connection) {
       // console.log('new connection');
       });

       if (mysqlPool !== null) {

         mysqlPool.getConnection(function(err, mysqlClient) {
           if (err) {
             console.log(err);
             process.exit(2);
             return;
           }


           var stmt = 'SELECT i.ID, i.TOOL_ID, i.VIRTUALIZATION, c.NAME, i.AMI, i.DESCRIPTION, i.ACTIVE from IMAGES i, CLOUD c WHERE i.CLOUD_ID = c.ID';
           if (options.active === true) {
             stmt += ' and i.ACTIVE <> "N";';
           }
           mysqlClient.query(stmt, function(err, rows, fields) {
             var exitCode = 0;
             var record;
             var table = new Table({
               style : {'compact' : true, 'padding-left': 0, 'padding-right': 0},
               //colWidths: [12, 32, 5, 10, 8, 11],
               head: ['Id', 'AMI', 'ToolId', 'Cloud', 'Virtualization', 'Description', 'State']
             });
             if (err) {
               exitCode = 2;
               console.log(err);
             } else {
               var records=[];
               for (var i = 0; i < rows.length; i++) {
                 record = {};
                 for (var j = 0; j < fields.length; j++) {
                   record[fields[j].name.toLowerCase()] = (rows[i][fields[j].name] !== null) ? rows[i][fields[j].name] : '';
                   if (typeof record[fields[j].name.toLowerCase()] === 'object') {
                     record[fields[j].name.toLowerCase()] += '';
                   }
                 }
                 records.push(record);
               }
               if (records.length) {
                 records.forEach(function (im) {
                   table.push([im.id || '',
                               im.ami || '',
                               im.tool_id,
                               im.name || '',
                               im.virtualization,
                               im.description || '',
                               ((im.active == 'N') ? 'Inactive' : 'Active')]);
                 });
                 console.log(table.toString());
               } else {
                   console.log('No images found');
               }
             }
             mysqlClient.release();
             setTimeout(function(){mysqlPool.end(function(err) {process.exit(exitCode);});}, 1000);
           });
         });
       }
     }

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

if (myshell !== 'node') {
  process.argv.unshift(myshell);
}

//console.log(process.argv);

myname=process.argv[1];
program.parse(process.argv);

//console.log(program);
if (!program.args.length) program.help();

function dbSetup(program) {
  Setup(program);
  var db = nconf.get('database');
  var dbSSLkey = '';
  var dbSSLcert = '';
  var dbSSLca = '';
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
      console.log('Warning: file '+db.sslkey+' is not readable.');
    }
  }
  if ((db.sslcert) && (db.sslcert !== '')) {
    if (nt.isReadableSync(db.sslcert)) {
      dbSSLcert = fs.readFileSync(db.sslcert);
    } else {
      console.log('Warning: file '+db.sslcert+' is not readable.');
    }
  }
  if ((db.sslca) && (db.sslca !== '')) {
    if (nt.isReadableSync(db.sslca)) {
      dbSSLca = fs.readFileSync(db.sslca);
    } else {
      console.log('Warning: file '+db.sslca+' is not readable.');
    }
  }
  if ((dbSSLkey !== '') || (dbSSLcert !== '') || (dbSSLca !== '')) {
    mysqlConfig.ssl = { key: dbSSLkey,
                        cert: dbSSLcert,
                        ca: dbSSLca
                      };
  }

}

function Setup(program) {
  var isPkg = (process.versions.pkg !== undefined);

  var exepath;

  if (isPkg) {
    exepath = process.argv[0];
  } else if ((path.basename(process.argv[0]) === 'node') ) {
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
}

function awsSetup(program) {
  Setup(program);
  var aws = nconf.get('aws');
  var awsParams = {'accessKeyId'     : program.apiKey || nconf.get('aws:ec2:accessKeyId'),
                   'secretAccessKey' : program.apiSecret || nconf.get('aws:ec2:secretAccessKey'),
                   'region'          : program.region || nconf.get('aws:ec2:region') || 'us-east-1'
                  };

  AWS.config.update(awsParams);

  if (program.apiEndpoint) {
    ep = new AWS.Endpoint(program.apiEndpoint);
  } else if ((aws.ec2.endpoint) && (! nt.isEmpty(aws.ec2.endpoint))) {
    var _ep = aws.ec2.endpoint;
    var endpoint;
    if (typeof _ep.url === 'string') {
      endpoint = _ep.url;
    } else {
      var epproto = _ep.protocol || 'http';
      var epport = ((_ep.port == 80) && (epproto == 'http')) ? '' : (((_ep.port == 443) && (epproto == 'https')) ? '' : ':'+_ep.port);
      endpoint = epproto + '://'+ _ep.host + epport+ (_ep.path || '/');
    }

    ep = new AWS.Endpoint(endpoint);
  }
  var EC2Params = {};
  if (ep !== null) {
    EC2Params['endpoint'] =  ep;
  }
  var signver = nconf.get('aws:ec2:endpoint:signatureVersion') || nconf.get('aws:ec2:signatureVersion') || null;
  if (ep !== null) {
    EC2Params['signatureVersion'] = signver;
  }
  ec2 = new AWS.EC2(EC2Params);
}

function listOfInts(val) {
  var ints = [];
  val.split(',').forEach(function(v) {
    if (! isNaN(parseInt(v, 10))) {
      ints.push(parseInt(v, 10));
    }
  });
  return ints;
}

function list(val) {
  return val.split(',');
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
