
var requests = {};

//var port = chrome.extension.connect();
document.body.addEventListener('ExtensionResponse', function() {
    var obj = JSON.parse(document.body.getAttribute('data-extension-response'));

    document.body.removeAttribute('data-extension-response');
    document.body.removeAttribute('data-extension-request');

    if (obj.cmd == 'call') {
        var request_id = obj.data.request_id;
        if (!requests[request_id])  {
            throw 'Unknown Request ID ' + requests[request_id];
        }

        if (obj.data.status == 200 || obj.data.status == 500)  {
            if (!obj.data.response) {
                requests[request_id].error('Server Returned Empty Response');
            } else {
                try {
                    var response = JSON.parse(obj.data.response);
                } catch (e) {
                    return requests[request_id].success(obj.data.response);
                }

                if (response.error) {
                    requests[request_id].error(response.error.message);
                } else {
                    requests[request_id].success(response.result);
                }
            }
        } else if (obj.data.status == 401) {
            requests[request_id].error('Authorization Failed Please Check Your Username & Password');
        } else {
            requests[request_id].error('Server Returned Unknown status ' + obj.data.status);
        }
    }
});

function sendExtensionRequest(obj) {
    var customEvent = document.createEvent('Event');
    customEvent.initEvent('ExtensionRequest', true, true);

    var request_id = ''+Math.floor((Math.random()*10000)+1);

    requests[request_id] = {success : obj.success, error : obj.error};

    obj.data.request_id = request_id;

    document.body.setAttribute('data-extension-request', JSON.stringify(obj));
    document.body.dispatchEvent(customEvent);
}

var JSONRPC = {
    settings : {
        rpcuser: 'username',
        rpcpass: 'password',
        rpcport: '8332',
        rpcssl: false,
        rpcserver: 'localhost'
    },
    url : function() {
        var self = this;
        var url = self.settings.rpcssl ? 'https://' : 'http://';
        return url + self.settings.rpcserver + ':' + self.settings.rpcport + '/';
    },
    call : function (method, params, success, error) {
        var self = this;

        sendExtensionRequest({
            cmd : 'call',
            success : success,
            error : error,
            data : {
                url : JSONRPC.url(),
                method : 'POST',
                username: JSONRPC.settings.rpcuser,
                password: JSONRPC.settings.rpcpass,
                data : JSON.stringify({
                    'method': method,
                    'params': params,
                    'id': method
                })
            }
        });
    }
};

function checkForExtension(success, error) {
    var timeout = setTimeout(error, 2000);

    sendExtensionRequest({
        cmd : 'call',
        success : function() {
            clearTimeout(timeout);
            success();
        },
        error : function() {
            clearTimeout(timeout);
            error();
        },
        data : {
            url : 'https://blockchain.info/ping',
            method : 'POST'
        }
    });
}

function jsonRPCImport(addr, label) {
    setLoadingText('Importing private key Bitcoind');

    JSONRPC.call('validateaddress', [addr], function(response) {
        if (response.ismine) {
            JSONRPC.call('dumpprivkey', [addr], function(priv) {
                getSecondPassword(function() {
                    importPrivateKeyUI(priv, label, downloadAddressList);
                });
            }, function(e) {
                makeNotice('error', 'misc-error', e);
            });
        } else if (response.isvalid && label) {
            makeNotice('success', 'misc-success', 'Added Address book entry');

            if (label && label.length > 0)
                internalAddAddressBookEntry(addr, label);
        }
    });
}


function jsonRPCExport(address, label) {
    console.log('OK');

    getSecondPassword(function() {
        console.log('getSecondPassword');

        var addr = addresses[address];

        var priv = base58ToSipa(addr.priv, addr);

        if (priv == null)
            return;

        if (label == null)
            label = '';

        makeNotice('success', 'misc-success', 'Exported Private key. Your Bitcoin Client may become un-responsive while the blockchain is re-scanned.', 20000);

        JSONRPC.call('importprivkey', [priv, label], function() {

        }, function(e) {
            makeNotice('error', 'misc-error', e);
        });
    });
}


