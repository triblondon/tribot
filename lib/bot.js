var util = require('util');
var EventEmitter = require('events').EventEmitter;
var xmpp = require('node-xmpp-client');
var bind = require('underscore').bind;
var ltx = require('ltx');
var JID = require('node-xmpp-core').JID;
var bunyan = require('bunyan');
var bunyanLogentries = require('bunyan-logentries');



// Make a bot
//
// `options` object:
//
//   - `jid`: Bot's Jabber ID
//   - `password`: Bot's Jabber password
//   - `host`: Force host to make XMPP connection to. Otherwise will look up
//      DNS SRV record on JID's host.
//   - `mucHost`: Multi-user chat hostname, usually different to the registration host
//      to power another bot framework (e.g. Hubot).
var Bot = function(options) {
	EventEmitter.call(this);

	this.setMaxListeners(0);

	this.options = options || {};
	this.options.host = options.host || (new JID(options.jid)).getDomain();
	this.options.mucHost = options.mucHost || "conf." + this.options.host;  // Multi-user conference host
	this.options.rooms = options.rooms || [];
	this.options.httpPort = options.httpPort || 80;

	this.client = null;
	this.keepalive = null;
	this.name = (new JID(this.options.jid)).getLocal();
	this.plugins = {};
	this.iq_count = 1; // Start the IQ ID counter at 1
	this.rooms = {};

	if (options.logs) {
		var logstreams = [];
		if (options.logs.logentries) {
			logstreams.push({
				stream: bunyanLogentries.createStream({token: options.logs.logentries.token}),
				level: options.logs.logentries.level,
				type:'raw'
			});
		}
		if (options.logs.stdout) {
			logstreams.push({
				stream: process.stdout,
				level: options.logs.stdout.level
			});
		}
		this.log = bunyan.createLogger({
			name: 'tribot-'+this.name,
			streams: logstreams
		});
	}

	Object.keys(options.plugins).forEach(function(id) {
		this.loadPlugin(id, options.plugins[id]);
	}.bind(this));
};

// Must do this before creating additional prototype methods
util.inherits(Bot, EventEmitter);



// Handle incoming XMPP messages. The `data` event will be triggered with the
// message for custom XMPP handling.  The bot will parse the message and
// trigger the `message` event when it is a group chat message or the
// `privateMessage` event when it is a private message.
var onStanza = function(stanza) {
	var from;
	var self = this;

	if (stanza.is('message') && stanza.attrs.type) {
		var body = stanza.getChildText('body');
		var fromNick;
		from = new JID(stanza.attrs.from);

		// Ignore typing notifications and chat history
		if (!body || stanza.getChild('delay')) return;

		// Ignore groupchat messages that do not begin with a mention (avoid bots butting into group chats unintentially)
		if (stanza.attrs.type === 'groupchat') {
			fromNick = from.getResource();
			var matches = (new RegExp('^(@'+this.name+':?|@?'+this.name+':)\\s+(.*?)$')).exec(body);
			if (!matches) return;
			body = matches[2];
		} else {
			fromNick = from.getLocal();
		}

		// Ignore own messages
		if (fromNick === this.name) return;

		this.log.trace("Inbound XMPP", {type:'msg', from:stanza.attrs.from, body:body});
		this.log.info("Message received", {from:stanza.attrs.from, body:body});
		var data = {
			type: stanza.attrs.type,
			fromJid: stanza.attrs.from,
			fromNick: fromNick,
			body: body
		};
		if (stanza.attrs.type === 'groupchat') data.room = from.getLocal();
		this.emit('message', data);

	} else if (stanza.is('message')) {

		// This is from wubot, no idea if it works.

		// TODO: It'd be great if we could have some sort of xpath-based listener
		// so we could just watch for '/message/x/invite' stanzas instead of
		// doing all this manual getChild nonsense.
		var x = stanza.getChild('x', 'http://jabber.org/protocol/muc#user');
		if (!x) return;
		var invite = x.getChild('invite');
		if (!invite) return;
		var reason = invite.getChildText('reason');

		var inviteRoom = stanza.attrs.from;
		var inviteSender = invite.attrs.from;

		this.log.trace("Inbound XMPP", {type:'roomInvitation', from:inviteSender, room:inviteRoom});
		this.emit('invite', inviteRoom, inviteSender, reason);

	} else if (stanza.is('iq')) {

		// Handle a response to an IQ request
		var event_id = 'iq:' + stanza.attrs.id;
		if (stanza.attrs.type === 'result') {
			this.log.trace("Inbound XMPP", {type:'iqResponse', iqID:stanza.attrs.id, content:stanza.root().toString()});
			this.emit(event_id, null, stanza);
		} else {
			// IQ error response
			// ex: http://xmpp.org/rfcs/rfc6121.html#roster-syntax-actions-result
			var error = 'unknown';
			var error_elem = stanza.getChild('error');
			if (error_elem) {
				error = error_elem.children[0].name;
			}
			this.log.trace("Inbound XMPP", {type:'iqError', iqID:stanza.attrs.id, content:stanza.root().toString()});
			this.emit(event_id, error, stanza);
		}

	} else if (stanza.is('presence') && (!stanza.attrs.type || stanza.attrs.type === 'available' || stanza.attrs.type === 'unavailable')) {

		from = new JID(stanza.attrs.from);
		var status = stanza.attrs.type || 'available';
		if (from.getResource() && from.getDomain() === this.options.mucHost) {
			this.rooms[from.getLocal()] = this.rooms[from.getLocal()] || {occupants:{}, selfmember:false};
			this.rooms[from.getLocal()].occupants[from.getResource()] = status;
		}

		if (stanza.getChild('x', 'http://jabber.org/protocol/muc#user')) {
			stanza.getChild('x', 'http://jabber.org/protocol/muc#user').getChildren('status').forEach(function(el) {

				// 110 = self-presence notification
				if(parseInt(el.attrs.code, 10) === 110 && !self.rooms[from.getLocal()].selfmember) {
					self.rooms[from.getLocal()].selfmember = true;
					self.emit('join', from.getLocal());
				}
			});
		}

		// TODO: Read <x xmlns="http://jabber.org/protocol/muc#user">/<item>.name/nick for profile info
		// TODO: Read <show> for status
		this.log.trace("Inbound XMPP", {type:'presence', from:stanza.attrs.from, status:status});

	} else {

		this.emit('unhandleddata', stanza);
		this.log.trace("Inbound XMPP", {type:'unknown', content:stanza.root().toString()});
	}
};

