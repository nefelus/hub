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

var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;
var nt = require('./tools');
var toml = require('toml');
var Joi = require('joi');
var _ = require('lodash');
var AWS= require('aws-sdk');

function mkAWSinstance(type, params) {
  var aws = {};
  var AWSConfig = new AWS.Config(); // eslint-disable-line no-unused-vars
  var awsParams = {
    'accessKeyId' : params.accessKeyId,
    'secretAccessKey' : params.secretAccessKey,
    'region' : params.region || 'us-east-1'
  };
  var endpoint;
  var ep;
  var _ep;

  AWS.config.update(awsParams);

  switch (type) {
    case 'ec2':
      var EC2Params = {};
      if (params.endpoint &&  (! nt.isEmpty(params.endpoint))) {
        endpoint='';
        _ep = params.endpoint;
        if (typeof _ep === 'string') {
          endpoint = _ep;
        } else {
          if (typeof _ep.url === 'string') {
            endpoint = _ep.url;
          }
        }

        ep = new AWS.Endpoint(endpoint);

        if (ep !== null) {
          EC2Params['endpoint'] =  ep;
        }

        var signver = params.endpoint.signatureVersion || params.signatureVersion || null;
        if (signver !== null) {
          EC2Params['signatureVersion'] = signver;
        }
      }
      aws.ec2 = new AWS.EC2(EC2Params);

      if (nt.isEmpty(params.route53)) {
        aws.r53info = null;
        aws.r53 = null;
      } else {
        aws.r53info = _.cloneDeep(params.route53);
        var r53awsParams = {
          'accessKeyId' : params.route53.accessKeyId || params.accessKeyId,
          'secretAccessKey' : params.route53.secretAccessKey || params.secretAccessKey
        };
        aws.r53info.accessKeyId = aws.r53info.accessKeyId || params.accessKeyId;
        aws.r53info.secretAccessKey = aws.r53info.secretAccessKey || params.secretAccessKey;
        AWS.config.update(r53awsParams);
        aws.r53 = new AWS.Route53();
      }

      break;
    case 's3':
      var S3Params = {
        s3ForcePathStyle : params.s3ForcePathStyle
      };
      if (params.endpoint &&  (! nt.isEmpty(params.endpoint))) {
        endpoint='';
        _ep = params.endpoint;
        if (typeof _ep === 'string') {
          endpoint = _ep;
        } else {
          if (typeof _ep.url === 'string') {
            endpoint = _ep.url;
          }
        }

        ep = new AWS.Endpoint(endpoint);

        if (ep !== null) {
          S3Params['endpoint'] =  ep;
        }

      }
      aws.s3 = new AWS.S3(S3Params);
      break;
    default:
      aws[type] = null;
      break;
  }
  return aws;
}


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
  clouds.s3 = null;
  clouds.primary = null;

  var Schemas = { ec2: Joi.object().keys({
                       accessKeyId: Joi.string().required(),
                       secretAccessKey: Joi.string().required(),
                       accountId: Joi.string().optional().allow(null),
                       region: Joi.string().required(),
                       zone: Joi.string().required(),
                       hasAutoAssignFloatingIp: Joi.boolean().truthy(['yes', 'y', '1']).falsy(['no', 'n', '0']).insensitive(true).default(true, ''),
                       keyName: Joi.string().optional().allow(null),
                       securityGroup: Joi.string().required().default('default', ''),
                       SubnetId: Joi.string().optional().allow(null),
                       endpoint: Joi.object().keys({
                         url: Joi.string().uri().required(),
                         signatureVersion: Joi.string().optional().allow(null).default(null, ''),
                       }).optional(),
                       dnsPostprocess: Joi.string().required().valid(['none', 'route53', 'dnstransform']),

                       dnstransform: Joi.when('dnsPostprocess', { is: 'dnstransform', then: Joi.object().keys({
                           matches:  Joi.array().items(Joi.string()).required(),
                           values:  Joi.array().items(Joi.string()).required(),
                           domainName: Joi.string().required()
                         })
                       }),
                       route53: Joi.when('dnsPostprocess', { is: 'route53', then: Joi.object().keys({
                           accessKeyId: Joi.string().optional(),
                           secretAccessKey: Joi.string().optional(),
                           accountId: Joi.string().optional().allow(null),
                           hostedZone: Joi.string().required(),
                           providerDomainName: Joi.string().required(),
                           domainName: Joi.string().required()
                         })
                       })
                     }),
                 s3: Joi.object().keys({
                       accessKeyId: Joi.string().required(),
                       secretAccessKey: Joi.string().required(),
                       accountId: Joi.string().optional().allow(null),
                       region: Joi.string().required(),
                       bucket: Joi.string().lowercase().min(3).max(64).trim().regex(/_/, {name: 'Bucket names should not contain underscores', invert:true})
                               .regex(/-$/,{name: 'Bucket names should not end with a dash', invert:true})
                               .regex(/\./, {name: 'Bucket names cannot contain periods', invert: true})
                               .required(),
                       vendorBucket: Joi.string().lowercase().min(3).max(64).trim().regex(/_/, {name: 'Bucket names should not contain underscores', invert:true})
                               .regex(/-$/,{name: 'Bucket names should not end with a dash', invert:true})
                               .regex(/\./, {name: 'Bucket names cannot contain periods', invert: true})
                               .required(),
                       s3ForcePathStyle: Joi.boolean().truthy(['yes', 'y', '1']).falsy(['no', 'n', '0']).insensitive(true).default(true, ''),
                       serverSideEncryption: Joi.boolean().truthy(['yes', 'y', '1']).falsy(['no', 'n', '0']).insensitive(true).default(false, ''),
                       expiresInMinutes: Joi.number().integer().min(1).default(5, '').required(),
                       uploadMethod: Joi.string().required().valid(['post', 'other']).default('post', ''),
                       endpoint: Joi.object().keys({
                         url: Joi.string().uri().required(),
                       }).optional(),
                     }),
                 bm: Joi.object().keys({
                     }).optional()
              };


  clouds.length = function length() {
    return clouds.cloudDefs.length;
  };

  clouds.dump = function dump() {
    console.log('--- clouds begin ---');
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      console.log(x, JSON.stringify(clouds.cloudDefs[x]));
    }
    console.log('--- clouds end ---');
  };

  clouds.getDefault = function getDefault(cloudtype) {
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      if (clouds.cloudDefs[x].cloud_type === cloudtype.toLowerCase()) {
        return clouds.cloudDefs[x];
      }
    }
    return null;
  };

  clouds.getPrimary = function getPrimary() {
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      if ((clouds.cloudDefs[x].cloud_type === 'ec2') && (clouds.cloudDefs[x].is_primary === 'Y')) {
        return clouds.cloudDefs[x];
      }
    }
    return null;
  };

  clouds.getById = function getById(id) {
    for (var x = 0; x < clouds.cloudDefs.length; x++) {
      if (clouds.cloudDefs[x].id == id) {
        return clouds.cloudDefs[x];
      }
    }
    return null;
  };

  clouds.loadClouds = function loadClouds(mysqlClient, cb) {
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
                  record[fields[j].name.toLowerCase()] = rows[i][fields[j].name] || '';
                  break;
                default:
                  record[fields[j].name.toLowerCase()] = rows[i][fields[j].name];
                  break;
              }
            }
            try {
              record.additional_info = toml.parse(record.additional_info);
              if (record.apikey) {
                record.additional_info.accessKeyId = record.apikey;
              }
              if (record.apisecret) {
                record.additional_info.secretAccessKey = record.apisecret;
              }
              if (record.accountid) {
                record.additional_info.accountId = record.accountid;
              }
            } catch (e) {
              console.log('Load clouds: ERROR parsing toml spec:' + util.inspect(e, null));
              record.additional_info = {};
            }
            var joiresult;
            var aws;

            if ('ec2,s3,bm'.indexOf(record.cloud_type.toLowerCase()) != -1) {

              joiresult = Joi.validate(record.additional_info, Schemas[record.cloud_type.toLowerCase()], {abortEarly: false});

              if (joiresult.error && joiresult.error.isJoi) {
                var em = [];
                joiresult.error.details.forEach(function(m) {
                  em.push(m.message);
                });
                logger.log('Error : '+ record.name+' ('+record.cloud_type+') Invalid params in additional info definition');
                logger.log(joiresult.error.name+': '+em.join(', '));
                record[record.cloud_type.toLowerCase()] = null;
              } else {
                record[record.cloud_type.toLowerCase()+'info'] = joiresult.value;
                aws = mkAWSinstance(record.cloud_type.toLowerCase(), record[record.cloud_type.toLowerCase()+'info']);
                record[record.cloud_type.toLowerCase()] = aws[record.cloud_type.toLowerCase()];
                if (record.cloud_type.toLowerCase() === 'ec2') {
                  record.r53 = aws.r53;
                  record.r53info = aws.r53info;
                }
              }
              delete record.additional_info;
              clouds.cloudDefs.push(record);
            } else {
              logger.log('Error : unknown cloud type :' + record.cloud_type);
            }
          }
        }
        cb(null, clouds.cloudDefs.length+' clouds loaded');
      });
    } catch (ex) {
      console.log( util.inspect(ex, null));
      cb('Load clouds FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  };

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
