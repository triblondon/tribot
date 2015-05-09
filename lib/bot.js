const EventEmitter = require('events').EventEmitter;
const xmpp = require('node-xmpp-client');
const ltx = require('ltx');
const JID = require('node-xmpp-core').JID;
const bunyan = require('bunyan');
const bunyanLogentries = require('bunyan-logentries');

"use strict";

class Bot extends EventEmitter {

	// Options:
	//
	//   - `jid`: Bot's Jabber ID
	//   - `password`: Bot's Jabber password
	//   - `host`: Force host to make XMPP connection to. Otherwise will look up
	//      DNS SRV record on JID's host.
	//   - `mucHost`: Multi-user chat hostname, usually different to the registration host
	//      to power another bot framework (e.g. Hubot).
	//   - `rooms`: Rooms to join (array)
	constructor(jid, password, config = {}) {

		// Mix in the event emitter
		super();
		this.setMaxListeners(0);

		// Save config
		this.config = Object.assign({
			jid,
			password,
			host: (new JID(jid)).getDomain(),
			mucHost: "conf." + this.host,  // Multi-user conference host
			name: (new JID(jid)).getLocal(),
			rooms: [],
			plugins: {}
		}, config);

		this.client = null;
		this.keepaliveTimer = null;
		this.plugins =  {};
		this.iq_count = 1;
		this.rooms = {};

		if (this.config.logs) {
			let logstreams = [];
			if (this.config.logs.logentries) {
				logstreams.push({
					stream: bunyanLogentries.createStream({token: this.config.logs.logentries.token}),
					level: this.config.logs.logentries.level,
					type:'raw'
				});
			}
			if (this.config.logs.stdout) {
				logstreams.push({
					stream: process.stdout,
					level: this.config.logs.stdout.level
				});
			}
			this.log = bunyan.createLogger({
				name: 'tribot-'+this.config.name,
				streams: logstreams
			});
		}

		this.log.info("Bot created");

		// Load plugins
		Object.keys(this.config.plugins).forEach(id => {
			let plugin = require('./plugins/'+id);
			if (typeof(plugin) !== 'object') throw new Error('plugin argument must be an object');
			if (typeof(plugin.load) !== 'function') throw new Error('plugin object must have a load function');

			this.plugins[id] = plugin;
			this.plugins[id].load(this, this.config.plugins[id].options || {});
			this.log.debug('Loaded plugin', {name:id, options:this.config.plugins[id].options});
		});
	}

	// Connects the bot to the server and sets the XMPP event listeners.
	connect() {
		var origSend;

		this.log.debug('Connecting');

		this.client = new xmpp.Client({
			jid: this.config.jid,
			password: this.config.password,
			host: this.host
		});

		origSend = this.client.send;
		this.client.send = stanza => {
			this.log.trace("Outbound XMPP", {data:stanza.root().toString()});
			return origSend.call(this.client, stanza);
		};

		this.client.on('online', () => {
			this.log.info('Connected');
			this.setAvailability('chat');
			this.keepaliveTimer = setInterval(() => {
				this.setAvailability('available');
				this.emit('sendping');
			}, 30000);
			this.config.rooms.forEach(this.join.bind(this));
			this.emit('connect');
		});

		this.client.on('offline', () => {
			this.log.warn('Client is offline, will reconnect');
			this.connect();
		});

		this.client.on('error', err => {
			this.log.warn(err);
		});

		this.client.on('stanza', onStanza.bind(this));
	}

	// Updates the bot's availability and status.
	//
	//  - `availability`: away | chat | dnd
	//  - `status`: Status message to display
	setAvailability(availability, status) {
		let packet = new ltx.Element('presence', { type: 'available', id:'status1' }).c('show').t(availability);
		if (status) packet.c('status').t(status);
		this.client.send(packet);
	}

