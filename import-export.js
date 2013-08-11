function _ImportExport() {

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
            data : {format : 'plain', language : MyWallet.getLanguage()},
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
                MyWallet.makeNotice('error', 'misc-error', 'Error Downloading Import Export Template');

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

    function showPrivateKeyWarningModal(address, import_direct, sweep) {
        var modal = $('#import-private-key-warning-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.center();

        modal.find('.address').text(address);

        BlockchainAPI.get_balance([address], function(balance) {
            modal.find('.address').text(address + " - " + formatBTC(balance));
        }, function(e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            import_direct();
            modal.modal('hide');
        });

        modal.find('.btn.btn-primary').unbind().click(function() {
            sweep();
            modal.modal('hide');
        });
    }

    function bind() {
        $('a[data-toggle="tab"]').unbind().on('show', function(e) {
            $(e.target.hash).trigger('show');
        });

        $("#import-json-btn").unbind().click(function() {

            $(this).prop("disabled", true);

            importTextArea($('#import-json'));

            $(this).prop("disabled", false);
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
                        if (MyWallet.addPrivateKey(key, {compressed : false, app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION})) {

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
                importPrivateKeyUI(Bitcoin.Base58.encode(bytes), 'Brain Wallet', 'brain_wallet');
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

        $('.paper-wallet-btn').unbind().click(function() {
            loadScript('wallet/paper-wallet', function() {
                PaperWallet.showModal();
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
                                        MyWallet.addPrivateKey(key,{
                                                compressed : format == 'compsipa',
                                                app_name : obj.created_device_name ? obj.created_device_name : IMPORTED_APP_NAME,
                                                app_version : obj.created_device_version ? obj.created_device_version : IMPORTED_APP_VERSION,
                                                created_time : obj.created_time ? obj.created_time : 0
                                            });
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
                        MyWallet.addPrivateKey(key, {compressed : compressed, app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION});
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

    function importPrivateKeyUI(value, label, success, app_name) {
        MyWallet.getSecondPassword(function() {
            try {
                if (!value || value.length == 0) {
                    throw 'You must enter a private key to import';
                }

                var format = MyWallet.detectPrivateKeyFormat(value);
                var key = MyWallet.privateKeyStringToKey(value, format);

                var addr = null;
                if (format == 'compsipa') {
                    addr = key.getBitcoinAddressCompressed().toString();
                } else {
                    addr = key.getBitcoinAddress().toString();
                }

                if (addr == null || addr.length == 0 || addr == 'undefined')
                    throw 'Unable to decode bitcoin addresses from private key';

                if (MyWallet.addressExists(addr) && !MyWallet.isWatchOnly(addr))
                    throw 'Address already exists in the wallet';

                function sweep() {
                    loadScript('wallet/signer', function() {
                        BlockchainAPI.get_balance([addr], function(value) {
                            var obj = initNewTx();

                            obj.fee = obj.base_fee; //Always include a fee
                            obj.to_addresses.push({address: new Bitcoin.Address(MyWallet.getPreferredAddress()), value : BigInteger.valueOf(value).subtract(obj.fee)});
                            obj.from_addresses = [addr];
                            obj.extra_private_keys[addr] = B58.encode(key.priv);

                            obj.start();

                        }, function() {
                            MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                        });
                    });
                };

                showPrivateKeyWarningModal(addr, function() {
                    //Import Direct

                    if (format == 'compsipa') {
                        showCompressedPrivateKeyWarning(function() {
                            if (MyWallet.addPrivateKey(key, {compressed : true, app_name : app_name ? app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION})) {

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
                            sweep();
                        });
                    } else {
                        if (MyWallet.addPrivateKey(key, {compressed : false, app_name : app_name ? app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION})) {

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
                }, function() {
                    //Sweep
                    sweep();
                });


            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }
        });
    }
}

var ImportExport = new _ImportExport();