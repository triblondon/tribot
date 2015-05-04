const util = require('util');
const EventEmitter = require('events').EventEmitter;
const xmpp = require('node-xmpp-client');
const ltx = require('ltx');
const JID = require('node-xmpp-core').JID;
const bunyan = require('bunyan');
const bunyanLogentries = require('bunyan-logentries');

"use strict";

class Bot {

	// Options:
	//
	//   - `jid`: Bot's Jabber ID
	//   - `password`: Bot's Jabber password
	//   - `host`: Force host to make XMPP connection to. Otherwise will look up
	//      DNS SRV record on JID's host.
	//   - `mucHost`: Multi-user chat hostname, usually different to the registration host
	//      to power another bot framework (e.g. Hubot).
	//   - `rooms`: Rooms to join (array)
	constructor({jid, password, host, mucHost, rooms, logs, plugins} = {}) {

		// Mix in an event emitter
		EventEmitter.call(this);
		this.setMaxListeners(0);

		// Save basic config in the object
		Object.assign(this, {
			jid,
			password,
			host: host || (new JID(jid)).getDomain(),
			mucHost: mucHost || "conf." + this.host,  // Multi-user conference host

			client: null,
			keepalive: null,
			name: (new JID(this.jid)).getLocal(),
			plugins: {},
			iq_count: 1,
			rooms: {}
		});

		if (logs) {
			let logstreams = [];
			if (logs.logentries) {
				logstreams.push({
					stream: bunyanLogentries.createStream({token: logs.logentries.token}),
					level: logs.logentries.level,
					type:'raw'
				});
			}
			if (logs.stdout) {
				logstreams.push({
					stream: process.stdout,
					level: logs.stdout.level
				});
			}
			this.log = bunyan.createLogger({
				name: 'tribot-'+this.name,
				streams: logstreams
			});
		}

		this.log.info("Bot created");

		Object.keys(plugins).forEach(id => this.loadPlugin(id, plugins[id]));
	}

	// Connects the bot to the server and sets the XMPP event listeners.
	connect() {
		var origSend;

		this.log.debug('Connecting');

		this.client = new xmpp.Client({
			jid: this.jid,
			password: this.password,
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
			this.keepalive = setInterval(() => {
				this.setAvailability('available');
				this.emit('sendping');
			}, 30000);
			this.options.rooms.forEach(this.join.bind(this));
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
	};

	// Updates the bot's availability and status.
	//
	//  - `availability`: away | chat | dnd
	//  - `status`: Status message to display
	setAvailability(availability, status) {
		let packet = new ltx.Element('presence', { type: 'available', id:'status1' }).c('show').t(availability);
		if (status) packet.c('status').t(status);
		this.client.send(packet);
	};

	join(room, historyStanzaCount = 0) {
		let packet = new ltx.Element('presence', { to: room + '@' + this.mucHost + '/' + this.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('history', {
				xmlns: 'http://jabber.org/protocol/muc',
				maxstanzas: String(historyStanzaCount)
			})
		;
		this.client.send(packet);
		this.log.info("Joined room", {room:room});
	};

	leave(room) {
		var packet = new ltx.Element('presence', { type: 'unavailable', from: this.jid+'/'+this.name, to: room + '@' + this.mucHost + '/' + this.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('status').t('hc-leave')
		;
		this.rooms[room].selfmember = false;
		this.client.send(packet);
		this.log.info("Left room", {room:room});
	};

	messageUser(targetJid, message) {
		if (targetJid.indexOf('@') === -1) targetJid += '@'+this.host;
		this.message(targetJid, 'chat', message);
	};

	messageRoom(targetJid, message) {
		if (targetJid.indexOf('@') === -1) targetJid += '@'+this.mucHost;
		this.message(targetJid, 'groupchat', message);
	};

	message(targetJid, type, message) {
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
	sendIq(stanza, callback) {
		stanza = stanza.root(); // work with base element
		let id = this.iq_count++;
		stanza.attrs.id = id;
		this.once('iq:' + id, callback);
		this.client.send(stanza);
	};

	loadPlugin(identifier, options) {
		var plugin = require('./plugins/'+identifier);
		if (typeof(plugin) !== 'object') throw new Error('plugin argument must be an object');
		if (typeof(plugin.load) !== 'function') throw new Error('plugin object must have a load function');

		this.plugins[identifier] = plugin;
		this.plugins[identifier].load(this, options || {});
		this.log.debug('Loaded plugin', {name:identifier, options:options});
	};


	/* Events API */

	// Call a function whenever the bot connects to the server.
	//
	// - `callback`: Function to be triggered: `function ()`
	onConnect(callback) {
		this.on('connect', callback);
	};

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
	};

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
	};

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
	};

}

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

		// Handle a ping request
		} else if (stanza.attrs.type === 'get' && stanza.getChild('ping')) {
			this.log.trace("Inbound XMPP", {type:'iqPing', iqID:stanza.attrs.id});
			this.client.send(new ltx.Element('iq', {
				from: stanza.attrs.to,
				to: stanza.attrs.from,
				type: 'result',
				id: stanza.attrs.id
			}));
		} else {
			this.log.trace("Inbound XMPP", {type:'iqUnknown', iqID:stanza.attrs.id, content:stanza.root().toString()});
		}

	} else if (stanza.is('presence') && (!stanza.attrs.type || stanza.attrs.type === 'available' || stanza.attrs.type === 'unavailable')) {

		from = new JID(stanza.attrs.from);
		var status = stanza.attrs.type || 'available';
		if (from.getResource() && from.getDomain() === this.mucHost) {
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


module.exports = Bot;