	join(room, historyStanzaCount = 0) {
		let packet = new ltx.Element('presence', { to: room + '@' + this.config.mucHost + '/' + this.config.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('history', {
				xmlns: 'http://jabber.org/protocol/muc',
				maxstanzas: String(historyStanzaCount)
			})
		;
		this.client.send(packet);
		this.log.info("Joined room", {room:room});
	}

	leave(room) {
		var packet = new ltx.Element('presence', { type: 'unavailable', from: this.jid+'/'+this.config.name, to: room + '@' + this.mucHost + '/' + this.config.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('status').t('hc-leave')
		;
		this.rooms[room].selfmember = false;
		this.client.send(packet);
		this.log.info("Left room", {room:room});
	}

	messageUser(targetJid, message) {
		if (targetJid.indexOf('@') === -1) targetJid += '@'+this.config.host;
		this.message(targetJid, 'chat', message);
	}

	messageRoom(targetJid, message) {
		if (targetJid.indexOf('@') === -1) targetJid += '@'+this.config.mucHost;
		this.message(targetJid, 'groupchat', message);
	}

	message(targetJid, type, message) {
		var packet = new ltx.Element('message', {
			to: targetJid,
			type: type,
			from: this.jid  // TODO: probably should be modified to be an in-room JID where appropriate
		}).c('body').t(message);
		this.log.info('Message sent', {to:targetJid, body:message});
		this.client.send(packet);
	}

	// Sends an IQ (Info/Query) stanza and stores a callback to be called when its
	// response is received.
	//
	// - `stanza`: `ltx.Element` to send
	// - `callback`: Function to be triggered: `function (err, stanza)`
	//   - `err`: Error condition (string) if any
	//   - `stanza`: Full response stanza, an `xmpp.Element`
	sendIq(stanza, callback) {
		stanza = stanza.root(); // work with base element
		let id = this.iq_count++;
		stanza.attrs.id = id;
		this.once('iq:' + id, callback);
		this.client.send(stanza);
	}


	// Events API

	// Call a function whenever the bot connects to the server.
	//
	// - `callback`: Function to be triggered: `function ()`
	onConnect(callback) {
		this.on('connect', callback);
	}

	// Call a function whenever the bot is invited to a room.
	//
	// `onInvite(callback)`
	//
	// - `callback`: Function to be triggered:
	//   `function (roomJid, fromJid, reason, matches)`
	//   - `roomJid`: JID of the room being invited to.
	//   - `fromJid`: JID of the person who sent the invite.
	//   - `reason`: Reason for invite (text)
	onInvite(callback) {
		this.on('invite', callback);
	}

	// Call a function whenever a message is received matching the specified conditions
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
	onMessage(conditions, callback) {
		if (typeof conditions === 'string' || conditions instanceof RegExp) {
			conditions = {body: conditions};
		}
		this.on('message', function(data) {
			var key, matches = {};
			for (key in conditions) {
				if (conditions.hasOwnProperty(key)) {
					if (!data[key]) return;
					if (typeof conditions[key] === 'string' && data[key].toLowerCase() !== conditions[key].toLowerCase()) return;
					if (conditions[key] instanceof RegExp) {
						if (!conditions[key].test(data[key].toLowerCase())) return;
						matches[key] = data[key].match(conditions[key]);
					}
				}
			}
			callback.call(this, data, matches);
		});
	}

	// Call a function whenever an XMPP stream error occurs. The `disconnect` event will
	// always be emitted afterwards.
	//
	// Conditions are defined in the XMPP spec:
	//   http://xmpp.org/rfcs/rfc6120.html#streams-error-conditions
	//
	// - `callback`: Function to be triggered: `function(condition, text, stanza)`
	//   - `condition`: XMPP stream error condition (string)
	//   - `text`: Human-readable error message (string)
	//   - `stanza`: The raw `xmpp.Element` error stanza
	onError(callback) {
		this.on('error', callback);
	}

}



// Handle incoming XMPP messages. The `data` event will be triggered with the
// message for custom XMPP handling.  The bot will parse the message and
// trigger the `message` event when it is a group chat message or the
// `privateMessage` event when it is a private message.
var onStanza = function(stanza) {
	var from;

	this.log.trace("Inbound XMPP", {data:stanza.root().toString()});

	if (stanza.is('message') && stanza.attrs.type) {
		var body = stanza.getChildText('body');
		var fromNick;
		from = new JID(stanza.attrs.from);

		// Ignore typing notifications and chat history
		if (!body || stanza.getChild('delay')) return;

		// Ignore groupchat messages that do not begin with a mention (avoid bots butting into group chats unintentially)
		if (stanza.attrs.type === 'groupchat') {
			fromNick = from.getResource();
			var matches = (new RegExp('^(@'+this.config.name+':?|@?'+this.config.name+':)\\s+(.*?)$')).exec(body);
			if (!matches) return;
			body = matches[2];
		} else {
			fromNick = from.getLocal();
		}

		// Ignore own messages
		if (fromNick === this.config.name) return;

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

		this.log.info("Received invitation", {from:inviteSender, room:inviteRoom});
		this.emit('invite', inviteRoom, inviteSender, reason);

	} else if (stanza.is('iq')) {

		// Handle a response to an IQ request
		var event_id = 'iq:' + stanza.attrs.id;
		if (stanza.attrs.type === 'result') {
			this.emit(event_id, null, stanza);

		// Handle a ping request
		} else if (stanza.attrs.type === 'get' && stanza.getChild('ping')) {
			this.client.send(new ltx.Element('iq', {
				from: stanza.attrs.to,
				to: stanza.attrs.from,
				type: 'result',
				id: stanza.attrs.id
			}));
		}

	} else if (stanza.is('presence') && (!stanza.attrs.type || stanza.attrs.type === 'available' || stanza.attrs.type === 'unavailable')) {

		from = new JID(stanza.attrs.from);
		var status = stanza.attrs.type || 'available';
		if (from.getResource() && from.getDomain() === this.config.mucHost) {
			this.rooms[from.getLocal()] = this.rooms[from.getLocal()] || {occupants:{}, selfmember:false};
			this.rooms[from.getLocal()].occupants[from.getResource()] = status;
		}

		if (stanza.getChild('x', 'http://jabber.org/protocol/muc#user')) {
			stanza.getChild('x', 'http://jabber.org/protocol/muc#user').getChildren('status').forEach(el => {

				// 110 = self-presence notification
				if (parseInt(el.attrs.code, 10) === 110 && !this.rooms[from.getLocal()].selfmember) {
					this.rooms[from.getLocal()].selfmember = true;
					this.emit('join', from.getLocal());
				}
			});
		}

		// TODO: Read <x xmlns="http://jabber.org/protocol/muc#user">/<item>.name/nick for profile info
		// TODO: Read <show> for status
		this.log.debug("Received presence", {from:stanza.attrs.from, status:status});

	} else {

		this.emit('unhandleddata', stanza);
		this.log.warn("Unrecognised XMPP message", {content:stanza.root().toString()});
	}
};


module.exports = Bot;
