'use strict';

var express         = require('express')
  , ejs             = require('ejs')
  , path            = require('path')

loadEnv('.env');

var port      = process.env.PORT || 8080
  , origins   = (process.env.BLOCKCHAIN || '').split(' ')
  , rootURL   = process.env.ROOT_URL || 'https://blockchain.info/'

// App configuration
var app = express();

app.use(function (req, res, next) {
  if (req.url === '/') {
    var cspHeader = ([
      "img-src 'self' " + rootURL + " data:",
      "style-src 'self' https://blockchain.info 'unsafe-inline'",
      "child-src 'self'",
      "script-src 'self' https://blockchain.info",
      "connect-src 'self' " + rootURL + " wss://*.blockchain.info  https://blockchain.info",
      "object-src 'none'",
      "media-src 'self' data: mediastream: blob:",
      "font-src 'self'", ''
    ]).join('; ');
    res.setHeader('content-security-policy', cspHeader);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    res.render('index-dev.html');
    return;

  }

  res.setHeader('Cache-Control', 'public, max-age=0, no-cache');

  next();
});

app.engine('html', ejs.renderFile);
app.use('/wallet', express.static('public'));
app.set('views', __dirname);

app.use(function (req, res) {
  res.status(404).send('<center><h1>404 Not Found</h1></center>');
});

app.listen(port, function () {
  console.log('Listening on %d', port);
});

// Custom middleware
function allowOrigins(origins) {
  return function (req, res, next) {
    origins.forEach(function (origin) {
      if (req.headers.origin != null && req.headers.origin.indexOf(origin) > -1) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      }
    });
    next();
  };
}

// Helper functions
function loadEnv(envFile) {
  try {
    require('node-env-file')(envFile);
  } catch (e) {
    console.log('You may optionally create a .env file to configure the server.');
  }
}
