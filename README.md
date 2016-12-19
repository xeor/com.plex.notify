# Plex notify

This app lets you trigger flows based on Plex player activity.

What triggers works:

* Play
* Pause
* Stop

The app uses tokens that support the following: player name, media title, plex username, media type.

What doesn't:

* Plex media servers lower than 1.3.0

CHANGELOG

v1.0.2

* Added 'type' token to flow cards
* Added help tip to flow cards to explain options
* Removed confidential tokens / credentials from debug info (To avoid issues should people post the output of their debug in the public domain)
* Improved debug logging
