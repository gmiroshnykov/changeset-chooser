var config = exports;
config.HOST = process.env.HOST || '0.0.0.0';
config.PORT = process.env.PORT || 5000;

config.REPOSITORY = '/Users/laggyluke/Projects/playground-central';

config.REVIEWBOARD_URL = 'http://rb.dev';
config.REVIEWBOARD_USERNAME = 'admin';
config.REVIEWBOARD_PASSWORD = 'admin';
config.REVIEWBOARD_REPOSITORY = 1;

// RB may fall over if you set this too high
config.ASYNC_LIMIT = 5;
