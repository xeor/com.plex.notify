'use strict'
var WebSocketClient = require('websocket').client
var PlexAPI = require('plex-api')
var EventEmitter = require('events')
var stateEmitter = new EventEmitter()

var wsclient = null
var plexClient = null

// If websocket fails, retry after x seconds
var reconnectInterval = 5000

// Store last player state for comparison
var playerSessions = {}
var playerStates = {}

// Required information to connect
const plexIP = Homey.env.PLEX_HOST
const plexPort = Homey.env.PLEX_PORT
const plexToken = Homey.env.PLEX_TOKEN

module.exports.init = function() {
	Homey.log('[Info] Plex app running...')
	stateEmitter.on('PlexSession', (data) => {
		Homey.log('[Info] Homey session listener detected event!')
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
	plexClient = new PlexAPI({
		hostname: Homey.env.PLEX_HOST,
		username: Homey.env.PLEX_USERNAME,
		password: Homey.env.PLEX_PASSWORD
	})
	plexClient.query('/').then(function(result) {
		Homey.log('[Info] Server Name: ' + result.MediaContainer.friendlyName)
		Homey.log('[Info] Server Version: ' + result.MediaContainer.version)
	}, function(err) {
		Homey.log('[Error] Could not connect to server:', err)
	})
	websocketListen()
}

function websocketListen() {
	wsclient = new WebSocketClient()
	wsclient.on('connectFailed', function(error) {
		Homey.log('[Info] WebSocket error: ' + error.toString())
		setTimeout(websocketListen, reconnectInterval)
	})
	wsclient.on('connect', function(connection) {
		Homey.log('[Info] WebSocket connected')
		connection.on('error', function(error) {
			Homey.log('[Info] WebSocket error: ' + error.toString())
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('close', function() {
			Homey.log('[Info] WebSocket closed')
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
						Homey.log('[Info] Detected session...')
						Homey.log('[Info] Found session:', data.PlaySessionStateNotification)
						Homey.log('[Info] Found state:', data.PlaySessionStateNotification[0].state)
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
	})

	wsclient.connect('ws://' + plexIP + ':' + plexPort + '/:/websockets/notifications?X-Plex-Token=' + plexToken)
}

function matchPlayer(data) {
	plexClient.query('/status/sessions/').then(function(result) {
		Homey.log('[Info] Sessions Data:', result)
		var metadata = result.MediaContainer.Metadata
		Homey.log('[Info] Metadata:', metadata)

		var found = getPlayer(data.key);

		function getPlayer(sessionKey) {
			return metadata.filter(
				function(data) {
					return data.sessionKey == sessionKey
				}
			)
		}

		Homey.log('[Info] Found player:', found[0].Player.title)
		playerSessions[data.key] = found[0].Player.title

		if (playerStates[found[0].Player.title] != data.state) {
			Homey.log('[Info] State changed: yes')
			var tokens = {
				'player': found[0].Player.title
			}
			playerStates[found[0].Player.title] = data.state
			playingEventFired(data.state, tokens)
		} else {
			Homey.log('[Info] State changed: no')
			playerStates[found[0].Player.title] = data.state
		}

	}, function(err) {
		Homey.log('[Error] Could not connect to server:', err)
	})
}

// Trigger flow cards
function playingEventFired(newState, tokens) {

	if (newState === 'buffering' || newState === 'error') {
		Homey.log('[Info] New state: ignored')
		return
	}

	Homey.log('[Info] New state:', newState)
	Homey.log('[Info] Token:', tokens)
	triggerFlow(newState, tokens)
}

// Trigger card helper function to add some debug information
function triggerFlow(eventName, tokens, callback) {
	Homey.log('[Trigger flow] ' + 'Event: ' + eventName + ' | ' + 'Token:', tokens);
	Homey.manager('flow').trigger(eventName, tokens, null, callback)
}