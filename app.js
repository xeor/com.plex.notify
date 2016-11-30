"use strict"

var WebSocketClient = require('websocket').client
var EventEmitter = require('events')
var stateEmitter = new EventEmitter()

var wsclient = null

const plexIP = Homey.env.PLEX_HOST
const plexPort = Homey.env.PLEX_PORT
const plexToken = Homey.env.PLEX_TOKEN

var PlexAPI = require("plex-api")

// const client = new PlexAPI({
//     hostname: 'null'
//     username: 'null'
//     password: 'null'
// })

const client = new PlexAPI({
    hostname: Homey.env.PLEX_HOST,
    username: Homey.env.PLEX_USERNAME,
    password: Homey.env.PLEX_PASSWORD
})
 
client.query("/").then(function (result) {
    Homey.log("Plex app running...")
    Homey.log("Server Name: " + result.MediaContainer.friendlyName)
    Homey.log("Server Version: " + result.MediaContainer.version)
 
    // array of children, such as Directory or Server items 
    // will have the .uri-property attached 
    // Homey.log(result)
}, function (err) {
    Homey.log("Could not connect to server", err)
})

websocketListen()

function websocketListen() {

    wsclient = new WebSocketClient()

    wsclient.on('connectFailed', function(error) {
        console.log('Connect Error: ' + error.toString())
        stateEmitter.emit('NotifierState', "socket failed " + error)
        // Attempt a reconnect:
        reconnect()
    })

    wsclient.on('connect', function(connection) {
        console.log('WebSocket Client Connected')
        stateEmitter.emit('NotifierState', 'Connected')

        // Connect error
        connection.on('error', function(error) {
            console.log("Connection Error: " + error.toString())
            stateEmitter.emit('NotifierState', 'Connection Error')
            reconnect()
        })

        //Connect close
        connection.on('close', function() {
            console.log('echo-protocol Connection Closed')
            stateEmitter.emit('NotifierState', 'Connection Closed')
            reconnect()
        })

        // Incoming message from plex media server
        connection.on('message', function(message) {
            if (message.type === 'utf8') {
                try {
                    var response = JSON.parse(message.utf8Data)
                    Homey.log("Response: ", response)
                    Homey.log("Response: ", response.NotificationContainer.PlaySessionStateNotification);
                    if(typeof(response._children) != 'undefined' && typeof response._children[0] == "object"){
                        if(response._children[0]._elementType == 'PlaySessionStateNotification'){
                            stateEmitter.emit('PlexSessionState', {"from": "socket", "status":response._children[0].state, "session": response._children[0].sessionKey, "offset": response._children[0].viewOffset, "key": response._children[0].key})
                        }
                    }
                } 
                catch(e){
                    console.error(e)
                }
                
            }
        })

        stateEmitter.on('closeWebSocket', function(){
            console.log('received socket close event')
            connection.close()
        })

    })

    function reconnect(){
        
        //clear any timers
        clearTimeout(reconnectTimer)

        // Start a new timer and run self.
        reconnectTimer = setTimeout(function(){
            if(settings.enableNotifier){
                console.log("-- Attempting reconnect websockets")
            }
            self.enableNotifier(settings.enableNotifier)
        }, 10000)
    }

    wsclient.connect('ws://' + plexIP + ':' + plexPort + '/:/websockets/notifications?X-Plex-Token=' + plexToken)
}