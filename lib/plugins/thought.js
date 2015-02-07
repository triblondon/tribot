var request = require('request');
var cron = require('node-schedule');
var quote, qdate;

module.exports.meta = {
	commands: {
		"thought": "Speak thought for the day"
	}
};

module.exports.load = function(bot, options) {

	function qotd(cb) {
		var today = new Date();
		today.setUTCHours(0);
		today.setUTCMinutes(0);
		today.setUTCSeconds(0);
		today.setUTCMilliseconds(0);
		if (!quote || today.getTime() !== qdate) {
			request('http://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=en', function(err, resp, body) {
				var data = JSON.parse(body);
				quote = data.quoteText;
				qdate = today.getTime();
				cb(quote);
			});
		} else {
			cb(quote);
		}
	}

	bot.onMessage("thought", function(msg) {
		qotd(function(quote) {
			bot.message(msg.fromJid, msg.type, quote);
		});
	});
	cron.scheduleJob('0 9 * 1-6 *', function() {
		qotd(function(quote) {
			bot.messageRoom('origami-internal', quote+'\nLet us begin a new day.');
		});
	});

};
