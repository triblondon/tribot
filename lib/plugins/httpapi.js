module.exports.meta = {
	urls: {
		"/rooms/:room": "POST a message to a group chat"
	}
};

module.exports.load = function(bot, options) {
	require('express')()
		.use(require('body-parser').text())
		.use(function(req, res, next) {
			res.setHeader("Content-Type", "text/plain");
			next();
		})
		.get('/', function(req, res) {
			res.send(
				bot.name + ' REST interface:\n\n'+
				'* POST /rooms/:room - body of request is posted to :room (if bot is currently in that room).  Ensure content-type of request is text/plain.\n'
			);
		})
		.post('/rooms/:roomname', function(req, res){
			if (!(req.headers['content-type'] && req.headers['content-type'] === 'text/plain')) {
				res.status(415).send('Please resend using only plain text content-type');
			} else {
	  			if (req.body) {
	  				bot.messageRoom(req.params.roomname, req.body);
	  			}
	  			res.status(200).send('OK');
	  		}
		})
		.listen(options.port)
	;
};
