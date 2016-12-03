'use strict'

var Promise = require("bluebird");

var WebSocketClient = require('websocket').client
var PlexAPI = require('plex-api')
var EventEmitter = require('events')
var stateEmitter = new EventEmitter()
var wsclient = null
var plexClient = null

var reconnectInterval = 5000

var plexToken = Homey.env.PLEX_TOKEN
var playerSessions = {}
var playerStates = {}

// Initialise application

module.exports.init = function() {
	Homey.log('[INITIALIZE] Please wait...')
	appStart()	
}

// Listening events

stateEmitter.on('PlexSession', (data) => {
	Homey.log('[LISTENER] Homey session listener detected event')
	if (data.state === 'stopped') {
		if (playerSessions[data.key]) {
			Homey.log('[Info] New state:', data.state)
			playerStates[playerSessions[data.key]] = data.state
			triggerFlow(data.state, {
				'player': playerSessions[data.key]
			})
		}
		delete playerSessions[data.key]
	} else {
		matchPlayer(data)
	}
})

// API triggered functions

module.exports.appRestart = function appRestart() {
	Homey.log('[RESTART] Plex notifier detected new settings...')
	stateEmitter.emit('closeWebSocket')
	Homey.log('[RESTART] Closed any open websockets')
	Homey.log('[RESTART] Restarting Plex notifier now...')
	appStart()
}

// Start application

function appStart() {
	Homey.log('[START] Plex notifier starting...')
    loginPlex(getCredentials())
    .then(websocketListen)
    .catch(function (error) {
    	Homey.log('[ERROR] Plex notifier error:', error)
    	// Homey.log('[START] Plex notifier will retry in 5 seconds...')
    	// setTimeout(appStart, reconnectInterval) // Conflicts with appRestart()
   	})
}

function getCredentials() {
	Homey.log('[CREDENTIALS] Plex notifier retrieving credentials...')
	return ({
		plexUsername: Homey.manager('settings').get('username'),
		plexPassword: Homey.manager('settings').get('password'),
		plexIP: Homey.manager('settings').get('ip'),
		plexPort: Homey.manager('settings').get('port'),
	})
}

function loginPlex(credentials) {
    Homey.log('[LOGIN] Plex notifier attempting login...')
    Homey.log('[LOGIN] Login credentials:')
    Homey.log(credentials)
    plexClient = new PlexAPI({
        hostname: credentials.plexIP,
        username: credentials.plexUsername,
        password: credentials.plexPassword,
        port: credentials.plexPort
    })
    return plexClient.query('/').then(function(result) {
        Homey.log('[CANDY] Server Name: ' + result.MediaContainer.friendlyName)
        Homey.log('[CANDY] Server Version: ' + result.MediaContainer.version)
        return Promise.resolve()
    })
}

function websocketListen(value) {
	wsclient = new WebSocketClient()
	wsclient.on('connectFailed', function(error) {
		Homey.log('[WEBSOCKET] Error: ' + error.toString())
		setTimeout(websocketListen, reconnectInterval)
	})
	wsclient.on('connect', function(connection) {
		Homey.log('[WEBSOCKET] Connected')
		connection.on('error', function(error) {
			Homey.log('[WEBSOCKET] Error: ' + error.toString())
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('close', function() {
			Homey.log('[WEBSOCKET] Closed')
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('message', function(message) {
			if (message.type === 'utf8') {
				try {
					// Homey.log("Incoming message: ", message)
					var parsed = JSON.parse(message.utf8Data)
					// Homey.log('[Info] Parsed: ', parsed)
					var data = parsed.NotificationContainer
					// Homey.log('[Info] Data: ', data)
					var type = data.type
					// Homey.log('[Info] Type: ', type)
					if (type === 'playing') {
						Homey.log('[WEBSOCKET] Detected session...')
						Homey.log('[WEBSOCKET] Found session:', data.PlaySessionStateNotification)
						Homey.log('[WEBSOCKET] Found state:', data.PlaySessionStateNotification[0].state)
						stateEmitter.emit('PlexSession', {
							'state': data.PlaySessionStateNotification[0].state,
							'key': data.PlaySessionStateNotification[0].sessionKey
						})
					}
				} catch (e) {
					console.error(e)
				}
			}
		})
// 		stateEmitter.on('closeWebSocket', function() {
//      	console.log('[WEBSOCKET] Received close event')
//      	connection.close()
//          return Promise.resolve()
//      })
	})

	wsclient.connect('ws://' + plexClient.hostname + ':' + plexClient.port + '/:/websockets/notifications?X-Plex-Token=' + plexToken)
}

function matchPlayer(data) {
	plexClient.query('/status/sessions/').then(function(result) {
		Homey.log('[INFO] Sessions Data:', result)
		var metadata = result.MediaContainer.Metadata
		Homey.log('[INFO] Metadata:', metadata)
		var found = getPlayer(data.key);
		function getPlayer(sessionKey) {
			return metadata.filter(
				function(data) {
					return data.sessionKey == sessionKey
				}
			)
		}
		Homey.log('[INFO] Found player:', found[0].Player.title)
		playerSessions[data.key] = found[0].Player.title
		if (playerStates[found[0].Player.title] != data.state) {
			Homey.log('[INFO] State changed: yes')
			var tokens = {
				'player': found[0].Player.title
			}
			playerStates[found[0].Player.title] = data.state
			playingEventFired(data.state, tokens)
		} else {
			Homey.log('[INFO] State changed: no')
			playerStates[found[0].Player.title] = data.state
		}
	}, function(err) {
		Homey.log('[ERROR] Could not connect to server:', err)
	})
}

function playingEventFired(newState, tokens) {
	if (newState === 'buffering' || newState === 'error') {
		Homey.log('[INFO] New state: ignored')
		return
	}
	Homey.log('[INFO] New state:', newState)
	Homey.log('[INFO] Token:', tokens)
	triggerFlow(newState, tokens)
}

function triggerFlow(eventName, tokens, callback) {
	Homey.log('[TRIGGER FLOW ' + 'Event: ' + eventName + ' | ' + 'Token:', tokens);
	Homey.manager('flow').trigger(eventName, tokens, null, callback)
}