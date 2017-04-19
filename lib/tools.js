var exec = require('child_process').exec;
var fs = require('fs');
var http = require('http');
var util = require('util');
var crypto = require('crypto');
var request = require('request');

var nt = module.exports = {};

nt.createToolPath = function createToolPath(tid) {
  var stuffed = tid;
  if ((installationId !== undefined) && (installationId !== null) && (installationId !== '')) {
    stuffed += installationId;
  }
  var hash = crypto.createHash('sha1').update('t-'+stuffed).digest('hex');
  return 't-tools/t-'+tid+'-'+hash.substr(0,8)+'/';
}

nt.createCompanyPath = function createCompanyPath(eid, installationId) {
  var stuffed = eid;
  if ((installationId !== undefined) && (installationId !== null) && (installationId !== '')) {
    stuffed += installationId;
  }
  var hash = crypto.createHash('sha1').update('e-'+stuffed).digest('hex');
  return 'e-'+eid+'-'+hash.substr(0,8)+'/';
}

nt.createUserPath = function createUserPath(eid, uid, installationId) {
  var cpath=nt.createCompanyPath(eid, installationId);
  var stuffed = uid;
  if ((installationId !== undefined) && (installationId !== null) && (installationId !== '')) {
    stuffed += installationId;
  }
  var hash = crypto.createHash('sha1').update('u-'+stuffed).digest('hex');
  return cpath+'users/u-'+uid+'-'+hash.substr(0,8)+'/';
}

nt.createProjectPath = function createProjectPath(eid, pid, installationId) {
  var cpath=nt.createCompanyPath(eid, installationId);
  var stuffed = pid;
  if ((installationId !== undefined) && (installationId !== null) && (installationId !== '')) {
    stuffed += installationId;
  }
  var hash = crypto.createHash('sha1').update('p-'+stuffed).digest('hex');
  return cpath+'projects/p-'+pid+'-'+hash.substr(0,8)+'/';
}

nt.createUserHome = function createUserHome(eid, uid, installationId) {
  var cpath=nt.createUserPath(eid, uid, installationId);
  return cpath+'Home/';
}

nt.createUserHomeFromSessionId = function createUserHomeFromSessionId(sessionId, installationId) {
  var sid;
  if (typeof sessionId === 'string') {
    sid = nt.parseSessionId(sessionId);
  } else {
    sid = sessionId;
  }
  var cpath=nt.createUserPath(sid.companyId, sid.clientId, installationId);
  return cpath+'Home'; // The slash at the end is not added intentionaly
}

nt.createProjectUserPath = function createProjectUserPath(cid, pid, uid, installationId) {
  var cpath=nt.createProjectPath(cid, pid, installationId);
  var stuffed = uid;
  if ((installationId !== undefined) && (installationId !== null) && (installationId !== '')) {
    stuffed += installationId;
  }
  var hash = crypto.createHash('sha1').update('u-'+stuffed).digest('hex');
  return cpath+'users/u-'+uid+'-'+hash.substr(0,8)+'/';
}

nt.createSessionPath = function createSessionPath(sessionId, installationId) {
  var sid;
  var ssid;
  if (typeof sessionId === 'string') {
    sid = nt.parseSessionId(sessionId);
  } else {
    sid = sessionId;
  }
  ssid = sid.companyId+'_'+sid.clientId+'_'+sid.projectId+'_'+sid.toolId+'_'+sid.taskId;
  var cpath=nt.createProjectUserPath(sid.companyId, sid.projectId, sid.clientId, installationId);
  return cpath+'Sessions/'+ssid+'/';
}

nt.checkSessionId = function checkSessionId(sid) {
  if (typeof sid === 'string') {
    var a = sid.split('_');
    if (a.length < 5) {
      return false;
    } else {
      return true;
    }
  } else if (Object.prototype.toString.call(sid) === '[object Array]') {
    if (sid.length < 5) {
      return false;
    } else {
      return true;
    }
  } else {
      return false;
  }
}

nt.parseSessionId = function parseSessionId(sid) {
  var a, l;
  if (typeof sid === 'string') {
    a = sid.split('_');
    l = a.length;
    if (l < 5) {
      for (var i = 4; i >= l; i--) {
        a[i] = '0';
      }
    }
  } else {
    a = ['0', '0', '0', '0', '0'];
  }

  return { 'companyId' : a.shift(),
           'clientId' : a.shift(),
           'projectId' : a.shift(),
           'toolId' : a.shift(),
           'taskId' : a.shift(),
           'params' : a.join('_')
         };
}

