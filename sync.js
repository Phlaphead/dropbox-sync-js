var dbox  = require("dbox");
var fs = require("fs");
var async = require("async");

var allow_uploads = true;
var allow_remote_deletes = true;
var allow_downloads = true;
var allow_local_deletes = true;

var sync_data_file = ".dropbox_sync_data";
var sync_data_path = null;
var settings_file = ".dropbox_settings";
var settings_path = null;

var app = null;
var client = null;
var saved_access_token = null;
var saved_sync_data = null;
var settings = null;
var errors = [];

var local_delta_finished = false;
var remote_delta_finished = false;

// task queue
var queue = async.queue(doTask, 1);


var finished;


/**************************** Startup Functions *******************************/

function start(callback)
{	
	remote_delta_finished = false;
	local_delta_finished = false;
	
	finished = callback;
	async.series(
	[
		setup,
		readSyncDataFile,
		sync
	]);
}


function readSyncDataFile(callback)
{
	//open sync data file
	fs.readFile(sync_data_path, "utf8", function(error, data)
	{
		if(!error)
		{
			saved_sync_data = JSON.parse(data);
		}
		else
		{
			saved_sync_data = {};
			saved_sync_data.files = {};
		}
		callback();
	});
}



function setup(callback)
{
	console.log("Connecting...");
	sync_data_path = getUserHome() + "/" + sync_data_file;
	settings_path = getUserHome() + "/" + settings_file;

	fs.readFile(settings_path, "utf8", function(error, data)
	{
		if(error && error.code == "ENOENT")
		{
			// settings file doesn't exist.
			settings = {};
			initialSetup(callback);
		}
		else if(!error)
		{
			// Get access token and continue
			settings = JSON.parse(data);
			initialSetup(callback);

			//app = dbox.app(settings.app_key);
			//client = app.client(settings.access_token);

			//callback();
		}
	});
}



/**************************** Initial Setup Functions *******************************/

function initialSetup(callback)
{
	async.series(
	[
		getAppKey,
		saveSettings,
		getAppSecret,
		saveSettings,
		authorize,
		saveSettings,
		getSyncDirectory,
		saveSettings
	], callback);
}


function getAppKey(callback)
{
	if(!settings.app_key)
	{
		//https://www.dropbox.com/developers/apps
		console.log();
		console.log("Please visit https://www.dropbox.com/developers/apps and create and app with the following details:");
		console.log("App type: Core API");
		console.log("App name: NodeJSClient_" + Math.floor(Math.random()*Math.pow(2,32)).toString(16));
		console.log("Access:   App folder");
		console.log();
		console.log("App key:");

		settings.app_key = {};

		process.stdin.resume();
		process.stdin.once('data', function(chunk) 
		{
			process.stdin.pause();
			settings.app_key.app_key = chunk.toString().trim();
			callback();
		});
	}
	else
	{
		callback();
	}
}


function getAppSecret(callback)
{
	if(!settings.app_key.app_secret)
	{
		console.log("App secret:");

		process.stdin.resume();
		process.stdin.once('data', function(chunk) 
		{
			process.stdin.pause();
			settings.app_key.app_secret = chunk.toString().trim();
			callback();
		});
	}
	else
	{
		callback();
	}
}

/**
 * Authorise the application to have access to the users dropbox account.
 */
function authorize(callback)
{
	if(!settings.access_token)
	{
		console.log("Authorizing...");

		app = dbox.app(settings.app_key);

		app.requesttoken(function(status, request_token)
		{
			if(status === 200)
			{
				console.log();
				console.log("Please visit the following URL and authorise the application, then press the enter key.");
				console.log(request_token.authorize_url);

				// Wait for keypress
				process.stdin.resume();
				process.stdin.once('data', function(chunk) 
				{ 
					process.stdin.pause();
					app.accesstoken(request_token, function(status, access_token)
					{
						if(status === 200)
						{
							//Save access token
							settings.access_token = access_token;

							//Create client and continue
							client = app.client(settings.access_token);
							callback();
						}
						else
						{
							console.log("ERROR: " + status);
							console.log(access_token);
						}
					});
				});
			}
			else
			{
				console.log("ERROR: Couldn't connect to dropbox.");
			}
		});
	}
	else
	{
		//Create client and continue
		app = dbox.app(settings.app_key);
		client = app.client(settings.access_token);
		callback();
	}
}

