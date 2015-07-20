var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;
var nt = require('./tools');

(function () {
  var clouds = {};

  // global on the server, window in the browser
  var root, previous_clouds;

  root = this;
  if (root != null) {
    previous_clouds = root.clouds;
  }

  clouds.noConflict = function () {
    root.clouds = previous_clouds;
    return clouds;
  };

  clouds.cloudDefs = [];

  var required_add_info = {
    'ec2' : ['securitygroup', 'keyname', 'dnspostprocess', 'route53'],
    's3' : ['bucket', 'vendorbucket', 's3forcepathstyle', 'serversideencryption']
  };

  var convertCloudRecord = function convertCloudRecord(inrec) {
    var outrec = {
      id : inrec.id,
      name : inrec.name,
      cloudType : inrec.cloud_type.toLowerCase(),
      name : inrec.name,
      endpoint : (inrec.endpoint) ? inrec.endpoint : '',
      region : ((inrec.region) && (inrec.region.trim() !== '')) ? inrec.region : 'us-east-1',
      accountId : inrec.accountid,
      accessKeyId : inrec.apikey,
      secretAccessKey : inrec.apisecret,
    };         

    switch (inrec.cloud_type.toLowerCase()) {
      case 'ec2' :
        outrec['keyName'] = inrec.additional_info.keyname || '';
        outrec['securityGroup'] = inrec.additional_info.securitygroup || 'default';
        outrec['dnsPostprocess'] = inrec.additional_info.dnspostprocess || 'none';
        if (inrec.additional_info[outrec['dnsPostprocess']]) {
          outrec[outrec['dnsPostprocess']] = (nt.isSafeJSON(inrec.additional_info[outrec['dnsPostprocess']])) ? JSON.parse(inrec.additional_info[outrec['dnsPostprocess']]) : null;
        }
        outrec['route53'] = null;
        if (inrec.additional_info.route53) {
          outrec['route53'] = (nt.isSafeJSON(inrec.additional_info.route53)) ? JSON.parse(inrec.additional_info.route53) : null;
        }
        break;
      case 's3' :
        outrec['bucket'] = inrec.additional_info.bucket;
        outrec['vendorBucket'] = inrec.additional_info.vendorbucket;
        outrec['serverSideEncryption'] = inrec.additional_info.serversideencryption || false;
        outrec['s3ForcePathStyle'] = inrec.additional_info.s3forcepathstyle || true;
        break;
      default:
        break;
    }
    return outrec;
  }

  clouds.length = function length() {
    return clouds.cloudDefs.length;
  }

  clouds.dump = function dump() {
    console.log('--- clouds begin ---');
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      console.log(x, JSON.stringify(clouds.cloudDefs[x]));
    }
    console.log('--- clouds end ---');
  }

  clouds.getDefault = function getDefault(cloudtype) {
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      if (clouds.cloudDefs[x].cloudType === cloudtype.toLowerCase()) {
        return clouds.cloudDefs[x];
      }
    }
    return null;
  }

  clouds.getById = function getById(id) {
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      if (clouds.cloudDefs[x].id == id) {
        return clouds.cloudDefs[x];
      }
    }
    return null;
  }

  //ID NAME CLOUD_TYPE ENDPOINT REGION ACCOUNTID KEYNAME APIKEY APISECRET ACTIVE
  clouds.loadClouds = function loadClouds(mysqlClient, cb) {
    //SELECT * FROM CLOUDS WHERE ACTIVE = 'Y' ORDER BY CLOUD_TYPE;
    clouds.cloudDefs = [];
    var record = {};
    try {
      mysqlClient.query(SQL.clouds, function(err, rows, fields) {
        if (err) {
          console.log('Error from MYSQL query:');
          console.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              switch (fields[j].name) {
                case 'CLOUD_TYPE':
                  record[fields[j].name.toLowerCase()] = rows[i][fields[j].name].toLowerCase();
                  break;
                case 'ADDITIONAL_INFO':
                  record[fields[j].name.toLowerCase()] = {};
                  if ((rows[i][fields[j].name]) && (rows[i][fields[j].name] !== '')) {
                    var infolist = rows[i][fields[j].name].split('&');
                    for (var il = 0; il < infolist.length; il++) {
                      var m = infolist[il].match(/([^=]*)=(.*)/);
                      var v = m[2];
                      if (v.toLowerCase() === 'true') {
                       v = true;
                      } else if (v.toLowerCase() === 'false') {
                       v = false;
                      }
                      record[fields[j].name.toLowerCase()][m[1].trim().toLowerCase()] = v;
                    }
                  }
                  break;
                default:
                  record[fields[j].name.toLowerCase()] = rows[i][fields[j].name];
                  break;
              }
            }
            var reqparams;
            var missingParams='';
            var isok = 0;
            if ((record['cloud_type'].toLowerCase() === 'ec2') || (record['cloud_type'].toLowerCase() === 's3')) {
              reqparams = required_add_info[record['cloud_type'].toLowerCase()];
              for (var r = 0; r < reqparams.length; r++) {
                if (record['additional_info'][reqparams[r]] !== undefined) {
                  isok++;
                } else {
                  missingParams = ((missingParams=='') ? '' : ', ') + reqparams[r];
                }
              }
              if (isok < reqparams.length) {
                console.log('Error : Missing required params "'+missingParams+'" in additional info'); // FIXME
              }
            } else {
              console.log('Error : unknown cloud type :' + record['cloud_type']); // FIXME
            }
            var crec = convertCloudRecord(record);

            clouds.cloudDefs.push(crec);
          }
        }
        cb(null, 'Clouds loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load clouds FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  }

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = clouds;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return clouds;
    });
  }
  // included directly via <script> tag
  else {
    root.clouds = clouds;
  }
}());
