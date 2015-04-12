var config;

if (!require('fs').existsSync('./config.json')) {
	console.error('Missing config file.  Before you start tribot, you need to configure it by creating a config.json file.  See the README for more details.');
	process.exit(1);
} else {
	config = require('./config.json');
}

// Patch the global Date object to support time zones and set the time zone correctly
// Since the effect is global this is done outside of the Bot class
var time = require('time')(Date);
if ("timeZone" in config) time.tzset(config.timeZone);

var Bot = require('./lib/bot');
var b = new Bot(require('./config.json'));

b.connect();
