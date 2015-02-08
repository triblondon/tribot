module.exports.meta = {
	commands: {
		"help": "Show this message"
	}
};

module.exports.load = function(bot, options) {
	bot.onMessage(/^(help|hi|hello|hey|wassup|who are you\??)$/, function(msg) {
		var cmds = [];
		Object.keys(bot.plugins).forEach(function(i) {
			if (!bot.plugins[i].meta.commands) return true;
			cmds.push('  *'+i+'*:');
			Object.keys(bot.plugins[i].meta.commands).forEach(function(j) {
				cmds.push('    - `'+j+'`: '+bot.plugins[i].meta.commands[j]);
			});
		});
		var op = "I am "+bot.name+".  When you talk to me in a group chat, remember to prefix your message with `@"+bot.name+"` or `"+bot.name+":`, otherwise I'll stay quiet.  When talking to me privately no prefix is required.\n\nI understand these commands:\n\n"+cmds.join('\n');
		if (msg.room) {
			bot.messageRoom(msg.room, "Sent welcome guide to "+msg.fromNick+' privately to avoid flooding the group.');
		}
		bot.messageUser(msg.fromNick, op);
	});
};
