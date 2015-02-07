module.exports.meta = {
	commands: {
		"echo [msg]": "Repeat something back to me (useful for testing)"
	}
};

module.exports.load = function(bot) {
	bot.onMessage(/^echo (.+)$/, function(msg, matches) {
		bot.message(msg.fromJid, msg.type, 'Right back at ya:\n'+matches.body[1]);
	});
};