nt.isSetSessionParam = function isSetSessionParam(sid, p) {
  var sSid = nt.parseSessionId(sid);
  var params = '_'+sSid.params.toLowerCase()+'_';
  return ((params.indexOf('_'+p.toLowerCase()+'_') !== -1) ? true : false);
}

nt.traverse = function traverse(startDir, files, dirs) {
  try {
    var a = fs.readdirSync(startDir);

    a.forEach(function(f) {  // forEach is synchronous
      var ff = startDir + '/' + f;
      var s = fs.lstatSync(ff);

      if (s.isDirectory()) {
        if (typeof dirs != 'undefined') {
          dirs.push({'name' : ff});
        }
        nt.traverse(ff, files, dirs);
      } else {
        if ((typeof files != 'undefined') && (s.isFile())) {
          files.push({'name' : ff, 'size':s.size});
        }
      }
    });
  } catch (e) {};
}

nt.filterChangedFiles = function filterChangedFiles(previous, current) {
  previous.forEach(function(f, i) { // forEach is synchronous
    var found = -1;
    for (var rf = current.length - 1; rf >= 0; rf--) {
      if (current[rf].name == f.name) {
        if ((typeof current[rf]['etag'] !== 'undefined') && (typeof f['etag'] !== 'undefined')) {
          if (current[rf].etag == f.etag) {
            found = rf;
            break;
          }
        } else if ((typeof current[rf]['size'] !== 'undefined') && (typeof f['size'] !== 'undefined')) {
          if (current[rf].size == f.size) {
            found = rf;
            break;
          }
        }
      }
/*
      if ((current[rf].name == f.name) && (current[rf].size == f.size)) {   // FIXME: Should check with etag not with size.
        found = rf;
        break;
      }
*/
    }
    if (found > -1) {
      current.splice(found, 1);
    }
  });
}

nt.fsexistsSync = function fsexistsSync(file) {
  if (fs.accessSync) {
    try {
      fs.accessSync(file, fs.R_OK);
      return true;
    } catch (e) {
      return false;
    }
  } else {
    return (fs.existsSync(file));
  }
}

