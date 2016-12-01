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
var lastState = null
var playerSessions = {}
var playerStates = {}

// Players to trigger events for
const playerOne = 'Plex Web (Safari)'
const playerTwo = 'Rasplex'

// Required information to connect
const plexIP = Homey.env.PLEX_HOST
const plexPort = Homey.env.PLEX_PORT
const plexToken = Homey.env.PLEX_TOKEN

module.exports.init = function() {
	Homey.log('Plex app running...')
	stateEmitter.on('PlexSession', (data) => {
		Homey.log('Homey session listener detected event!')
		if (data.state === 'stopped') {
		triggerFlow(data.state, { 'player': playerSessions[data.key] })
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
		Homey.log('Server Name: ' + result.MediaContainer.friendlyName)
		Homey.log('Server Version: ' + result.MediaContainer.version)
	}, function(err) {
		Homey.log('Could not connect to server: ', err)
	})
	websocketListen()
}

function websocketListen() {
	wsclient = new WebSocketClient()
	wsclient.on('connectFailed', function(error) {
		Homey.log('WebSocket error: ' + error.toString())
		setTimeout(websocketListen, reconnectInterval)
	})
	wsclient.on('connect', function(connection) {
		Homey.log('WebSocket connected')
		connection.on('error', function(error) {
			Homey.log('WebSocket error: ' + error.toString())
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('close', function() {
			Homey.log('WebSocket closed')
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('message', function(message) {
			if (message.type === 'utf8') {
				try {
					// Homey.log("Incoming message: ", message)
					var parsed = JSON.parse(message.utf8Data)
					// Homey.log('Parsed: ', parsed)
					var data = parsed.NotificationContainer
					// Homey.log('Data: ', data)
					var type = data.type
					// Homey.log('Type: ', type)
					if (type === 'playing') {
						Homey.log('Detected session...')
						Homey.log('Found session: ', data.PlaySessionStateNotification)
						Homey.log('Found state: ', data.PlaySessionStateNotification[0].state)
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
		Homey.log('Sessions Data: ', result)
		var metadata = result.MediaContainer.Metadata
		Homey.log('Metadata: ', metadata)

		var found = getPlayer(data.key);

		function getPlayer(sessionKey) {
			return metadata.filter(
				function(data) {
					return data.sessionKey == sessionKey
				}
			)
		}

		Homey.log('Found player: ', found[0].Player.title)
		playerSessions[data.key] = found[0].Player.title

		if (found[0].Player.title === playerOne) {
			Homey.log('Player is in watchlist')
			if (lastState != data.state) {
				Homey.log('State has changed')
				var tokens = { 'player': found[0].Player.title }
				playerStates[found[0].Player.title] = data.state
				playingEventFired(data.state, tokens)
			} 
			else {
				Homey.log('State has not changed')
				playerStates[found[0].Player.title] = data.state
			}
		}
		
		else {
		Homey.log('Player not in watchlist')
		}
      
	}, function(err) {
		Homey.log('Could not connect to server: ', err)
	})
}

// Trigger flow cards
function playingEventFired(newState, tokens) {
	
	if(newState === 'buffering'){
	Homey.log('New state: Buffering (IGNORED)')
    return
    }
    
	Homey.log('New state: ', newState)
	Homey.log('Token: ', tokens)
	triggerFlow(newState, tokens)
}

// Trigger card helper function to add some debug information
function triggerFlow(eventName, tokens, callback) {
	console.log('[Trigger Flow]: ', eventName, tokens);
	Homey.manager('flow').trigger(eventName, tokens, null, callback)
}