# dropbox-sync-js

This is a node.js script which provides a two way sync between a local folder and a dropbox folder. This is useful for use on systems where the dropbox client is not available such as ARM systems (e.g. BeagleBone, Raspberry Pi).


## Installation

Clone the repository:

	git clone git://github.com/Phlaphead/dropbox-sync-js.git

Install dependencies

	npm install


## Configuration

Run the dropbox sync with the following command:

	node sync.js

The first time it is run it will give ask for the configuration options. Follow the instructions given.

	Please visit https://www.dropbox.com/developers/apps and create and app with the following details:
	App type: Core API
	App name: NodeJSClient_xxxxxxxx
	Access:   App folder

I recommend restricting access to an app folder. Syncing with full dropbox access has not been tested.
After doing this, the dropbox website will give you and 'app key' and an 'app secret'. Enter these at the promtps.

	Enter app key:
	xjbbs5c2iq8yqhh
	Enter app secret:
	6bdhfk5bfbuwhv8

After entering these you will be given another url to visit in a browser to authorise the app with dropbox.

	Please visit the following URL and authorise the application, then press the enter key.


After allowing access, press enter to continue. You will then be prompted to enter the local directory which you want to sync with the dropbox folder.

	Enter local sync directory ( e.g. /home/user/workspace ):

You should enter the full path of the folder you want to sync. After entering this it will attempt to sync the local folder with the dropbox folder with the same name.

If the local folder exists then the entire contents will be uploaded to dropbox. If any files with the same name already exist on dropbox then they will be overwritten.
If the local folder doesn't exist and a folder already exists in dropbox then it will be downloaded. If the folder exists neither locally or in dropbox then nothing will happen.


## Usage

### Syncing

After configuration the saem command is used to do a sync:

	node sync.js

This performs the following operations in this order:

* Any files that have been changed locally will be uploaded to dropbox (Overwriting any conflicting changes).
* Any files that have been deleted locally will be deleted from dropbox (Even if the dropbox file has changed).
* Any files that have been changed in dropbox will be downloaded.
* Any files that have been deleted in dropbox will be deleted locally.

Configuration is stored in the file ~/.dropbox_settings (where ~ is your home directory). Changes to configuration can be made by editing this file, or deleting it and running the script again.


### Excluding Files

To add an exclude pattern, use the command:

	node sync.js exclude [pattern]

Where [pattern] is the pattern of the file or directory you want to exclude. It can contain * and ? wildcard characters.

e.g.

	node sync.js exclude *~
	node sync.js exclude .git
	node sync.js exclude build

Use exclude without a pattern to list all of the exclude patterns currently in use.

If the excluded files have already been synced then they will be removed from dropbox during the next sync.

To remove and excluded pattern use the include command:

	node sync.js include build

This will remove the pattern from the exclude list.


### Quota

This command:

	node sync.js quota

Will tell you your dropbox quota and the amount of space used.


## Tested Environments

* Angstrom Linux / BeagleBone
* Windows

If you have successfully used this script on other platforms please let me know.


## To Do

* Add ability to sync multiple folders


## Disclaimer

This script is provided "as is" and I cannot guarantee that it is free of defects, and you use it at your own risk.

I do not accept any responsibilty for any loss of data or damage caused due to the use of this software.