nt.isReadableSync = function isReadableSync(filename) {
  if (nt.fsexistsSync(filename)) {
    try {
      var fd = fs.openSync(filename, 'r');
      fs.closeSync(fd);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

// should npm install dateformat
// var dateformat = require('dateformat');
nt.getDateTimeNow_alt = function getDateTimeNow_alt(withDelim, twelve) {

  var d = new Date();
  var template = 'yyyymmddHHMMss';

  if (withDelim === true) {
    if (twelve === true) {
      template = 'yyyy/mm/dd hh:MM:ss TT';
    } else {
      template = 'yyyy/mm/dd HH:MM:ss';
    }
  }

  return (dateformat(d, template));
}

nt.getDateTimeNow = function getDateTimeNow(withDelim, twelve) {
  var d = new Date();
  var dd = '', dt = '', dm = '';
  var mo, da;
  var h, m, s, t = '';
  mo = d.getMonth() + 1;
  da = d.getDate();
  m = d.getMinutes();
  s = d.getSeconds();
  h = d.getHours();
  if (withDelim === true) {
    dd = '/';
    dt = ':';
    dm = ' ';
    if (twelve === true) {
      if (d.getHours() < 12) {
        h = d.getHours();
        t = ' AM';
      } else {
        h = d.getHours() - 12;
        if (h == 0) {
          h = 12;
        }
        t = ' PM';
      }
    }
  }
  mo = mo < 10 ? '0' + mo : mo;
  da = da < 10 ? '0' + da : da;
  h = h < 10 ? '0' + h : h;
  m = m < 10 ? '0' + m : m;
  s = s < 10 ? '0' + s : s;
  return r = d.getFullYear().toString() + dd + mo + dd + da + dm + h + dt + m + dt + s + t;
  //return r = mo + dd + da + dd + d.getFullYear().toString() + dm + h + dt + m + dt + s + t;
}

nt.getMyInstanceId_new = function getMyInstanceId_new(imd, callback, tries) {
  var MAX_TRIES = 30;
  var RETRY_TIMEOUT = 6000;

  if (tries === undefined) {
    tries = MAX_TRIES;
  }

  //var Imd = require('awssum-amazon-imd').Imd;
  //var imd = new Imd({});
  imd.Get({'Category' : '/meta-data/instance-id/', 'Version' : 'latest'}, function (err, data) {
    if (err) {
      tries--;
      if (tries > 0) {
        setTimeout(nt.getMyInstanceId_new(imd, callback, tries), RETRY_TIMEOUT);
      } else {
        callback('Could not get Instance ID', null);
      }
    } else {
      callback(null, data);
    }
  });
}

nt.getMyInstanceId = function getMyInstanceId(callback, tries) {
  var MAX_TRIES = 10;
  var RETRY_TIMEOUT = 6000;
  var myInstanceId = '';

  var options = {
        host: '169.254.169.254',
        port: 80,
        path: '/latest/meta-data/instance-id'
  };

  if (tries === undefined) {
    tries = 1;
  }

  http.get(options, function(res) {
    var data = '';
    res.on('data', function (chunk) {
      data += chunk;
    }).on('end', function () {
      if (res.statusCode == 200) {
        myInstanceId = data;
        callback(null, myInstanceId);
      } else {
        myInstanceId = '';
        if (tries <= MAX_TRIES) {
          tries++;
          setTimeout(nt.getMyInstanceId(callback, tries), RETRY_TIMEOUT);
        } else {
          callback('Could not get Instance ID', null);
        }
      }
    });
  }).on('error', function(e) {
    if (tries <= MAX_TRIES) {
      tries++;
      setTimeout(nt.getMyInstanceId(callback, tries), RETRY_TIMEOUT);
    } else {
      callback('Could not get Instance ID', null);
    }
  });
}

nt.parseUserData = function parseUserData(s) {
  var arr = s.split('\n');
  var key = '';
  var value = '';
  var res = {};
  l = arr.length;
  for (var j = l - 1; j >= 0; j--) {
    if (arr[j] === '') {
      l = l - 1;
    } else {
      break;
    }
  }
  for (var i = 0; i < l; i++) {
    if (arr[i].substr(0, 2) === '#%') {
      key = arr[i].substr(2);
      var pos = key.indexOf(':');
      if (pos > -1) {
        value = key.substr(pos + 1);
        key = key.substr(0, pos);
      } else {
        value = '';
      }
      res[key] = value;
    } else {
      res[key] = res[key] + ((res[key] !== '') ? '\n' : '') + arr[i];
    }
  }
  return res;
}

nt.getMyUserData_new = function getMyUserData_new(imd, callback, tries) {
  var MAX_TRIES = 30;
  var RETRY_TIMEOUT = 6000;

  if (tries === undefined) {
    tries = MAX_TRIES;
  }

  //var Imd = require('awssum-amazon-imd').Imd;
  //var imd = new Imd({});
  imd.Get({'Category' : '/user-data/', 'Version' : 'latest'}, function (err, data) {
    if (err) {
      tries--;
      if (tries > 0) {
        setTimeout(nt.getMyUserData_new(imd, callback, tries), RETRY_TIMEOUT);
      } else {
        callback('Could not get UserData', null);
      }
    } else {
      var myUserData = nt.parseUserData(data);
      callback(null, myUserData);
    }
  });
}

nt.getMyUserData = function getMyUserData(callback, tries) {
  var MAX_TRIES = 10;
  var RETRY_TIMEOUT = 6000;
  var myUserData = '';

  var options = {
        host: '169.254.169.254',
        port: 80,
        path: '/latest/user-data'
  };

  if (tries === undefined) {
    tries = 1;
  }

  http.get(options, function(res) {
    var data = '';
    res.on('data', function (chunk) {
      data += chunk;
    }).on('end', function () {
      if (res.statusCode == 200) {
        myUserData = nt.parseUserData(data);
      } else {
        myUserData = {};
      }
      callback(null, myUserData);
    });
  }).on('error', function(e) {
    if (tries <= MAX_TRIES) {
      tries++;
      setTimeout(nt.getMyUserData(callback, tries), RETRY_TIMEOUT);
    } else {
      callback('Could not get UserData', null);
    }
  });
}

nt.getMyPublicIP = function getMyPublicIP(callback, tries) {
  var MAX_TRIES = 30;
  var RETRY_TIMEOUT = 6000;

  if (tries === undefined) {
    tries = MAX_TRIES;
  }

  var Imd = require('awssum-amazon-imd').Imd;
  var imd = new Imd({});
  imd.Get({'Category' : '/meta-data/public-ipv4/', 'Version' : 'latest'}, function (err, data) {
    if (err) {
      tries--;
      if (tries > 0) {
        setTimeout(nt.getMyPublicIP(callback, tries), RETRY_TIMEOUT);
      } else {
        callback('Could not get IP', null);
      }
    } else {
      callback(null, data);
    }
  });
}

nt.getMyIP = function getMyIP(callback, tries) {
  var MAX_TRIES = 10;
  var RETRY_TIMEOUT = 6000;
  var myIP = '';

  var options = {
                    host: 'checkip.amazonaws.com',
                    port: 80,
                    path: '/'
  };

  if (tries === undefined) {
    tries = 1;
  }
  http.get(options, function(res) {
    var data = '';
    res.on('data', function (chunk) {
      data += chunk;
    }).on('end', function () {
      myIP = data;
      callback(null, myIP);
    });
  }).on('error', function(e) {
    if (tries <= MAX_TRIES) {
      tries++;
      setTimeout(nt.getMyIP(callback, tries), RETRY_TIMEOUT);
    } else {
      callback('Could not get IP', null);
    }
  });
}

nt.md5file = function md5file(filename, cb) {

  var md5sum = crypto.createHash('md5');
  var s = fs.ReadStream(filename);
  s.on('data', function(d) {
    md5sum.update(d);
  });

  s.on('error', function() {
    cb({name: filename, md5: ''});
  });

  s.on('end', function() {
    var d = md5sum.digest('hex');
    cb({name: filename, md5: d});
  });
}

// Extracted from Douglas Crockford json2.js, JSON.parse.
nt.isSafeJSON = function isSafeJSON(text) {

  var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
  text = String(text);
  cx.lastIndex = 0;
  if (cx.test(text)) {
    text = text.replace(cx, function (a) {
                              return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                            });
  }

  if (/^[\],:{}\s]*$/.test(text
                           .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                           .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                           .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {
    return true;
  } else {
    return false;
  }
}

nt.isEmpty = function isEmpty(obj) {
  if ((obj != undefined) && (obj != null)) {

    if (obj.length && obj.length > 0) {
      return false;
    }

    for (var key in obj) {
      if (hasOwnProperty.call(obj, key)) {
        return false;
      }
    }
  }
  return true;
};

nt.estimateSpareTime = function estimateSpareTime(uptime, gracetime) {

  var spare = 60 - Math.ceil((uptime % 3600) /  60) - gracetime;

  if (spare <  gracetime) {
    spare = 0;
  }

  return spare * 60000;
}

nt.cryptData = function cryptData(buf, passphrase, cb) {
  if (buf === false) {
    cb(true, null);
    return;
  }
  try {
    var rb = crypto.randomBytes(8);
    var salt = Buffer(rb);
    var rounds = 3;
    var data00 = Buffer.concat([Buffer(passphrase) ,  salt]);
    var md5Hash = new Array();
    md5Hash[0] = crypto.createHash('md5').update(data00).digest();
    var result = md5Hash[0];

    for (var i = 1; i < rounds; i++) {
      md5Hash[i] = crypto.createHash('md5').update(Buffer.concat([md5Hash[i - 1] , data00])).digest();
      result = Buffer.concat([result, md5Hash[i]]);
    }

    var key;
    var iv;

    if (typeof Buffer.alloc === 'function') {
      key = Buffer.alloc(32);
      iv = Buffer.alloc(16);
    } else {
      key = new Buffer(32);
      iv = new Buffer(16);
    }

    result.copy(key, 0, 0, 32);
    result.copy(iv, 0, 32, 48);

    var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    var content = Buffer.concat([Buffer('Salted__'), salt, cipher.update(buf), cipher.final()]);
    cb(null, content.toString('base64'));
  } catch (e) {
    cb(e, null);
  }
}

nt.isAliveUrl = function(uri, callback) {

  var options = {
    followRedirect: true,
    timeout : uri.timeout || 10000,
    strictSSL : false,
    uri: uri.url || uri
  };

  request.get(options, function(error, response, body) {
    if (error) {
      return callback(error, null);
    } else {
      if (String(response.statusCode).substr(0, 1) === '5') {
        return callback(response.statusCode, null);
      } else {
        return callback(null, response.statusCode);
      }
    }
  });
}

nt.isTrue = function isTrue(value) {
  return (((typeof value === 'string') &&
           ((value.toLowerCase() == 'true') || (value.toLowerCase() == 'yes') ||
            (value == '1'))) ||
          ((typeof value === 'boolean') && (value === true)) || (value === 1));
}

nt.isFalse = function isFalse(value) {
  return (((typeof value === 'string') &&
           ((value.toLowerCase() == 'false') || (value.toLowerCase() == 'no') ||
            (value == '0'))) ||
          ((typeof value === 'boolean') && (value === false)) || (value === 0));
}

nt.isValidDate = function isValidDate(d) {
  if ( Object.prototype.toString.call(d) !== "[object Date]" )
    return false;
  return !isNaN(d.getTime());
}
