var Bot = require('./lib/bot');
var b = new Bot({
	jid: 'my.jabber.id@my.jabber.server',
	password: 'password',
	mucHost: 'multi.user.chat.server.address',
	rooms: [],
	debug: false,
	httpPort: 80
});

b.loadPlugin('httpapi');
b.loadPlugin('echo');
b.loadPlugin('groupcommands');
b.loadPlugin('maps');
b.loadPlugin('help');

b.connect();
