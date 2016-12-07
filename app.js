'use strict'
var WebSocketClient = require('websocket').client
var PlexAPI = require('plex-api')
var PlexAPICredentials = require('plex-api/node_modules/plex-api-credentials')
var EventEmitter = require('events')
var stateEmitter = new EventEmitter()

var wsclient = null
var plexClient = null
var plexUser = null
var plexToken = null

var reconnectInterval = 5000

var playerSessions = {}
var playerStates = {}

var firstRun = true

// Initialise application
module.exports.init = function() {
    console.log('[INITIALISE] Please wait...')
    appStart()
}

// Listening events
stateEmitter.on('PlexEvent', (event) => {
    console.log('[LISTENER] Homey session listener detected event')
    if (playerSessions[event.key]) {
        if (event.state === 'stopped') {
            closedSessionHandler(event)
        }
    }
    if (event.state === 'playing' || event.state === 'paused') {
        openSessionHandler(event)
    } else {
        if (playerSessions[event.key]) {
            console.log('[ERROR] Unwanted state detected:', event.state)
        }
    }
})

// API triggered functions
module.exports.appRestart = function appRestart() {
    console.log('[RESTART] Plex notify detected new settings...')
    stateEmitter.emit('closeWebSocket')
    console.log('[RESTART] Closed any open websockets')
    console.log('[RESTART] Restarting Plex notify now...')
    appStart()
}

// Start application
function appStart() {
    if (!Homey.manager('settings').get('username') || !Homey.manager('settings').get('password') || !Homey.manager('settings').get('ip') || !Homey.manager('settings').get('port')) {
        firstRun = true
    } else {
        firstRun = false
    }
    if (!firstRun) {
        console.log('[START] Plex notify starting...')
            // Erase existing sessions
        playerSessions = {}
            // Erase existing states
        playerStates = {}
            // Commence startup
        loginPlex(getCredentials()).then(websocketListen).catch(function(error) {
            console.log('[ERROR] Plex notify error:', error)
        })
    } else {
        console.log('[ERROR] No settings found - please input settings and save them!')
    }
}

function getCredentials() {
    console.log('[CREDENTIALS] Plex notifdier retrieving credentials...')
    return {
        'plexUsername': Homey.manager('settings').get('username'),
        'plexPassword': Homey.manager('settings').get('password'),
        'plexIP': Homey.manager('settings').get('ip'),
        'plexPort': Homey.manager('settings').get('port'),
    }
}

function loginPlex(credentials) {
    console.log('[LOGIN] Plex notify attempting login...')
    console.log('[LOGIN] Using login credentials:')
    console.log(credentials)
    plexUser = PlexAPICredentials({
        'username': credentials.plexUsername,
        'password': credentials.plexPassword
    })
    plexClient = new PlexAPI({
        'hostname': credentials.plexIP,
        'port': credentials.plexPort,
        'authenticator': plexUser,
        'options': {
            'identifier': 'HomeyPlexNotify',
            'deviceName': 'Homey',
            'version': '1.0.0',
            'product': 'Plex Notify',
            'platform': 'Plex Home Theater',
            'device': 'Linux'
        }
    })
    plexUser.on('token', function(token) {
        console.log('[TOKEN] Waiting for token...')
        plexToken = token
        console.log('[TOKEN] Token found and saved:', token)
    })
    return plexClient.query('/').then(function(result) {
        console.log('[CANDY] Server Name: ' + result.MediaContainer.friendlyName)
        console.log('[CANDY] Server Version: ' + result.MediaContainer.version)
        return Promise.resolve()
    })
}

function websocketListen() {
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
                    // console.log('[WEBSOCKET] Incoming message: ', message)
                    var parsed = JSON.parse(message.utf8Data)
                        // console.log('[WEBSOCKET] Parsed: ', parsed)
                    var data = parsed.NotificationContainer
                        // console.log('[WEBSOCKET] Data: ', data)
                    var type = data.type
                        // console.log('[WEBSOCKET] Type: ', type)
                    if (type === 'playing') {
                        console.log('[WEBSOCKET] Detected session:')
                        console.log(data.PlaySessionStateNotification)
                        console.log('[WEBSOCKET] Detected state: ', data.PlaySessionStateNotification[0].state)
                        stateEmitter.emit('PlexEvent', {
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
    wsclient.connect('ws://' + plexClient.hostname + ':' + plexClient.port + '/:/websockets/notifications?X-Plex-Token=' + plexToken)
}

function closedSessionHandler(event) {
    if (playerSessions[event.key]) {
        console.log('[INFO] Detected state:', event.state)
        triggerFlow(event.state, playerSessions[event.key])
    }
    console.log('[INFO]', playerSessions[event.key].title, 'stopped playing - cleaning sessions / states for', playerSessions[event.key].player)
    delete playerStates[playerSessions[event.key].player]
    delete playerSessions[event.key]
}

function openSessionHandler(event) {
    plexClient.query('/status/sessions/').then(function(result) {
        console.log('[DATA] Sessions Data:', result)
        var session = result.MediaContainer.Metadata.filter(item => item.sessionKey === event.key)
        console.log('[INFO] Detected session:')
        console.log(session)
        console.log('[INFO] Detected player:', session[0].Player.title)
        console.log('[INFO] Detected title:', session[0].title)
        console.log('[INFO] Detected user:', session[0].User.title)
        playerSessions[event.key] = {
            'player': session[0].Player.title,
            'title': session[0].title,
            'user': session[0].User.title
        }
        console.log('[DATA] Sessions:')
        console.log(playerSessions)
        console.log('[DATA] States:')
        console.log(playerStates)
        if (playerStates[session[0].Player.title] != event.state) {
            console.log('[INFO] State changed? Yes')
            playerStates[session[0].Player.title] = event.state
            triggerFlow(event.state, playerSessions[event.key])
        } else {
            console.log('[INFO] State changed? No')
            playerStates[session[0].Player.title] = event.state
        }
    }, function(err) {
        console.log('[ERROR] Could not connect to server:', err)
    })
}

function triggerFlow(newState, tokens) {
    console.log('[INFO] New state:', newState)
    console.log('[INFO] Tokens:', tokens)
    triggerFlowHelper(newState, tokens)
}

function triggerFlowHelper(eventName, tokens, callback) {
    console.log('[TRIGGER FLOW] ' + 'Event: ' + eventName + ' | ' + 'Tokens:', tokens)
    Homey.manager('flow').trigger(eventName, tokens, null, callback)
}
