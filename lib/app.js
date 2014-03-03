var http = require('http');
var express = require('express');

var config = require('../config'),
    routes = require('./routes');

module.exports = function(callback) {
  var app = express();
  app.http = http.createServer(app);

  app.enable('trust proxy');

  app.configure('development', function() {
    app.use(express.logger('dev'));
  });

  app.configure('production', function() {
    app.use(express.logger('short'));
  });

  app.use(express.urlencoded());
  app.use(express.json());

  routes(app);

  return process.nextTick(function() {
    return callback(null, app);
  });
};