var onStreamError = function(err) {
	this.log.warn(err);
};




/* Public api */

// Connects the bot to the server and sets the XMPP event listeners.
Bot.prototype.connect = function() {
	var origSend;

	this.client = new xmpp.Client({
		jid: this.options.jid,
		password: this.options.password,
		host: this.options.host
	});

	origSend = this.client.send;
	this.client.send = function(stanza) {
		this.log.trace("Outbound XMPP", {data:stanza.root().toString()});
		return origSend.call(this.client, stanza);
	}.bind(this);

	this.client.on('online', function() {
		this.log.info('Connected');
		this.setAvailability('chat');
		this.keepalive = setInterval(function() {
			this.setAvailability('available');
			this.emit('sendping');
		}.bind(this), 30000);
		this.options.rooms.forEach(this.join.bind(this));
		this.emit('connect');
	}.bind(this));

	this.client.on('error', bind(onStreamError, this));
	this.client.on('stanza', bind(onStanza, this));
};


// Updates the bot's availability and status.
//
//  - `availability`: away | chat | dnd
//  - `status`: Status message to display
Bot.prototype.setAvailability = function(availability, status) {
	var packet = new ltx.Element('presence', { type: 'available', id:'status1' }).c('show').t(availability);
	if (status) packet.c('status').t(status);
	this.client.send(packet);
};

// Join a room.
//
// - `room`: Target room (must exist on options.mucHost)
// - `historyStanzas`: Number of history entries to request
Bot.prototype.join = function(room, historyStanzas) {
	if (!historyStanzas) historyStanzas = 0;
	var packet = new ltx.Element('presence', { to: room + '@' + this.options.mucHost + '/' + this.name })
		.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
		.c('history', {
			xmlns: 'http://jabber.org/protocol/muc',
			maxstanzas: String(historyStanzas)
		})
	;
	this.client.send(packet);
	this.log.info("Joined room", {room:room});
};

// Leave a room.
//
// - `roomJid`: Target room
Bot.prototype.leave = function(room) {
	var packet = new ltx.Element('presence', { type: 'unavailable', from: this.options.jid+'/'+this.name, to: room + '@' + this.options.mucHost + '/' + this.name })
		.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
		.c('status').t('hc-leave')
	;
	this.rooms[room].selfmember = false;
	this.client.send(packet);
	this.log.info("Left room", {room:room});
};

