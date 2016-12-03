'use strict'

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
	console.log('[INITIALISE] Please wait...')
	appStart()	
}

// Listening events

stateEmitter.on('PlexSession', (data) => {
	console.log('[LISTENER] Homey session listener detected event')
	if (data.state === 'stopped') {
		if (playerSessions[data.key]) {
			console.log('[INFO] New state:', data.state)
			playerStates[playerSessions[data.key].player] = data.state
			triggerFlow(data.state, playerSessions[data.key])
		}
		console.log('INFO: Cleaning up old sessions')
		delete playerSessions[data.key]
	} else {
		sessionHandler(data)
	}
})

// API triggered functions

module.exports.appRestart = function appRestart() {
	console.log('[RESTART] Plex notifier detected new settings...')
	stateEmitter.emit('closeWebSocket')
	console.log('[RESTART] Closed any open websockets')
	console.log('[RESTART] Restarting Plex notifier now...')
	appStart()
}

// Start application

function appStart() {
	console.log('[START] Plex notifier starting...')
	// Erase any existing sessions
	playerSessions= {}
	// Erase any existing states
	playerStates = {}
	// Commence startup logic
    loginPlex(getCredentials())
    .then(websocketListen)
    .catch(function (error) {
    	console.log('[ERROR] Plex notifier error:', error)
    	// console.log('[ERROR] Plex notifier will retry in 5 seconds...')
    	// setTimeout(appStart, reconnectInterval) // Conflicts with appRestart()
   	})
}

function getCredentials() {
	console.log('[CREDENTIALS] Plex notifier retrieving credentials...')
	return {
		plexUsername: Homey.manager('settings').get('username'),
		plexPassword: Homey.manager('settings').get('password'),
		plexIP: Homey.manager('settings').get('ip'),
		plexPort: Homey.manager('settings').get('port'),
	}
}

function loginPlex(credentials) {
    console.log('[LOGIN] Plex notifier attempting login...')
    console.log('[LOGIN] Login credentials:')
    console.log(credentials)
    plexClient = new PlexAPI({
        hostname: credentials.plexIP,
        username: credentials.plexUsername,
        password: credentials.plexPassword,
        port: credentials.plexPort
    })
    return plexClient.query('/').then(function(result) {
        console.log('[CANDY] Server Name: ' + result.MediaContainer.friendlyName)
        console.log('[CANDY] Server Version: ' + result.MediaContainer.version)
        return Promise.resolve()
    })
}

function websocketListen(value) {
	wsclient = new WebSocketClient()
	wsclient.on('connectFailed', function(error) {
		console.log('[WEBSOCKET] Error: ' + error.toString())
		setTimeout(websocketListen, reconnectInterval)
	})
	wsclient.on('connect', function(connection) {
		console.log('[WEBSOCKET] Connected')
		connection.on('error', function(error) {
			console.log('[WEBSOCKET] Error: ' + error.toString())
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('close', function() {
			console.log('[WEBSOCKET] Closed')
			setTimeout(websocketListen, reconnectInterval)
		})
		connection.on('message', function(message) {
			if (message.type === 'utf8') {
				try {
					// console.log("Incoming message: ", message)
					var parsed = JSON.parse(message.utf8Data)
					// console.log('[WEBSOCKET] Parsed: ', parsed)
					var data = parsed.NotificationContainer
					// console.log('[WEBSOCKET] Data: ', data)
					var type = data.type
					// console.log('[WEBSOCKET] Type: ', type)
					if (type === 'playing') {
						console.log('[WEBSOCKET] Detected session...')
						console.log('[WEBSOCKET] Found session:')
						console.log(data.PlaySessionStateNotification)
						console.log('[WEBSOCKET] Found state: ', data.PlaySessionStateNotification[0].state)
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

function sessionHandler(event) {
	plexClient.query('/status/sessions/').then(function(result) {
		console.log('[DATA] Sessions Data:', result)
		
		var session = result.MediaContainer.Metadata.filter(item => item.sessionKey === event.key)
		
		console.log('[INFO] Found session:')
		console.log(session)	
		console.log('[INFO] Found player:', session[0].Player.title)
		console.log('[INFO] Found title:', session[0].title)
		
		playerSessions[event.key] = {
		  player: session[0].Player.title,
		  title: session[0].title
		}
		
		console.log('[DATA] Player sessions:')
		console.log(playerSessions)
		console.log('[DATA] Player states:')
		console.log(playerStates)
		
		if (playerStates[session[0].Player.title] != event.state) {
			console.log('[INFO] State changed: yes')
			playerStates[session[0].Player.title] = event.state
			playingEventFired(event.state, playerSessions[event.key])
		} else {
			console.log('[INFO] State changed: no')
			playerStates[session[0].Player.title] = event.state
		}
	}, function(err) {
		console.log('[ERROR] Could not connect to server:', err)
	})
}

function playingEventFired(newState, tokens) {
	if (newState === 'buffering' || newState === 'error') {
		console.log('[INFO] New state: ignored')
		return
	}
	console.log('[INFO] New state:', newState)
	console.log('[INFO] Token:', tokens)
	triggerFlow(newState, tokens)
}

function triggerFlow(eventName, tokens, callback) {
	console.log('[TRIGGER FLOW] ' + 'Event: ' + eventName + ' | ' + 'Token:', tokens);
	Homey.manager('flow').trigger(eventName, tokens, null, callback)
}