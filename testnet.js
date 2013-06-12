// A miniature HTTP interface for litecoind

var JSON = require("json"),
    fs = require('fs'),
    os = require('os'),
    express = require('express'),
    http = require('http'),
    _ = require('underscore'),
	colors = require('colors'),
    wallet_interface = require('bitcoin');

var limits = { }

function get_client_ip(req) {
  var ipAddress;
  // Amazon EC2 / Heroku workaround to get real client IP
  var forwardedIpsStr = req.header('x-forwarded-for'); 
  if (forwardedIpsStr) {
    // 'x-forwarded-for' header may return multiple IP addresses in
    // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
    // the first one
    var forwardedIps = forwardedIpsStr.split(',');
    ipAddress = forwardedIps[0];
  }
  if (!ipAddress) {
    // Ensure getting client IP address still works in
    // development environment
    ipAddress = req.connection.remoteAddress;
  }
  return ipAddress;
};


function dpc(t,fn) { if(typeof(t) == 'function') setTimeout(t,0); else setTimeout(fn,t); }

// Read config from the config folder. This function will check for 'name.hostname.cfg'
// and if not present, it will read 'name.cfg'.  This allows user to create a custom 
// local config file without distrupting the main config.
function get_config(name) {

    var host_filename = __dirname + '/config/'+name+'.'+os.hostname()+'.cfg';
    var filename = __dirname + '/config/'+name+'.cfg';
    var data = undefined;
    if(fs.existsSync(host_filename)) {
        data = fs.readFileSync(host_filename);
        console.log("Reading config:",host_filename);
    }
    else {
        data = fs.readFileSync(filename);
        console.log("Reading config:",filename);
    }

    return eval('('+data.toString('utf-8')+')');
}

function no_cache(res, is_json) {
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", 0);
    if(is_json)
        res.contentType('application/json');
}

function Application() {
    var self = this;
    self.status = { }

    var config = get_config('testnet');

    console.log("Starting...".bold);

    self.client = new wallet_interface.Client(config.daemon);

    var app = express();

    app.configure(function(){
        app.use(express.bodyParser());
        app.set('view engine','ejs');
        app.set('view options', { layout : false });
    });

    app.get('/', function(req, res, next) {
        res.render('index.ejs', { self : self, HTTP_POLL_FREQ : config.http_poll_freq });
    });

    app.get('/status', function(req, res) {
        no_cache(res, true);
        res.end(JSON.stringify(self.status));
    });

    app.get('/send', function(req, res) {
        no_cache(res, true);
        if(!req.query.address || !req.query.amount)
            return res.end(JSON.stringify({ error : "address and amount are required" }));

	var ip = get_client_ip(req);

	var limit = 100;

	var amount = parseFloat(req.query.amount);
	if(amount > limit)
		amount = limit;

	if(!limits[ip])
		limits[ip] = 0;

	var to_send = amount;// + limits[ip];
	if(to_send + limits[ip] > limit)
		to_send = limit - limits[ip];

	if(to_send <= 0)
	  return res.end(JSON.stringify({ error : 'maximum amount exceeded, already sent '+limits[ip]+' coins'}));

	limits[ip] += to_send;

        self.client.sendToAddress(req.query.address, to_send ,'', function(err, txhash) {
            if(err)
                return res.end(JSON.stringify(err));

            self.client.getTransaction(txhash, function(err, txinfo) {
                if(err)
                    return res.end(JSON.stringify(err));

                res.end(JSON.stringify(txinfo));
            })

        })
    });

    app.get('/fee', function(req, res) {
        no_cache(res, true);
        if(!req.query.fee)
            return res.end(JSON.stringify({ error : "fee value is required" }));

	var fee = parseFloat(req.query.fee);
	if(fee > 10)
		fee = 10;

        self.client.setTxFee(fee, function(err) {
            if(err)
                return res.end(JSON.stringify(err));

            res.end("\"OK - FEE IS SET TO "+req.query.fee+" (info should change in few sec.)\"");
        })
    });

    app.get('/tx/:txhash', function(req, res) {
        no_cache(res, true);

        if(!req.params.txhash)
            return res.end(JSON.stringify({ error : "txhash is required" }));

        self.client.getTransaction(req.params.txhash, function(err, txinfo) {
            if(err)
                return res.end(JSON.stringify(err));

            res.end(JSON.stringify(txinfo));
        })

    });

    app.get('/block/:blockhash', function(req, res) {
        no_cache(res, true);

        console.log("LOOKING FOR:",req.params.blockhash);

        if(!req.params.blockhash)
            return res.end(JSON.stringify({ error : "blockhash is required" }));

        self.client.getBlock(req.params.blockhash, function(err, blockinfo) {
            if(err)
                return res.end(JSON.stringify(err));

            res.end(JSON.stringify(blockinfo));
        })

    });

    app.use(express.static('http/'));

    console.log("HTTP server listening on ports: ",config.http_port);
    http.createServer(app).listen(config.http_port);

    function init() {
        self.client.getAccountAddress('', function(err, address) {
            if(err) {
                console.error("Unable to obtain account address (RPC reachable?), waiting 2sec...".red.bold, err);
                return dpc(2000, init);
            }

            console.log("Local address:",address);

            self.status.address = address;
            update_status();
        })
    }

    function update_status() {
        self.client.getInfo(function(err, info) {
            if(err)
                console.error("getInfo error:",err);
            self.status.info = info;

            self.client.getPeerInfo(function(err, peer_info) {
                if(err)
                    console.error("getPeerInfo error:", err);
                self.status.peer_info = peer_info;

                self.client.getBalance('*', 0, function(err, balance_0) {
                    if(err)
                        console.error("getBalance error:", err);
                    self.status.balance_0 = balance_0;

                    self.client.getBalance('*', 1, function(err, balance_1) {
                        if(err)
                            console.error("getBalance error:", err);
                        self.status.balance_1 = balance_1;

                        self.status.last_blocks = [ ]

                        var blocks = [ ]
                        var n = info.blocks;
                        for(var i = 0; i < 10; i++)
                            blocks.push(n-i);

                        get_block();

                        function get_block() {

                            var height = blocks.shift();

                            if(!height)
                                return dpc(config.daemon_poll_freq, update_status);

                            self.client.getBlockHash(height, function(err, blockhash) {
                                if(err)
                                    console.error("getBlockHash error:", err);

                                self.status.last_blocks.push({
                                    height : height,
                                    hash : blockhash
                                });

                                get_block();                               
                            })
                        }                        
                    })                
                })                
            })
        })
    }

    dpc(2000, init);
}

