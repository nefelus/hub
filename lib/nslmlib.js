var util = require('util');
var fs = require('fs');
var path = require('path');
var url = require('url');
var request = require('request');
var Hawk = require('hawk');
var licSigner = require('./licsigner');
var EventEmitter = require('events').EventEmitter;

var license = function license(options) {

  var self = this;
  this.active = null;

  this.sessionInfo = { authMethod : 'hawk',
                       licenseServer : (options && options.licenseServer) ? options.licenseServer : 'http://127.0.0.1/',
                       accessKey : (options && options.accessKey) ? options.accessKey : '',
                       secretKey : (options && options.secretKey) ? options.secretKey : '',
                       feature : (options && options.feature) ? options.feature : '',
                       sessionId : null,
                       auto : false,
                       refreshTimer: null,
                       refreshInterval : 0
                     };

  this.sessionFilesPath = (options && options.sessionFilesPath) ? options.sessionFilesPath : '/tmp';
  this.restartTimer = null;
  this.restartTimeout = 5000; // 5 seconds

  this.isActive = function isActive() {
    return self.active;
  }

  this.set = function set(key, val) {
    self.sessionInfo[key] = val;
  }

  this.get = function get(key) {
    return self.sessionInfo[key];
  }

  this.start = function start() {
    self.sessionInfo.auto = true;
    self.checkout();
  }

  this.end = function end(cb) {
    if (self.sessionInfo.refreshTimer !== null) {
      clearInterval(self.sessionInfo.refreshTimer);
      self.sessionInfo.refreshTimer = null;
    }
    self.sessionInfo.auto = false;
    self.checkin(function(err, data) {
      if (cb) {
        cb(err, data);
      }
    });
  }

  this.loadFromFile = function loadFromFile() {
    var fname = path.join(self.sessionFilesPath, 'ses_'+self.sessionInfo.accessKey+'_'+self.sessionInfo.feature+'.dat');
    //console.log('loading from file', fname);
    try {
      var s = fs.readFileSync(fname, {encoding: 'utf-8'});
      //console.log(s);
      return s;
    } catch (e) {
      return '';
    }
  }

  this.saveToFile = function saveToFile(sessionId) {
    var fname = path.join(self.sessionFilesPath, 'ses_'+self.sessionInfo.accessKey+'_'+self.sessionInfo.feature+'.dat');
    //console.log('saving to file',fname, ' ', sessionId);
      fs.writeFile(fname, sessionId, function (err) {
        if (err) {
          console.log('Error writing to license session file');
          console.log(util.inspect(err, {depth: null}));
        }
      });
  }

  this.checkout = function checkout(cb) {
    if (! cb) {
      cb = function(){};
    }

    var _self = self;
    if (self.active === null) {
      var oldSessionId = self.loadFromFile();
      if (oldSessionId !== '') {
        self.sessionInfo.sessionId = oldSessionId;
        self.checkin(function(err, data) {
          _self.checkout(cb);
        });
        return;
      }
    }

    if (self.sessionInfo.sessionId !== null) {
      self.checkin(function(err, data) {
        _self.checkout(cb);
      });
      return;
    }

    var preparedRequest = self.prepareRequest('checkout', {feature: self.sessionInfo.feature}, self.sessionInfo);
    //console.log(preparedRequest.options);
    request(preparedRequest.options, function(error, response, body) {
      if (error) {
        if (error.code == 'ECONNREFUSED') {
          console.log('Error: ECONNREFUSED : Connection to license server refused.');
        } else {
          console.log('ERROR', util.inspect(error));
        }
        _self.active && _self.emit('inactive');
        _self.active = false;
        if (_self.sessionInfo.auto) {
          _self.restartTimer = setTimeout(function() {_self.checkout(cb);}, _self.restartTimeout);
        } else {
          cb(error, false);
        }
      } else {
        //console.log('headers : '+util.inspect(response.headers, {depth:null}));
        var isValid = Hawk.client.authenticate(response, preparedRequest.credentials, preparedRequest.header.artifacts, { payload: body , required:false});

        //console.log(response.statusCode + ': ' + ((isValid === true) ? '(valid)' : '(invalid)'));
        //console.log(body);
        if ((isValid) && (response.statusCode == 200)) {
          try {
            var x  = JSON.parse(body);
            _self.sessionInfo.sessionId = x.sessionId;
            _self.saveToFile(x.sessionId);
            _self.sessionInfo.refreshInterval = x.refreshInterval;
            (! _self.active) && _self.emit('active');
            _self.active = true;
            _self.sessionInfo.refreshTimer = setInterval(function(){_self.refresh();}, _self.sessionInfo.refreshInterval);
            cb(null, true);
          } catch (e) {
            _self.saveToFile('');
            _self.active && _self.emit('inactive');
            _self.active = false;
            if (_self.sessionInfo.auto) {
              _self.restartTimer = setTimeout(function() {_self.checkout(cb);}, _self.restartTimeout);
            } else {
              cb(error, false);
            }
          }
        } else {
          console.log('not authenticated');
          _self.saveToFile('');
          _self.active && _self.emit('inactive');
          _self.active = false;
          if (_self.sessionInfo.auto) {
            _self.restartTimer = setTimeout(function() {_self.checkout(cb);}, _self.restartTimeout);
          } else {
            cb(null, false);
          }
        }
      }
    });
  }

  this.refresh = function refresh(cb) {
    if (! cb) {
      cb = function(){};
    }

    var preparedRequest = self.prepareRequest('refresh', {sessionId : self.sessionInfo.sessionId, feature: self.sessionInfo.feature}, self.sessionInfo);
    //console.log(preparedRequest.options);
    var _self = self;
    request(preparedRequest.options, function(error, response, body) {
      if (error) {
        _self.active && _self.emit('inactive');
        self.active = false;
        if (error.code == 'ECONNREFUSED') {
          console.log('Error: ECONNREFUSED : Connection to license server refused.');
        } else {
          console.log('ERROR', util.inspect(error));
        }
        cb(error, false);
      } else {
        //console.log('Response time : '+response.headers['x-response-time']);
        var isValid = Hawk.client.authenticate(response, preparedRequest.credentials, preparedRequest.header.artifacts, { payload: body , required:false});

        //console.log(response.statusCode + ': ' + ((isValid === true) ? '(valid)' : '(invalid)'));
        //console.log(body);

        if ((isValid) && (response.statusCode == 200)) {
          (! _self.active) && _self.emit('active');
          _self.active = true;
          cb(null, true);
        } else {
          console.log('not authenticated');
          _self.active && _self.emit('inactive');
          _self.active = false;
          if (_self.sessionInfo.auto) {
            _self.restartTimer = setTimeout(function() {_self.checkout(cb);}, _self.restartTimeout);
          } else {
            cb(null, false);
          }
        }
      }
    });
  }

  this.checkin = function checkin(cb) {
    if (! cb) {
      cb = function(){};
    }

    var fname = path.join(self.sessionFilesPath, 'ses_'+self.sessionInfo.accessKey+'_'+self.sessionInfo.feature+'.dat');
    try {
      fs.unlinkSync(fname);
    } catch (e) {}

    var preparedRequest = self.prepareRequest('checkin', {sessionId : self.sessionInfo.sessionId, feature: self.sessionInfo.feature}, self.sessionInfo);
    //console.log(preparedRequest.options);
    var _self = self;
    request(preparedRequest.options, function(error, response, body) {
      if (error) {
        if (error.code == 'ECONNREFUSED') {
          console.log('Error: ECONNREFUSED : Connection to license server refused.');
        } else {
          console.log('ERROR', util.inspect(error));
        }
        _self.active && _self.emit('inactive');
        _self.active = false;
        cb(error, false);
      } else {
        var isValid = isValid = Hawk.client.authenticate(response, preparedRequest.credentials, preparedRequest.header.artifacts, { payload: body , required:false});
  
        //console.log(response.statusCode + ': ' + ((isValid === true) ? '(valid)' : '(invalid)'));
        //console.log(body);
        _self.active && _self.emit('inactive');
        _self.active = false;
        _self.sessionInfo.sessionId = null;
        if (_self.sessionInfo.refreshTimer !== null) {
          clearInterval(_self.sessionInfo.refreshTimer);
        }
        _self.sessionInfo.refreshTimer = null;
        _self.sessionInfo.refreshInterval = 0;
        if ((isValid) && (response.statusCode == 200)) {
          cb(null, true);
        } else {
          console.log('not authenticated but never mind');
          cb(null, false);
        }
      }
    });
  }

  this.prepareRequest = function prepareRequest(verb, args, authInfo) {
    var result = {
                   options : null,
                   credentials : null,
                   header : null
                 };
    var options = { url : '',
                    method : 'GET',
                    headers: {}
                  };
    options.url = this.sessionInfo.licenseServer.replace(/\/*$/,'')+'/'+verb+'?';

    var u = url.parse(this.sessionInfo.licenseServer);
    if (u.protocol === 'https:') {
      options['strictSSL'] = false;
    }

    if ((authInfo === false) || (authInfo === undefined) || (authInfo === null) || (! authInfo.authMethod))  {
      for (var k in args) {
        options.url += k + '=' + ((args[k] !== undefined) ? encodeURIComponent(args[k]) : '') + '&';
      }
    } else {
      switch (authInfo.authMethod) {
        case 'private' :
          var signOptions = { protocol : u.protocol.replace(/:/,''),
                              host : u.hostname
                            };
          if (u.port) {
            signOptions.port = String(u.port);
          }
          var licSignit = licSigner.urlSigner(authInfo.accessKey, authInfo.secretKey, signOptions);
          options.url = licSignit.signUrl(verb, args, authInfo.expiresInMinutes);
          options.url = options.url.replace(/&$/,'');
          result.credentials = {
                                 id : authInfo.accessKey,
                                 key : authInfo.secretKey
                               };
  
          break;
  
        case 'hawk' :
          for (var k in args) {
            options.url += k + '=' + ((args[k] !== undefined) ? encodeURIComponent(args[k]) : '') + '&';
          }
          options.url = options.url.replace(/&$/,'');
          
          var hawkCredentials = {
                                 id : authInfo.accessKey,
                                 key : authInfo.secretKey,
                                 algorithm : "sha256"
                                };
          var header = Hawk.client.header(options.url, options.method, { credentials: hawkCredentials});
          options.headers.Authorization = header.field;
  
          result.header = header;
          result.credentials = hawkCredentials;
  
          break;
  
        default :
          break;
      }
    }

    result.options = options;
    return result; 
  }

  if (this.sessionInfo.auto === true) {
    this.checkout();
  }

  this.on('newListener', function(listener) {
    console.log('Event Listener: ' + listener);
  });

}

// extend the EventEmitter class using license class
util.inherits(license, EventEmitter);

// we specify that this module is a refrence to the license class
module.exports = license;
