//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var DNS_MAX_TRIES = 6;
var DNS_TIMEOUT = 10000;
var async = require('async');
var dns = require('dns');

function getDomain(name) {
  return name.replace(/[^.]*/, '').replace(/^\./, '');
}

var dnsResolve = function dnsResolve(ip, domain, cb) {
  var name = ip;

  dns.reverse(ip, function (err, domains) {
    if (err) {
      cb(err, null);
    } else {
      domains.forEach(function(d) {
        if (getDomain(d) === domain) {
          name = d;
        }
      });
      cb(null, name);
    }
  });
};

var dnsNone = function dnsNone(ip, cb) {

  if (cb && typeof cb === 'function') {
    cb(null, ip);
  } else {
    return ip;
  }
};

var dnsMap = function dnsMap(ip, map, cb) {
  var name = ip;
  if (map[ip]) {
    name = map[ip];
  }
  if (cb && typeof cb === 'function') {
    cb(null, name);
  } else {
    return name;
  }
};

var dnsTransform = function dnsTransform(ip, config, cb) {
  var i;
  var name = ip;
  if (config.matches && config.values && config.matches.length === config.values.length) {
    var l = config.matches.length;
    for (i = 0; i < l; i++) {

      var m = config.matches[i].match(/.*\/([i|g|m]*)$/);
      var pattern;
      var modifier;
      if (m) {
        modifier = m[1];
        pattern = config.matches[i].substr(0, config.matches[i].length - modifier.length);
      } else {
        modifier = '';
        pattern = config.matches[i];
      }
      pattern = pattern.replace(/^\//, '').replace(/\/$/, '');

      var r = new RegExp(pattern, modifier);
      name = name.replace(r , config.values[i]);
    }
    name = name + config.domainName;
  }

  if (cb && typeof cb === 'function') {
    cb(null, name);
  } else {
    return name;
  }
};

function publicToNefelusDNSName(info, publicDNS) {

  if (publicDNS !== '') {
    if (info.providerDomainName === publicDNS.substr(-(info.providerDomainName.length))) {
      return publicDNS.substr(0,publicDNS.length-info.providerDomainName.length).replace(/\./g,'-')+info.domainName;
    }
  }
  return '';
}

var createCNAME = function createCNAME(r53, info, publicDNS, cb) {
  if (info != null) {
    var nefelusDNS = publicToNefelusDNSName(info, publicDNS);
    if (nefelusDNS !== '') {
      var args = {
                   HostedZoneId : info.hostedZone,
                   ChangeBatch: { 
                     Changes : [
                       {
                         Action : 'CREATE',
                         ResourceRecordSet : {
                           Name : nefelusDNS,
                           Type : 'CNAME',
                           TTL : '300',
                           ResourceRecords : [
                             { Value : publicDNS }
                           ]
                         }
                       }
                     ]
                   }
                 };

      var triescount = 0;
      var ready = false;
      var errormsg = '';

      async.whilst(
        function () { return ((ready === false) && (triescount < DNS_MAX_TRIES)); },
        function (callback) {
          triescount++;
          r53.changeResourceRecordSets(args, function(err, data) {
            if ( err ) {
              if (typeof err.message !== 'undefined') {
                errormsg = 'Error ('+err.code+'): '+err.message;
              } else {
                errormsg = 'Error while creating Route53 record for '+publicDNS;
              }
              setTimeout(function() { callback(null); }, DNS_TIMEOUT);
            } else {
              ready = true;
              callback(null);
            }
          });
        },
        function (err) {
          if (ready) {
            cb(null, nefelusDNS);
          } else {
            if (errormsg === '') {
              errormsg = 'Call to Route53 service failed';
            } 
            cb(errormsg, null);
          }
        }
      );

    } else {
      cb('Could not map publicDNS name to NefelusDNS name', null);
    }
  } else {
    cb('Could not map publicDNS name to NefelusDNS name', null);
  }
};

var deleteCNAME = function deleteCNAME(r53, info, nefelusDNS, publicDNS, cb) {
  if ((info != null ) && (nefelusDNS !== '')) {
    var args = {
                 HostedZoneId : info.hostedZone,
                 ChangeBatch: { 
                   Changes : [
                     {       
                       Action : 'DELETE',
                       ResourceRecordSet : {
                         Name : nefelusDNS,          
                         Type : 'CNAME',             
                         TTL : '300',                
                         ResourceRecords : [         
                           { Value : publicDNS }             
                         ]                           
                       }       
                     }       
                   ]
                 }
               };

    var triescount = 0;
    var ready = false;
    var errormsg = '';

    async.whilst(
      function () { return ((ready === false) && (triescount < DNS_MAX_TRIES)); },
      function (callback) {
        triescount++;
        r53.changeResourceRecordSets(args, function(err, data) {
          if ( err ) {
            if (typeof err.message !== 'undefined') {
              errormsg = 'Error ('+err.code+'): '+err.message;
            } else {
              errormsg = 'Error while deleting Route53 record for '+publicDNS;
            }
            setTimeout(function() { callback(null); }, DNS_TIMEOUT);
          } else {
            ready = true;
            callback(null);
          }
        });
      },
      function (err) {
        if (ready) {
          cb(null, '');
        } else {
          if (errormsg === '') {
            errormsg = 'Call to Route53 service failed';
          } 
          cb(errormsg, null);
        }
      }
    );

  } else {
    cb('There should be no Route53 mapping for publicDNS :'+publicDNS, null);
  }
};

exports.createCNAME = createCNAME;
exports.deleteCNAME = deleteCNAME;
exports.dnsNone = dnsNone;
exports.dnsMap = dnsMap;
exports.dnsResolve = dnsResolve;
exports.dnsTransform = dnsTransform;
