var MyWallet = new function() {
    var MyWallet = this;

    this.skip_init = false;
    var demo_guid = 'abcaa314-6f67-6705-b384-5d47fbe9d7cc';
    var encrypted_wallet_data; //Encrypted wallet data (Base64, AES 256)
    var guid; //Wallet identifier
    var cVisible; //currently visible view
    var password; //Password
    var dpassword; //double encryption Password
    var dpasswordhash; //double encryption Password
    var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't overwrite a wallet backup even if you have the guid
    var final_balance = 0; //Final Satoshi wallet balance
    var total_sent = 0; //Total Satoshi sent
    var total_received = 0; //Total Satoshi received
    var n_tx = 0; //Number of transactions
    var n_tx_filtered = 0; //Number of transactions after filtering
    var latest_block; //Chain head block
    var address_book = {}; //Holds the address book addr = label
    var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
    var double_encryption = false; //If wallet has a second password
    var tx_page = 0; //Multi-address page
    var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)
    var maxAddr = 1000; //Maximum number of addresses
    var addresses = []; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
    var payload_checksum; //SHA256 hash of the current wallet.aes.json
    var archTimer; //Delayed Backup wallet timer
    var mixer_fee = 1.5; //Default mixer fee 1.5%
    var pbkdf2_iterations = 10; //Not ideal, but limitations of using javascript
    var tx_notes = {}
    var logout_timeout;
    var event_listeners = []; //Emits Did decrypt wallet event (used on claim page)
    var last_input_main_password;
    var main_password_timeout = 60000;
    var auth_type;
    var wallet_options = {
        fee_policy : 0,
        html5_notifications : false,
        logout_time : 300000 //Default 5 minutes
    }; //Default Fee policy (-1 Tight, 0 Normal, 1 High)

    this.addEventListener = function(func) {
        event_listeners.push(func);
    }

    this.getLogoutTime = function() {
        return wallet_options.logout_time;
    }

    this.setLogoutTime = function(logout_time) {
        wallet_options.logout_time = logout_time;

        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
    }

    this.getDoubleEncryption = function() {
        return double_encryption;
    }

    this.getEncryptedWalletData = function() {
        return encrypted_wallet_data;
    }

    this.getFeePolicy = function() {
        return wallet_options.fee_policy;
    }

    this.getGuid = function() {
        return guid;
    }

    this.setFeePolicy = function(policy) {
        wallet_options.fee_policy = policy;
    }

    this.getHTML5Notifications = function() {
        return wallet_options.html5_notifications;
    }

    this.setHTML5Notifications = function(val) {
        wallet_options.html5_notifications = val;
    }

    this.getTransactions = function() {
        return transactions;
    }

    this.addressExists = function(address) {
        return addresses[address] != null;
    }

    this.getAddressTag = function(address) {
        return addresses[address].tag;
    }

    this.setAddressTag = function(address, tag) {
        addresses[address].tag = tag;
    }

    this.getAddressBook = function() {
        return address_book;
    }

    this.getAddressLabel = function(address) {
        return addresses[address].label;
    }

    this.setAddressLabel = function(address, label) {
        addresses[address].label = label;
    }

    this.setAddressBalance = function(address, balance) {
        addresses[address].balance = balance;
    }

    this.getAddressBookLabel = function(address) {
        return address_book[address];
    }

    this.isWatchOnly = function(address) {
        return addresses[address].priv == null;
    }

    this.getAddressBalance = function(address) {
        return addresses[address].balance;
    }

    this.getMixerFee = function() {
        return mixer_fee;
    }

    this.deleteAddress = function(addr) {
        delete addresses[addr];
    }

    this.addAddressBookEntry = function(addr, label) {
        address_book[addr] = label;
    }

    //TODO Depreciate this. Need to restructure signer.js
    this.getPrivateKey = function(address) {
        return addresses[address].priv;
    }

    this.setLabel = function(address, label) {

        addresses[address].label = label;

        backupWalletDelayed();

        buildVisibleView();
    }

    this.securePost = function(url, data) {
        var clone = jQuery.extend({}, data);

        if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36) {
            throw 'Shared key is invalid';
        }

        clone.sharedKey = sharedKey;
        clone.guid = guid;
        clone.format = 'plain';

        return $.post(root + url, clone);
    }

    this.setDoubleEncryption = function(value) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            window.location.reload();
        };

        try {
            if (double_encryption == value)
                return;

            if (value) {
                var tpassword = $('#double-password').val();
                var tpassword2 = $('#double-password2').val();

                if (tpassword == null || tpassword.length == 0 || tpassword.length < 4 || tpassword.length > 255) {
                    MyWallet.makeNotice('error', 'misc-error', 'Password must be 4 characters or more in length');
                    return;
                }

                if (tpassword != tpassword2) {
                    MyWallet.makeNotice('error', 'misc-error', 'Passwords do not match.');
                    return;
                }

                if (tpassword == password) {
                    MyWallet.makeNotice('error', 'misc-error', 'Second password should not be the same as your main password.');
                    return;
                }

                //Ask the use again before we backup
                MyWallet.getSecondPassword(function() {
                    try {
                        double_encryption = true;
                        dpassword = tpassword;

                        for (var key in addresses) {
                            var addr = addresses[key];

                            if (addr.priv != null) {
                                addr.priv = encodePK(B58.decode(addr.priv));
                            }
                        }

                        //N rounds of SHA 256
                        var round_data = Crypto.SHA256(sharedKey + dpassword, {asBytes: true});
                        for (var i = 1; i < pbkdf2_iterations; ++i) {
                            round_data = Crypto.SHA256(round_data, {asBytes: true});
                        }
                        dpasswordhash = Crypto.util.bytesToHex(round_data);

                        //Clear the password to force the user to login again
                        //Incase they have forgotten their password already
                        dpassword = null;

                        MyWallet.getSecondPassword(function() {
                            try {
                                MyWallet.checkAllKeys();

                                MyWallet.backupWallet('update', function() {
                                    setDoubleEncryptionButton();
                                }, function() {
                                    panic(e);
                                });
                            } catch(e) {
                                panic(e);
                            }
                        }, function() {
                            panic();
                        });
                    } catch(e) {
                        panic(e);
                    }

                }, function () {
                    panic();
                });
            } else {
                MyWallet.getSecondPassword(function() {
                    try {
                        for (var key in addresses) {

                            var addr = addresses[key];

                            if (addr.priv != null) {
                                addr.priv = MyWallet.decryptPK(addr.priv);
                            }
                        }

                        double_encryption = false;

                        dpassword = null;

                        MyWallet.checkAllKeys();

                        MyWallet.backupWallet('update', function() {
                            setDoubleEncryptionButton();
                        }, function() {
                            panic(e);
                        });
                    } catch (e) {
                        panic(e);
                    }
                }, function(e) {
                    panic(e);
                });
            }
        } catch (e) {
            panic(e);
        }
    }

    function hidePopovers() {
        try {
            $('.pop').popover('hide');
        } catch (e) {}
    }

    $(window).resize(function() {
        $('.modal:visible').center();

        hidePopovers();
    });

    this.setLoadingText = function(txt) {
        $('.loading-text').text(txt);
    }

    function bindTx(tx_tr, tx) {
        tx_tr.click(function(){
            openTransactionSummaryModal(tx.txIndex, tx.result);
        });

        tx_tr.find('.show-note').mouseover(function() {
            var note = tx.note ? tx.note : tx_notes[tx.hash];
            showNotePopover(this, note, tx.hash);
        });

        tx_tr.find('.add-note').mouseover(function() {
            addNotePopover(this, tx.hash);
        });

        return tx_tr;
    }

    function calcTxResult(tx, is_new) {
        /* Calculate the result */
        var result = 0;
        for (var i = 0; i < tx.inputs.length; ++i) {
            var output = tx.inputs[i].prev_out;

            if (!output || !output.addr)
                continue;

            //If it is our address then subtract the value
            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result -= value;

                if (is_new) {
                    total_sent += value;
                    addr.balance -= value;
                }
            }
        }

        for (var ii = 0; ii < tx.out.length; ++ii) {
            var output = tx.out[ii];

            if (!output || !output.addr)
                continue;

            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result += value;

                if (is_new) {
                    total_received += value;
                    addr.balance += value;
                }
            }
        }
        return result;
    }
    function wsSuccess(ws) {
        ws.onmessage = function(e) {

            try {
                var obj = $.parseJSON(e.data);

                if (obj.op == 'status') {
                    $('#status').html(obj.msg);
                } else if (obj.op == 'on_change') {
                    var old_checksum = Crypto.util.bytesToHex(Crypto.SHA256(encrypted_wallet_data, {asBytes: true}));
                    var new_checksum = obj.checksum;

                    console.log('On change old ' + old_checksum + ' ==  new '+ new_checksum);

                    if (old_checksum != new_checksum) {
                        MyWallet.updateCacheManifest();

                        //Fetch the updated wallet from the server
                        setTimeout(getWallet, 250);
                    }

                } else if (obj.op == 'utx') {

                    var tx = TransactionFromJSON(obj.x);

                    //Check if this is a duplicate
                    //Maybe should have a map_prev to check for possible double spends
                    for (var key in transactions) {
                        if (transactions[key].txIndex == tx.txIndex)
                            return;
                    }

                    var result = calcTxResult(tx, true);

                    if (MyWallet.getHTML5Notifications()) {
                        //Send HTML 5 Notification
                        var send_notification = function(options) {
                            try {
                                if (window.webkitNotifications && navigator.userAgent.indexOf("Chrome") > -1) {
                                    if (webkitNotifications.checkPermission() == 0) {
                                        webkitNotifications.createNotification(options.iconUrl, options.title, options.body).show();
                                    }
                                } else if (window.Notification) {
                                    if (Notification.permissionLevel() === 'granted') {
                                        new Notification(options.title, options).show();
                                    }
                                }
                            } catch (e) {}
                        };

                        try {
                            send_notification({
                                title : result > 0 ? 'Payment Received' : 'Payment Sent',
                                body : 'Transaction Value ' + formatBTC(result) + ' BTC',
                                iconUrl : resource + 'cube48.png'
                            });
                        } catch (e) {
                            console.log(e);
                        }
                    }

                    tx.result = result;

                    final_balance += result;

                    n_tx++;

                    tx.setConfirmations(0);

                    playSound('beep');

                    if (tx_filter == 0 && tx_page == 0) {
                        transactions.unshift(tx);

                        var did_pop = false;
                        if (transactions.length > 50) {
                            transactions.pop();
                            did_pop = true;
                        }
                    }

                    var id = buildVisibleViewPre();
                    if ("my-transactions" == id) {
                        if (tx_filter == 0 && tx_page == 0) {
                            $('#no-transactions').hide();

                            if ($('#tx_display').val() == 0) {
                                var txcontainer = $('#transactions-compact').show();

                                bindTx($(getCompactHTML(tx, addresses, address_book)), tx).prependTo(txcontainer.find('tbody')).find('div').hide().slideDown('slow');

                                if (did_pop) {
                                    txcontainer.find('tbody tr:last-child').remove();
                                }

                            } else {
                                var txcontainer = $('#transactions-detailed').show();

                                txcontainer.prepend(tx.getHTML(addresses, address_book));

                                if (did_pop) {
                                    txcontainer.find('div:last-child').remove();
                                }
                            }
                        }
                    } else {
                        buildVisibleView();
                    }

                }  else if (obj.op == 'block') {
                    //Check any transactions included in this block, if the match one our ours then set the block index
                    for (var i = 0; i < obj.x.txIndexes.length; ++i) {
                        for (var ii = 0; ii < transactions.length; ++ii) {
                            if (transactions[ii].txIndex == obj.x.txIndexes[i]) {
                                if (transactions[ii].blockHeight == null || transactions[ii].blockHeight == 0) {
                                    transactions[ii].blockHeight = obj.x.height;
                                    break;
                                }
                            }
                        }
                    }

                    setLatestBlock(BlockFromJSON(obj.x));

                    //Need to update latest block
                    buildTransactionsView();
                }

            } catch(e) {
                console.log(e);

                console.log(e.data);
            }
        };

        ws.onopen = function() {
            $('#status').html('CONNECTED.');

            var msg = '{"op":"blocks_sub"}';

            if (guid != null)
                msg += '{"op":"wallet_sub","guid":"'+guid+'"}';

            try {
                var addrs = MyWallet.getActiveAddresses();
                for (var key in addrs) {
                    msg += '{"op":"addr_sub", "addr":"'+ addrs[key] +'"}'; //Subscribe to transactions updates through websockets
                }
            } catch (e) {
                alert(e);
            }

            ws.send(msg);
        };

        ws.onclose = function() {
            $('#status').html('DISCONNECTED.');
        };
    }

    this.makeNotice = function(type, id, msg, timeout) {

        if (msg == null || msg.length == 0)
            return;

        console.log(msg);

        if (timeout == null)
            timeout = 5000;

        var el = $('<div class="alert alert-block alert-'+type+'"></div>');

        el.text(''+msg);

        if ($('#'+id).length > 0) {
            el.attr('id', id);
            return;
        }

        $("#notices").append(el).hide().fadeIn(200);

        if (timeout > 0) {
            (function() {
                var tel = el;

                setTimeout(function() {
                    tel.fadeOut(250, function() {
                        $(this).remove();
                    });
                }, timeout);
            })();
        }
    }

    function noConvert(x) { return x; }
    function base58ToBase58(x) { return MyWallet.decryptPK(x); }
    function base58ToBase64(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToBase64(bytes); }
    function base58ToHex(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToHex(bytes); }
    this.base58ToSipa = function(x, addr) {
        var bytes = MyWallet.decodePK(x);

        var eckey = new Bitcoin.ECKey(bytes);

        while (bytes.length < 32) bytes.unshift(0);

        bytes.unshift(0x80); // prepend 0x80 byte

        if (eckey.getBitcoinAddress().toString() == addr) {
        } else if (eckey.getBitcoinAddressCompressed().toString() == addr) {
            bytes.push(0x01);    // append 0x01 byte for compressed format
        } else {
            throw 'Private Key does not match bitcoin address' + addr;
        }

        var checksum = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });

        bytes = bytes.concat(checksum.slice(0, 4));

        var privWif = B58.encode(bytes);

        return privWif;
    }

    this.makeWalletJSON = function(format) {
        return makeCustomWalletJSON(format, guid, sharedKey);
    }

    function makeCustomWalletJSON(format, guid, sharedKey) {

        var encode_func = noConvert;

        if (format == 'base64')
            encode_func = base58ToBase64;
        else if (format == 'hex')
            encode_func = base58ToHex;
        else if (format == 'sipa')
            encode_func = MyWallet.base58ToSipa;
        else if (format == 'base58')
            encode_func = base58ToBase58;

        var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';

        if (double_encryption && dpasswordhash != null && encode_func == noConvert) {
            out += '	"double_encryption" : '+double_encryption+',\n	"dpasswordhash" : "'+dpasswordhash+'",\n';
        }

        if (wallet_options) {
            out += '	"options" : ' + JSON.stringify(wallet_options)+',\n';
        }

        out += '	"keys" : [\n';

        for (var key in addresses) {
            var addr = addresses[key];

            out += '	{"addr" : "'+ addr.addr +'"';

            if (addr.priv != null) {
                out += ',\n	 "priv" : "'+ encode_func(addr.priv, addr.addr) + '"';
            }

            if (addr.tag == 2) {
                out += ',\n	 "tag" : '+ addr.tag;
            }

            if (addr.label != null) {
                out += ',\n	 "label" : "'+ addr.label + '"';
            }

            out += '},\n';

            atLeastOne = true;
        }

        if (atLeastOne) {
            out = out.substring(0, out.length-2);
        }

        out += "\n	]";

        if (nKeys(address_book) > 0) {
            out += ',\n	"address_book" : [\n';

            for (var key in address_book) {
                out += '	{"addr" : "'+ key +'",\n';
                out += '	 "label" : "'+ address_book[key] + '"},\n';
            }

            //Remove the extra comma
            out = out.substring(0, out.length-2);

            out += "\n	]";
        }

        if (nKeys(tx_notes) > 0) {
            out += ',\n	"tx_notes" : ' + JSON.stringify(tx_notes)
        }

        out += '\n}';

        //Write the address book

        return out;
    }

    this.get_history = function(success, error) {
        BlockchainAPI.get_history(function(data) {

            parseMultiAddressJSON(data, false);

            //Rebuild the my-addresses list with the new updated balances (Only if visible)
            buildVisibleView();

            if (success) success();

        }, function() {
            if (error) error();

        }, tx_filter, tx_page);
    }

    this.deleteAddressBook = function(addr) {
        delete address_book[addr];

        backupWalletDelayed();

        $('#send-coins').find('.tab-pane').trigger('show', true);
    }

    function buildSendTxView(reset) {
        $('#send-coins').find('.tab-pane.active').trigger('show', reset);

        if (reset) {
            BlockchainAPI.get_ticker();

            $('.send').attr('disabled', false);
        }
    }

    function buildSelect(select, zero_balance, reset) {
        var old_val = select.val();

        select.empty();

        for (var key in addresses) {
            var addr = addresses[key];

            //Don't include archived addresses
            if (!addr || addr.tag == 2)
                continue;

            var label = addr.label;

            if (!label)
                label = addr.addr.substring(0, 15) + '...';

            if (zero_balance || addr.balance > 0) {
                //On the sent transactions page add the address to the from address options
                select.prepend('<option value="'+addr.addr+'">' + label + ' - ' + formatBTC(addr.balance) + ' BTC</option>');
            }
        }

        select.prepend('<option value="any" selected>Any Address</option>');

        if (!reset && old_val)
            select.val(old_val);
    }

    function buildSendForm(el, reset) {

        buildSelect(el.find('select[name="from"]'), false, reset);

        buildSelect(el.find('select[name="change"]'), true, reset);

        el.find('select[name="change"]').prepend('<option value="new">New Address</option>');

        if (reset) {
            el.find('input').val('');
            el.find('.send-value-usd').text(formatSymbol(0, symbol_local)).val('');
            el.find('.amount-needed').text(0);
        }

        var recipient_container = el.find(".recipient-container");

        if (reset) {
            var first_child = recipient_container.find(".recipient:first-child").clone();

            recipient_container.empty().append(first_child);
        }

        function totalValue() {
            var total_value = 0;
            el.find('input[name="send-value"]').each(function(){
                var el_val = parseFloat($(this).val());
                if (!isNaN(el_val))
                    total_value += el_val;
            });
            return total_value;
        }

        function bindRecipient(recipient) {
            recipient.find('input[name="send-to-address"]').val('').typeahead({
                source : getActiveLabels()
            });

            recipient.find('.local-symbol').text(symbol_local.symbol);

            recipient.find('input[name="send-value"]').val('').bind('keyup change', function(e) {
                if (e.keyCode == '9') {
                    return;
                }

                el.find('.amount-needed').text(formatBTC(Bitcoin.Util.parseValue(totalValue().toFixed(8)).toString()));

                recipient.find('.send-value-usd').val(convert($(this).val() *  100000000, symbol_local.conversion)).text(formatSymbol($(this).val() *  100000000, symbol_local));
            });

            recipient.find('.send-value-usd').val('').text(formatSymbol(0, symbol_local)).bind('keyup change', function(e) {
                if (e.keyCode == '9') {
                    return;
                }

                recipient.find('.send-value').val(formatBTC(parseFloat($(this).val()) * symbol_local.conversion));
            });
        }

        recipient_container.find(".recipient").each(function(){
            bindRecipient($(this));
        });

        el.find('.remove-recipient').unbind().click(function() {
            var n = recipient_container.find(".recipient").length;

            if (n > 1) {
                if (n == 2)
                    $(this).hide(200);

                recipient_container.find(".recipient:last-child").remove();
            }
        });

        el.find('.add-recipient').unbind().click(function() {
            var recipient = recipient_container.find(".recipient:first-child").clone();

            recipient.appendTo(recipient_container);

            bindRecipient(recipient);

            el.find('.remove-recipient').show(200);
        });
    }

    this.getAllAddresses = function() {
        var array = [];
        for (var key in addresses) {
            array.push(key);
        }
        return array;
    }

    //Find the preferred address to use for change
    //Order deposit / request coins
    this.getPreferredAddress = function() {
        var preferred = null;
        for (var key in addresses) {
            var addr = addresses[key];

            if (preferred == null)
                preferred = addr;

            if (addr.priv != null) {
                if (preferred == null)
                    preferred = addr;

                if (addr.tag == null || addr.tag == 0) {
                    preferred = addr;
                    break;
                }
            }
        }

        return preferred.addr;
    }

    function getAddressesWithTag(tag) {
        var array = [];
        for (var key in addresses) {
            var addr = addresses[key];
            //Don't include archived addresses
            if (addr.tag == tag)
                array.push(addr.addr);
        }
        return array;
    }

    this.getActiveAddresses = function() {
        return getAddressesWithTag();
    }

    this.getArchivedAddresses = function() {
        return getAddressesWithTag(2);
    }

    function setLatestBlock(block) {

        if (block != null) {
            latest_block = block;

            for (var key in transactions) {
                var tx = transactions[key];

                if (tx.blockHeight != null && tx.blockHeight > 0) {
                    var confirmations = latest_block.height - tx.blockHeight + 1;
                    if (confirmations <= 100) {
                        tx.setConfirmations(latest_block.height - tx.blockHeight + 1);
                    } else {
                        tx.setConfirmations(null);
                    }
                } else {
                    tx.setConfirmations(0);
                }
            }
        }
    }


    function openTransactionSummaryModal(txIndex, result) {
        loadScript('wallet/frame-modal.js', function() {
            showFrameModal({
                title : 'Transaction Summary',
                description : '',
                src : root + 'tx-summary/'+txIndex+'?result='+result+'&guid='+guid
            });
        });
    }

    this.deleteNote = function(tx_hash) {
        delete tx_notes[tx_hash];

        buildVisibleView();

        backupWalletDelayed();
    }

    function addNotePopover(el, tx_hash) {
        (function(el, tx_hash) {
            el = $(el);

            if (!el.data('popover')) {
                el.popover({
                    title : 'Add Note',
                    trigger : 'manual',
                    content : '<textarea style="width:97%;height:50px;margin-top:2px" placeholder="Enter the note here..."></textarea><div style="text-align:right"><button class="btn btn-small">Save</button></div>'
                });
            } else if (el.data('popover').tip().is(':visible'))
                return;

            el.popover('show');

            el.mouseleave(function() {
                if (!el.__timeout) {
                    el.__timeout = setTimeout(function() {
                        el.popover('hide');
                    }, 250);
                }
            });

            function clearT() {
                if (el.__timeout) {
                    clearTimeout(el.__timeout);
                    el.__timeout = null;
                }
            }

            var tip = el.data('popover').tip().mouseenter(clearT);

            tip.find('textarea').focus(clearT);

            tip.mouseleave(function() {
                el.__timeout = setTimeout(function() {
                    el.popover('hide');
                }, 250);
            });

            tip.find('button').click(function() {
                //Strip HTML and replace quotes
                var note = $.trim($('<div>'+tip.find('textarea').val()+'</div>').text().replace(/'/g, '').replace(/"/g, ''));

                if (note.length > 0) {
                    tx_notes[tx_hash] = note;

                    backupWalletDelayed();
                }

                buildVisibleView();
            });
        })(el, tx_hash);
    }

    function showNotePopover(el, content, tx_hash) {
        (function(el, content, tx_hash) {
            el = $(el);

            if (!el.data('popover')) {
                var title = 'Note';

                //Only if it is a custom (not public note do we show the delete button
                if (tx_notes[tx_hash])
                    title += ' <span style="float:right"><img src="'+resource+'delete.png" /></span>';

                $(el).popover({
                    title : title,
                    trigger : 'manual',
                    content : content
                })
            } else if (el.data('popover').tip().is(':visible'))
                return;

            el.popover('show');

            el.mouseleave(function() {
                if (!el.__timeout) {
                    el.__timeout = setTimeout(function() {
                        el.popover('hide');
                    }, 250);
                }
            });

            var tip = el.data('popover').tip().mouseenter(function() {
                if (el.__timeout) {
                    clearTimeout(el.__timeout);
                    el.__timeout = null;
                }
            });

            tip.find('img').unbind().click(function() {
                MyWallet.deleteNote(tx_hash);
            });

            tip.mouseleave(function() {
                el.__timeout = setTimeout(function() {
                    el.popover('hide');
                }, 250);
            });
        })(el, content, tx_hash);
    }


    function getCompactHTML(tx, myAddresses, addresses_book) {
        var result = tx.result;

        var html = '<tr class="pointer" id="tx-' + tx.txIndex + '"><td class="hidden-phone" style="width:365px"><div><ul style="margin-left:0px;" class="short-addr">';

        var all_from_self = true;
        if (result >= 0) {
            for (var i = 0; i < tx.inputs.length; ++i) {
                var out = tx.inputs[i].prev_out;

                if (!out || !out.addr) {
                    all_from_self = false;

                    html += '<span class="label">Newly Generated Coins</span>';
                } else {
                    var my_addr = myAddresses[out.addr];

                    //Don't Show sent from self
                    if (my_addr)
                        continue;

                    all_from_self = false;

                    html += formatOutput(out, myAddresses, addresses_book);
                }
            }
        } else if (result < 0) {
            for (var i = 0; i < tx.out.length; ++i) {
                var out = tx.out[i];

                var my_addr = myAddresses[out.addr];

                //Don't Show sent to self
                if (my_addr && out.type == 0)
                    continue;

                all_from_self = false;

                html += formatOutput(out, myAddresses, addresses_book);
            }
        }

        if (all_from_self)
            html += '<span class="label">Moved Between Wallet</info>';

        html += '</ul></div></td><td><div>';

        var note = tx.note ? tx.note : tx_notes[tx.hash];

        if (note) {
            html += '<img src="'+resource+'note.png" class="pop show-note"> ';
        } else {
            html += '<img src="'+resource+'note_grey.png" class="pop add-note"> ';
        }

        if (tx.time > 0) {
            html += dateToString(new Date(tx.time * 1000));
        }

        if (tx.confirmations == 0) {
            html += ' <span class="label label-important pull-right hidden-phone">Unconfirmed Transaction!</span> ';
        } else if (tx.confirmations > 0) {
            html += ' <span class="label label-info pull-right hidden-phone">' + tx.confirmations + ' Confirmations</span> ';
        }

        html += '</div></td>';

        if (result > 0)
            html += '<td style="color:green"><div>' + formatMoney(result, true) + '</div></td>';
        else if (result < 0)
            html += '<td style="color:red"><div>' + formatMoney(result, true) + '</div></td>';
        else
            html += '<td><div>' + formatMoney(result, true) + '</div></td>';

        if (tx.balance == null)
            html += '<td></td></tr>';
        else
            html += '<td class="hidden-phone"><div>' + formatMoney(tx.balance) + '</div></td></tr>';

        return html;
    };


    //Reset is true when called manually with changeview
    function buildVisibleViewPre() {
        //Hide any popovers as they can get stuck whent the element is re-drawn
        hidePopovers();

        //Update the account balance
        if (final_balance == null) {
            $('#balance').html('Loading...');
        } else {
            $('#balance').html(formatSymbol(final_balance, symbol));
            $('#balance2').html(formatSymbol(final_balance, (symbol == symbol_local) ? symbol_btc : symbol_local));
        }

        //Only build when visible
        return cVisible.attr('id');
    }

    //Reset is true when called manually with changeview
    function buildVisibleView(reset) {

        var id = buildVisibleViewPre();

        if ("send-coins" == id)
            buildSendTxView(reset);
        else if ("home-intro" == id)
            buildHomeIntroView(reset);
        else if ("receive-coins" == id)
            buildReceiveCoinsView(reset)
        else if ("my-transactions" == id)
            buildTransactionsView(reset)
    }

    function buildHomeIntroView(reset) {
        $('#summary-n-tx').html(n_tx);

        $('#summary-received').html(formatMoney(total_received, true));

        $('#summary-sent').html(formatMoney(total_sent, true));

        $('#summary-balance').html(formatMoney(final_balance, symbol));

        var preferred = MyWallet.getPreferredAddress();

        $('#tweet-for-btc').unbind().click(function() {
            window.open('https://twitter.com/share?url=https://blockchain.info/wallet&hashtags=tweet4btc,bitcoin,'+preferred+'&text=Sign Up For a Free Bitcoin Wallet @ Blockchain.info', "", "toolbar=0, status=0, width=650, height=360");
        });

        if (MyWallet.isWatchOnly(preferred) == null) {
            $('.no-watch-only').hide();
        } else {
            $('.no-watch-only').show();

            var primary_address = $('#my-primary-address');
            if (primary_address.text() != preferred) {
                primary_address.text(preferred);

                $('#my-primary-addres-qr-code').html('<img style="padding-right:10px;padding-bottom:10px" src="'+root+'qr?data='+preferred+'&size=125">');
            }
        }
    }

    //Show a Advanced Warning, The show Import-Export Button After Main Password is Entered
    function buildImportExportView() {
        var warning = $('#export-warning').show();

        var content = $('#import-export-content').hide();

        $('#show-import-export').unbind().click(function () {
            MyWallet.getMainPassword(function() {
                warning.hide();

                loadScript('wallet/import-export.min.js', function() {
                    ImportExport.init(content, function() {
                        content.show();
                    }, function() {

                        changeView($("#home-intro"));
                    })
                }, function (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);

                    changeView($("#home-intro"));
                });
            }, function() {
                changeView($("#home-intro"));
            });
        });
    };

    //Display The My Transactions view
    function buildTransactionsView() {
        var tx_display = $('#tx_display').val();
        var interval = null;
        var start = 0;

        if (interval != null) {
            clearInterval(interval);
            interval = null;
        }

        var txcontainer;
        if (tx_display == 0) {
            $('#transactions-detailed').hide();
            txcontainer = $('#transactions-compact').show().find('tbody').empty();
        } else {
            $('#transactions-compact').hide();
            txcontainer = $('#transactions-detailed').empty().show();
        }

        if (transactions.length == 0) {
            $('#transactions-detailed, #transactions-compact').hide();
            $('#no-transactions').show();
            return;
        } else {
            $('#no-transactions').hide();
        }

        var buildSome = function() {
            for (var i = start; i < transactions.length && i < (start+10); ++i) {
                var tx = transactions[i];

                if (tx_display == 0) {
                    txcontainer.append(bindTx($(getCompactHTML(tx, addresses, address_book)), tx));
                } else {
                    txcontainer.append(tx.getHTML(addresses, address_book));
                }
            }

            start += 10;

            if (start < transactions.length) {
                interval = setTimeout(buildSome, 15);
            } else {
                var pagination = $('.pagination ul').empty();

                if (tx_page == 0 && transactions.length < 50) {
                    pagination.hide();
                    return;
                } else {
                    pagination.show();
                }

                var pages = Math.ceil(n_tx_filtered / 50);

                var disabled = ' disabled';
                if (tx_page > 0)
                    disabled = '';

                pagination.append($('<li class="prev'+disabled+'"><a>&larr; Previous</a></li>').click(function() {
                    MyWallet.setPage(tx_page-1);
                }));

                for (var i = 0; i < pages && i <= 10; ++i) {
                    (function(i){
                        var active = '';
                        if (tx_page == i)
                            active = ' class="active"';

                        pagination.append($('<li'+active+'><a class="hidden-phone">'+i+'</a></li>').click(function() {
                            MyWallet.setPage(i);
                        }));
                    })(i);
                }

                var disabled = ' disabled';
                if (tx_page < pages)
                    disabled = '';

                pagination.append($('<li class="next'+disabled+'"><a>Next &rarr;</a></li>').click(function() {
                    MyWallet.setPage(tx_page+1)
                }));
            }
        };

        buildSome();
    }

    this.setPage = function(i) {
        tx_page = i;

        scroll(0,0);

        MyWallet.get_history();
    }

    function parseMultiAddressJSON(json, cached) {
        var obj = $.parseJSON(json);

        if (!cached && obj.mixer_fee) {
            mixer_fee = obj.mixer_fee;
        }

        transactions.length = 0;

        if (obj.wallet == null) {
            total_received = 0;
            total_sent = 0;
            final_balance = 0;
            n_tx = 0;
            n_tx_filtered = 0;
            return;
        }

        total_received = obj.wallet.total_received;
        total_sent = obj.wallet.total_sent;
        final_balance = obj.wallet.final_balance;
        n_tx = obj.wallet.n_tx;
        n_tx_filtered = obj.wallet.n_tx_filtered;

        for (var i = 0; i < obj.addresses.length; ++i) {
            if (addresses[obj.addresses[i].address])
                addresses[obj.addresses[i].address].balance = obj.addresses[i].final_balance;
        }


        for (var i = 0; i < obj.txs.length; ++i) {
            var tx = TransactionFromJSON(obj.txs[i]);

            //Don't use the result given by the api because it doesn't include archived addresses
            tx.result = calcTxResult(tx, false);

            transactions.push(tx);
        }

        if (obj.info) {
            $('#nodes-connected').html(obj.info.nconnected);

            if (obj.info.latest_block != null)
                setLatestBlock(obj.info.latest_block);

            var new_symbol_local = obj.info.symbol_local;

            if (symbol == symbol_local) {
                symbol_local = new_symbol_local;
                symbol = new_symbol_local;
                calcMoney();
            } else if (!cached) {
                symbol_local = new_symbol_local;
            }
        }
    }

    function didDecryptWallet() {
        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());

        for (var listener in event_listeners) {
            event_listeners[listener]('did_decrypt')
        }

        //We have dealt the the hash values, don't need them anymore
        window.location.hash = '';

        try {
            //Make sure the last guid the user logged in the ame as this one, if not clear cache
            var local_guid = localStorage.getItem('guid');

            if (local_guid != guid) {
                localStorage.clear();

                //Demo Account Guid
                if (guid != demo_guid)
                    localStorage.setItem('guid', guid);
            } else {
                //Restore the balance cache
                var multiaddrjson = localStorage.getItem('multiaddr');

                if (multiaddrjson != null) {
                    parseMultiAddressJSON(multiaddrjson, true);

                    buildVisibleView();
                }
            }

        } catch (e) { } //Don't care - cache is optional

        ///Get the list of transactions from the http API
        MyWallet.get_history();

        changeView($("#home-intro"));

        $('#initial_error,#initial_success').remove();
    }

