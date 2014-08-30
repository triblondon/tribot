# Tribot, a pluggable XMPP chat bot

This is an XMPP chat bot styled on hubot, which came out of a weekend hacking at creating a bot for Slack.  I wasn't happy with hubot for sending braodcast notifications to multiple rooms, especially those that the bot isn't a member of, and I also don't like coffeescript very much.

## Installation

Not on npm, so:

```
git clone https://github.com/triblondon/tribot.git
cd tribot
npm install
```

Note: the dependency tree includes [node-gyp](https://github.com/TooTallNate/node-gyp) which can [be problematic](https://github.com/TooTallNate/node-gyp/issues/341) to install on MacOS.  I found that using the latest 0.10.* version of Node and the latest version of npm solved the problem.

Now open up config.json and add the username, password and server of the XMPP user account that you want the bot to control.  You can also set `debug` to true if you want verbose output, and configure any plugins that you want.  See the [plugins](lib/plugins) directory for plugin specific documentation.

Now, start the bot:

```
npm start
```

## Configuration

The bot is created by instantiating the `Bot` module, with a single options argument to the constructor, comprising the following properties:

* `jid`: Jabber ID.  Looks a bit like `doodlebot@foo.xmpp.slack.com` (required)
* `password`: Password for this XMPP user (required)
* `host`: Force connection to this XMPP server.  If omitted, will use the hostname in the `jid`
* `mucHost`: Multi-user chat host.  Required to join any group chats.  Typically a subdomain of the registration host
* `rooms`: Array of rooms to join on connect
* `debug`: Boolean, whether to enable verbose output
* `httpPort`: Port on which to run the HTTP server (default 80)


## Extensibility

Tribot uses plugins to provide the services it offers through the chat interface.  A plugin is a module in the `lib/plugins` directory, which must export a `meta` object and a `load` function.  The `meta` object describes the commands that the plugin understands:

```
module.exports.meta = {
	urls: {
		"/rooms/:room": "POST a message to a group chat"
	},
	commands: {
		"hello": "Replies to you in a jolly fashion"
	}
};
```

These are just used for auto-generating documentation, so how you express flexible syntax doesn't matter much.

The `load` function should do the main business of the bot by binding to the `onMessage` event:

```
module.exports.load = function(bot, options) {
	bot.onMessage(/^echo (.+)$/, function(msg, matches) {
		bot.message(msg.fromJid, msg.type, 'Right back at ya:\n'+matches.body[1]);
	});
};

```

`load` receives two arguments: `bot` is a reference to the bot object, which provides the `onMessage` binder as well as methods to send a reply.  `options` contains any options passed to the plugin when it was configured.

The `onMessage` function takes two arguments: a string, regex or object describing the conditions the message must match to trigger this handler, and the handler itself.  If the conditions argument is a string or regex, it will be matched against the message body.  If an object, each item will match against the property of the message identified by its key.

The message handler callback receives two arguments: `msg` is an object describing the message, with the following properties:

* `type`: chat or groupchat
* `room`: For groupchat messages, the room/channel
* `fromNick`: Handle of the user who sent the message
* `fromJid`: Full JID of the user who sent the message
* `body`: The message itself

The second argument to the message handler is an object with the same properties as the message, containing arrays of matches for regex conditions.  For example, in the example above, `matches.body[1]` would be the regex subpattern from the condition.  It's matched the body of the message because no message property was specified, but you can also specify the property if you want to:

```
bot.onMessage({ body: /^echo (.+)$/ }, function(msg, matches) { ... }
```

Having matched a message, you then go search for cat gifs or whatever, and then reply using one of the following methods:

* `bot.messageUser(targetNick, message)` - Send a message to a particular user (useful with `msg.fromNick`)
* `bot.messageRoom(targetRoom, message)` - Send a message to a room (useful with `msg.room`)
* `bot.message(targetJid, type, message)` - Send a message to a raw JID (useful with `msg.fromJid` and `msg.type`)

To enable your new plugin, add a line to the bottom of `index.js`, calling `loadPlugin` on whatever your bot var is:

```
b.loadPlugin('my-splendid-cat-gififyer');
```
