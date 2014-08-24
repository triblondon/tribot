module.exports.meta = {
	commands: {
		"map (of) [location]": "Show a map of a location of your choice"
	}
}

module.exports.load = function(bot, options) {
	bot.onMessage(/^map (?:of )?(.+)$/, function(msg, matches) {
    	var mapType = "roadmap";
    	var location = matches.body[1];
    	var mapUrl = "http://maps.google.com/maps/api/staticmap?markers=" + escape(location) + "&size=600x400&maptype=" + mapType + "&sensor=false&format=png";
    	bot.message(msg.fromJid, msg.type, mapUrl);
	});
};