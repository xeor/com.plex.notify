module.exports = [
    {
        description:	'Restart app',
        method: 		'POST',
        path:			'/restart/',
        fn: function() {     
            Homey.app.appRestart()
        }
    }
]