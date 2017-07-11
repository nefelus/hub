//
// This file is subject to the terms and conditions defined in
// file 'LICENSE.txt', which is part of this source code package.
//
var os = require('os');

function _log(f, args, label) {
  var now;

  // Format the date

  var d = new Date();
  var mo = d.getMonth() + 1;
  var da = d.getDate();
  var h = d.getHours();
  var m = d.getMinutes();
  var s = d.getSeconds();
  mo = mo < 10 ? '0' + mo : mo;
  da = da < 10 ? '0' + da : da;
  h = h < 10 ? '0' + h : h;
  m = m < 10 ? '0' + m : m;
  s = s < 10 ? '0' + s : s;
  now = d.getFullYear().toString() + '-' + mo + '-' + da + ' ' + h + ':' + m + ':' + s;

  // Unfold long objects
  var strings = [];
  args.forEach(function (s) {
    if (typeof s != 'string') {
      strings.push(JSON.stringify(s));
    } else {
      strings.push(s);
    }
  });

  // Add the label if set
  if (label) {
    strings.unshift(label  + ':');
  }

  // Add the timestamp
  strings.unshift(now);

  if (console.opts.stream) {
    console.opts.stream.write(strings.join(' ')+os.EOL, 'utf8');
  } else {
    f.apply(f, strings);
  }
}

// Keep the original functions around in case the developer wants them
// Kudos to pretty-console package from twistdigital
console.raw = {};

// Console log
console.raw.log = console.log;
console.log = function () {
  var args = Array.prototype.slice.call(arguments);
  _log(console.raw.log, args, '(i)');
};

// Console warn
console.raw.warn = console.warn;
console.warn = function () {
  var args = Array.prototype.slice.call(arguments);
  _log(console.raw.warn, args, '(w)');
};

// Console error
console.raw.error = console.error;
console.error = function () {
  var args = Array.prototype.slice.call(arguments);
  _log(console.raw.error, args, '(e)');
};

// Console debug
console.debug = function () {
  if (console.opts.debug) {
    var args = Array.prototype.slice.call(arguments);
    _log(console.raw.log, args, '(d)');
  }
};

console.opts = {debug : false, stream : null};

exports.logger = console;
