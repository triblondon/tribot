module.exports.meta = {};

module.exports.load = function(bot, options) {

	bot.onMessage(/.*/, function(msg) {
		Object.keys(options.questions).forEach(function(q) {
			if (q === msg.body) {
				if (!Array.isArray(options.questions[q])) {
					options.questions[q] = [options.questions[q]];
				}
				var op = [];
				options.questions[q].forEach(function(response) {
					var itemop = [];
					if (response.image) {
						itemop.push(response.image);
					}
					if (response.answer) {
						itemop.push('"'+response.answer+'"');
					}
					if (response.link) {
						itemop.push(' -- More info: '+response.link);
					}
					op.push(itemop.join('\n'));
				});
				bot.message(msg.fromJid, msg.type, op.join('\n\n'));
			}
		});
	});
};
