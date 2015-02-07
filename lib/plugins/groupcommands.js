module.exports.meta = {
	commands: {
		"join (me/us in) [room]": "Join a room (in private chat)",
		"leave [room]": "Leave a room (in private chat)",
		"leave": "Leave current room",
		"list rooms": "List the rooms in which the bot is currently a member",
		"you there?": "Declare presence if in room"
	}
};

module.exports.load = function(bot, options) {
	bot.onMessage(/^(go away|get lost|be quiet|leave( us|the room)?)( please| now)?$/, function(msg) {
		bot.messageRoom(msg.room, 'Farewell.  When you are ready for me to return, you may say \'join #'+msg.room+'\' to me in private chat');
		bot.leave(msg.room);
	});
	bot.onMessage({type:'chat', body:/^join (?:(?:us|me) in )?\#?([\w\-]+)$/}, function(msg, matches) {
		bot.messageUser(msg.fromNick, "I will join you there");
		bot.join(matches.body[1]);

		// TODO: It would be nice to be able to announce arrival in the room,
		// but to do this you'd need to await the presence confirmation from the service
		// http://xmpp.org/extensions/xep-0045.html#enter-pres
	});
	bot.onMessage({type:'chat', body:/^leave \#?([\w\-]+)$/}, function(msg, matches) {
		bot.messageUser(msg.fromNick, "Leaving "+matches.body[1]);
		bot.messageRoom(matches.body[1], "Leaving the room, on orders from "+msg.fromNick+'. When you are ready for me to return, you may say \'join #'+matches.body[1]+'\' to me in private chat');
		bot.leave(matches.body[1]);
	});
	bot.onMessage(/^(((are )?you there)|yt)\??/, function(msg) {
		bot.message(msg.fromJid, msg.type, 'I am here');
	});
	bot.onMessage(/(which (rooms|channels) are you in\/?|list (rooms|channels))/, function(msg) {
		bot.message(msg.fromJid, msg.type, (Object.keys(bot.rooms).length === 0) ?
			"I am nowhere.  To invite me into a room, say 'join #<room name>' to me in private chat" :
			"I am currently active in: "+Object.keys(bot.rooms).join(', ')
		);
	});
};
