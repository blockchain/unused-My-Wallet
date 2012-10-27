
function parsePrivateKeysFromText(input_text) {
    var components = input_text.split(/\W+/g);

    try {
        var nKeysAdded = 0;

        for (var i in components) {
            var word = components[i];

            if (walletIsFull()) {
                throw 'Wallet Is Full';
            }

            try {
                var format = detectPrivateKeyFormat(word);

                var key = privateKeyStringToKey(word, format);

                console.log('Found PK ' + word);

                if (format == 'compsipa') {
                    if (internalAddKey(key.getBitcoinAddressCompressed().toString(), encodePK(key.priv)))
                        ++nKeysAdded;
                } else {
                    if (internalAddKey(key.getBitcoinAddress().toString(), encodePK(key.priv)))
                        ++nKeysAdded;
                }
            } catch (e) { }
        }

        if (nKeysAdded > 0) {
            makeNotice('success', 'misc-success', 'Imported ' + nKeysAdded + ' private keys');

            //Perform a wallet backup
            backupWallet('update', function() {
                BlockchainAPI.get_history();
            });

            return true;
        }

    } catch (e) {
        makeNotice('error', 'misc-error', e);
    }

    return false;
}

function importPyWalletJSONObject(obj) {
    var i = 0;
    try {
        for (i = 0; i < obj.keys.length; ++i) {

            if (walletIsFull())
                return;

            var key = privateKeyStringToKey(obj.keys[i].sec, detectPrivateKeyFormat(obj.keys[i].sec));

            //Check the the private keys matches the bitcoin address
            if (obj.keys[i].addr ==  key.getBitcoinAddress().toString() || obj.keys[i].addr ==  key.getBitcoinAddressCompressed().toString()) {
                internalAddKey(obj.keys[i].addr, encodePK(key.priv));
            } else {
                makeNotice('error', 'misc-error', 'Private key doesn\'t seem to match the address. Possible corruption', 1000);
                return false;
            }
        }
    } catch (e) {
        makeNotice('error', 'misc-error', 'Exception caught parsing importing JSON. Incorrect format?');
        return false;
    }

    makeNotice('success', 'misc-success', 'Imported ' + i + ' private keys');
}

function importJSON(input_text) {

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
        decrypt(input_text, password, function(decrypted) {
            try {
                obj = $.parseJSON(decrypted);

                return (obj != null);
            } catch (e) {
                return false;
            }
        });
    }

    getSecondPassword(function() {
        try {
            if (obj == null) {
                console.log('Error Parsing JSON. Trying Plain Text import.');

                //Not JSON Try plain Text
                if (parsePrivateKeysFromText(input_text)) {
                    return true;
                } else {
                    throw 'Could not decode import data';
                }
            }

            if (obj == null || obj.keys == null || obj.keys.length == 0) {
                throw 'No keys imported. Incorrect format?';
            }

            //Pywallet contains hexsec
            if (obj.keys[0].hexsec != null) {
                importPyWalletJSONObject(obj);
            } else {
                //Parse the normal wallet backup
                for (var i = 0; i < obj.keys.length; ++i) {
                    var addr = obj.keys[i].addr;

                    if (addr == null || addr.length == 0 || addr == 'undefined')
                        continue;

                    try {
                        //If there is a private key we first need to decrypt it, detect the format then re-insert
                        if (obj.keys[i].priv != null) {

                            //If the wallet is double encrypted we need to decrypt the key first
                            if (obj.double_encryption) {
                                var decrypted = decrypt(obj.keys[i].priv, obj.sharedKey + dpassword, isBase58);

                                if (decrypted == null)
                                    throw 'Error decrypting private key for address ' + addr;

                                obj.keys[i].priv = decrypted;
                            }

                            var key = privateKeyStringToKey(obj.keys[i].priv, detectPrivateKeyFormat(obj.keys[i].priv));
                            if (key.getBitcoinAddress().toString() == addr || key.getBitcoinAddressCompressed().toString() == addr) {
                                internalAddKey(addr, encodePK(key.priv));
                            } else {
                                throw 'Not importing ' + addr + ' becuse it is inconsistent with the decoded address ';
                            }

                            //Else see if there is a compressed private key
                        }   else {
                            internalAddKey(addr); //Add watch only address
                        }

                        //Copy over the tag and label
                        var added_addr = addresses[addr];
                        added_addr.label = obj.keys[i].label;

                        if (obj.keys[i].tag != null)
                            added_addr.tag = obj.keys[i].tag;
                        else
                            added_addr.tag = 1; //Mark as unsynced
                    } catch (e) {
                        makeNotice('error', 'misc-error', e);
                    }
                }

                if (obj.address_book != null) {
                    for (var i = 0; i < obj.address_book.length; ++i) {
                        internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
                    }
                }
            }

            //Check the integrity of all keys
            checkAllKeys();

            //Clear the old value
            $('#import-input_text').val('');

            //Perform a wallet backup
            backupWallet('update', function() {
                BlockchainAPI.get_history();
            });
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    });
}


function importS3WalletBackup(id) {
    setLoadingText('Importing Backup');

    $.get(root + 'wallet/get-backup?guid='+guid+'&sharedKey='+sharedKey+'&id='+id).success(function(obj) {
        try {
            var payload = obj.payload;

            importJSON(payload);
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