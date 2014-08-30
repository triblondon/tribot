if (!require('fs').existsSync('./config.json')) {
	console.error('Missing config file.  Before you start tribot, you need to configure it by creating a config.json file.  See the README for more details.')
	process.exit(1);
}


var Bot = require('./lib/bot');
var b = new Bot(require('./config.json'));

b.connect();
