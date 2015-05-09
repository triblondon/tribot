var os = require("os");

module.exports.meta = {
	commands: {
		"debug": "Show status information"
	}
};

module.exports.load = function(bot, options) {
	var starttime = (new Date()).getTime();
	bot.onMessage('debug', function(msg) {
		var now = new Date();
		var op = {
			'Name': bot.config.name,
			'Running on': os.hostname(),
			'NodeJS version': process.version,
			'Uptime': Math.floor((now.getTime()-starttime)/1000)+' seconds',
			'Time now': now.toString(),
			'Process ID': process.pid
		};
		bot.messageUser(msg.fromNick, Object.keys(op).map(key => "*"+key+":* "+op[key]).join('\n'));
	});
};