function downloadAddressList() {
    var el = $('#sync-bitcoind');

    var table = el.find('.rpc-address-table');

    table.hide();

    var tbody = table.find('tbody').empty();

    setLoadingText('Fetching Address List from Bitcoind');

    JSONRPC.call('listreceivedbyaddress', [0, true], function(bitcoind_addresses) {
        table.show(200);
        tbody.empty();

        var bitcoind_addresses_strings = [];
        for (var i in bitcoind_addresses) {
            bitcoind_addresses_strings.push(bitcoind_addresses[i].address);
        }

        var buildBitcoind = function(obj) {
            tbody.find('.bitcoind').remove();

            for (var i in bitcoind_addresses) {
                var bitcoind_addr = bitcoind_addresses[i];

                var action = '<a href="#" onclick="jsonRPCImport(\''+bitcoind_addr.address+'\', \''+bitcoind_addr.account+'\')">Import</a>';
                if (addresses[bitcoind_addr.address] && addresses[bitcoind_addr.address].priv) {
                    action = 'Already Exists';
                }

                if (addr.balance > 0)
                    tbody.prepend('<tr class="bitcoind"><td>'+bitcoind_addr.address+'</td><td>'+bitcoind_addr.account+'</td><td>'+ (obj[bitcoind_addr.address] ? formatBTC(obj[bitcoind_addr.address].final_balance) + ' BTC' : 'Unknown') + '</td><td>'+action+'</td></tr>');
                else
                    tbody.append('<tr class="bitcoind"><td>'+bitcoind_addr.address+'</td><td>'+bitcoind_addr.account+'</td><td>'+ (obj[bitcoind_addr.address] ? formatBTC(obj[bitcoind_addr.address].final_balance) + ' BTC' : 'Unknown') + '</td><td>'+action+'</td></tr>');
            }
        };

        BlockchainAPI.get_balances(bitcoind_addresses_strings, buildBitcoind, function(e) {
            makeNotice('error', 'misc-error', e);

            buildBitcoind({});
        });

        for (var i in addresses) {
            var addr = addresses[i];

            var exists = false;
            for (var i in bitcoind_addresses_strings) {
                if (bitcoind_addresses_strings[i] == addr.addr)
                    exists = true;
            }

            if (exists) continue;

            var action = ' <a href="#" onclick="jsonRPCExport(\''+addr.addr+'\', \''+addr.label+'\')">Export</a>';

            if (addr.balance > 0)
                tbody.prepend('<tr><td>'+addr.addr+'</td><td>'+ (addr.label ? addr.label : '') +'</td><td>'+formatBTC(addr.balance)+' BTC </td><td>'+action+'</td></tr>');
            else
                tbody.append('<tr><td>'+addr.addr+'</td><td>'+ (addr.label ? addr.label : '') +'</td><td>'+formatBTC(addr.balance)+' BTC </td><td>'+action+'</td></tr>');
        }

    }, function(e) {
        makeNotice('error', 'misc-error', e);
    });
}

function syncWallet(_success) {
    var el = $('#sync-bitcoind');

    JSONRPC.settings.rpcuser =  el.find('input[name="rpc-user"]').val();
    JSONRPC.settings.rpcpass =  el.find('input[name="rpc-pass"]').val();
    JSONRPC.settings.rpcport = parseInt(el.find('input[name="rpc-port"]').val());
    JSONRPC.settings.rpcssl  = el.find('input[name="rpc-ssl"]').is(':checked');

    var wallet_pass =  el.find('input[name="wallet-pass"]').val();

    if (!JSONRPC.settings.rpcuser || !JSONRPC.settings.rpcpass || JSONRPC.settings.rpcuser.length == 0 || JSONRPC.settings.rpcpass.length == 0 || JSONRPC.settings.rpcport.length <= 0) {
        return;
    }

    if (wallet_pass && wallet_pass.length > 0) {
        JSONRPC.call('walletpassphrase', [wallet_pass, 600], function() {
            if (_success) _success();

            downloadAddressList(el);
        }, function(e) {
            makeNotice('error', 'misc-error', e);
        });
    } else {
        JSONRPC.call('getinfo', [], function() {
            if (_success) _success();

            downloadAddressList(el);
        }, function(e) {
            makeNotice('error', 'misc-error', e);
        });
    }
}
