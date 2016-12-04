module.exports = [
    {
        description:	"Restart application",
        method: 		"POST",
        path:			"/restart/",
        fn: function() {     
        	Homey.log("[API] Restart application")
            Homey.app.appRestart()
        }
    }
]