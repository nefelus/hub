//  ID int CLOUD_ID int TOOL_ID int VIRTUALIZATION AMI ACTIVE 
var SQL = require('../sqlTemplates').sqlTemplates;
var util = require('util');
var logger = require('./logging').logger;

(function () {
  var images = {};

  // global on the server, window in the browser
  var root, previous_images;

  root = this;
  if (root != null) {
    previous_images = root.images;
  }

  images.noConflict = function () {
    root.images = previous_images;
    return images;
  };

  images.imageDefs = [];

  images.length = function length() {
    return images.imageDefs.length;
  }

  images.dump = function dump() {
    console.log('--- images begin ---');
    for (var x = 0; x < images.imageDefs.length; x++) {
      console.log(x, JSON.stringify(images.imageDefs[x]));
    }
    console.log('--- images end ---');
  }

  images.getDefault = function getDefault(virttype, cloud) {
    return images.getAMI(virttype, 0, cloud);
  }

  images.getAMI = function getAMI(virttype, tool, cloud) {
    var self = images;
    var defaultAMI = null;
    //if (typeof cloud === 'undefined') {
      //cloud = 1; // FIXME ? 
    //}
    for (var i = 0; i < images.imageDefs.length; i++) {
      if ((virttype === images.imageDefs[i]['VIRTUALIZATION']) && ((!cloud) || (cloud == images.imageDefs[i]['CLOUD_ID']))) {
        if (tool == images.imageDefs[i]['TOOL_ID']) {
          return images.imageDefs[i]['AMI'];
        } else if (images.imageDefs[i]['TOOL_ID'] == 0) {
          defaultAMI = images.imageDefs[i]['AMI'];
        }
      }
    }
    return defaultAMI;
  }

  images.loadImages = function loadImages(mysqlClient, cb) {
    //SELECT * FROM IMAGES WHERE ACTIVE = 'Y' ORDER BY CLOUD_ID, TOOL_ID, VIRTUALIZATION;
    images.imageDefs.length = 0;
    var record = {};
    try {
      mysqlClient.query(SQL.images, function(err, rows, fields) {
        if (err) {
          logger.log('Error from MYSQL query:');
          logger.log(err);
          cb(err);
          return;
        } else {
          for (var i = 0; i < rows.length; i++) {
            record = {};
            for (var j = 0; j < fields.length; j++) {
              record[fields[j].name] = rows[i][fields[j].name];
            }
            images.imageDefs.push(record);
          }
        }
        cb(null, 'Images loaded');
      });
    } catch (ex) {
      logger.log( util.inspect(ex, null));
      cb('Load images FATAL ERROR:' + util.inspect(ex, null));
      return;
    }
  }

  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = images;
  }
  // AMD / RequireJS
  else if (typeof define !== 'undefined' && define.amd) {
    define([], function () {
      return images;
    });
  }
  // included directly via <script> tag
  else {
    root.images = images;
  }
}());
