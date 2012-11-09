function parsePrivateKeysFromText(input_text) {
    var components = input_text.split(/\W+/g);

    try {
        var nKeysFound = 0;

        for (var i in components) {
            var word = components[i];

            if (walletIsFull()) {
                throw 'Wallet Is Full';
            }

            try {
                var format = detectPrivateKeyFormat(word);

                var key = privateKeyStringToKey(word, format);

                if (format == 'compsipa') {
                    internalAddKey(key.getBitcoinAddressCompressed().toString(), encodePK(key.priv))
                    ++nKeysFound;
                } else {
                    internalAddKey(key.getBitcoinAddress().toString(), encodePK(key.priv))
                    ++nKeysFound;
                }
            } catch (e) { }
        }

        return nKeysFound;

    } catch (e) {
        makeNotice('error', 'misc-error', e);
    }

    return false;
}

function appendModals() {
    if ($('#import-password-modal').length == 0)
        $('body').append('<div id="import-password-modal" class="modal hide">\
        <div class="modal-header">\
        <button type="button" class="close" data-dismiss="modal">×</button>\
        <h3>Wallet Password</h3>\
        </div>\
        <div class="modal-body">\
            <p>If this wallet is encrypted please enter the password below. Otherwise leave it blank.</p>\
            <p align="center">\
                <b>Wallet password:</b> <input style="margin-left:10px" placeholder="password" name="password" type="password"/>\
            </p>\
        </div>\
        <div class="modal-footer">\
            <div class="btn-group pull-right">\
               <button class="btn btn-primary">Continue</button>\
            </div>\
        </div>\
    </div>');

    if ($('#import-second-password-modal').length == 0)
        $('body').append('<div id="import-second-password-modal" class="modal hide">\
        <div class="modal-header">\
        <button type="button" class="close" data-dismiss="modal">×</button>\
        <h3>Wallet Second Password</h3>\
        </div>\
        <div class="modal-body">\
            <p>Please enter the second password for this wallet.</p>\
            <p align="center">\
                <b>Second password:</b> <input style="margin-left:10px" placeholder="password" name="password" type="password"/>\
            </p>\
        </div>\
        <div class="modal-footer">\
            <div class="btn-group pull-right">\
                <button class="btn btn-primary">Continue</button>\
            </div>\
        </div>\
    </div>');
}

function importJSON(input_text, opt, success, error) {
    try {
        appendModals();

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
            decrypt(input_text, opt && opt.password ? opt.password : password, function(decrypted) {
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
                        var priv = json_key.priv;
                        if (!priv)
                            priv = json_key.sec;

                        //If there is a private key we first need to decrypt it, detect the format then re-insert
                        if (priv != null) {
                            //If the wallet is double encrypted we need to decrypt the key first
                            if (obj.double_encryption) {
                                if (opt.second_password || dpassword) {
                                    var decrypted = decrypt(priv, obj.sharedKey + (dpassword ? dpassword : opt.second_password), isBase58);

                                    if (decrypted == null)
                                        throw 'Error decrypting private key for address ' + addr;

                                    priv = decrypted;
                                } else {
                                    getPassword($('#import-second-password-modal'), function(__password) {
                                        opt.second_password = __password;
                                        importJSON(input_text, opt, success, error)
                                    });
                                    return;
                                }
                            }

                            var key = privateKeyStringToKey(priv, detectPrivateKeyFormat(priv));
                            if (key.getBitcoinAddress().toString() == addr || key.getBitcoinAddressCompressed().toString() == addr) {
                                internalAddKey(addr, encodePK(key.priv))
                                    ++nKeysFound;
                            } else {
                                throw 'Not importing ' + addr + ' because it is inconsistent with the decoded address ';
                            }
                        }

                        //Copy over the tag and label
                        var added_addr = addresses[addr];
                        if (added_addr) {
                            if (json_key.label && $.trim(json_key.label.length) > 0)
                                added_addr.label = $.trim(json_key.label);

                            if (json_key.tag)
                                added_addr.tag = json_key.tag;
                            else if (json_key.reserve)
                                added_addr.tag = 2; //Mark as archived
                            else
                                added_addr.tag = 1; //Mark as unsynced
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
                            internalAddAddressBookEntry(addressbook_obj.addr, addressbook_obj.label);
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
                makeNotice('info', 'keys-skipped', 'Some keys may have been skipped');

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

function importTextArea(area) {
    getSecondPassword(function() {
        importJSON(area.val(), {},
            function() {
                //Perform a wallet backup
                backupWallet('update', function() {
                    BlockchainAPI.get_history();
                });
            }, function(e) {
                makeNotice('error', 'misc-error', e);
            });
    });
}

function importS3WalletBackup(id) {
    setLoadingText('Importing Backup');

    $.get(root + 'wallet/get-backup?guid='+guid+'&sharedKey='+sharedKey+'&id='+id).success(function(obj) {
        try {
            var payload = obj.payload;

            getSecondPassword(function() {
                importJSON(payload, {}, function() {
                    //Perform a wallet backup
                    backupWallet('update', function() {
                        BlockchainAPI.get_history();
                    });
                }, function(e) {
                    makeNotice('error', 'misc-error', e);
                });
            });
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    }).error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}

function loadBackupsList(el) {
    setLoadingText('Loading Backup List');

    $.get(root + 'wallet/list-backups?guid='+guid+'&sharedKey='+sharedKey).success(function(obj) {
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

                tbody.append('<tr><td>'+result.name+'</td><td>'+dateToString(new Date(result.last_modified))+'</td><td>'+result.size+'</td><td><a href="#" onclick="importS3WalletBackup(\''+result.id+'\')">Import</a></td></tr>')
            }
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    }).error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}