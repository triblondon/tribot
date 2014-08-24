module.exports.meta = {
	commands: {
		"help": "Show this message"
	}
};

module.exports.load = function(bot, options) {
	bot.onMessage(/^(help|hi|hello)$/, function(msg) {
		var cmds = [];
		for (var i in bot.plugins) {
			if (!bot.plugins[i].meta.commands) continue;
			cmds.push('  *'+i+'*:');
			for (var j in bot.plugins[i].meta.commands) {
				cmds.push('    - `'+j+'`: '+bot.plugins[i].meta.commands[j]);
			}
		}
		var op = "Hi, I'm "+bot.name+".  When you talk to me in a group chat, remember to prefix your message with `@"+bot.name+"` or `"+bot.name+":`, otherwise I'll stay quiet.  When talking to me privately no prefix is required.\n\nI understand these commands:\n\n"+cmds.join('\n');
		if (msg.room) {
			bot.messageRoom(msg.room, "Sent welcome guide to "+msg.fromNick+' privately to avoid flooding the group.');
		}
		bot.messageUser(msg.fromNick, op);
	});
};