function getSyncDirectory(callback)
{
	if(!settings.local_sync_dir)
	{
		console.log();
		console.log("Enter local sync directory ( e.g. /home/user/workspace ):");
		process.stdin.resume();
		process.stdin.once('data', function(chunk) 
		{
			process.stdin.pause();
			settings.local_sync_dir = chunk.toString().trim();
			settings.local_sync_dir = settings.local_sync_dir.replace(/\\/,"/"); //replace \ with /
			
			var dirs = settings.local_sync_dir.split("/");
			settings.remote_sync_dir = "/" + dirs[dirs.length-1];

			callback();
		});
	}
	else
	{
		callback();
	}
}



function saveSettings(callback)
{
	var buffer = JSON.stringify(settings);
	fs.writeFile(settings_path, buffer);
	callback();
}


/****************************** Delta Functions *******************************/

function sync()
{
	getLocalDelta();
}

queue.drain = function() 
{
	if(local_delta_finished && !remote_delta_finished)
	{
		getRemoteDelta();
	}
	else if(local_delta_finished && remote_delta_finished)
	{
		console.log("Finished.");
		
		if(errors.length > 0)
	    {
			console.log("Errors: ");
			errors.forEach(function(error)
			{
				console.log(error);
			});
	    }
	    
	    if(typeof finished=="function")
	    {
	    	finished();
	    }
	}
};

function getRemoteDelta()
{
	console.log("Syncing Remote Changes...");

	client.delta({ cursor:saved_sync_data.cursor }, function(status, reply) 
	{
		saved_sync_data.cursor = reply.cursor;
		if(status == 200)
		{
			reply.entries.forEach(function(entry)
			{
				var remote_path = entry[0];
				var remote_data = entry[1];
				if(remote_data)
				{
					// Use remote_data.path to preserve case in new filenames.
					remote_path = remote_data.path;
				}

				var local_path = getLocalPath(remote_path);
				var sync_data = saved_sync_data.files[local_path];
				
				if(!remote_data && sync_data && sync_data.type == "f")
				{
					// Remote file was deleted and there is a local file, so delete local file
					addTask("rm local", rmLocal, {remote_path: remote_path, local_path: local_path});
				}
				else if(!remote_data && sync_data && sync_data.type == "d")
				{
					// Remote directory was deleted and there is a local directory, so delete local directory
					addTask("rmdir local", rmdirLocal, {remote_path: remote_path, local_path: local_path});
				}
				else if(remote_data && remote_data.is_dir && !sync_data)
				{
					// Remote directory was created and we don't have it, so create local directory
					addTask("mkdir local", mkdirLocal, {remote_path: remote_path, local_path: local_path});
				}
				else if(remote_data && !remote_data.is_dir && !sync_data)
				{
					// Remote file was added and we don't have it, so download it
					addTask("download", download, {remote_path: remote_path, local_path: local_path});
				}
				else if(remote_data && !remote_data.is_dir && sync_data && remote_data.revision > sync_data.rev)
				{
					// Remote file was changed and is a later revision than local one
					addTask("download", download, {remote_path: remote_path, local_path: local_path});
				}
			});
		}
		else
		{
			console.log("ERROR: Getting remote delta");
		}
		
		remote_delta_finished = true;
		if(queue.length() == 0)
		{
			queue.drain();
		}
	});
}

