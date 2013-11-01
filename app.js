var JSON = require("json"),
	_ = require("underscore"),
    spawn = require("child_process").spawn,
	colors = require('colors');

function dpc(t,fn) { if(typeof(t) == 'function') setTimeout(t,0); else setTimeout(fn,t); }

function Process(options)
{
    var self = this;
    self.options = options;
    self.relaunch = true;

    if(!options.descr)
        throw new Error("descr option is required");

    self.terminate = function()
    {
        if(self.process) {
            self.relaunch = false;
            self.process.kill('SIGTERM');
            delete self.process;
        }
        else
            console.error("Unable to terminate process, no process present");
    }

    self.restart = function()
    {
        if(self.process)
            self.process.kill('SIGTERM');
    }

    self.run = function()
    {
        if(self.process) {
            console.error(self.options);
            throw new Error("Process is already running!");
        }

        self.relaunch = true;
        self.process = spawn(self.options.process, self.options.args)

        self.process.stdout.on('data',function (data) {
            process.stdout.write(data);
            if(options.logger)
                options.logger.write(data);
        });

        self.process.stderr.on('data',function (data) {
            process.stderr.write(data);
            if(options.logger)
                options.logger.write(data);
        });

        self.stdin = process.openStdin();
        self.stdin.on('data', function(data) {
            self.process.stdin.write(data);
        });

        self.process.on('exit',function (code) {
            if(code) {
                console.log("WARNING - Child process '"+self.options.descr.toUpperCase()+"' exited with code "+code);
            }

            delete self.process;

            if(self.relaunch) {
                console.log("Restarting '"+self.options.descr.toUpperCase()+"'");
                dpc(self.run, options.restart_delay || 0);
            }
        });
    }
}

function Application() {

	var self = this;

    self.process = { }
	var processes = 
	{
		'testnet' : { script: 'testnet.js' },
	}

    _.each(processes, function(o, name){
    	self.process[name] = new Process({ 
    		process: o.process || process.execPath, 
    		args: o.script ? [o.script] : o.args, 
    		descr : name
    	});
    	self.process[name].run();
    });

}

GLOBAL.app = new Application();

