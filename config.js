var config = exports;
config.HOST = process.env.HOST || '0.0.0.0';
config.PORT = process.env.PORT || 5000;
config.URL = process.env.URL || 'http://localhost:5000/';

config.REPOSITORY = process.env.REPOSITORY;

config.REVIEWBOARD_URL = process.env.REVIEWBOARD_URL;
config.REVIEWBOARD_USERNAME = 'admin';
config.REVIEWBOARD_PASSWORD = 'admin';
config.REVIEWBOARD_REPOSITORY = 1;

// RB may fall over if you set this too high
var asyncLimit = process.env.ASYNC_LIMIT || '5';
config.ASYNC_LIMIT = parseInt(asyncLimit, 10);