function getLocalDelta()
{
	console.log("Syncing Local Changes...");
	
	listLocalFiles(settings.local_sync_dir, function(error, file_list) 
	{
		if (error) throw error;
		
		for(var path in file_list)
		{
			var file_data = file_list[path];
			var sync_data = saved_sync_data.files[path];
			
			if(!sync_data && file_data.type == 'f')
			{
				// File has never been synced so it needs to be uploaded.
				addTask("upload", upload, {local_path: path});
			}
			else if(!sync_data && file_data.type == 'd')
			{
				// Directory has never been synced so it needs to be uploaded.
				addTask("mkdir remote", mkdirRemote, {local_path: path});
			}
			else if(sync_data && !sync_data.ignore && file_data.mod_time > new Date(Date.parse(sync_data.date)))
			{
				// File has been modified after last sync.
				addTask("upload", upload, {local_path: path});
			}
		}
		
		for(path in saved_sync_data.files)
		{
			var file_data = file_list[path];
			var sync_data = saved_sync_data.files[path];
			
			if(!file_data && (!sync_data.type || sync_data.type == "f"))
			{
				//File previously synced has been deleted
				addTask("rm remote", rmRemote, {local_path: path});
			}
			else if(!file_data && sync_data.type && sync_data.type == "d" && path != settings.local_sync_dir)
			{
				//Directory previously synced has been deleted
				addTask("rmdir remote", rmdirRemote, {local_path: path});
			}
		}
		
		local_delta_finished = true;
		if(queue.length() == 0)
		{
			queue.drain();
		}
	});
}



function listLocalFiles(dir, callback)
{
	var results = {};
	fs.readdir(dir, function(error, list) 
	{
		if (error) return callback(error);
		var i = 0;
		(function next() 
		{
			var file = list[i++];
			if (!file) return callback(null, results);
			file = dir + '/' + file;
			fs.stat(file, function(err, stat) 
			{
				if (stat && stat.isDirectory()) 
				{
					var file_data = {};
					file_data.type = "d";
					results[file] = file_data;
					
					listLocalFiles(file, function(err, res) 
					{
						results = collect(results, res);
						next();
					});
				} 
				else 
				{
					var file_data = {};
					file_data.type = "f"; 
					file_data.mod_time = stat.mtime;
					results[file] = file_data;
					next();
				}
			});
		})();
	});
}




/**************************** Task Processing *********************************/

function addTask(name, op, options)
{
	var task = {};
	task.name = name;
	task.op = op;
	task.options = options;
	queue.push(task);
	return task;
}


function doTask(task, callback)
{
	if(task.options.local_path && !task.options.remote_path)
	{
		task.options.remote_path = getRemotePath(task.options.local_path);
	}
	else if(task.options.remote_path && !task.options.local_path)
	{
		task.options.local_path = getLocalPath(task.options.remote_path);
	}
	
	if(typeof(task.op) == "function")
	{
		task.op(task, callback);
	}
	else
	{
		console.log("ERROR: task.op is not a function");
	}
}


function getRemotePath(local_path)
{
	var common_path = local_path.substring(settings.local_sync_dir.length);
	var remote_path = settings.remote_sync_dir + common_path;
	return remote_path;
}

function getLocalPath(remote_path)
{
	var common_path = remote_path.substring(settings.remote_sync_dir.length);
	var local_path = settings.local_sync_dir + common_path;

	//local path may be a different case, so need to search for the path
	for(var path in saved_sync_data.files)
	{
		if(path.toLowerCase() == local_path.toLowerCase())
		{
			local_path = path;
		}
	}

	return local_path;
}


/****************************** File Operations *******************************/

