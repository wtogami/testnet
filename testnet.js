// A miniature HTTP interface for litecoind

// Configuration:

var HTTP_SERVER_PORT = 8080;

var LITECOIN_RPC_CONFIG = {
    host: '127.0.0.1',
    port: 20332,
    user: 'testnet',
    pass: 'q1w2e3r4'
}

var DAEMON_POLL_FREQ = 5000;
var HTTP_POLL_FREQ = 2000;

// ----------------------------------------------------------

var JSON = require("json"),
    fs = require('fs'),
    os = require('os'),
    express = require('express'),
    http = require('http'),
    _ = require('underscore'),
	colors = require('colors'),
    wallet_interface = require('bitcoin');


function dpc(t,fn) { if(typeof(t) == 'function') setTimeout(t,0); else setTimeout(fn,t); }

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

    console.log("Starting...".bold);

    self.client = new wallet_interface.Client(LITECOIN_RPC_CONFIG);

    var app = express();

    app.configure(function(){
        app.use(express.bodyParser());
        app.set('view engine','ejs');
        app.set('view options', { layout : false });
    });

    app.get('/', function(req, res, next) {
        res.render('index.ejs', { self : self, HTTP_POLL_FREQ : HTTP_POLL_FREQ });
    });

    app.get('/status', function(req, res) {
        no_cache(res, true);
        res.end(JSON.stringify(self.status));
    });

    app.get('/send', function(req, res) {
        no_cache(res, true);
        if(!req.query.address || !req.query.amount)
            return res.end(JSON.stringify({ error : "address and amount are required" }));

        self.client.sendToAddress(req.query.address, parseFloat(req.query.amount), '', function(err, txhash) {
            if(err)
                return res.end(JSON.stringify(err));

            self.client.getTransaction(txhash, function(err, txinfo) {
                if(err)
                    return res.end(JSON.stringify(err));

                res.end(JSON.stringify(txinfo));
            })

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

        if(!req.params.blockhash)
            return res.end(JSON.stringify({ error : "blockhash is required" }));

        self.client.getBlock(req.params.blockhash, function(err, blockinfo) {
            if(err)
                return res.end(JSON.stringify(err));

            res.end(JSON.stringify(blockinfo));
        })

    });

    app.use(express.static('http/'));

    console.log("HTTP server listening on ports: ",HTTP_SERVER_PORT);
    http.createServer(app).listen(HTTP_SERVER_PORT);

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

                        dpc(DAEMON_POLL_FREQ, update_status);
                        
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