function _ImportExport() {
    function _DesktopSync() {
        var requests = {};

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

        this.checkForExtension = function(success, error) {
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
                    method : 'POST',
                    data : ''
                }
            });
        }

        function jsonRPCImport(addr, label) {
            MyWallet.setLoadingText('Importing private key Bitcoind');

            JSONRPC.call('validateaddress', [addr], function(response) {
                if (response.ismine) {
                    JSONRPC.call('dumpprivkey', [addr], function(priv) {
                        MyWallet.getSecondPassword(function() {
                            importPrivateKeyUI(priv, label, downloadAddressList);
                        });
                    }, function(e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    });
                } else if (response.isvalid && label) {
                    MyWallet.makeNotice('success', 'misc-success', 'Added Address book entry');

                    if (label && label.length > 0)
                        MyWallet.addAddressBookEntry(addr, label);
                }
            });
        }

        function jsonRPCExport(address, label) {
            MyWallet.getSecondPassword(function() {
                if (!MyWallet.addressExists(address))
                    return;

                var priv = MyWallet.base58ToSipa(MyWallet.getPrivateKey(address), address);

                if (priv == null)
                    return;

                if (label == null)
                    label = '';

                MyWallet.makeNotice('success', 'misc-success', 'Exported Private key. Your Bitcoin Client may become un-responsive while the blockchain is re-scanned.', 20000);

                JSONRPC.call('importprivkey', [priv, label], function() {

                }, function(e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                });
            });
        }

        function downloadAddressList() {
            var el = $('#sync-bitcoind');

            var table = el.find('.rpc-address-table');

            table.hide();

            var tbody = table.find('tbody').empty();

            MyWallet.setLoadingText('Fetching Address List from Bitcoind');

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

                        var action = '<a href="#" class="act-import">Import</a>';
                        if (MyWallet.addressExists(bitcoind_addr.address) && !MyWallet.isWatchOnly(bitcoind_addr.address)) {
                            action = 'Already Exists';
                        }

                        var tr = $('<tr class="bitcoind"><td>'+bitcoind_addr.address+'</td><td>'+bitcoind_addr.account+'</td><td>'+ (obj[bitcoind_addr.address] ? formatBTC(obj[bitcoind_addr.address].final_balance) + ' BTC' : 'Unknown') + '</td><td>'+action+'</td></tr>');

                        (function(bitcoind_addr) {
                            tr.find('.act-import').click(function() {
                                jsonRPCImport(bitcoind_addr.address, bitcoind_addr.account);
                            });
                        })(bitcoind_addr);

                        if (MyWallet.getAddressBalance(bitcoind_addr.address) > 0)
                            tbody.prepend();
                        else
                            tbody.append(tr);
                    }
                };

                BlockchainAPI.get_balances(bitcoind_addresses_strings, buildBitcoind, function(e) {
                    MyWallet.makeNotice('error', 'misc-error', e);

                    buildBitcoind({});
                });

                var addresses = MyWallet.getAllAddresses();
                for (var i in addresses) {
                    var address = addresses[i];

                    var exists = false;
                    for (var i in bitcoind_addresses_strings) {
                        if (bitcoind_addresses_strings[i] == address)
                            exists = true;
                    }

                    if (exists) continue;

                    var label = MyWallet.getAddressLabel(address);

                    var balance = MyWallet.getAddressBalance(address);

                    var action = ' <a href="#" onclick="jsonRPCExport(\''+address+'\', \''+label+'\')">Export</a>';

                    tbody.prepend('<tr><td>'+address+'</td><td>'+ (label ? label : '') +'</td><td>'+formatBTC(balance)+' BTC </td><td>'+action+'</td></tr>');
                }

            }, function(e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });
        }


        this.syncWallet = function(_success) {
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

                    downloadAddressList();
                }, function(e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                });
            } else {
                JSONRPC.call('getinfo', [], function() {
                    if (_success) _success();

                    downloadAddressList();
                }, function(e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                });
            }
        }
    };

    this.init = function(container, success, error) {
        MyWallet.setLoadingText('Loading Import Export View');

        if (!container.is(':empty')) {
            bind();
            success();
            return;
        }

        $.ajax({
            type: "GET",
            url: root + 'wallet/import-export-template',
            data : {format : 'plain'},
            success: function(html) {
                try {
                    container.html(html);

                    bind();

                    success();
                } catch (e) {
                    console.log(e);

                    error();
                }
            },
            error : function() {
                MyWallet.makeNotice('error', 'misc-error', 'Error Downloading Account Settings Template');

                error();
            }
        });
    }

    function showWatchOnlyWarning(address, success) {
        var modal = $('#watch-only-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });


        modal.center();

        modal.find('.address').text(address);

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });

        modal.find('.btn.btn-primary').unbind().click(function() {
            success();

            modal.modal('hide');
        });
    }

    function bind() {
        $('a[data-toggle="tab"]').unbind().on('show', function(e) {
            $(e.target.hash).trigger('show');
        });

        $('#sync-bitcoind').on('show', function() {
            var DesktopSync = new _DesktopSync();

            $('#rpc-step-1').hide();
            $('#rpc-step-2').hide();
            $('#rpc-body').hide();

            DesktopSync.checkForExtension(function(data) {
                $('#rpc-step-2').show(200);

                DesktopSync.syncWallet(function() {
                    $('#rpc-step-2').hide();
                    $('#rpc-body').show();
                });
            }, function(e) {
                $('#rpc-step-1').show(200);
            });

            $("#sync-bitcoind-btn").unbind().click(function() {
                DesktopSync.syncWallet();
            });

            $("#rpc-continue-btn").unbind().click(function() {
                $('#rpc-step-2').hide();
                $('#rpc-body').show(200);
            });
        });

        $("#import-json-btn").unbind().click(function() {

            $(this).attr("disabled", true);

            importTextArea($('#import-json'));

            $(this).attr("disabled", false);
        });

        $('#import-address-btn').unbind().click(function() {
            var value = $.trim($('#import-address-address').val());

            if (value.length = 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter an address to import');
                return;
            }

            try {
                var address = new Bitcoin.Address(value);

                if (address.toString() != value) {
                    throw 'Inconsistency between addresses';
                }

                $('#import-address-address').val('');

                showWatchOnlyWarning(value, function() {
                    try {
                        if (MyWallet.addWatchOnlyAddress(value)) {
                            MyWallet.makeNotice('success', 'added-address', 'Successfully Added Address ' + address);

                            try {
                                ws.send('{"op":"addr_sub", "addr":"'+address+'"}');
                            } catch (e) { }

                            //Backup
                            MyWallet.backupWallet('update', function() {
                                MyWallet.get_history();
                            });
                        } else {
                            throw 'Wallet Full Or Addresses Exists'
                        }
                    } catch (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    }
                });
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing address: ' + e);
                return;
            }
        });

        $('#import-private-scan').unbind().click(function() {
            MyWallet.getSecondPassword(function() {
                loadScript('wallet/signer', function() {
                    showPrivateKeyModal(function (key) {
                        if (MyWallet.addPrivateKey(key)) {

                            //Perform a wallet backup
                            MyWallet.backupWallet('update', function() {
                                MyWallet.get_history();
                            });

                            MyWallet.makeNotice('success', 'added-address', 'Imported Bitcoin Address ' + key.getBitcoinAddress());
                        } else {
                            throw 'Unable to add private key for bitcoin address ' + key.getBitcoinAddress();
                        }

                    }, function(e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    }, 'Any Private Key');
                });
            });
        });

        $('#import-private-btn').unbind().click(function() {
            var input = $('#import-private-key');

            try {
                importPrivateKeyUI($.trim(input.val()));
            } catch(e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }

            input.val('');
        });

        $('#import-brain-wallet-btn').unbind().click(function() {

            var input = $('#import-brain-wallet');

            var phrase = $.trim(input.val());

            // enforce a minimum passphrase length
            if (phrase.length < 15) {
                MyWallet.makeNotice('error', 'misc-error', 'The passphrase must be at least 15 characters long');
                return;
            }
            var bytes = Crypto.SHA256(phrase, { asBytes: true });

            try {
                importPrivateKeyUI(Bitcoin.Base58.encode(bytes), 'Brain Wallet');
            } catch(e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }

            input.val('');
        });

        $('#export-priv-format').change(function (e) {
            $("#json-unencrypted-export").val(MyWallet.makeWalletJSON($('#export-priv-format').val()));
        });

        $('#export-crypted').on('show', function() {
            $("#json-crypted-export").val(MyWallet.getEncryptedWalletData());
        });

        $('#export-unencrypted').on('show', function() {
            MyWallet.getSecondPassword(function() {
                $('#export-priv-format').val('base58');
                $("#json-unencrypted-export").val(MyWallet.makeWalletJSON($('#export-priv-format').val()));
            });
        });

        $('#import-backup').on('show', function() {
            var self = this;

            loadBackupsList($(self));
        });

        $('#export-paper-btn').click(function() {
            MyWallet.getSecondPassword(function() {
                var popup = window.open(null, null, "width=700,height=800,toolbar=1");

                loadScript('wallet/jquery.qrcode', function() {
                    try {
                        if (popup == null) {
                            MyWallet.makeNotice('error', 'misc-error', 'Failed to open popup window');
                            return;
                        }

                        var addresses_array = MyWallet.getAllAddresses();

                        popup.document.write('<!DOCTYPE html><html><head></head><body><h1>Paper Wallet</h1></body></html>');

                        var container = $('body', popup.document);

                        var table = $('<table style="page-break-after:always;"></table>', popup.document);

                        container.append(table);

                        var ii = 0;
                        var ii_appended = 0;
                        var append = function() {
                            try {
                                var address = addresses_array[ii];

                                if (!MyWallet.addressExists(address))
                                    return;

                                ++ii;

                                if (MyWallet.getAddressTag(address) == 2) {//Skip archived
                                    setTimeout(append, 10);
                                    return;
                                } else if (MyWallet.isWatchOnly(address)) {
                                    setTimeout(append, 10);
                                    return;
                                }

                                var display_pk = MyWallet.base58ToSipa(MyWallet.getPrivateKey(address), address);

                                var row = $('<tr></tr>', popup.document);

                                //Add Address QR code
                                var qrspan = $('<td><div style="margin:10px;overflow:hidden"></div></td>', popup.document);

                                qrspan.children(":first").qrcode({width: 200, height: 200, text: display_pk});

                                row.append(qrspan);

                                var label = '';
                                if (MyWallet.getAddressLabel(address))
                                    label = MyWallet.getAddressLabel(address) + ' - ';

                                var body = $('<td><h3>' + address + '</h3><small><p><b>' + display_pk + '</b></p></small><p>'+label+'Balance ' + formatBTC(MyWallet.getAddressBalance(address)) + ' BTC</p> </td>', popup.document);

                                row.append(body);

                                if (MyWallet.getAddressBalance(address) > 0)
                                    table.prepend(row);
                                else
                                    table.append(row);

                                if ((ii_appended+1) % 3 == 0) {
                                    table = $('<table style="page-break-after:always;"></table>', popup.document);
                                    container.append(table);
                                }

                                ii_appended++;

                                if (ii < addresses_array.length) {
                                    setTimeout(append, 10);
                                }
                            } catch (e) {
                                MyWallet.makeNotice('error', 'error-paper', e);
                            }
                        };

                        append();

                    } catch (e) {
                        MyWallet.makeNotice('error', 'error-paper', e);
                    }
                });
            });
        });
    }

    this.importJSON = function(input_text, opt, success, error) {
        try {
            var nKeysFound = 0;

            if (input_text == null || input_text.length == 0) {
                throw 'No import data provided!';
            }

            var obj = null;

            try {
                //First try a simple decode
                obj = $.parseJSON(input_text);

                if (obj == null)
                    throw 'null input_text';
            } catch(e) {
                //Maybe it's encrypted?
                MyWallet.decrypt(input_text, opt.main_password, MyWallet.getDefaultPbkdf2Iterations(), function(decrypted) {
                    try {
                        obj = $.parseJSON(decrypted);

                        return (obj != null);
                    } catch (e) {
                        return false;
                    }
                });
            }

            var key_n = 0;
            var really_import = function() {
                try {
                    //Parse the  wallet backup
                    var json_key = obj.keys[key_n];

                    var addr = json_key.addr;

                    if (addr != null && addr.length > 0 && addr != 'undefined') {
                        try {

                            //Ignore addresses from keypool
                            if (json_key.reserve)
                                throw 'Ignoring Reserve Key';

                            var priv = json_key.priv;
                            if (!priv)
                                priv = json_key.sec;

                            //If there is a private key we first need to decrypt it, detect the format then re-insert
                            if (priv != null) {

                                var tmp_pbkdf2_iterations = MyWallet.getDefaultPbkdf2Iterations();
                                if (obj.options && obj.options.pbkdf2_iterations)
                                    tmp_pbkdf2_iterations = obj.options.pbkdf2_iterations;

                                //If the wallet is double encrypted we need to decrypt the key first
                                if (obj.double_encryption) {
                                    if (opt.second_password) {
                                        var decrypted = MyWallet.decrypt(priv, obj.sharedKey + opt.second_password, tmp_pbkdf2_iterations, MyWallet.isBase58);

                                        if (decrypted == null)
                                            throw 'Error decrypting private key for address ' + addr;

                                        priv = decrypted;
                                    } else {
                                        MyWallet.getPassword($('#import-second-password-modal'), function(__password) {
                                            opt.second_password = __password;

                                            ImportExport.importJSON(input_text, opt, success, error)
                                        });
                                        return;
                                    }
                                }

                                var format = MyWallet.detectPrivateKeyFormat(priv);

                                var key = MyWallet.privateKeyStringToKey(priv, format);

                                if (key.getBitcoinAddress().toString() == addr || key.getBitcoinAddressCompressed().toString() == addr) {

                                    try {
                                        MyWallet.addPrivateKey(key, format == 'compsipa')
                                    } catch (e) {}

                                    ++nKeysFound;
                                } else {
                                    throw 'Not importing ' + addr + ' because it is inconsistent with the decoded address ';
                                }
                            }

                            //Copy over the tag and label
                            if (MyWallet.addressExists(addr)) {
                                if (json_key.label && $.trim(json_key.label.length) > 0)
                                    MyWallet.setAddressLabel(addr, $.trim(json_key.label));

                                if (json_key.tag)
                                    MyWallet.setAddressTag(addr, json_key.tag);
                                else if (json_key.reserve)
                                    MyWallet.setAddressTag(addr, 2); //Mark as archived
                                else
                                    MyWallet.setAddressTag(addr, 1); //Mark as unsynced
                            }
                        } catch (e) {
                            console.log(e);
                        }
                    }

                    if (key_n < obj.keys.length-1) {
                        ++key_n;
                        setTimeout(really_import, 10);
                        return;
                    }

                    if (obj.address_book != null) {
                        for (var i2 = 0; i2 < obj.address_book.length; ++i2) {
                            var addressbook_obj = obj.address_book[i2];
                            if (addressbook_obj.addr && addressbook_obj.label)
                                MyWallet.addAddressBookEntry(addressbook_obj.addr, addressbook_obj.label);
                        }
                    }

                    //Clear the old value
                    $('#import-input_text').val('');

                    if (nKeysFound > 0)
                        success();
                    else
                        throw 'No Private Keys Imported. Unknown Format Incorrect Password';
                } catch (e) {
                    console.log(e);

                    try {
                        error(e);
                    } catch (e) {}
                }
            }

            if (obj == null) {
                nKeysFound = parsePrivateKeysFromText(input_text);

                //Clear the old value
                $('#import-input_text').val('');

                if (nKeysFound > 0)
                    success();
                else
                    throw 'No Private Keys Imported. Unknown Format or Incorrect Password';
            } else if (obj != null && obj.keys != null && obj.keys.length > 0) {

                if (obj.keys.length > 1000) {
                    MyWallet.makeNotice('info', 'keys-skipped', 'Some keys may have been skipped');

                    var ii = 0;
                    var test_balances=[];

                    var do_part = function() {
                        try {
                            for (; ii < obj.keys.length; ++ii) {
                                var json_key = obj.keys[ii];

                                var addr = json_key.addr;

                                if (addr == null || addr.length == 0 || addr == 'undefined')
                                    continue;

                                if (json_key.reserve || json_key.tag == 2)
                                    test_balances.push(json_key.addr);

                                if (test_balances.length == 1000 || (ii == obj.keys.length-1 &&  test_balances.length > 0)) {
                                    BlockchainAPI.get_balances(test_balances, function(response) {
                                        try {
                                            for (var key in response) {
                                                if (response[key].final_balance == 0) {
                                                    for (var iii = 0; iii < obj.keys.length; ++iii) {
                                                        var _addr = obj.keys[iii].addr;

                                                        if (_addr == key) {
                                                            if (obj.keys.length > 1)
                                                                obj.keys.splice(iii, 1);

                                                            --ii;
                                                        }
                                                    }
                                                }
                                            }

                                            setTimeout(do_part, 10);
                                        } catch (e) {
                                            console.log(e);

                                            try {
                                                error(e);
                                            } catch (e) {}
                                        }
                                    }, function(e) {
                                        console.log(e);

                                        try {
                                            error(e);
                                        } catch (e) {}
                                    });

                                    test_balances = [];

                                    return;
                                }
                            }
                        } catch (e) {
                            console.log(e);

                            try {
                                error(e);
                            } catch (e) {}
                        }

                        really_import();
                    };

                    do_part();
                } else {
                    really_import();
                }
            } else {
                throw 'Unknown Format'
            }
        } catch (e) {
            console.log(e);

            try {
                error(e);
            } catch (e) {}
        }
    }

    function parsePrivateKeysFromText(input_text) {
        var components = input_text.split(/\W+/g);

        try {
            var nKeysFound = 0;

            for (var i in components) {
                var word = components[i];

                try {
                    var format = MyWallet.detectPrivateKeyFormat(word);

                    var key = MyWallet.privateKeyStringToKey(word, format);

                    var compressed = format == 'compsipa';

                    try {
                        MyWallet.addPrivateKey(key, compressed);
                    } catch (e) {}

                    ++nKeysFound;
                } catch (e) { }
            }

            return nKeysFound;

        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        }

        return false;
    }

    function importTextArea(area) {
        MyWallet.getMainPassword(function(main_password) {
            MyWallet.getSecondPassword(function(second_password) {
                ImportExport.importJSON(area.val(), {main_password : main_password, second_password : second_password},
                    function() {
                        //Perform a wallet backup
                        MyWallet.backupWallet('update', function() {
                            MyWallet.get_history();
                        });
                    }, function(e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    });
            });
        });
    }

    function showCompressedPrivateKeyWarning(success, error) {
        var modal = $('#compressed-private-key-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.center();

        modal.find('.btn.btn-secondary').unbind().click(function() {
            success();
            modal.modal('hide');
        });

        modal.find('.btn.btn-primary').unbind().click(function() {
            error();
            modal.modal('hide');
        });
    }

    function importS3WalletBackup(id) {
        MyWallet.setLoadingText('Importing Backup');

        MyWallet.securePost('wallet', {method: 'get-backup', id : id, format : 'json'}, function(obj) {
            try {
                var payload = obj.payload;

                MyWallet.getMainPassword(function(main_password) {
                    MyWallet.getSecondPassword(function(second_password) {
                        ImportExport.importJSON(payload, {main_password : main_password, second_password : second_password}, function() {
                            //Perform a wallet backup
                            MyWallet.backupWallet('update', function() {
                                MyWallet.get_history();
                            });
                        }, function(e) {
                            MyWallet.makeNotice('error', 'misc-error', e);
                        });
                    });
                });
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            }
        }, function(data) {
            MyWallet.makeNotice('error', 'misc-error', data.responseText);
        });
    }

    function loadBackupsList(el) {
        MyWallet.setLoadingText('Loading Backup List');

        MyWallet.securePost('wallet', {method : 'list-backups', format : 'json'}, function(obj) {
            try {
                if (obj == null) {
                    throw 'Failed to get backups';
                }

                var tbody = el.find('table tbody').empty();

                var results = obj.results;

                if (results.length == 0) {
                    throw 'No backups found';
                }

                for (var i in results) {
                    var result = results[i];

                    var tr = $('<tr><td>'+result.name+'</td><td>'+dateToString(new Date(result.last_modified))+'</td><td>'+result.size+'</td><td><a class="act-import">Import</a></td></tr>');

                    (function(result) {
                        tr.find('.act-import').click(function() {
                            importS3WalletBackup(result.id);
                        });
                    })(result);

                    tbody.append(tr);
                }
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            }
        }, function(data) {
                MyWallet.makeNotice('error', 'misc-error', data.responseText);
            });
    }

    function importPrivateKeyUI(value, label, success) {
        MyWallet.getSecondPassword(function() {
            try {
                if (!value || value.length == 0) {
                    throw 'You must enter a private key to import';
                }

                var format = MyWallet.detectPrivateKeyFormat(value);
                var key = MyWallet.privateKeyStringToKey(value, format);

                if (format == 'compsipa') {
                    var addr = key.getBitcoinAddressCompressed().toString();

                    showCompressedPrivateKeyWarning(function() {
                        if (addr == null || addr.length == 0 || addr == 'undefined')
                            throw 'Unable to decode bitcoin addresses from private key';

                        if (MyWallet.addPrivateKey(key, true)) {

                            if (label && label.length > 0)
                                MyWallet.setAddressLabel(addr, label);

                            //Perform a wallet backup
                            MyWallet.backupWallet('update', function() {
                                MyWallet.get_history();
                            });

                            if (success) success();

                            MyWallet.makeNotice('success', 'added', 'Added Bitcoin Address ' + addr);
                        }
                    }, function() {
                        loadScript('wallet/signer', function() {

                            var from_address = key.getBitcoinAddress().toString();

                            BlockchainAPI.get_balance([from_address], function(value) {
                                var obj = initNewTx();

                                obj.fee = obj.base_fee; //Always include a fee
                                obj.to_addresses.push({address: new Bitcoin.Address(MyWallet.getPreferredAddress()), value : BigInteger.valueOf(value).subtract(obj.fee)});
                                obj.from_addresses = [from_address];
                                obj.extra_private_keys[from_address] = B58.encode(key.priv);

                                obj.start();

                            }, function() {
                                MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                            });
                        });
                    });

                } else {
                    var addr = key.getBitcoinAddress().toString();

                    if (addr == null || addr.length == 0 || addr == 'undefined')
                        throw 'Unable to decode bitcoin addresses from private key';

                    if (MyWallet.addPrivateKey(key, false)) {

                        if (label && label.length > 0)
                            MyWallet.setAddressLabel(addr, label);

                        //Perform a wallet backup
                        MyWallet.backupWallet('update', function() {
                            MyWallet.get_history();
                        });

                        if (success) success();

                        MyWallet.makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr);
                    } else {
                        throw 'Unable to add private key for bitcoin address ' + addr;
                    }
                }
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }
        });
    }
}

var ImportExport = new _ImportExport();