var os = require("os");

module.exports.meta = {
	commands: {
		"debug": "Show status information"
	}
};

module.exports.load = function(bot, options) {
	var starttime = (new Date()).getTime();
	bot.onMessage('debug', function(msg) {
		var now = (new Date()).getTime();
		var op = {
			'Name': bot.name,
			'Running on': os.hostname(),
			'NodeJS version': process.version,
			'Uptime': Math.floor((now-starttime)/1000)+' seconds',
			'Process ID': process.pid
		};
		bot.messageUser(msg.fromNick, Object.keys(op).map(key => "*"+key+":* "+op[key]).join('\n'));
	});
};
