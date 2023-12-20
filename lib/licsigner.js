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

var crypto = require('crypto');
var url = require('url');

var urlSigner = function urlSigner(key, secret, options){
  options = options || {};
  var endpoint = options.host;
  var protocol = options.protocol || 'http';
  var port = options.port || ((protocol === 'https') ? '443' : '80');

  var hmacSha256 = function (message) {
    return crypto.createHmac('sha256', secret)
                  .update(message)
                  .digest('base64');
  };

  var mkurl = function (verb, args) {
      var portstr = ((port === '') || ((protocol === 'http') && (port === '80')) || ((protocol === 'https') && (port === '443'))) ? '' : ':'+port;
      var theurl = protocol + '://'+ endpoint + portstr;

      theurl += '/'+verb+'?';
      for (var k in args) {
        theurl += k + '=' + ((args[k] !== undefined) ? encodeURIComponent(args[k]) : '') + '&';
      }
      theurl = theurl.replace(/&$/,'');

      return theurl;
  };

  return {
    verifyUrl : function(u){
      var up = url.parse(u);
      var verb = up.pathname.replace(/^\//,'');
      var params = [];
      var q = up.query.split('&');
      for (var i=0; i< q.length; i++) {
        var kv=q[i].match(/^([^=]+)=(.*)/);
        if (kv) {
          //params[kv[1]] = kv[2];
          params[kv[1]] = decodeURIComponent(kv[2]);
        }
      }
      if (params.Expires && params.AccessKey && params.Signature && (params.Expires !== '') && (params.Signature !== '') && (params.AccessKey === key)) {
        var str = '';
        for (var k in params) {
          if ( k !== 'Expires' && k !== 'AccessKey' && k !== 'Signature') {
            str += '\n' + params[k];
          }
        }
        str = params['Expires'] + '\n' + verb + str;
        var hashed = hmacSha256(str);
        if (hashed !== params['Signature']) {
          return false;
        } else {
          var now = new Date();
          var d = new Date(Number(params['Expires'])*1000);
          if (now.valueOf() > d.valueOf()) {
            return false;
          } else {
            return true;
          }
        }
      } else {
        return false;
      }
        
    },
    signUrl : function(verb, args, expiresInMinutes){
      var expires = new Date();

      expires.setMinutes(expires.getMinutes() + expiresInMinutes);

      var epo = Math.floor(expires.getTime()/1000);

      var str = '';
      for (var k in args) {
        str += '\n' + ((args[k] !== undefined) ? args[k] : '');
      }
      str = epo + '\n' + verb + str;

      //var str = epo + '\n' + bucket + '\n' + fname;

      var hashed = hmacSha256(str);

      var urlRet = mkurl(verb, args) +
        '&Expires=' + epo +
        '&AccessKey=' + key +
        '&Signature=' + encodeURIComponent(hashed);

      return urlRet;

    }
  };
};

//var signOptions = {'host' : "localhost", 'protocol' : "http", 'port': 8898 };
//var signOptions2 = {'host' : "", 'protocol' : "http"};
//var u = urlSigner("1234567890", "123abc456d", signOptions).signUrl('download' , {file: "/test/tost.txt", bucket: "asd-1231-qwe21-123"}, 1 );
//result = {'url' : u.replace(/&/g, '&amp;') };
//console.log(result);
//setTimeout(function () { console.log( urlSigner("1234567890", "123abc456d", signOptions).verifyUrl(u)); }, 5000);
//setTimeout(function () { console.log( urlSigner("1234567890", "123abc456d", signOptions2).verifyUrl(u)); }, 7000);
//setTimeout(function () { console.log( urlSigner("0000000000", "123abc456d", signOptions).verifyUrl(u)); }, 11000);
//setTimeout(function () { console.log( urlSigner("1234567890", "123abc456d", signOptions).verifyUrl(u)); }, 61000);

exports.urlSigner = urlSigner;