// Send a private message to a user.
//
// - `targetJid`: Target user name or JID.
// - `message`: Message to be sent to the target
Bot.prototype.messageUser = function(targetJid, message) {
	if (targetJid.indexOf('@') === -1) targetJid += '@'+this.options.host;
	this.message(targetJid, 'chat', message);
};

// Send a group message to a room
//
// - `targetJid`: Target room name or JID.
// - `message`: Message to be sent to the target
Bot.prototype.messageRoom = function(targetJid, message) {
	if (targetJid.indexOf('@') === -1) targetJid += '@'+this.options.mucHost;
	this.message(targetJid, 'groupchat', message);
};

// Send a message to a raw Jid
//
// - `targetJid`: Target JID.
// - `type`: 'groupchat' or 'chat'
// - `message`: Message to be sent to the target
Bot.prototype.message = function(targetJid, type, message) {
	var packet = new ltx.Element('message', {
		to: targetJid,
		type: type,
		from: this.jid  // TODO: probably should be modified to be an in-room JID where appropriate
	}).c('body').t(message);
	this.log.info('Message sent', {to:targetJid, body:message});
	this.client.send(packet);
};

// Sends an IQ (Info/Query) stanza and stores a callback to be called when its
// response is received.
//
// - `stanza`: `ltx.Element` to send
// - `callback`: Function to be triggered: `function (err, stanza)`
//   - `err`: Error condition (string) if any
//   - `stanza`: Full response stanza, an `xmpp.Element`
Bot.prototype.sendIq = function(stanza, callback) {
	stanza = stanza.root(); // work with base element
	var id = this.iq_count++;
	stanza.attrs.id = id;
	this.once('iq:' + id, callback);
	this.client.send(stanza);
};

Bot.prototype.loadPlugin = function(identifier, options) {
	var plugin = require('./plugins/'+identifier);
	if (typeof(plugin) !== 'object') throw new Error('plugin argument must be an object');
	if (typeof(plugin.load) !== 'function') throw new Error('plugin object must have a load function');

	this.plugins[identifier] = plugin;
	this.plugins[identifier].load(this, options || {});
};



/* Events API */

// Emitted whenever the bot connects to the server.
//
// - `callback`: Function to be triggered: `function ()`
Bot.prototype.onConnect = function(callback) {
	this.on('connect', callback);
};

// Emitted whenever the bot is invited to a room.
//
// `onInvite(callback)`
//
// - `callback`: Function to be triggered:
//   `function (roomJid, fromJid, reason, matches)`
//   - `roomJid`: JID of the room being invited to.
//   - `fromJid`: JID of the person who sent the invite.
//   - `reason`: Reason for invite (text)
Bot.prototype.onInvite = function(callback) {
	this.on('invite', callback);
};

// Emitted whenever a message is received matching the specified conditions
//
// - `condition`: String or RegExp the message must match.  May be an object
//   keyed on any of the message data.  If a string or regexp, will match body.
// - `callback`: Function to be triggered: `function (data, matches)`:
//   - `data` is an object:
//     - `type`: 'chat' or 'groupchat'
//     - `fromNick`: Nickname of the sender
//     - `room`: If groupchat, the name of the room
//     - `fromJid`: Raw Jabber ID of the sender
//     - `body`: The message
//   -`matches`: The matches returned by any regexp conditions
Bot.prototype.onMessage = function(conditions, callback) {
	if (typeof conditions === 'string' || conditions instanceof RegExp) {
		conditions = {body: conditions};
	}
	this.on('message', function(data) {
		var key, matches = {};
		for (key in conditions) {
			if (conditions.hasOwnProperty(key)) {
				if (!data[key]) return;
				if (typeof conditions[key] === 'string' && data[key] !== conditions[key]) return;
				if (conditions[key] instanceof RegExp) {
					if (!conditions[key].test(data[key])) return;
					matches[key] = data[key].match(conditions[key]);
				}
			}
		}
		callback.call(this, data, matches);
	});
};


// Emitted whenever an XMPP stream error occurs. The `disconnect` event will
// always be emitted afterwards.
//
// Conditions are defined in the XMPP spec:
//   http://xmpp.org/rfcs/rfc6120.html#streams-error-conditions
//
// - `callback`: Function to be triggered: `function(condition, text, stanza)`
//   - `condition`: XMPP stream error condition (string)
//   - `text`: Human-readable error message (string)
//   - `stanza`: The raw `xmpp.Element` error stanza
Bot.prototype.onError = function(callback) {
	this.on('error', callback);
};


module.exports = Bot;
