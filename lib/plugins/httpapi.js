module.exports.meta = {
	urls: {
		"/rooms/:room": "POST a message to a group chat"
	}
};

module.exports.load = function(bot, options) {
	require('express')()
		.use(require('body-parser').text())
		.all(function(req, res) {
			res.set("Content-Type", "text/plain");
		})
		.get('/', function(req, res) {
			res.send(
				bot.name + ' REST interface:\n\n'+
				'* POST /rooms/:room - body of request is posted to :room (if bot is currently in that room)\n'
			);
		})
		.post('/rooms/:roomname', function(req, res){
	  		bot.messageRoom(req.params.roomname, req.body);
	  		res.status(200).send('OK');
		})
		.listen(bot.options.httpPort)
	;
};