//Fetch a new wallet from the server
    function getWallet() {
        for (var key in addresses) {
            var addr = addresses[key];
            if (addr.tag == 1) { //Don't fetch a new wallet if we have any keys which are marked un-synced
                alert('Warning! wallet data may have changed but cannot sync as you have uns-saved keys');
                return;
            }
        }

        console.log('Get wallet with checksum ' + payload_checksum);

        $.get(root + 'wallet/wallet.aes.json?guid='+guid+'&sharedKey='+sharedKey+'&checksum='+payload_checksum+'&format=plain').success(function(data) {
            if (data == null || data.length == 0)
                return;

            if (data == 'Not modified') {
                console.log('Not modified');
                return;
            } else {
                console.log('Wallet data modified');

                encrypted_wallet_data = data;

                payload_checksum = Crypto.util.bytesToHex(Crypto.SHA256(encrypted_wallet_data, {asBytes: true}));

                internalRestoreWallet();

                MyWallet.get_history();

                buildVisibleView();
            }
        });
    }

    function internalRestoreWallet() {
        try {
            if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'No Wallet Data To Decrypt');
                return false;
            }

            var obj = null;
            MyWallet.decrypt(encrypted_wallet_data, password, function(decrypted) {
                try {
                    obj = $.parseJSON(decrypted);

                    return (obj != null);
                } catch (e) {
                    return false;
                };
            });

            if (obj == null) {
                throw 'Error Decrypting Wallet. Please check your password is correct.';
            }

            if (obj.double_encryption && obj.dpasswordhash) {
                double_encryption = obj.double_encryption;
                dpasswordhash = obj.dpasswordhash;
            }

            if (obj.options) {
                $.extend(wallet_options, obj.options);
            } else {
                //TODO Depreciate this block
                if (obj.fee_policy) {
                    MyWallet.setFeePolicy(obj.fee_policy);
                }

                if (obj.html5_notifications) {
                    MyWallet.setHTML5Notifications(obj.html5_notifications);
                }
            }

            addresses.length = 0;
            for (var i = 0; i < obj.keys.length; ++i) {

                var key = obj.keys[i];
                if (key.addr == null || key.addr.length == 0 || key.addr == 'undefined') {
                    MyWallet.makeNotice('error', 'null-error', 'Your wallet contains an undefined address. This is a sign of possible corruption, please double check all your BTC is accounted for. Backup your wallet to remove this error.', 15000);
                    continue;
                }

                addresses[key.addr] = key;
            }

            address_book = {};
            if (obj.address_book != null) {
                for (var i = 0; i < obj.address_book.length; ++i) {
                    MyWallet.addAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
                }
            }

            if (obj.tx_notes) tx_notes = obj.tx_notes;

            sharedKey = obj.sharedKey;

            if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36)
                throw 'Shared Key is invalid';

            //If we don't have a checksum then the wallet is probably brand new - so we can generate our own
            if (payload_checksum == null || payload_checksum.length == 0) {
                payload_checksum = Crypto.util.bytesToHex(Crypto.SHA256(encrypted_wallet_data, {asBytes: true}));
            } else {
                //Else we need to check if the wallet has changed
                getWallet();
            }

            setIsIntialized();

            return true;

        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        }

        return false;
    }

    this.getPassword = function(modal, success, error) {

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        //Center
        modal.center();

        var input = modal.find('input[name="password"]');

        //Virtual On-Screen Keyboard
        var $write = input,
            shift = false,
            capslock = false;

        modal.find('.vkeyboard li').click(function(){
            var $this = $(this),
                character = $this.html(); // If it's a lowercase letter, nothing happens to this variable

            // Shift keys
            if ($this.hasClass('left-shift') || $this.hasClass('right-shift')) {
                $('.letter').toggleClass('uppercase');
                $('.symbol span').toggle();

                shift = (shift === true) ? false : true;
                capslock = false;
                return false;
            }

            // Caps lock
            if ($this.hasClass('capslock')) {
                $('.letter').toggleClass('uppercase');
                capslock = true;
                return false;
            }

            // Delete
            if ($this.hasClass('delete')) {
                var html = $write.val();

                $write.val(html.substr(0, html.length - 1));
                return false;
            }

            // Special characters
            if ($this.hasClass('symbol')) character = $('span:visible', $this).html();
            if ($this.hasClass('space')) character = ' ';
            if ($this.hasClass('tab')) character = "\t";
            if ($this.hasClass('return')) character = "\n";

            // Uppercase letter
            if ($this.hasClass('uppercase')) character = character.toUpperCase();

            // Remove shift once a key is clicked.
            if (shift === true) {
                $('.symbol span').toggle();
                if (capslock === false) $('.letter').toggleClass('uppercase');

                shift = false;
            }

            // Add the character
            $write.val($write.val() + character);
        });

        input.unbind().keypress(function(e) {
            if(e.keyCode == 13) { //Pressed the return key
                e.preventDefault();
                modal.find('.btn.btn-primary').click();
            }
        });

        input.val('');

        modal.find('.btn.btn-primary').unbind().click(function() {
            if (success) {
                error = null;

                var ccopy = success;

                success = null;

                modal.modal('hide');

                setTimeout(function() {
                    ccopy(input.val());
                }, 100);
            }
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            if (error) {
                var ccopy = error;

                error = null;

                setTimeout(function() {
                    try { ccopy(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }, 100);
            }

            modal.modal('hide');
        });

        modal.unbind().on('hidden', function () {
            if (error) {
                var ccopy = error;

                error = null;

                setTimeout(function() {
                    try { ccopy(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }, 100);
            }
        });
    }

    this.makePairingQRCode = function(success) {
        MyWallet.getMainPassword(function() {
            loadScript('wallet/qr.code.creator.js', function() {
                try {
                    var device_qr = makeQRCode(300, 300, 1 , guid + '|' + sharedKey + '|' + password);

                    success(device_qr);
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            });
        }, function() {
            MyWallet.logout();
        });
    }

    this.getMainPassword = function(success, error) {
        //If the user has input their password recently just call the success handler
        if (last_input_main_password > new Date().getTime() - main_password_timeout)
            return success(password);

        MyWallet.getPassword($('#main-password-modal'), function(_password) {

            if (password == _password) {
                last_input_main_password = new Date().getTime();

                if (success) {
                    try { success(password); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            } else {
                MyWallet.makeNotice('error', 'misc-error', 'Password incorrect.');

                if (error) {
                    try { error(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            }
        }, error);
    }

    this.getSecondPassword = function(success, error) {

        if (!double_encryption || dpassword != null) {
            if (success) {
                try { success(dpassword); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e);  }
            }
            return;
        }

        MyWallet.getPassword($('#second-password-modal'), function(_password) {
            if (vaidateDPassword(_password)) {
                if (success) {
                    try { success(_password); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            } else {
                MyWallet.makeNotice('error', 'misc-error', 'Password incorrect.');

                if (error) {
                    try { error(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            }
        }, error);
    }

    function restoreWallet() {

        var input_field = $("#restore-password");

        password = $.trim(input_field.val());

        //Clear the password field now we are done with it
        input_field.val('');

        //Main Password times out after 10 minutes
        last_input_main_password = new Date().getTime();

        //If we don't have any wallet data then we must have two factor authentication enabled
        if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
            MyWallet.setLoadingText('Validating Authentication key');

            var auth_key = $.trim($('.restore-auth-'+auth_type).find('.code').val());

            if (auth_key.length == 0 || auth_key.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a Two Factor Authentication code');
                return false;
            }

            $.post(root + "wallet", { guid: guid, payload: auth_key, length : auth_key.length,  method : 'get-wallet', format : 'plain' },  function(data) {
                try {
                    if (data == null || data.length == 0) {
                        MyWallet.makeNotice('error', 'misc-error', 'Server Return Empty Wallet Data');
                        return;
                    }

                    encrypted_wallet_data = data;

                    //We can now hide the auth token input
                    $('.restore-auth-'+auth_type).hide();

                    $('.restore-auth-0').show();

                    if (internalRestoreWallet()) {
                        bindReady();

                        didDecryptWallet();
                    }
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            }).error(function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText);
                });
        } else {

            if (internalRestoreWallet()) {
                bindReady();

                didDecryptWallet();
            }
        }


        return true;
    }

    function setIsIntialized() {
        webSocketConnect(wsSuccess);

        $('#tech-faq').hide();

        $('#intro-text').hide();

        $('#large-summary').show();

        $('#status-container').show();
    }

    this.quickSendNoUI = function(to, value, listener) {
        loadScript('wallet/signer.min.js', function() {
            MyWallet.getSecondPassword(function() {
                try {
                    var obj = initNewTx();

                    obj.from_addresses = MyWallet.getActiveAddresses();

                    obj.to_addresses.push({address: new Bitcoin.Address(to), value :  Bitcoin.Util.parseValue(value)});

                    obj.addListener(listener);

                    obj.start();
                } catch (e){
                    listener.on_error(e);
                }
            }, function(e) {
                listener.on_error(e);
            });
        });
    }

    function emailBackup() {
        MyWallet.setLoadingText('Sending email backup');

        $.post(root + "wallet", { guid: guid, sharedKey: sharedKey, method : 'email-backup', format : 'plain' },  function(data) {
            MyWallet.makeNotice('success', 'backup-success', data);
        }).error(function(data) {
                MyWallet.makeNotice('error', 'misc-error', data.responseText);
            });
    }

    this.updateCacheManifest = function(done) {
        try {
            var cache = window.applicationCache;

            console.log('Clear Cache Manifest');

            // Swap in newly download files when update is ready
            cache.addEventListener('updateready', function(e){
                cache.swapCache();

                if(done) done();
            }, false);

            // Swap in newly download files when update is ready
            cache.addEventListener('noupdate', function(e){
                if(done) done();
            }, false);

            // Swap in newly download files when update is ready
            cache.addEventListener('error', function(e){
                if(done) done();
            }, false);

            cache.update();
        } catch (e) {
            console.log(e);

            if(done) done();
        }
    }

    //Can call multiple times in a row and it will backup only once after a certain delay of activity
    function backupWalletDelayed(method, success, error, extra) {
        if (archTimer != null) {
            clearInterval(archTimer);
            archTimer = null;
        }

        archTimer = setTimeout(function (){
            MyWallet.backupWallet(method, success, error, extra);
        }, 3000);
    }

    //Save the javascript walle to the remote server
    this.insertWallet = function(guid, sharedKey, password, extra, successcallback, errorcallback) {
        try {
            var data = makeCustomWalletJSON(null, guid, sharedKey);

            //Everything looks ok, Encrypt the JSON output
            var crypted = MyWallet.encrypt(data, password);

            if (crypted.length == 0) {
                throw 'Error encrypting the JSON output';
            }

            //Now Decrypt the it again to double check for any possible corruption
            var obj = null;
            MyWallet.decrypt(crypted, password, function(decrypted) {
                try {
                    obj = $.parseJSON(decrypted);
                    return (obj != null);
                } catch (e) {
                    return false;
                };
            });

            if (obj == null) {
                throw 'Error Decrypting Previously encrypted JSON. Not Saving Wallet.';
            }

            //SHA256 new_checksum verified by server in case of curruption during transit
            var new_checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));

            MyWallet.setLoadingText('Saving wallet');

            if (extra == null)
                extra = '';

            encrypted_wallet_data = crypted;

            $.ajax({
                type: "POST",
                url: root + 'wallet' + extra,
                data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, checksum: new_checksum, method : 'insert' },
                converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
                success: function(data) {

                    var change = false;
                    for (var key in addresses) {
                        var addr = addresses[key];
                        if (addr.tag == 1) {
                            addr.tag = null; //Make any unsaved addresses as saved
                            change = true;
                        }
                    }

                    //Update to the new payload new_checksum
                    payload_checksum = new_checksum;

                    MyWallet.makeNotice('success', 'misc-success', data);

                    buildVisibleView();

                    if (successcallback != null)
                        successcallback();

                    MyWallet.updateCacheManifest();
                },
                error : function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText, 10000);

                    buildVisibleView();

                    if (errorcallback != null)
                        errorcallback();
                }
            });
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', 'Error Saving Wallet: ' + e, 10000);

            buildVisibleView();

            if (errorcallback != null)
                errorcallback(e);
            else throw e;
        }
    }

    //Save the javascript walle to the remote server
    this.backupWallet = function(method, successcallback, errorcallbac) {
        try {
            if (method == null)
                method = 'update';

            if (nKeys(addresses) == 0)
                return;

            var data = MyWallet.makeWalletJSON();

            //Everything looks ok, Encrypt the JSON output
            var crypted = MyWallet.encrypt(data, password);

            if (crypted.length == 0) {
                throw 'Error encrypting the JSON output';
            }

            //Now Decrypt the it again to double check for any possible corruption
            var obj = null;
            MyWallet.decrypt(crypted, password, function(decrypted) {
                try {
                    obj = $.parseJSON(decrypted);
                    return (obj != null);
                } catch (e) {
                    return false;
                };
            });

            if (obj == null) {
                throw 'Error Decrypting Previously encrypted JSON. Not Saving Wallet.';
            }

            //SHA256 new_checksum verified by server in case of curruption during transit
            var new_checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));

            MyWallet.setLoadingText('Saving wallet');

            encrypted_wallet_data = crypted;

            $.ajax({
                type: "POST",
                url: root + 'wallet',
                data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, checksum: new_checksum, old_checksum : payload_checksum,  method : method },
                converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
                success: function(data) {

                    var change = false;
                    for (var key in addresses) {
                        var addr = addresses[key];
                        if (addr.tag == 1) {
                            addr.tag = null; //Make any unsaved addresses as saved
                            change = true;
                        }
                    }

                    //Update to the new payload new_checksum
                    payload_checksum = new_checksum;

                    MyWallet.makeNotice('success', 'misc-success', data);

                    buildVisibleView();

                    if (successcallback != null)
                        successcallback();

                    MyWallet.updateCacheManifest();
                },
                error : function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText, 10000);

                    buildVisibleView();

                    if (errorcallback != null)
                        errorcallback();
                }
            });
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', 'Error Saving Wallet: ' + e, 10000);

            buildVisibleView();

            if (errorcallback != null)
                errorcallback(e);
            else throw e;
        }
    }


    function encryptPK(base58) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot encrypt private key without a password';

            return MyWallet.encrypt(base58, sharedKey + dpassword);
        } else {
            return base58;
        }

        return null;
    }

    this.isBase58 = function(str, base) {
        for (var i = 0; i < str.length; ++i) {
            if (str[i] < 0 || str[i] > 58) {
                return false;
            }
        }
        return true;
    }

    //Changed padding to CBC iso10126 9th March 2012 & iterations to pbkdf2_iterations
    this.encrypt = function(data, password) {
        return Crypto.AES.encrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : pbkdf2_iterations });
    }

    //When the ecryption format changes it can produce data which appears to decrypt fine but actually didn't
    //So we call success(data) and if it returns true the data was formatted correctly
    this.decrypt = function(data, password, success, error) {

        //iso10126 with 10 iterations
        try {
            var decoded = Crypto.AES.decrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : pbkdf2_iterations });

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        //OFB iso7816 padding with one iteration
        try {
            //Othwise try the old default settings
            var decoded = Crypto.AES.decrypt(data, password, {mode: new Crypto.mode.OFB(Crypto.pad.iso7816), iterations : 1});

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        //iso10126 padding with one iteration
        try {
            var decoded = Crypto.AES.decrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : 1 });

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        if (error != null)
            error();

        return null;
    }


    //Fetch information on a new wallet identfier
    this.setGUID = function(guid_or_alias, resend_code) {
        MyWallet.setLoadingText('Changing Wallet Identifier');

        $('#initial_error,#initial_success').remove();

        $.get(root + 'wallet/'+guid_or_alias, {format : 'json', resend_code : resend_code}).success(function(obj) {
            $('.restore-auth-'+auth_type).hide();

            guid = obj.guid;
            auth_type = obj.auth_type;
            payload_checksum = obj.payload_checksum;
            encrypted_wallet_data = obj.payload;
            war_checksum = obj.war_checksum;
            symbol_local = obj.symbol_local;

            $('#restore-guid').val(guid);

            $('.restore-auth-'+auth_type).show();

            if (obj.initial_error)
                MyWallet.makeNotice('error', 'misc-error', obj.initial_error);

            if (obj.initial_success)
                MyWallet.makeNotice('success', 'misc-success', obj.initial_success);

            try {
                localStorage.clear();

                //Demo Account Guid
                if (guid != demo_guid)
                    localStorage.setItem('guid', guid);
            } catch (e) { }

        }).error(function(e) {
                console.log(e);

                try {
                    var obj = $.parseJSON(e.responseText);

                    if (obj.initial_error) {
                        MyWallet.makeNotice('error', 'misc-error', obj.initial_error);
                        return;
                    }
                } catch (e) {}

                MyWallet.makeNotice('error', 'misc-error', 'Error changing wallet identifier');
            });
    }


    function encodePK(priv) {
        var base58 = B58.encode(priv);
        return encryptPK(base58);
    }

    this.decryptPK = function(priv) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot decrypt private key without a password';

            return MyWallet.decrypt(priv, sharedKey + dpassword, MyWallet.isBase58);
        } else {
            return priv;
        }

        return null;
    }

    this.decodePK = function(priv) {
        var decrypted = MyWallet.decryptPK(priv);
        if (decrypted != null) {
            return B58.decode(decrypted);
        }
        return null;
    }

    this.signmessage = function(address, message) {
        var addr = addresses[address];

        var decryptedpk = MyWallet.decodePK(addr.priv);

        var key = new Bitcoin.ECKey(decryptedpk);

        return  Bitcoin.Message.signMessage(key, message, addr.addr);
    }

    function vaidateDPassword(input) {
        var thash = Crypto.SHA256(sharedKey + input, {asBytes: true});

        //try n rounds of SHA 256
        var data = thash;
        for (var i = 1; i < pbkdf2_iterations; ++i) {
            data = Crypto.SHA256(data, {asBytes: true});
        }

        var thash10 = Crypto.util.bytesToHex(data);
        if (thash10 == dpasswordhash) {
            dpassword = input;
            return true;
        }

        //Otherwise try SHA256 + salt
        if (Crypto.util.bytesToHex(thash) == dpasswordhash) {
            dpassword = input;
            dpasswordhash = thash10;
            return true;
        }

        //Legacy as I made a bit of a mistake creating a SHA256 hash without the salt included
        var leghash = Crypto.SHA256(input);

        if (leghash == dpasswordhash) {
            dpassword = input;
            dpasswordhash = thash10;
            return true;
        }

        return false;
    }

    //Check the integreity of all keys in the wallet
    this.checkAllKeys = function(reencrypt) {
        for (var key in addresses) {
            var addr = addresses[key];

            if (addr.addr == null)
                throw 'Null Address Found in wallet ' + key;

            //Will throw an exception if the checksum does not validate
            if (addr.addr.toString() == null)
                throw 'Error decoding wallet address ' + addr.addr;

            if (addr.priv != null) {
                var decryptedpk = MyWallet.decodePK(addr.priv);

                var privatekey = new Bitcoin.ECKey(decryptedpk);

                var actual_addr = privatekey.getBitcoinAddress().toString();
                if (actual_addr != addr.addr && privatekey.getBitcoinAddressCompressed().toString() != addr.addr) {
                    throw 'Private key does not match bitcoin address ' + addr.addr + " != " + actual_addr;
                }

                if (reencrypt) {
                    addr.priv = encodePK(decryptedpk);
                }
            }
        }

        MyWallet.makeNotice('success', 'wallet-success', 'Wallet verified.');
    }

    this.setMainPassword = function(new_password) {
        MyWallet.getMainPassword(function() {
            password = new_password;

            MyWallet.backupWallet('update', function() {
                MyWallet.updateCacheManifest(function() {
                    MyWallet.logout();
                });
            }, function() {
                MyWallet.logout();
            });
        });
    }

    function changeView(id) {
        if (id === cVisible)
            return;

        if (cVisible != null) {
            if ($('#' + cVisible.attr('id') + '-btn').length > 0)
                $('#' + cVisible.attr('id') + '-btn').parent().attr('class', '');

            cVisible.hide();
        }

        cVisible = id;

        cVisible.show();

        if ($('#' + cVisible.attr('id') + '-btn').length > 0)
            $('#' + cVisible.attr('id') + '-btn').parent().attr('class', 'active');

        buildVisibleView(true);
    }

    function nKeys(obj) {
        var size = 0, key;
        for (key in obj) {
            size++;
        }
        return size;
    };

    function internalDeletePrivateKey(addr) {
        addresses[addr].priv = null;
    }

    function walletIsFull() {
        if (nKeys(addresses) >= maxAddr) {
            MyWallet.makeNotice('error', 'misc-error', 'We currently support a maximum of '+maxAddr+' private keys, please remove some unused ones.');
            return true;
        }

        return false;
    }

    //Address (String), priv (base58 String), compresses boolean
    function internalAddKey(addr, priv) {
        var existing = addresses[addr];
        if (!existing || existing.length == 0) {
            addresses[addr] = {addr : addr, priv : priv, balance : 0};
            return true;
        } else if (!existing.priv && priv) {
            existing.priv = priv;
            return true;
        }
        return false;
    }

    function addAddressBookModal() {
        var modal = $('#add-address-book-entry-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        var labelField = modal.find('input[name="label"]');

        var addrField = modal.find('input[name="address"]');

        labelField.val('');
        addrField.val('');

        //Added address book button
        modal.find('.btn.btn-primary').unbind().click(function() {

            modal.modal('hide');

            var label = $.trim($('<div>' + labelField.val() + '</div>').text());

            var bitcoinAddress = $.trim(addrField.val());

            if (label.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a label for the address book entry');
                return false;
            }

            if (label.indexOf("\"") != -1) {
                MyWallet.makeNotice('error', 'misc-error', 'Label cannot contain double quotes');
                return false;
            }

            if (bitcoinAddress.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a bitcoin address for the address book entry');
                return false;
            }

            var addr;

            try {
                addr = new Bitcoin.Address(bitcoinAddress);

                if (addr == null)
                    throw 'Null address';

            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Bitcoin address invalid, please make sure you entered it correctly');
                return false;
            }

            if (address_book[bitcoinAddress] != null) {
                MyWallet.makeNotice('error', 'misc-error', 'Bitcoin address already exists');
                return false;
            }

            MyWallet.makeNotice('success', 'misc-success', 'Added Address book entry');

            MyWallet.addAddressBookEntry(bitcoinAddress, label);

            backupWalletDelayed();

            $('#send-coins').find('.tab-pane').trigger('show', true);
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    this.logout = function() {
        $.get(root + 'wallet/logout?format=plain').success(function() {
            window.location.reload();
        }).error(function() {
                window.location.reload();
            });
    }

    function deleteAddresses(addrs) {

        var modal = $('#delete-address-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.find('.btn.btn-primary').hide();
        modal.find('.btn.btn-danger').hide();

        $('#change-mind').hide();

        modal.find('#to-delete-address').html(addrs.join(' '));

        modal.find('#delete-balance').empty();

        var dbalance = modal.find('#delete-balance');

        var addrs_with_priv = [];
        for (var i in addrs) {
            var address_string = addrs[i];
            if (addresses[address_string] && addresses[address_string].priv)
                addrs_with_priv.push(addrs[i]);
        }

        BlockchainAPI.get_balance(addrs_with_priv, function(data) {

            modal.find('.btn.btn-primary').show(200);
            modal.find('.btn.btn-danger').show(200);

            dbalance.html('Balance ' + formatBTC(data) + ' BTC');

            if (data > 0)
                dbalance.css('color', 'red');
            else
                dbalance.css('color', 'black');


        }, function() {

            modal.find('.btn.btn-primary').show(200);
            modal.find('.btn.btn-danger').show(200);

            dbalance.text('Error Fetching Balance');
        });

        var isCancelled = false;
        var i = 0;
        var interval = null;
        var changeMindTime = 10;

        changeMind = function() {
            $('#change-mind').show();
            $('#change-mind-time').text(changeMindTime - i);
        };

        modal.find('.btn.btn-primary').unbind().click(function() {

            changeMind();

            modal.find('.btn.btn-primary').hide();
            modal.find('.btn.btn-danger').hide();

            interval = setInterval(function() {

                if (isCancelled)
                    return;

                ++i;

                changeMind();

                if (i == changeMindTime) {
                    //Really delete address
                    $('#delete-address-modal').modal('hide');

                    MyWallet.makeNotice('warning', 'warning-deleted', 'Private Key Removed From Wallet');

                    for (var ii in addrs) {
                        internalDeletePrivateKey(addrs[ii]);
                    }

                    //Update view with remove address
                    buildVisibleView();

                    MyWallet.backupWallet();

                    clearInterval(interval);
                }

            }, 1000);
        });

        modal.find('.btn.btn-danger').unbind().click(function() {

            changeMind();

            modal.find('.btn.btn-primary').hide();
            modal.find('.btn.btn-danger').hide();

            interval = setInterval(function() {

                if (isCancelled)
                    return;

                ++i;

                changeMind();

                if (i == changeMindTime) {
                    try {
                        //Really delete address
                        $('#delete-address-modal').modal('hide');

                        MyWallet.makeNotice('warning', 'warning-deleted', 'Address & Private Key Removed From Wallet');

                        for (var ii in addrs) {
                            MyWallet.deleteAddress(addrs[ii]);
                        }

                        buildVisibleView();

                        MyWallet.backupWallet('update', function() {
                            MyWallet.get_history();
                        });

                    } finally {
                        clearInterval(interval);
                    }
                }

            }, 1000);
        });

        modal.unbind().on('hidden', function () {
            if (interval) {
                isCancelled = true;
                clearInterval(interval);
                interval = null;
            }
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    function getActiveLabels() {
        var labels = [];
        for (var key in address_book) {
            labels.push(address_book[key]);
        }
        for (var key in addresses) {
            var addr =  addresses[key];
            if (addr.tag != 2 && addr.label)
                labels.push(addr.label);
        }
        return labels;
    }

    function sweepAddresses(addresses) {
        MyWallet.getSecondPassword(function() {
            var modal = $('#sweep-address-modal');

            modal.modal('show');


            BlockchainAPI.get_balance(addresses, function(data) {
                modal.find('.balance').text('Amount: ' + formatBTC(data) + ' BTC');
            }, function() {
                modal.find('.balance').text('Error Fetching Balance');
            });

            var sweepSelect = modal.find('select[name="change"]');

            buildSelect(sweepSelect, true);

            modal.find('.btn.btn-primary').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    BlockchainAPI.get_balance(addresses, function(value) {
                        var obj = initNewTx();

                        obj.fee = obj.base_fee; //Always include a fee
                        obj.to_addresses.push({address: new Bitcoin.Address($.trim(sweepSelect.val())), value : BigInteger.valueOf(value).subtract(obj.fee)});
                        obj.from_addresses = addresses;

                        obj.start();

                    }, function() {
                        MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                    });
                });

                modal.modal('hide');
            });

            modal.find('.btn.btn-secondary').unbind().click(function() {
                modal.modal('hide');
            });
        });
    }

    function buildPopovers() {
        try {
            $(".pop").popover({
                offset: 10,
                placement : 'bottom'
            });
        } catch(e) {}
    }

    function bindReady() {

        $('#add-address-book-entry-btn').click(function() {
            addAddressBookModal();
        });

        $("#home-intro-btn").click(function() {
            changeView($("#home-intro"));
        });

        $("#my-transactions-btn").click(function() {
            changeView($("#my-transactions"));
        });

        $("#send-coins-btn").click(function() {
            changeView($("#send-coins"));
        });

        $("#import-export-btn").click(function() {
            changeView($("#import-export"));

            buildImportExportView();
        });

        $('#chord-diagram').click(function() {
            window.open(root + 'taint/' + MyWallet.getActiveAddresses().join('|'), null, "width=850,height=850");
        });

        $('#verify-message').click(function() {
            loadScript('wallet/address_modal.min.js', function() {
                verifyMessageModal();
            });
        });

        $('#group-received').click(function() {
            loadScript('wallet/taint_grouping.min.js', function() {
                try{
                    loadTaintData();
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', 'Unable To Load Taint Grouping Data');
                }
            });
        });

        $("#my-account-btn").click(function() {
            changeView($("#my-account"));

            var warning = $('#account-settings-warning').show();

            var content = $('#my-account-content').hide();

            $('#show-account-settings').unbind().click(function () {
                MyWallet.getMainPassword(function() {
                    warning.hide();

                    loadScript('wallet/account.min.js', function() {
                        AccountSettings.init(content, function() {
                            content.show();
                        }, function() {
                            changeView($("#home-intro"));
                        })
                    }, function (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);

                        changeView($("#home-intro"));
                    });
                }, function() {
                    changeView($("#home-intro"));
                });
            });
        });

        $('.download-backup-btn').click(function() {
            window.open(root + 'wallet/wallet.aes.json?guid=' + guid + '&sharedKey=' + sharedKey);
        });

        $('#enable_archived_checkbox').change(function() {
            var enabled = $(this).is(':checked');

            $('.archived_checkbox').attr('checked', false);

            $('.archived_checkbox').attr('disabled', !enabled);

            $('#archived-sweep').attr('disabled', !enabled);

            $('#archived-delete').attr('disabled', !enabled);
        });

        $('#anonymous-addresses').on('show', function() {
            var self = $(this);
            loadScript('wallet/anonymous-addresses.min.js', function() {
                buildAnonymousTable(self);
            });
        });

        $('#active-addresses').on('show', function() {
            var table = $(this).find('table:first');

            table.find("tbody:gt(0)").remove();

            var tbody = table.find('tbody').empty();

            for (var key in addresses) {
                var addr = addresses[key];

                //Hide Archived
                if (addr.tag == 2)
                    continue;

                var noPrivateKey = '';

                if (addr.tag == 1) {
                    noPrivateKey = ' <font color="red" class="pop" title="Not Synced" data-content="This is a new address which has not yet been synced with our the server. Do not used this address yet.">(Not Synced)</font>';
                } else if (addr.priv == null) {
                    noPrivateKey = ' <font color="red" class="pop" title="Watch Only" data-content="Watch Only means there is no private key associated with this bitcoin address. <br /><br /> Unless you have the private key stored elsewhere you do not own the funds at this address and can only observe the transactions.">(Watch Only)</font>';
                }

                var extra = '';
                var label = addr.addr;
                if (addr.label != null) {
                    label = addr.label;
                    extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
                }

                var action_tx = $('<tr><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatMoney(addr.balance, true) + '</span></td>\
            <td><div class="btn-group pull-right"><a class="btn btn-mini dropdown-toggle" data-toggle="dropdown" href="#"><span class="hidden-phone">Actions </span><span class="caret"></span></a><ul class="dropdown-menu"> \
            <li><a href="#" class="pop act-archive" title="Archive Address" data-content="Click this button to hide the address from the main view. You can restore or delete later by finding it in the Archived addresses tab.">Archive Address</a></li>\
            <li><a href="#" class="pop act-label" title="Label Address" data-content="Set the label for this address.">Label Address</a></li>\
            <li><a href="#" class="pop act-qr" title="Show QR Code" data-content="Show a QR Code for this address.">QR Code</a></li>\
            <li><a href="#" class="pop act-sign" title="Sign Message" data-content="Sign A message with this address.">Sign Message</a></li>\
            <li><a href="#" class="pop act-request" title="Request Payment" data-content="Click here to create a new QR Code payment request. The QR Code can be scanned using most popular bitcoin software and mobile apps.">Create Payment Request</a></li>\
            </ul></div></td></tr>');

                (function(address) {
                    action_tx.find('.act-archive').click(function() {
                        MyWallet.archiveAddr(address);
                    });

                    action_tx.find('.act-label').click(function() {
                        loadScript('wallet/address_modal.min.js', function() {
                            showLabelAddressModal(address);
                        });
                    });

                    action_tx.find('.act-qr').click(function() {
                        loadScript('wallet/address_modal.min.js', function() {
                            showAddressModalQRCode(address);
                        });
                    });

                    action_tx.find('.act-sign').click(function() {
                        loadScript('wallet/address_modal.min.js', function() {
                            showAddressModalSignMessage(address);
                        });
                    });

                    action_tx.find('.act-request').click(function() {
                        loadScript('wallet/frame-modal.js', function() {
                            showFrameModal({
                                title : 'Create Payment Request',
                                description : 'Request Payment into address <b>'+address+'</b>',
                                src : root + 'payment_request?address='+address
                            });
                        });
                    });
                })(addr.addr);

                if (addr.balance > 0 && addr.priv)  {
                    table.prepend(action_tx);
                } else {
                    table.append(action_tx);
                }
            }

            buildPopovers();
        });

        $('#archived-addresses').on('show', function() {

            $('#enable_archived_checkbox').attr('checked', false);
            $('#archived-delete').attr('disabled', true);
            $('#archived-sweep').attr('disabled', true);
            $('#archived-addr tbody').empty();

            var table = $(this).find('tbody');

            var archived = MyWallet.getArchivedAddresses();

            var build = function() {
                table.empty();

                for (var key in archived) {
                    var addr = addresses[archived[key]];

                    if (addr.tag != 2)
                        continue;

                    var noPrivateKey = '';
                    if (addr.priv == null) {
                        noPrivateKey = ' <font color="red">(Watch Only)</font>';
                    }

                    var extra = '';
                    var label = addr.addr;
                    if (addr.label != null) {
                        label = addr.label;
                        extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
                    }

                    var tr = $('<tr><td style="width:20px;"><input type="checkbox" class="archived_checkbox" value="'+addr.addr+'" disabled></td><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatBTC(addr.balance) + '<span class="hidden-phone"> BTC</span></span></td><td style="width:16px"><img src="'+resource+'unarchive.png" class="act-unarchive" /></td></tr>');

                    (function(address) {
                        tr.find('.act-unarchive').click(function() {
                            MyWallet.unArchiveAddr(address);
                        });
                    })(addr.addr);

                    if (addr.balance > 0 && addr.priv)  {
                        table.prepend(tr);
                    } else {
                        table.append(tr);
                    }
                }
            }

            build();

            BlockchainAPI.get_balances(archived, function(obj) {
                build();
            }, function(e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });
        });

        $('#archived-sweep').click(function() {

            var toSweep = [];

            $('.archived_checkbox:checked').each(function() {
                var addr = addresses[$(this).val()];

                if (addr.priv == null) {
                    MyWallet.makeNotice('error', 'misc-error', 'Cannot Sweep Watch Only Address');
                    return;
                }

                toSweep.push(addr.addr);
            });


            if (toSweep.length == 0)
                return;

            sweepAddresses(toSweep);
        });

        $('#archived-delete').click(function() {

            var toDelete = [];

            $('.archived_checkbox:checked').each(function() {
                toDelete.push($(this).val());
            });

            if (toDelete.length == 0)
                return;

            deleteAddresses(toDelete);
        });

        $('#anonymous-never-ask').click(function() {
            SetCookie('anonymous-never-ask', $(this).is(':checked'));
        });

        $('#export-history').click(function() {
            loadScript('wallet/frame-modal.js', function() {
                showFrameModal({
                    title : 'Export History',
                    description : '',
                    src : root + 'export-history?active='+ MyWallet.getActiveAddresses().join('|')+'&archived='+MyWallet.getArchivedAddresses().join("|")
                });
            });
        });

        $('.deposit-btn').click(function() {
            var self = $(this);
            var address = MyWallet.getPreferredAddress();
            loadScript('wallet/frame-modal.js', function() {
                showFrameModal({
                    title : self.data('title'),
                    description : 'Deposit into address <b>'+address+'</b>',
                    top_right : 'Have Questions? Read <a href="'+self.data('link')+'" target="new">How It Works</a>',
                    src : root + 'deposit?address='+address+'&ptype='+self.data('type')+'&guid='+guid+'&sharedKey='+sharedKey
                });
            });
        });

        $('.withdraw-btn').click(function() {
            var self = $(this);
            MyWallet.getSecondPassword(function() {
                var address = MyWallet.getPreferredAddress();
                loadScript('wallet/frame-modal.js', function() {
                    showFrameModal({
                        title : self.data('title'),
                        description : 'Your Wallet Balance is <b>'+formatBTC(final_balance)+' BTC</b>',
                        src : root + 'withdraw?method='+self.data('type')+'&address='+address+'&balance='+final_balance+'&guid='+guid+'&sharedKey='+sharedKey
                    });
                });
            });
        });

        $('#logout').click(MyWallet.logout);

        $('#refresh').click(function () {
            getWallet();

            MyWallet.get_history();
        });

        $('#summary-n-tx-chart').click(function() {
            window.open(root + 'charts/n-transactions?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $('#summary-received-chart').click(function() {
            window.open(root + 'charts/received-per-day?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $('#summary-balance-chart').click(function() {
            window.open(root + 'charts/balance?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $("#new-addr").click(function() {
            try {
                MyWallet.getSecondPassword(function() {
                    var address = MyWallet.generateNewKey().getBitcoinAddress().toString();

                    MyWallet.makeNotice('info', 'new-address', 'Generated new Bitcoin Address ' + address);

                    loadScript('wallet/address_modal.min.js', function() {
                        showLabelAddressModal(address);
                    });

                    MyWallet.backupWallet();
                });
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            }
        });

        $('#filter').change(function(){
            tx_page = 0;
            tx_filter = $(this).val();

            MyWallet.get_history();
        });

        var tx_display_el = $('#tx_display');
        tx_display_el.change(function(){
            SetCookie("tx_display", $(this).val());

            buildVisibleView();

        });

        var tx_cookie_val = getCookie('tx_display');
        if (tx_cookie_val != null) {
            tx_display_el.val(parseInt(tx_cookie_val));
        }

        $('#email-backup-btn').click(function() {
            emailBackup();
        });

        $('#dropbox-backup-btn').click(function() {
            window.open(root + 'wallet/dropbox-login?guid=' + guid + '&sharedKey=' + sharedKey);
        });

        $('#gdrive-backup-btn').click(function() {
            window.open(root + 'wallet/gdrive-login?guid=' + guid + '&sharedKey=' + sharedKey);
        });

        $('#large-summary').click(function() {
            toggleSymbol();

            buildVisibleView();
        });

        $('#send-quick').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    startTxUI(self, 'quick', initNewTx());
                });
            });
        });

        $('#send-email').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    startTxUI(self, 'email', initNewTx());
                });
            });
        });

        $('#send-anonymous').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.mixer_fee').text(mixer_fee);

            self.find('.fees,.free,.bonus').show();
            if (mixer_fee < 0) {
                self.find('.fees,.free').hide();
            } else if (mixer_fee == 0) {
                self.find('.fees,.bonus').hide();
            } else {
                self.find('.free,.bonus').hide();
            }

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    startTxUI(self, 'anonymous', initNewTx());
                });
            });

            self.find('.anonymous-fees').text('0.00');
            self.find('input[name="send-before-fees"]').unbind().bind('keyup change', function() {
                var input_value = parseFloat($.trim($(this).val()));
                var real_tx_value = 0;

                if (input_value > 0) {
                    if (mixer_fee > 0) {
                        real_tx_value = parseFloat(input_value + ((input_value / 100) *  mixer_fee));
                    } else {
                        real_tx_value = parseFloat(input_value);

                        self.find('.bonus-value').text(- (Math.min($(this).val(), 200) / 100) * mixer_fee);
                    }
                }

                if (input_value < 0.5)
                    self.find('.anonymous-fees').text('0.00');
                else
                    self.find('.anonymous-fees').text(real_tx_value.toFixed(4));

                self.find('input[name="send-value"]').val(real_tx_value).trigger('keyup');
            })
        });

        $('#send-custom').on('show',  function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    startTxUI(self, 'custom', initNewTx());
                });
            });

            self.find('select[name="from"]').unbind().change(function() {
                var total_selected = 0;

                var values = $(this).val();
                for (var i in values) {
                    if (values[i] == 'any') {
                        $(this).val('any');

                        total_selected = final_balance;
                        break;
                    } else {
                        var addr = addresses[values[i]];
                        if (addr && addr.balance)
                            total_selected += addr.balance;
                    }
                }

                self.find('.amount-available').text(formatBTC(total_selected));
            }).trigger('change');

            self.find('.reset').unbind().click(function() {
                buildSendForm(self, true);

                self.find('select[name="from"]').trigger('change');
            });
        });

        $('#send-satoshi-dice,#send-btcdice-dice').on('show', function(e, reset) {
            var self = this;

            loadScript('wallet/dicegames.min.js', function() {
                try {
                    DICEGame.init($(self));
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', 'Unable To Load Dice Bets');
                }
            }, function (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });
        });


        $('#send-sms').on('show', function(e, reset) {
            if (reset)
                return;

            var self = $(this);

            buildSendForm(self);

            $.get(resource + 'wallet/country_codes.html').success(function(data) {
                self.find('select[name="sms-country-code"]').html(data);
            }).error(function () {
                    MyWallet.makeNotice('error', 'misc-error', 'Error Downloading SMS Country Codes')
                });

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer.min.js', function() {
                    var pending_transaction = initNewTx();

                    startTxUI(self, 'sms', pending_transaction);
                });
            });
        });


        $('#address-book').on('show', function() {
            var el = $('#address-book-tbl tbody');

            if (nKeys(address_book) > 0) {
                el.empty();

                for (var address in address_book) {
                    var tr = $('<tr><td>'+ address_book[address] + '</td><td><div class="addr-book-entry">'+ address + '</div></td><td style="width:16px" class="hidden-phone"><img src="'+resource+'delete.png" class="act-delete" /></td></tr>');

                    (function(address) {
                        tr.find('.act-delete').click(function() {
                            MyWallet.deleteAddressBook(address);
                        });
                    })(address);

                    el.append(tr);
                }
            }
        });

        $('a[data-toggle="tab"]').unbind().on('show', function(e) {
            $(e.target.hash).trigger('show');
        });


        $("#receive-coins-btn").click(function() {
            changeView($("#receive-coins"));
        });

        $('.show_adv').click(function() {
            $('.modal:visible').center();
        });
    }

    function bindInitial() {

        $('.resend-code').click(function() {
            MyWallet.setGUID(guid, true);
        });


        buildPopovers();

        $('#restore-password').keypress(function(e) {
            if(e.keyCode == 13) { //Pressed the return key
                e.preventDefault();

                $('#restore-wallet-continue').click();
            }
        });

        $("#restore-wallet-continue").unbind().click(function(e) {
            e.preventDefault();

            var tguid = $.trim($('#restore-guid').val());

            if (tguid.length == 0)
                return;

            if (guid != tguid) {
                MyWallet.setGUID(tguid, false);
            } else {
                restoreWallet();
            }
        });

        $('.modal').on('show', function() {
            hidePopovers();

            $(this).center();
        }).on('shown', function() {
                hidePopovers();

                $(this).center();
            })
    }

    function parseMiniKey(miniKey) {
        var check = Crypto.SHA256(miniKey + '?');

        switch(check.slice(0,2)) {
            case '00':
                var decodedKey = Crypto.SHA256(miniKey, {asBytes: true});
                return decodedKey;
                break;
            case '01':
                var x          = Crypto.util.hexToBytes(check.slice(2,4))[0];
                var count      = Math.round(Math.pow(2, (x / 4)));
                var decodedKey = Crypto.PBKDF2(miniKey, 'Satoshi Nakamoto', 32, { iterations: count, asBytes: true});
                return decodedKey;
                break;
            default:
                console.log('invalid key');
                break;
        }
    };

    function getSelectionText() {
        var sel, html = "";
        if (window.getSelection) {
            sel = window.getSelection();
            if (sel.rangeCount) {
                var frag = sel.getRangeAt(0).cloneContents();
                var el = document.createElement("div");
                el.appendChild(frag);
                html = el.innerText;
            }
        } else if (document.selection && document.selection.type == "Text") {
            html = document.selection.createRange().htmlText;
        }
        return html;
    }

    this.detectPrivateKeyFormat = function(key) {
        // 51 characters base58, always starts with a '5'
        if (/^5[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50}$/.test(key))
            return 'sipa';

        //52 character compressed starts with L or K
        if (/^[LK][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{51}$/.test(key))
            return 'compsipa';

        // 52 characters base58
        if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(key) || /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{43}$/.test(key))
            return 'base58';

        if (/^[A-Fa-f0-9]{64}$/.test(key))
            return 'hex';

        if (/^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=+\/]{44}$/.test(key))
            return 'base64';

        if (/^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{21}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{25}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{29}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{30}$/.test(key)) {

            var testBytes = Crypto.SHA256(key + "?", { asBytes: true });

            if (testBytes[0] === 0x00 || testBytes[0] === 0x01)
                return 'mini';
        }

        throw 'Unknown Key Format ' + key;
    }

    this.privateKeyStringToKey = function(value, format) {

        var key_bytes = null;

        if (format == 'base58') {
            key_bytes = B58.decode(value);
        } else if (format == 'base64') {
            key_bytes = Crypto.util.base64ToBytes(value);
        } else if (format == 'hex') {
            key_bytes = Crypto.util.hexToBytes(value);
        } else if (format == 'mini') {
            key_bytes = parseMiniKey(value);
        } else if (format == 'sipa') {
            var tbytes = B58.decode(value);
            tbytes.shift();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else if (format == 'sipa') {
            var tbytes = B58.decode(value);
            tbytes.shift();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else if (format == 'compsipa') {
            var tbytes = B58.decode(value);
            tbytes.shift();
            tbytes.pop();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else {
            throw 'Unsupported Key Format';
        }

        if (key_bytes.length != 32)
            throw 'Result not 32 bytes in length';

        return new Bitcoin.ECKey(key_bytes);
    }

    $(document).ready(function() {

        var body = $(document.body);

        //Load data attributes from html
        encrypted_wallet_data = body.data('payload');
        guid = body.data('guid');
        sharedKey = body.data('sharedkey');
        payload_checksum =  body.data('payload-checksum');
        auth_type =  body.data('auth-type');

        //Deposit pages set this flag so it can be loaded in an iframe

        if (MyWallet.skip_init) return;

        //Iframe breakout
        if (top.location!= self.location) {
            top.location = self.location.href
        }

        if (!$.isEmptyObject({})) {
            MyWallet.makeNotice('error', 'error', 'Object.prototype has been extended by a browser extension. Please disable this extensions and reload the page.');
            return;
        }

        //Disable auotcomplete in firefox
        $("input,button,select").attr("autocomplete","off");

        body.ajaxStart(function() {
            $('.loading-indicator').fadeIn(200);
        }).ajaxStop(function() {
                $('.loading-indicator').hide();
            }).click(function() {

                if (logout_timeout) {
                    clearTimeout(logout_timeout);
                    logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
                }

                rng_seed_time();
            }).keypress(function() {
                if (logout_timeout) {
                    clearTimeout(logout_timeout);
                    logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
                }

                rng_seed_time();
            });

        bindInitial();

        $('.restore-auth-'+auth_type).show();

        cVisible = $("#restore-wallet");

        cVisible.show();

        //Show a warning when the Users copies a watch only address to the clipboard
        var ctrlDown = false;
        var ctrlKey = 17, vKey = 86, cKey = 67, appleKey = 67;
        $(document).keydown(function(e) {
            try {
                if (e.keyCode == ctrlKey || e.keyCode == appleKey)
                    ctrlDown = true;

                if (ctrlDown &&  e.keyCode == cKey) {
                    var selection = $.trim(getSelectionText());

                    var addr = addresses[selection];

                    if (addr != null) {
                        if (addr.priv == null) {
                            $('#watch-only-copy-warning-modal').modal('show');
                        } else if (addr.tag == 1) {
                            $('#not-synced-warning-modal').modal('show');
                        }
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }).keyup(function(e) {
                if (e.keyCode == ctrlKey || e.keyCode == appleKey)
                    ctrlDown = false;
            });
    });

    this.unArchiveAddr = function(addr) {
        var addr = addresses[addr];
        if (addr.tag == 2) {
            addr.tag = null;

            buildVisibleView();

            backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });
        } else {
            MyWallet.makeNotice('error', 'add-error', 'Cannot Unarchive This Address');
        }
    }

    this.archiveAddr = function(addr) {
        if (MyWallet.getActiveAddresses().length <= 1) {
            MyWallet.makeNotice('error', 'add-error', 'You must leave at least one active address');
            return;
        }

        var addr = addresses[addr];
        if (addr.tag == null || addr.tag == 0) {
            addr.tag = 2;

            buildVisibleView();

            backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });

        } else {
            MyWallet.makeNotice('error', 'add-error', 'Cannot Archive This Address');
        }
    }

    function buildReceiveCoinsView() {
        $('#receive-coins').find('.tab-pane.active').trigger('show');

        setupToggle();
    }

    this.addWatchOnlyAddress = function(address) {
        return internalAddKey(address);
    }

    this.addPrivateKey = function(key, compressed) {
        if (walletIsFull())
            return false;

        if (key == null) {
            throw 'Unable to generate a new bitcoin address.';
        }

        if (compressed)
            var addr = key.getBitcoinAddressCompressed();
        else
            var addr = key.getBitcoinAddress();

        if (addr == null) {
            throw 'Generated invalid bitcoin address.';
        }

        if (internalAddKey(addr.toString(), encodePK(key.priv))) {
            addresses[addr].tag = 1; //Mark as unsynced

            //Subscribe to tranaction updates through websockets
            try {
                ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');
            } catch (e) { }
        } else {
            throw 'Unable to add generated bitcoin address.';
        }

        return addr;
    }

    this.generateNewKey = function() {
        var key = new Bitcoin.ECKey(false);

        if (MyWallet.addPrivateKey(key)) {
            return key;
        }
    }
};