function upload(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Uploading " + local_path + " --> " + remote_path);

	if(allow_uploads)
	{
		fs.readFile(local_path, function(error, data)
		{
			if(error) throw error;

			// doesn't like empty buffer, so change it to empty string
			if(data.length == 0)
			{
				data = "";
			}

			client.put(remote_path, data, function(status, metadata)
			{
				if(status == 200)
				{
					//save sync data
					setFileSyncData(local_path, metadata.revision, "f");
				}
				else if(status == 503 || status == null)
				{
					// Rate limit reached, put back on queue to try again later.
					console.log("ERROR: 503 - Rate limited - will try again.");
					queue.push(task);
				}
				else if(status == 400 && metadata.error.indexOf("ignored file list") !== -1)
				{
					// Ignore file
					console.log(metadata.error);
					setFileSyncData(local_path, metadata.revision, "f", true);
				}
				else
				{
					logError(
					{
						code: status,
						message: metadata ? metadata.error : "Unknown Error",
						local_path : local_path,
						remote_path : remote_path
					});
				}
				
				callback();
			});
		});
	}
	else
	{
		callback();
	}
}

function download(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Downloading " + local_path + " <-- " + remote_path);

	if(allow_downloads)
	{
		client.get(remote_path, function(status, data, metadata) 
		{
			if(status == 200)
			{
				fs.writeFile(local_path, data, function(error)
				{
					if(!error)
					{
						//save sync data
						setFileSyncData(local_path, metadata.revision, "f");
					}
				});
			}
			else if(status == 503)
			{
				//rate limit reached, put back on queue to try again later.
				console.log("ERROR: 503 - Rate limited - will try again.");
				queue.push(task);
			}
			else
			{
				logError(
				{
					code: status,
					message: "Error downloading file",
					local_path : local_path,
					remote_path : remote_path
				});
			}
			
			callback();
		});
	}
	else
	{
		callback();
	}
}

function mkdirLocal(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Creating Local Directory " + local_path + " <-- " + remote_path);

	if(allow_downloads)
	{
		fs.mkdir(local_path, "0777", function(error)
		{
			setFileSyncData(local_path, null, "d");
			callback();
		});
	}
	else
	{
		callback();
	}
}

function mkdirRemote(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Creating Remote Directory " + local_path + " --> " + remote_path);

	if(allow_uploads)
	{
		client.mkdir(remote_path, function(status, reply)
		{
			if(status == 200)
			{
				setFileSyncData(local_path, null, "d");
				callback();
			}
			else if(status == 503)
			{
				// Rate limit reached, put back on queue to try again later.
				console.log("ERROR: 503 - Rate limited - will try again.");
				queue.push(task);
			}
			else if(status == 403 && reply.error.indexOf("already exists") !== -1)
			{
				// Directory already exists
				setFileSyncData(local_path, null, "d");
				callback();
			}
			else
			{
				logError(
				{
					code: status,
					message: reply.error,
					local_path : local_path,
					remote_path : remote_path
				});
			}
		});
	}
	else
	{
		callback();
	}
}

function rmLocal(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Deleting Local File " + local_path + " x-- " + remote_path);
	
	if(allow_local_deletes)
	{
		fs.unlink(local_path, function(error) 
		{
			if(error)
			{
				logError(error);
			}
			
			removeFileSyncData(local_path);
			callback();
		});
	}
	else
	{
		callback();
	}
}

function rmRemote(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Deleting Remote File " + local_path + " --x " + remote_path);
	
	if(allow_remote_deletes)
	{
		client.rm(remote_path, function(status, reply) 
		{
			if(status == 200 || status == 404)
			{
				removeFileSyncData(local_path);
			}
			else if(status == 503)
			{
				//rate limit reached, put back on queue to try again later.
				console.log("ERROR: 503 - Rate limited - will try again.");
				queue.push(task);
			}
			else
			{
				logError(
				{
					code: status,
					message: "Error deleting remote file",
					local_path : local_path,
					remote_path : remote_path
				});
			}
			
			callback();
		});
	}
	else
	{
		callback();
	}
}

function rmdirLocal(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Deleting Local Directory " + local_path + " x-- " + remote_path);
	
	if(allow_local_deletes)
	{
		fs.removeRecursive(local_path, function(error)
		{
			if(error)
			{
				console.log(error);
			}
			
			callback();
		});
	}
	else
	{
		callback();
	}
}

