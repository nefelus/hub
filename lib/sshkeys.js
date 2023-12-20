//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//

var NodeRSA = require('node-rsa');
var sshpk = require('sshpk');
/*
var spawn = require('threads').spawn;

var thread = spawn(function(input, done) {

  var NodeRSA = require('node-rsa');
  var sshpk = require('sshpk');

  var key = new NodeRSA({b: 2048});
  var kp = key.generateKeyPair();
  var publicPem = kp.exportKey('public');
  var sshkey = sshpk.parseKey(publicPem, 'pem');
  var publicSSHKey = sshkey.toString('ssh');

  done( {private: kp.exportKey('pkcs8'), public: sshkey.toString('ssh')});
});


thread
  .send()
  .on('message', function(response) {
    console.log(response);
    thread.kill();
  })
  .once('error', function(error) {
    console.error('Worker errored:', error);
  })
  .once('exit', function() {
  });
*/

function mksshkeys() {
  var key = new NodeRSA({b: 2048});
  var kp = key.generateKeyPair();
  var publicPem = kp.exportKey('public');
  var sshkey = sshpk.parseKey(publicPem, 'pem');

  return {private: kp.exportKey('pkcs8'), public: sshkey.toString('ssh')};
}

var sshkeys = function sshkeys(options) {

  var self = this;
  this.options = options || {};
  this.maxkeys = this.options.maxkeys || 3;
  this.data = [];
  this.timer = setInterval(function() {
    self.push();
  }, this.options.timeout || 60000);

  this.length = function length() {
    return self.data.length;
  };

  this.pop = function pop() {
    if (self.length() > 0) {
      return self.data.pop();
    } else {
      var k = mksshkeys();
      return k;
    }
  };

  this.push = function push() {
    while (self.length() < self.maxkeys) {
      self.data.push(mksshkeys());
    }
  };

  this.dump = function dump() {
    var x;
    console.log('--- sshkeys begin ---');
    for (x = 0; x < self.data.length; x++) {
      console.log(x, JSON.stringify(self.data[x]));
    }
    console.log('--- sshkeys end ---');
  };

  this.retrieve = function retrieve(sqlclient, id, cb) {
    sqlclient.query('SELECT PUBLIC as publicKey, PRIVATE as privateKey FROM SSHKEYS where HRID=?', [id || 0], function(err, rows, fields) {
      if (err) {
        cb(err, null);
      } else {
        if (rows.length) {
        cb(null, {publicKey: rows[0].publicKey || null, privateKey: rows[0].privateKey || null});
        } else {
          cb(null, null);
        }
      }
    });
  };

  this.store = function store(sqlclient, id, publicKey, privateKey) {
    sqlclient.query('INSERT INTO SSHKEYS (HRID, PUBLIC, PRIVATE) values (?,?,?);', [id, publicKey, privateKey], function(err, result) {
      if (err) {
        // empty line
      } else {
        if (result.affectedRows !== 1) {
          // empty line
        } else {
          // empty line
        }
      }
    });
  };

  this.push();
  this.timer.unref();

};

// we specify that this module is a refrence to the lmqueue class
module.exports = sshkeys;