GLOBAL.app = new Application();

/*

list of bitcoin API calls included for convenience

  addMultiSigAddress: 'addmultisigaddress',
  backupWallet: 'backupwallet',
  createRawTransaction: 'createrawtransaction', // Bitcoin v0.7+
  decodeRawTransaction: 'decoderawtransaction', // Bitcoin v0.7+
  dumpPrivKey: 'dumpprivkey',
  encryptWallet: 'encryptwallet',
  getAccount: 'getaccount',
  getAccountAddress: 'getaccountaddress',
  getAddressesByAccount: 'getaddressesbyaccount',
  getBalance: 'getbalance',
  getBlock: 'getblock',
  getBlockCount: 'getblockcount',
  getBlockHash: 'getblockhash',
  getConnectionCount: 'getconnectioncount',
  getDifficulty: 'getdifficulty',
  getGenerate: 'getgenerate',
  getHashesPerSecond: 'gethashespersec',
  getHashesPerSec: 'gethashespersec',
  getInfo: 'getinfo',
  getMemorypool: 'getmemorypool',
  getMemoryPool: 'getmemorypool',
  getMiningInfo: 'getmininginfo',
  getNewAddress: 'getnewaddress',
  getPeerInfo: 'getpeerinfo', // Bitcoin v0.7+
  getRawMemPool: 'getrawmempool', // Bitcoin v0.7+
  getRawTransaction: 'getrawtransaction', // Bitcoin v0.7+
  getReceivedByAccount: 'getreceivedbyaccount',
  getReceivedByAddress: 'getreceivedbyaddress',
  getTransaction: 'gettransaction',
  getWork: 'getwork',
  help: 'help',
  importPrivKey: 'importprivkey', // <=================================
  keypoolRefill: 'keypoolrefill',
  keyPoolRefill: 'keypoolrefill',
  listAccounts: 'listaccounts', // <=================================
  listReceivedByAccount: 'listreceivedbyaccount', // <=================================
  listReceivedByAddress: 'listreceivedbyaddress', // <=================================
  listSinceBlock: 'listsinceblock',
  listTransactions: 'listtransactions',
  listUnspent: 'listunspent', // Bitcoin v0.7+
  move: 'move',
  sendFrom: 'sendfrom',
  sendMany: 'sendmany',
  sendRawTransaction: 'sendrawtransaction', // Bitcoin v0.7+
  sendToAddress: 'sendtoaddress',
  setAccount: 'setaccount',
  setGenerate: 'setgenerate',
  setTxFee: 'settxfee',
  signMessage: 'signmessage',
  signRawTransaction: 'signrawtransaction', // Bitcoin v0.7+
  stop: 'stop',
  validateAddress: 'validateaddress',
  verifyMessage: 'verifymessage',
  walletLock: 'walletlock',
  walletPassphrase: 'walletpassphrase',
  walletPassphraseChange: 'walletpassphrasechange'

*/