function rmdirRemote(task, callback)
{
	var local_path = task.options.local_path;
	var remote_path = task.options.remote_path;
	console.log("Deleting Remote Directory " + local_path + " --x " + remote_path);
	
	if(allow_remote_deletes)
	{
		client.rm(remote_path, function(status, reply) 
		{
			if(status == 200 || status == 404)
			{
				removeFileSyncData(local_path);
			}
			else if(status == 503)
			{
				//rate limit reached, put back on queue to try again later.
				console.log("ERROR: 503 - Rate limited - will try again.");
				queue.push(task);
			}
			else
			{
				logError(
				{
					code: status,
					message: "Error deleting remote directory",
					local_path : local_path,
					remote_path : remote_path
				});
			}
			
			callback();
		});
	}
	else
	{
		callback();
	}
}



fs.removeRecursive = function(path, callback)
{
	var self = this;

	fs.stat(path, function(err, stats) 
	{
		if(err)
		{
			callback(err,stats);
			return;
      	}
		if(stats.isFile())
		{
			fs.unlink(path, function(err) 
			{
				if(err) 
				{
					callback(err,null);
				}
				else
				{
					removeFileSyncData(path);
					callback(null,true);
				}
				return;
			});
		}
		else if(stats.isDirectory())
		{
			// A folder may contain files
			// We need to delete the files first
			// When all are deleted we could delete the 
			// dir itself
			fs.readdir(path, function(err, files) 
			{
				if(err)
				{
					callback(err,null);
					return;
				}
				var f_length = files.length;
				var f_delete_index = 0;

				// Check and keep track of deleted files
				// Delete the folder itself when the files are deleted

				var checkStatus = function()
				{
					// We check the status
					// and count till we r done
					if(f_length===f_delete_index)
					{
						fs.rmdir(path, function(err) 
						{
							if(err)
							{
								callback(err,null);
							}
							else
							{ 
								removeFileSyncData(path);
								callback(null,true);
							}
						});
						return true;
					}
					return false;
				};
				if(!checkStatus())
				{
					for(var i=0;i<f_length;i++)
					{
						// Create a local scope for filePath
						// Not really needed, but just good practice
						// (as strings arn't passed by reference)
						(function()
						{
							var filePath = path + '/' + files[i];
							// Add a named function as callback
							// just to enlighten debugging
							fs.removeRecursive(filePath,function removeRecursiveCB(err,status)
							{
								if(!err)
								{
									f_delete_index ++;
									checkStatus();
								}
								else
								{
									callback(err,null);
									return;
								}
							});
						})()
					}
				}
			});
		}
	});
};




function removeFileSyncData(local_path)
{
	delete saved_sync_data.files[local_path];
	
	saveFileSyncData();
}


function setFileSyncData(local_path, sync_revision, type, ignore)
{
	saved_sync_data.files[local_path] = {};
	saved_sync_data.files[local_path].rev = sync_revision;
	saved_sync_data.files[local_path].date = new Date();
	saved_sync_data.files[local_path].type = type;
	if(ignore) saved_sync_data.files[local_path].ignore = ignore;
	
	saveFileSyncData();
}

function saveFileSyncData()
{
	var buffer = new Buffer(JSON.stringify(saved_sync_data));
	fs.writeFile(sync_data_path, buffer, function(error) 
	{
		if(error) throw error;
	});
}


function logError(error)
{
	errors[errors.length] = error;
	console.log(error);
}



/******************************** Utilities **********************************/

function getUserHome() 
{
	var home = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
	if(!home)
	{
		home = "/home/root";
	}
	return home 
}

function collect() 
{
	var ret = {};
	var len = arguments.length;
	for (var i=0; i<len; i++) 
	{
		for (p in arguments[i]) 
		{
			if (arguments[i].hasOwnProperty(p)) 
			{
				ret[p] = arguments[i][p];
			}
		}
	}
	return ret;
}

exports.start = start;

start();
