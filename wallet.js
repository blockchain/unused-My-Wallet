var encrypted_wallet_data = null; //Encrypted wallet data (Base64, AES 256)
var guid = null; //Wallet identifier
var cVisible; //currently visible view
var password; //Password
var dpassword = null; //double encryption Password
var dpasswordhash; //double encryption Password
var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't overwrite a wallet backup even if you have the guid
var final_balance = 0; //Final Satoshi wallet balance
var total_sent = 0; //Total Satoshi sent
var total_received = 0; //Total Satoshi received
var n_tx = 0; //Number of transactions
var n_tx_filtered = 0; //Number of transactions after filtering
var isInitialized = false; //Wallet is loaded and decrypted
var latest_block = null; //Chain head block
var address_book = []; //Holds the address book addr = label
var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
var double_encryption = false; //If wallet has a second password
var tx_page = 0; //Multi-address page
var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)
var maxAddr = 400; //Maximum number of addresses
var nconnected; //Number of nodes blockchain.info is connected to
var addresses = []; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
var offline = false; //If on offline or online mode
var pbkdf2_iterations = 10; //Not ideal, but limitations of using javascript
var payload_checksum = null; //SHA256 hash of the current wallet.aes.json
var addressToAdd = null; //a watch only address to add from #newaddr hash value (String)
var privateKeyToSweep = null; //a private key to sweep from #newpriv hash value (ECKey)
var isSignup = false; //Set when on new account signup page
var Base58 = Bitcoin.Base58;
var archTimer; //Delayed Backuop wallet timer

$.fn.center = function () {
    this.css("top", ( $(window).height() - this.height() ) / 2+$(window).scrollTop() + "px");
    this.css("left", ( $(window).width() - this.width() ) / 2+$(window).scrollLeft() + "px");
    return this;
};

$(window).resize(function() {
    $('.modal:visible').center();
});

function setLoadingText(txt) {
    $('.loading-text').text(txt);
}

function hideNotice(id) {
    $('#'+id).remove();
}

setInterval ( "doStuffTimer()", 10000 );

//Updates time last block was received and check for websocket connectivity
function doStuffTimer () {
    try {

        if (WebSocket != null) {
            if ((!offline && isInitialized) && (ws == null || ws.readyState != WebSocket.OPEN))
                websocketConnect();
        }
    } catch (e) {}
}

function websocketConnect() {
    if (!isInitialized || offline) return;

    try {
        ws = new WebSocket("ws://api.blockchain.info:8335/inv");

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
                        updateCacheManifest();

                        //Fetch the updated wallet from the server
                        setTimeout(getWallet, 250);
                    }

                } else if (obj.op == 'utx') {

                    var tx = TransactionFromJSON(obj.x);

                    //Check if this is a duplicate
                    //Maybe should have a map_prev to check for possible double spends
                    for (var i = 0; i < transactions.length; ++i) {
                        if (transactions[i].txIndex == tx.txIndex)
                            return;
                    }

                    playSound('beep');

                    /* Calculate the result */
                    var result = 0;

                    for (var i = 0; i < tx.inputs.length; i++) {
                        var input = tx.inputs[i];

                        //If it is our address then subtract the value
                        var addr = addresses[input.prev_out.addr];
                        if (addr) {
                            var value = parseInt(input.prev_out.value);

                            if (addr.tag != 2) {
                                result -= value;
                                total_sent += value;
                            }
                            addr.balance -= value;
                        }
                    }


                    for (var i = 0; i < tx.out.length; i++) {
                        var output = tx.out[i];

                        var addr = addresses[output.addr];
                        if (addr) {
                            var value = parseInt(output.value);

                            if (addr.tag != 2) {
                                result += value;
                                total_received += value;
                            }

                            addr.balance += value;
                        }
                    }


                    flashTitle('New Transaction');

                    tx.result = result;

                    final_balance += result;

                    n_tx++;

                    tx.setConfirmations(0);

                    if (tx_filter == 0 && tx_page == 0) {

                        transactions.unshift(tx);

                        //Meed to update transactions list
                        buildVisibleView();
                    }

                }  else if (obj.op == 'block') {
                    flashTitle('New Block');

                    //Very annoying
                    //playSound('ding');

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
                    buildVisibleView();
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
                var addrs = getActiveAddresses();
                for (var i = 0; i < addrs.length; ++i) {
                    //Subscribe to tranactions updates through websockets
                    msg += '{"op":"addr_sub", "addr":"'+ addrs[i] +'"}';
                }
            } catch (e) {
                alert(e);
            }

            ws.send(msg);
        };

        ws.onclose = function() {
            $('#status').html('DISCONNECTED.');
        };
    } catch (e) {
        console.log('Exception ' + e);
    }
}

function makeNotice(type, id, msg, timeout) {

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
function base58ToBase58(x) { return decryptPK(x); }
function base58ToBase64(x) { var bytes = decodePK(x); return Crypto.util.bytesToBase64(bytes); }
function base58ToHex(x) { var bytes = decodePK(x); return Crypto.util.bytesToHex(bytes); }
function base58ToSipa(x, addr) {
    var bytes = decodePK(x); // zero pad if private key is less than 32 bytes (thanks Casascius)

    var eckey = new Bitcoin.ECKey(bytes);

    while (bytes.length < 32) bytes.unshift(0x00);

    bytes.unshift(0x80); // prepend 0x80 byte

    if (eckey.getBitcoinAddressCompressed().toString() == addr)
        bytes.push(0x01);    // append 0x01 byte for compressed format

    var checksum = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });
    bytes = bytes.concat(checksum.slice(0, 4));

    var privWif = Base58.encode(bytes);

    return privWif;
}

function makeWalletJSON(format) {

    var encode_func = noConvert;

    if (format == 'base64')
        encode_func = base58ToBase64;
    else if (format == 'hex')
        encode_func = base58ToHex;
    else if (format == 'sipa')
        encode_func = base58ToSipa;
    else if (format == 'base58')
        encode_func = base58ToBase58;

    var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';

    if (double_encryption && dpasswordhash != null && encode_func == noConvert) {
        out += '	"double_encryption" : '+double_encryption+',\n	"dpasswordhash" : "'+dpasswordhash+'",\n';
    }

    out += '	"keys" : [\n';

    var atLeastOne = false;
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

    out += '\n}';

    //Write the address book

    return out;
}

function deleteAddressBook(addr) {
    delete address_book[addr];

    backupWallet();

    buildVisibleView();
}


function buildSendTxView() {
    $('#send-coins').find('.tab-pane.active').trigger('show', true);
}

function buildSendForm(el, reset) {

    function buildSelect(select) {
        var old_val = select.val();

        select.empty();

        for (var key in addresses) {
            var addr = addresses[key];

            //Don't include archived addresses
            if (addr.tag == 2)
                continue;

            var label = addr.label;

            if (label == null)
                label = addr.addr;

            if (addr.balance > 0) {
                //On the sent transactions page add the address to the from address options
                select.prepend('<option value="'+addr.addr+'">' + label + ' - ' + formatBTC(addr.balance) + ' BTC </option>');
            }
        }

        select.prepend('<option value="any">Any Address</option>');

        if (!reset)
            select.val(old_val);
    }

    buildSelect(el.find('select[name="from"]'));

    buildSelect(el.find('select[name="change"]'));

    el.find('select[name="change"]').prepend('<option value="new">New Address</option>');

    if (reset) {
        el.find('input').val('');
        el.find('.send-value-usd').html('$0');
    }

    var recipient_container = el.find(".recipient-container");

    if (reset) {
        var first_child = recipient_container.find(".recipient:first-child").clone();

        recipient_container.empty().append(first_child);
    }

    recipient_container.find(".recipient").find('input[name="send-to-address"]').typeahead({
        source : getAllLabels()
    });

    recipient_container.find(".recipient").find('input[name="send-value"]').unbind().keyup(function() {
        $(this).parent().find('.send-value-usd').html(formatSymbol($(this).val() *  100000000, symbol_local));
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
        var el = recipient_container.find(".recipient:first-child").clone();

        el.appendTo(recipient_container);

        el.find('input[name="send-to-address"]').val('').typeahead({
            source : getAllLabels()
        });

        el.find('.send-value-usd').html('$0');
        el.find('input[name="send-value"]').val('').keyup(function() {
            $(this).parent().find('.send-value-usd').html(formatSymbol($(this).val() *  100000000, symbol_local));
        });

        $(this).parent().find('.remove-recipient').show(200);
    });

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

function parseMultiBit(str) {
    //Any better way to auto detect?
    //Multibit Wallets start with a comment #
    try {

        var addedOne = false;
        var lines = str.split('\n');

        for (var i = 0; i < lines.length; ++i) {
            var line = lines[i];

            if (line == null || line.length == 0 | line.charAt(0) == '#')
                continue;

            var components = line.split(' ');

            var sipa = components[0];

            if (sipa == null)
                continue;

            if (walletIsFull())
                continue;

            var format = detectPrivateKeyFormat(sipa);

            var key = privateKeyStringToKey(sipa, format);

            if (format == 'compsipa')
                internalAddKey(key.getBitcoinAddressCompressed().toString(), encodePK(key.priv));
            else
                internalAddKey(key.getBitcoinAddress().toString(), encodePK(key.priv));

            addedOne = true;
        }

        if (addedOne) {
            //Perform a wallet backup
            backupWallet('update', function() {
                queryAPIMultiAddress();
            });

            return true;
        }

    } catch (e) {
        makeNotice('error', 'misc-error', e);
    }

    return false;
}

function importJSON() {

    var json = $('#import-json').val();

    if (json == null || json.length == 0) {
        throw 'No import data provided!';
    }

    //Any better way to auto detect?
    //Multibit Wallets start with a comment #
    if (json.charAt(0) == '#') {
        if (parseMultiBit(json)) {
            return true;
        }
    }

    var obj = null;

    try {
        //First try a simple decode
        obj = $.parseJSON(json);

        if (obj == null)
            throw 'null json';
    } catch(e) {
        //Maybe it's encrypted?
        decrypt(json, password, function(decrypted) {
            try {
                obj = $.parseJSON(decrypted);

                return (obj != null);
            } catch (e) {
                return false;
            }
        });
    }

    if (obj == null) {
        throw 'Could not decode import data';
    }

    if (obj == null || obj.keys == null || obj.keys.length == 0) {
        throw 'No keys imported. Incorrect format?';
    }

    getSecondPassword(function() {
        try {
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
            $('#import-json').val('');

            //Perform a wallet backup
            backupWallet('update', function() {
                queryAPIMultiAddress();
            });
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    });
}

function getAllAddresses() {
    var array = [];
    for (var key in addresses) {
        array.push(key);
    }
    return array;
}

//Find the prefferred addres to use for change
//Order deposit / request coins
function getPreferredAddress() {
    var preferred = null;
    for (var key in addresses) {
        var addr = addresses[key];

        if (preferred == null)
            preferred = addr.addr;

        if (addr.priv != null) {
            if (preferred == null)
                preferred = addr.addr;

            if (addr.tag == null || addr.tag == 0) {
                preferred = addr.addr;
                break;
            }
        }
    }
    return preferred;
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

function getActiveAddresses() {
    return getAddressesWithTag();
}

function getArchivedAddresses() {
    return getAddressesWithTag(2);
}

function setLatestBlock(block) {

    /*
     $('#latest-block').show();

     $('#latest-block-height').html(block.height);

     var date = new Date(block.time * 1000);

     $('#latest-block-time').html(dateToString(date));
     */

    latest_block = block;
}

Transaction.prototype.getCompactHTML = function(myAddresses, addresses_book) {

    var result = this.result;

    var html = '<tr><td style="width:16px" class="hidden-phone"><a target="new" href="'+root+'tx-index/'+this.txIndex+'/'+this.hash+'"><img src="'+resource+'info.png" /></a></td><td class="hidden-phone"><ul style="margin-left:0px;" class="short-addr">';

    if (result > 0) {
        if (this.inputs.length > 0) {
            for (var i = 0; i < this.inputs.length; i++) {
                input = this.inputs[i];

                if (input.prev_out == null || input.prev_out.addr == null) {
                    html += '<li>No Input (Newly Generated Coins)</li>';
                } else {

                    //Don't Show sent from
                    if (myAddresses[input.prev_out.addr] != null) continue;

                    html += formatOutput(input.prev_out, myAddresses, addresses_book);
                }
            }
        } else {
            html += '<li>No inputs, transaction probably sent from this.</li>';
        }
    } else if (result < 0) {
        for (var i = 0; i < this.out.length; i++) {

            //Don't Show sent to self
            if (this.out.length > 1 && this.out[i].type == 0 && myAddresses[this.out[i].addr] != null) continue;

            html += formatOutput(this.out[i], myAddresses, addresses_book);
        }
    } else {
        html += '<span class="label">Moved Between Wallet</info>';
    }

    html += '</ul></td><td>';

    if (this.time > 0) {
        html += dateToString(new Date(this.time * 1000));
    }

    if (this.confirmations == 0) {
        html += ' <span class="label label-important pull-right hidden-phone" onclick="showInventoryModal(\''+this.hash+'\')">Unconfirmed Transaction!</span> ';
    } else if (this.confirmations > 0) {
        html += ' <span class="label label-info pull-right hidden-phone">' + this.confirmations + ' Confirmations</span> ';
    }

    html += '</td>';

    if (result > 0)
        html += '<td style="color:green">' + formatMoney(result, true) + '</td>';
    else if (result < 0)
        html += '<td style="color:red">' + formatMoney(result, true) + '</td>';
    else
        html += '<td>' + formatMoney(result, true) + '</td>';

    if (this.balance == null)
        html += '<td></td>';
    else
        html += '<td class="hidden-phone">' + formatMoney(this.balance) + '</td>';

    html += '</tr>';

    return html;
};


function buildVisibleView() {
    //Only build when visible
    var id = cVisible.attr('id');
    if ("send-coins" == id)
        buildSendTxView();
    else if ("home-intro" == id)
        buildHomeIntroView();
    else if ("receive-coins" == id)
        buildReceiveCoinsView()
    else if ("my-transactions" == id)
        buildTransactionsView();

    //Update the account balance
    if (final_balance == null) {
        $('#balance').html('Loading...');
    } else {
        $('#balance').html(formatSymbol(final_balance, symbol));
        $('#balance2').html(formatSymbol(final_balance, (symbol == symbol_local) ? symbol_btc : symbol_local));
    }
}


function buildHomeIntroView() {
    $('#summary-n-tx').html(n_tx);

    $('#summary-received').html(formatMoney(total_received, true));

    $('#summary-sent').html(formatMoney(total_sent, true));

    $('#summary-balance').html(formatMoney(final_balance, symbol));


}

function buildTransactionsView() {

    var tx_display = $('#tx_display').val();

    if (transactions.length == 0) {
        $('#transactions-header').hide();
        return;
    } else {
        $('#transactions-header').show();
    }

    var interval = null;
    var start = 0;

    if (interval != null) {
        clearInterval(interval);
        interval = null;
    }

    var txcontainer = $('#transactions').empty();

    if (tx_display == 1) {
        var table = $('<table class="table table-striped table-condensed"><tr><th style="width:16px" class="hidden-phone"></th><th class="hidden-phone">To / From</th><th>Date</th><th>Amount</th><th class="hidden-phone">Balance</th></tr></table>');

        txcontainer.append(table);
        txcontainer = table;
    }

    var buildSome = function() {
        var html = '';

        for (var i = start; i < transactions.length && i < (start+5); ++i) {

            var tx = transactions[i];

            if (tx.blockHeight != null && tx.blockHeight > 0 && latest_block != null) {
                var confirmations = latest_block.height - tx.blockHeight + 1;
                if (confirmations <= 100) {
                    tx.setConfirmations(latest_block.height - tx.blockHeight + 1);
                }
            } else {
                tx.setConfirmations(0);
            }

            if (tx_display == 1) {
                html += tx.getCompactHTML(addresses, address_book);
            } else {
                html += tx.getHTML(addresses, address_book);
            }
        }

        txcontainer.append(html);

        start += 5;

        if (start < transactions.length) {
            interval = setTimeout(buildSome, 1);
        }
    };


    buildSome();

    var container = $('.pagination ul').empty();

    if (tx_page == 0 && transactions.length < 50) {
        container.hide();
        return;
    } else {
        container.show();
    }

    var pages = Math.ceil(n_tx_filtered / 50);

    var disabled = ' disabled';
    if (tx_page > 0)
        disabled = '';

    container.append('<li onclick="setPage(tx_page-1)" class="prev'+disabled+'"><a>&larr; Previous</a></li>');

    for (var i = 0; i < pages && i <= 15; ++i) {
        var active = '';
        if (tx_page == i)
            active = ' class="active"';

        container.append('<li onclick="setPage('+i+')"'+active+'><a class="hidden-phone">'+i+'</a></li>');
    }

    var disabled = ' disabled';
    if (tx_page < pages)
        disabled = '';

    container.append('<li onclick="setPage(tx_page+1)" class="next'+disabled+'"><a>Next &rarr;</a></li>');
}

function setFilter(i) {
    tx_page = 0;
    tx_filter = i;

    queryAPIMultiAddress();
}

function setPage(i) {
    tx_page = i;

    scroll(0,0);
    queryAPIMultiAddress();
}

function parseMultiAddressJSON(json) {
    var obj = $.parseJSON(json);

    $('#nodes-connected').html(obj.info.nconnected);

    if (obj.info.latest_block != null)
        setLatestBlock(obj.info.latest_block);

    var new_symbol_local = obj.info.symbol_local;

    if (symbol == symbol_local) {
        symbol_local = new_symbol_local;
        symbol = new_symbol_local;
        calcMoney();
    } else {
        symbol_local = new_symbol_local;
    }

    transactions = [];

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
        transactions.push(tx);
    }
}

//Get the list of transactions from the http API, after that it will update through websocket
function queryAPIMultiAddress() {
    if (!isInitialized || offline) return;

    setLoadingText('Loading transactions');

    $.ajax({
        type: "POST",
        url: root +'multiaddr?filter='+tx_filter+'&offset='+tx_page*50,
        data: {'active' : getActiveAddresses().join('|'), 'archived' : getArchivedAddresses().join('|') },
        converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": $.parseXML},
        success: function(data) {

            if (data.error != null) {
                makeNotice('error', 'misc-error', data.error);
            }

            try {
                parseMultiAddressJSON(data);

                //Rebuild the my-addresses list with the new updated balances (Only if visible)
                buildVisibleView();

                try {
                    //Cache results to show next login
                    if (tx_page == 0 && tx_filter == 0)
                        localStorage.setItem('multiaddr', data);
                } catch (e) {

                }

            } catch (e) {
                console.log(data);

                makeNotice('error', 'misc-error', e);
            }
        },

        error : function(data) {

            console.log(data);

            makeNotice('error', 'misc-error', data.responseText);
        }
    });
}


//Extract a set of key = value from the #hash window tag e.g. /wallet#key|value
function extractKVFromHash() {

    //Check if we have any addresses to add
    var hash = decodeURI(window.location.hash.replace("#", ""));
    var map = [];

    if (hash != null && hash.length > 0) {
        var components = hash.split("|");
        for (var i = 0; i < components.length; i += 2) {
            var key = components[i];
            var value = components[i+1];
            map[key] = value;
        }
    }

    return map;
}

function showClaimModal(key) {

    var modal = $('#claim-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.modal-body').show();

    modal.find('#claim-balance').empty();

    var address = key.getBitcoinAddress().toString();

    loadScript(resource + 'wallet/qr.code.creator.js', function() {
        var claim_qr = makeQRCode(300, 300, 1 , address);

        $('#claim-qr-code').empty().append(claim_qr);
    });

    apiGetBalance([address], function(data) {
        modal.find('#claim-balance').text('Amount: ' + formatBTC(data) + ' BTC');
    }, function() {
        modal.find('#claim-balance').text('Error Fetching Balance');
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        window.location = root + 'wallet/new' + window.location.hash;
    });

    modal.find('.btn.btn-success').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {

        $('#claim-manual').show(200);

        $('#claim-manual-send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                var to_address = $('#claim-manual-address').val();
                try {
                    new Bitcoin.Address(to_address);
                } catch (e) {
                    makeNotice('error', 'misc-error', 'Invalid Bitcoin Address');
                    return;
                }

                var from_address = privateKeyToSweep.getBitcoinAddress().toString();

                internalAddKey(to_address);

                var obj = initNewTx();

                obj.from_addresses = [from_address];
                obj.extra_private_keys[from_address] = Base58.encode(privateKeyToSweep.priv);

                obj.start();

                modal.modal('hide');
            });
        });

        $(this).hide();
    });
}

function didDecryptWallet() {

    //Add and address form #newaddr K=V tag
    if (addressToAdd != null) {

        if (walletIsFull())
            return;

        console.log('Add Watch Only');

        if (internalAddKey(addressToAdd)) {
            makeNotice('success', 'added-addr', 'Added Watch Only Address ' + addressToAdd);

            backupWalletDelayed();
        } else {
            makeNotice('error', 'error-addr', 'Error Adding Bitcoin Address ' + addressToAdd);
        }
    }

    if (privateKeyToSweep != null) {
        loadScript(resource + 'wallet/signer.min.js', function() {

            var address = privateKeyToSweep.getBitcoinAddress().toString();

            var obj = initNewTx();

            obj.from_addresses = [address];
            obj.extra_private_keys[address] = Base58.encode(privateKeyToSweep.priv);

            obj.start();
        });
    }

    try {
        //Make sure the last guid the user logged in the ame as this one, if not clear cache
        var local_guid = localStorage.getItem('guid');

        if (local_guid != guid) {
            localStorage.clear();
        }

        //Restore the balance cache
        var multiaddrjson = localStorage.getItem('multiaddr');

        if (multiaddrjson != null) {
            parseMultiAddressJSON(multiaddrjson);

            buildVisibleView();
        }

        localStorage.setItem('guid', guid);

    } catch (e) { } //Don't care - cache is optional

    ///Get the list of transactions from the http API
    queryAPIMultiAddress();

    changeView($("#home-intro"));

    buildVisibleView();

    $('#initial_error').remove();
    $('#initial_success').remove();

    makeNotice('success', 'misc-success', 'Sucessfully Decrypted Wallet');
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

    $.get(root + 'wallet/wallet.aes.json?guid='+guid+'&sharedKey='+sharedKey+'&checksum='+payload_checksum).success(function(data) {
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

            buildVisibleView();
        }

    });
}

function internalRestoreWallet() {
    try {
        if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
            makeNotice('error', 'misc-error', 'No Wallet Data To Decrypt');
            return false;
        }

        var obj = null;
        decrypt(encrypted_wallet_data, password, function(decrypted) {
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

        if (obj.double_encryption != null && obj.dpasswordhash != null) {
            double_encryption = obj.double_encryption;
            dpasswordhash = obj.dpasswordhash;
        }

        addresses = [];
        for (var i = 0; i < obj.keys.length; ++i) {

            var key = obj.keys[i];
            if (key.addr == null || key.addr.length == 0 || key.addr == 'undefined') {
                makeNotice('error', 'null-error', 'Your wallet contains an undefined address. This is a sign of possible curruption, please double check all your BTC is acounted for. Backup your wallet to remove this error.', 15000);
                continue;
            }

            addresses[key.addr] = key;
        }

        address_book = [];
        if (obj.address_book != null) {
            for (var i = 0; i < obj.address_book.length; ++i) {
                internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
            }
        }

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
        makeNotice('error', 'misc-error', e);
    }

    return false;
}

function getSecondPassword(success, error) {

    if (!double_encryption || dpassword != null) {
        if (success) {
            try { success(); } catch (e) { makeNotice('error', 'misc-error', e);  }
        }

        return;
    }

    var modal = $('#second-password-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    var input = modal.find('input[name="password"]');

    input.val('');

    modal.find('.btn.btn-primary').unbind().click(function() {

        var password = input.val();

        if (vaidateDPassword(password)) {
            if (success) {
                try { success(); } catch (e) { makeNotice('error', 'misc-error', e); }
            }
        } else {
            makeNotice('error', 'misc-error', 'Password incorrect.');
            if (error) {
                try { error(); } catch (e) { makeNotice('error', 'misc-error', e); }
            }
        }

        modal.modal('hide');
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        makeNotice('error', 'misc-error', 'User cancelled, password needed to continue.');
        modal.modal('hide');

        if (error) {
            try { error(); } catch (e) { makeNotice('error', 'misc-error', e); }
        }
    });
}

function showPrivateKeyModal(success, error, addr) {

    var modal = $('#private-key-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(addr);

    var key = null;
    var error_msg = null;

    //WebCam
    loadScript(resource + 'wallet/llqrcode.js', function() {
        loadScript(resource + 'wallet/qr.code.reader.js', function() {
            //Flash QR Code Reader
            var interval = initQRCodeReader('qr-code-reader', function(code){
                try {
                    key = privateKeyStringToKey(code, detectPrivateKeyFormat(code));

                    if (key == null) {
                        throw 'Error decoding private key';
                    }

                    clearInterval(interval);

                } catch(e) {
                    error_msg = 'Error decoding private key ' + e;
                }

                modal.modal('hide');

            }, resource + 'wallet/');

            modal.on('hidden', function () {
                clearInterval(interval);
            });
        });
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        var value = modal.find('input[name="key"]').val();

        try {
            if (value.length == 0) {
                throw  'You must enter a private key to import';
            }

            key = privateKeyStringToKey(value, detectPrivateKeyFormat(value));

            if (key == null) {
                throw 'Could not decode private key';
            }
        } catch(e) {
            error_msg = 'Error importing private key ' + e;
        }

        modal.modal('hide');
    });

    modal.on('hide', function() {
        if (key)
            success(key);
        else
            error(error_msg);
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}

function restoreWallet() {

    guid = $("#restore-guid").val();

    if (guid == null || guid.length != 36) {
        makeNotice('error', 'misc-error', 'Invalid wallet identifier');
        return false;
    } else {
        hideNotice('guid-error');
    }

    password = $("#restore-password").val();

    if (password.length == 0 || password.length < 8 || password.length > 255) {
        makeNotice('error', 'misc-error', 'Password length must at least 10 characters');
        return false;
    } else {
        hideNotice('password-error');
    }

    var toffline = $('#restore-offline').is(':checked');

    if (toffline) {
        try {
            if (localStorage == null) {
                makeNotice('error', 'misc-error', 'Your browser does not support local stoage. Cannot login in offline mode.');
                return false;
            } else if (localStorage.getItem('multiaddr') != null) {
                makeNotice('error', 'misc-error', 'Local storage not empty. Have you enabled private browsing?.');
                return false;
            }
        } catch (e) {
            console.log(e);
        }
    }

    //If we don't have any wallet data then we must have two factor authenitcation enabled
    if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {

        setLoadingText('Validating authentication key');

        var auth_key = $('#restore-auth-key').val();

        if (auth_key == null || auth_key.length == 0 || auth_key.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter a Yubikey or Email confirmation code');
            return false;
        }

        $.post("/wallet", { guid: guid, payload: auth_key, length : auth_key.length,  method : 'get-wallet' },  function(data) {

            encrypted_wallet_data = data;

            if (internalRestoreWallet()) {
                if (toffline)
                    getReadyForOffline();
                else
                    didDecryptWallet();
            } else {
                if (toffline)
                    $('#offline-mode-modal').modal('hide');

                $("#restore-wallet-continue").removeAttr('disabled');
            }

        })
            .error(function(data) {
                $("#restore-wallet-continue").removeAttr('disabled');

                makeNotice('error', 'misc-error', data.responseText);
            });
    } else {

        if (internalRestoreWallet()) {

            if (toffline)
                getReadyForOffline();
            else
                didDecryptWallet();
        } else {
            if (toffline)
                $('#offline-mode-modal').modal('hide');

            $("#restore-wallet-continue").removeAttr('disabled');
        }
    }


    return true;
}

function setIsIntialized() {
    isInitialized = true;

    websocketConnect();

    $('#tech-faq').hide();

    $('#intro-text').hide();

    $('#large-summary').show();

    $('#status-container').show();
}

function validateEmail(str) {
    var lastAtPos = str.lastIndexOf('@');
    var lastDotPos = str.lastIndexOf('.');
    return (lastAtPos < lastDotPos && lastAtPos > 0 && str.indexOf('@@') == -1 && lastDotPos > 2 && (str.length - lastDotPos) > 2);
}

//Get email address, secret phrase, yubikey etc.
function getAccountInfo() {

    if (!isInitialized || offline) return;

    setLoadingText('Getting Wallet Info');

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info' },  function(data) {

        if (data.email != null) {
            $('#wallet-email').val(data.email);
            $('.my-email').text(data.email);
        }

        $('#wallet-phrase').val(data.phrase);

        $('#two-factor-select').val(data.auth_type);
        $('.two-factor').hide();
        $('.two-factor.t'+data.auth_type).show(200);

        $('#notifications-type').val(data.notifications_type);
        $('.notifications-type').hide(200);
        $('.notifications-type.t'+data.notifications_type).show(200);

        $('#notifications-confirmations').val(data.notifications_confirmations);
        $('#notifications-on').val(data.notifications_on);

        if (data.alias != null && data.alias.length > 0) {
            $('#wallet-alias').val(data.alias);
            $('.alias').text('https://blockchain.info/wallet/'+data.alias);
            $('.alias').show(200);
        }

        loadScript(resource + 'wallet/qr.code.creator.js', function() {
            var device_qr = makeQRCode(300, 300, 1 , guid + '|' + sharedKey + '|' + password);

            $('#device-qr-code').empty().append(device_qr);

            if (data.google_secret_url != null && data.google_secret_url.length > 0) {

                var qr = makeQRCode(300, 300, 1 , data.google_secret_url);

                $('#wallet-google-qr').empty().append(qr);
            }
        });

        if (data.auto_email_backup == 1)
            $('#auto-email-backup').prop("checked", true);
        else
            $('#auto-email-backup').prop("checked", false);

        $('#wallet-http-url').val(data.http_url);

        $('#wallet-http-url').val(data.http_url);
        $('#wallet-skype').val(data.skype_username);
        $('#wallet-yubikey').val(data.yubikey);

        if (data.email_verified == 0) {
            $('#verify-email').show();
            $('#email-verified').hide();
        } else {

            $('#verify-email').hide();
            $('#email-verified').show();
        }

    })
        .error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}

function emailBackup() {
    if (!isInitialized || offline) return;

    setLoadingText('Sending email backup');

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'email-backup' },  function(data) {
        makeNotice('success', 'backup-success', data);
    })
        .error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}

function verifyEmail(code) {
    if (!isInitialized || offline) return;

    if (code == null || code.length == 0 || code.length > 255) {
        makeNotice('error', 'misc-error', 'You must enter a code to verify');
        return;
    }

    code = $.trim(code);

    setLoadingText('Verifying Email');

    $.post("/wallet", { guid: guid, payload: code, sharedKey: sharedKey, length : code.length, method : 'verify-email' },  function(data) {
        makeNotice('success', 'email-success', data);

        $('#verify-email').hide();
        $('#email-verified').show(200);
    })
        .error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
            $('#verify-email').show(200);
            $('#email-verified').hide();
        });
}

function updateKV(txt, method, value, success, error) {
    if (!isInitialized || offline) return;

    if (value == null || value.length == 0) {
        makeNotice('error', 'misc-error', txt + ': Invalid value');
        return;
    }

    if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36) {
        makeNotice('error', 'misc-error', 'Shared key is invalid');
        return;
    }

    value = $.trim(value);

    setLoadingText(txt);

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, length : (value+'').length, payload : value+'', method : method },  function(data) {
        makeNotice('success', method + '-success', data);

        if (success) success();
    })
        .error(function(data) {
            makeNotice('error', method + '-error', data.responseText);

            if (error) error();
        });
}

//Changed padding to CBC iso10126 9th March 2012 & iterations to pbkdf2_iterations
function encrypt(data, password) {
    return Crypto.AES.encrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : pbkdf2_iterations });
}

//When the ecryption format changes it can produce data which appears to decrypt fine but actually didn't
//So we call success(data) and if it returns true the data was formatted correctly
function decrypt(data, password, success, error) {

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

    //OBC iso7816 padding with one iteration
    try {
        //Othwise try the old default settings
        var decoded = Crypto.AES.decrypt(data, password, {iterations : 1});

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

function updateCacheManifest() {
    try {
        console.log('Clear Cache Manifest');

        window.applicationCache.update();
    } catch (e) {
        console.log(e);
    }
}

//Can call multiple times in a row and it will backup only once after a certain delay of activity
function backupWalletDelayed(method, success, error, extra) {
    if (archTimer != null) {
        clearInterval(archTimer);
        archTimer = null;
    }

    archTimer = setTimeout(function (){
        backupWallet(method, success, error, extra);
    }, 3000);
}

//Save the javascript walle to the remote server
function backupWallet(method, successcallback, errorcallback, extra) {
    if (offline) return;

    try {
        if (method == null) method = 'update';

        if (!isInitialized && method != 'insert')
            return false;

        if (guid.length != 36) {
            throw 'Invalid wallet identifier';
        }

        var data = makeWalletJSON();

        //Everything looks ok, Encrypt the JSON output
        var crypted = encrypt(data, password);

        if (crypted.length == 0) {
            throw 'Error enrypting the JSON output';
        }

        //Now Decrypt the it again to double check for any possible curruption
        var obj = null;
        decrypt(crypted, password, function(decrypted) {
            try {
                obj = $.parseJSON(decrypted);
                return (obj != null);
            } catch (e) {
                return false;
            };
        });

        if (obj == null) {
            makeNotice('error', 'misc-error', 'Error Decrypting Wallet, Not saving. This is a serious error..');
            return false;
        }

        //SHA256 checksum verified by server in case of curruption during transit
        var checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));

        setLoadingText('Saving wallet');

        if (extra == null)
            extra = '';

        encrypted_wallet_data = crypted;

        $.ajax({
            type: "POST",
            url: root + 'wallet' + extra,
            data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, checksum: checksum, method : method },
            converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
            success: function(data) {

                var change = false;
                for (var key in addresses) {
                    var addr = addresses[key];
                    if (addr.tag == 1) {
                        addr.tag = null; //Make any unsaved addresses as saved
                        change = true;
                    }

                    //Update view remove 'Unsynced' tags
                    if (change)
                        buildVisibleView();
                }

                payload_checksum = checksum;

                makeNotice('success', 'misc-success', data);

                if (successcallback != null)
                    successcallback();

                updateCacheManifest();
            },

            error : function(data) {
                makeNotice('error', 'misc-error', data.responseText, 10000);

                if (errorcallback != null)
                    errorcallback();
            }
        });
    } catch (e) {
        makeNotice('error', 'misc-error', e, 10000);
        throw e;
    }
}


function encryptPK(base58) {
    if (double_encryption) {
        if (dpassword == null)
            throw 'Cannot encrypt private key without a password';

        return encrypt(base58, sharedKey + dpassword);
    } else {
        return base58;
    }

    return null;
}

function encodePK(priv) {
    var base58 = Base58.encode(priv);
    return encryptPK(base58);
}

function isBase58(str) {
    for (var i = 0; i < str.length; ++i) {
        if (str[i] < 0 || str[i] > 58) {
            return false;
        }
    }
    return true;
}

function decryptPK(priv) {
    if (double_encryption) {
        if (dpassword == null)
            throw 'Cannot decrypt private key without a password';

        return decrypt(priv, sharedKey + dpassword, isBase58);
    } else {
        return priv;
    }

    return null;
}

function decodePK(priv) {
    var decrypted = decryptPK(priv);
    if (decrypted != null) {
        return Base58.decode(decrypted);
    }
    return null;
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

function setDoubleEncryptionButton() {
    if (double_encryption) {
        $('#double-encryption-off').hide();
        $('#double-encryption-on').show();
    } else {
        $('#double-encryption-on').hide();
        $('#double-encryption-off').show();
    }

    $('#double-password').val('');
    $('#double-password2').val('');
}

function setDoubleEncryption(value) {

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
                makeNotice('error', 'misc-error', 'Password must be 4 characters or more in length');
                return;
            }

            if (tpassword != tpassword2) {
                makeNotice('error', 'misc-error', 'Passwords do not match.');
                return;
            }

            if (tpassword == password) {
                makeNotice('error', 'misc-error', 'Second password should not be the same as your main password.');
                return;
            }

            //Ask the use again before we backup
            getSecondPassword(function() {
                try {
                    double_encryption = true;
                    dpassword = tpassword;

                    for (var key in addresses) {
                        var addr = addresses[key];

                        if (addr.priv != null) {
                            addr.priv = encodePK(Base58.decode(addr.priv));
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

                    getSecondPassword(function() {
                        try {
                            checkAllKeys();

                            backupWallet('update', function() {
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
            getSecondPassword(function() {
                try {
                    for (var key in addresses) {

                        var addr = addresses[key];

                        if (addr.priv != null) {
                            addr.priv = decryptPK(addr.priv);
                        }
                    }

                    double_encryption = false;

                    dpassword = null;

                    checkAllKeys();

                    backupWallet('update', function() {
                        setDoubleEncryptionButton();
                    }, function() {
                        panic(e);
                    });
                } catch (e) {
                    panic(e);
                }
            }, function() {
                panic();
            });
        }
    } catch (e) {
        panic(e);
    }
}

//Check the integreity of all keys in the wallet
function checkAllKeys(reencrypt) {
    for (var key in addresses) {
        var addr = addresses[key];

        if (addr.addr == null)
            throw 'Null Address Found in wallet ' + key;

        //Will throw an exception if the checksum does not validate
        if (addr.addr.toString() == null)
            throw 'Error decoding wallet address ' + addr.addr;

        if (addr.priv != null) {
            var decryptedpk = decodePK(addr.priv);

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

    makeNotice('success', 'wallet-success', 'Wallet verified.');
}


function checkAndSetPassword() {
    var tpassword = $("#password").val();
    var tpassword2 = $("#password2").val();

    if (tpassword != tpassword2) {
        makeNotice('error', 'misc-error', 'Passwords do not match.');
        return false;
    }

    if (tpassword.length == 0 || tpassword.length < 10 || tpassword.length > 255) {
        makeNotice('error', 'misc-error', 'Password must be 10 characters or more in length');
        return false;
    }

    password = tpassword;

    return true;
}

function updatePassword() {
    if (!isInitialized || offline) return;

    var modal = $('#update-password-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');

        var oldPassword = password;

        if (!checkAndSetPassword()) {
            return false;
        }

        try {
            backupWallet('update', function() {
                window.location = root + 'wallet/' + guid + window.location.hash;
            }, function() {
                makeNotice('error', 'misc-error', 'Error syncing wallet. Password Not changed');
                password = oldPassword;
            });

        } catch (e) {
            makeNotice('error', 'misc-error', 'Error syncing wallet. Password Not changed');
            password = oldPassword;
        }
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}

function changeView(id) {

    if (id === cVisible)
        return;

    if (cVisible != null) {
        if ($('#' + cVisible.attr('id') + '-btn').length > 0)
            $('#' + cVisible.attr('id') + '-btn').parent().attr('class', '');

        cVisible.hide(200);
    }

    cVisible = id;

    cVisible.show(200);

    if ($('#' + cVisible.attr('id') + '-btn').length > 0)
        $('#' + cVisible.attr('id') + '-btn').parent().attr('class', 'active');

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

function internalDeleteAddress(addr) {
    delete addresses[addr];
}

function internalAddAddressBookEntry(addr, label) {
    address_book[addr] = label;
}

function walletIsFull(addr) {

    if (nKeys(addresses) >= maxAddr) {
        makeNotice('error', 'misc-error', 'We currently support a maximum of '+maxAddr+' private keys, please remove some unsused ones.');
        return true;
    }

    return false;
}

//Address (String), priv (base58 String), compresses boolean
function internalAddKey(addr, priv) {
    var existing = addresses[addr];
    if (existing == null || existing.length == 0) {
        addresses[addr] = {addr : addr, priv : priv, balance : 0};
        return true;
    } else if (existing.priv == null && priv != null) {
        existing.priv = priv;
        return true;
    }
    return false;
}


function showInventoryModal(hash) {
    var modal = $('#inv-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    setLoadingText('Getting Inventory Data');

    $('#inv-data').hide();

    $.get(root + 'inv/'+hash+'?format=json').success(function(data) {

        $('#inv-data').show(200);

        $('#initial_ip').html('<a href="'+root+'ip-address/'+data.initial_ip+'">'+data.initial_ip+'</a>');

        $('#initial_time').html(dateToString(new Date(parseInt(data.initial_time))));

        $('#last_seen').html(dateToString(new Date(parseInt(data.last_time))));

        $('#inv_n_connected').html(data.nconnected);

        $('#total_relayed').html(data.relayed_count);

        $('#p_network').html(data.relayed_percent);

        var container = $('#inv_mining_nodes');

        container.empty();

        var tmp_map = [];

        for (var i = 0; i < data.mining_nodes.length; ++i) {
            var node = data.mining_nodes[i];

            if (tmp_map[node.name] == null) {
                tmp_map[node.name] = true;
                container.append('<li><a href="'+node.link+'">'+node.name+'</a></li>');
            }
        }

        if (data.mining_nodes == 0) {
            container.append('<li>No mining nodes have receivied this transaction. It is unlikely to be included in any blocks and will be clear in approximatly 24 hours.</li>');
        }

    }).error(function(data) {
            modal.modal('hide');
            makeNotice('error', 'misc-error', data.responseText);
        });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}

function labelAddress(addr) {
    var modal = $('#label-address-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(addr);

    var label_input = modal.find('input[name="label"]');

    modal.find('.address').text(addr);

    label_input.val('');

    //Added address book button
    modal.find('.btn.btn-primary').unbind().click(function() {

        modal.modal('hide');

        var label = label_input.val();

        if (label.length == 0) {
            makeNotice('error', 'misc-error', 'you must enter a label for the address');
            return false;
        }

        addresses[addr].label = label;

        backupWalletDelayed();

        buildVisibleView();
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}


function addAddressBookEntry() {
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

        var label = labelField.val();

        var bitcoinAddress = addrField.val();

        if (label.length == 0) {
            makeNotice('error', 'misc-error', 'you must enter a label for the address book entry');
            return false;
        }

        if (bitcoinAddress.length == 0) {
            makeNotice('error', 'misc-error', 'you must enter a bitcoin address for the address book entry');
            return false;
        }

        var addr;

        try {
            addr = new Bitcoin.Address($.trim(bitcoinAddress));

            if (addr == null)
                throw 'Null address';

        } catch (e) {
            makeNotice('error', 'misc-error', 'Bitcoin address invalid, please make sure you entered it correctly');
            return false;
        }

        if (address_book[bitcoinAddress] != null) {
            makeNotice('error', 'misc-error', 'Bitcoin address already exists');
            return false;
        }

        makeNotice('success', 'misc-success', 'Added Address book entry');

        internalAddAddressBookEntry(bitcoinAddress, label);

        backupWalletDelayed();

        buildSendForm($('#send-coins'), true);

        buildVisibleView();
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
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

    modal.find('.modal-body').show();
    $('#change-mind').hide();

    modal.find('#to-delete-address').html(addrs.join(' '));

    modal.find('#delete-balance').empty();

    var dbalance = modal.find('#delete-balance');

    apiGetBalance(addrs, function(data) {

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

    changeMind = function() {
        $('#change-mind').show();
        $('#change-mind-time').text(5 - i);
    };

    modal.find('.btn.btn-primary').unbind().click(function() {

        changeMind();

        modal.find('.btn.btn-primary').hide();
        modal.find('.btn.btn-danger').hide();

        interval = setInterval(function() {

            if (isCancelled)
                return;

            console.log('Change mind');

            playSound('beep');

            ++i;

            changeMind();

            if (i == 5) {
                //Really delete address
                $('#delete-address-modal').modal('hide');

                makeNotice('warning', 'warning-deleted', 'Private Key Removed From Wallet');

                for (var ii in addrs) {
                    internalDeletePrivateKey(addrs[ii]);
                }

                //Update view with remove address
                buildVisibleView();

                backupWallet();

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

            playSound('beep');

            ++i;

            changeMind();

            if (i == 5) {

                try {

                    //Really delete address
                    $('#delete-address-modal').modal('hide');

                    makeNotice('warning', 'warning-deleted', 'Address & Private Key Removed From Wallet');

                    for (var ii in addrs) {
                        internalDeleteAddress(addrs[ii]);
                    }

                    buildVisibleView();

                    backupWallet('update', function() {
                        queryAPIMultiAddress();
                    });

                } finally {
                    clearInterval(interval);
                }
            }

        }, 1000);
    });

    modal.on('hidden', function () {
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

function resolveLabel(label) {
    label = $.trim(label.toLowerCase());

    for (var key in address_book) {
        var a_label = address_book[key];
        if (a_label.toLowerCase() == label) {
            return key;
        }
    }
    for (var key in addresses) {
        var a_label = addresses[key].label;
        if (a_label && a_label.toLowerCase() == label)
            return key;
    }
    return null;
}

function getAllLabels() {
    var labels = [];
    for (var key in address_book) {
        labels.push(address_book[key]);
    }
    for (var key in addresses) {
        if (addresses[key].label)
            labels.push(addresses[key].label);
    }
    return labels;
}

function formatAddresses(m, faddresses, resolve_labels) {
    var str = '';
    if (faddresses.length == 1) {
        var addr_string = faddresses[0].toString();

        if (resolve_labels && addresses[addr_string] != null && addresses[addr_string].label != null)
            str = addresses[addr_string].label;
        else if (resolve_labels && address_book[addr_string] != null)
            str = address_book[addr_string];
        else
            str = addr_string;

    } else {
        str = 'Escrow (<i>';
        for (var i = 0; i < faddresses.length; ++i) {
            str += faddresses[i].toString() + ', ';
        }

        str = str.substring(0, str.length-2);

        str += '</i> - ' + m + ' Required)';
    }
    return str;
}

function apiGetRejectionReason(hexhash, success, error) {
    $.get(root + 'q/rejected/'+hexhash).success(function(data) {

        if (data == null || data.length == 0)
            error();
        else
            success(data);

    }).error(function(data) {
            if (error) error();
        });
}

function apiGetPubKey(addr, success, error) {
    setLoadingText('Getting Pub Key');

    $.get(root + 'q/pubkeyaddr/'+addr).success(function(data) {

        if (data == null || data.length == 0)
            error();
        else
            success(Crypto.util.hexToBytes(data));

    }).error(function(data) {
            error();
        });
}

//Get the balances of multi addresses (Used for archived)
function apiGetBalances(_addresses, success, error) {
    setLoadingText('Getting Balances');

    $.post("/multiaddr", {'active' : _addresses.join('|'), 'simple' : true, 'format' : 'json' },  function(obj) {
        for (var key in obj) {
            addresses[key].balance = obj[key].final_balance;
        }

        success();
    }).error(function(data) {
            error(data.responseText);
        });
}

//Get the balance of an array of addresses
function apiGetBalance(addresses, success, error) {
    setLoadingText('Getting Balance');

    $.get(root + 'q/addressbalance/'+addresses.join('|')).success(function(data) {
        success(data);
    }).error(function(data) {
            error(data.responseText);
        });
}

function apiResolveFirstbits(addr, success, error) {

    setLoadingText('Getting Firstbits');

    $.get(root + 'q/resolvefirstbits/'+addr).success(function(data) {

        if (data == null || data.length == 0)
            error();
        else
            success(data);

    }).error(function(data) {
            error();
        });
}


function sweepAddresses(addresses) {
    getSecondPassword(function() {
        loadScript(resource + 'wallet/signer.min.js', function() {
            var obj = initNewTx();

            obj.from_addresses = addresses;

            obj.start();
        });
    });
}

function bind() {
    try {
        $(".pop").popover({
            offset: 10,
            placement : 'bottom'
        });
    } catch(e) {}


    $('#download-backup-btn').click(function() {
        window.open(root + 'wallet/wallet.aes.json?guid=' + guid + '&sharedKey=' + sharedKey);
    });

    //Virtual On-Screen Keyboard
    var $write = $('#second-password'),
        shift = false,
        capslock = false;

    $('#keyboard li').click(function(){
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

    $('#logout').click(function () {
        window.location.reload();
    });

    $('#enable_archived_checkbox').change(function() {
        var enabled = $(this).is(':checked');

        $('.archived_checkbox').attr('checked', false);

        $('.archived_checkbox').attr('disabled', !enabled);

        $('#archived-sweep').attr('disabled', !enabled);

        $('#archived-delete').attr('disabled', !enabled);
    });


    $('#active-addresses').on('show', function() {
        var table = $(this).find('tbody');

        table.empty();

        for (var key in addresses) {
            var addr = addresses[key];

            //Hide Archived
            if (addr.tag == 2)
                continue;

            var noPrivateKey = '';

            if (addr.tag == 1) {
                noPrivateKey = ' <font color="red" class="extrapop" title="Not Synced" data-content="This is a new address which has not yet been synced with our the server. Do not used this address yet.">(Not Synced)</font>';
            } else if (addr.priv == null) {
                noPrivateKey = ' <font color="red" class="extrapop" title="Watch Only" data-content="Watch Only means there is no private key associated with this bitcoin address. <br /><br /> Unless you have the private key stored elsewhere you do not own this address and can only observe it.">(Watch Only)</font>';
            }

            var balance = formatBTC(addr.balance) + ' <span class="hidden-phone">BTC</span>';

            var extra = '';
            var label = addr.addr;
            if (addr.label != null) {
                label = addr.label;
                extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
            }

            var thtml = '<tr><td style="width:20px;"><img id="qr'+addr.addr+'" onclick="showAddressModal(\'' + addr.addr +'\')" src="'+resource+'info.png" /></td><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span id="'+addr.addr+'" style="color:green">' + balance +'</span></td><td style="width:16px"><img src="'+resource+'archive.png" onclick="archiveAddr(\''+addr.addr+'\')" /></td></tr>';

            table.append(thtml);
        }
    });

    $('#archived-addresses').on('show', function() {
        $('#enable_archived_checkbox').attr('checked', false);
        $('#archived-delete').attr('disabled', true);
        $('#archived-sweep').attr('disabled', true);
        $('#archived-addr tbody').empty();

        var table = $(this).find('tbody');

        var archived = getArchivedAddresses();

        var build = function() {
            table.empty();

            for (var key in archived) {
                var addr = addresses[archived[key]];

                if (addr.tag != 2)
                    continue;

                var extra = '';
                var label = addr.addr;
                if (addr.label != null) {
                    label = addr.label;
                    extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
                }

                var thtml = '<tr><td style="width:20px;"><input type="checkbox" class="archived_checkbox" value="'+addr.addr+'" disabled></td><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + '<div></td>';

                thtml += '<td>';

                if (addr.balance != null)  {
                    var balance = formatBTC(addr.balance) + ' <span class="hidden-phone">BTC</span>';

                    thtml += '<span id="'+addr.addr+'" style="color:green">' + balance +'</span>';
                }

                thtml += '</td><td style="width:16px"><img src="'+resource+'unarchive.png" onclick="unArchiveAddr(\''+addr.addr+'\')" /></td></tr>';

                table.append(thtml);
            }
        }

        build();

        apiGetBalances(archived, function() {
            build();
        });
    });

    $('#archived-sweep').click(function() {

        var toSweep = [];

        $('.archived_checkbox:checked').each(function() {
            var addr = addresses[$(this).val()];

            if (addr.priv == null) {
                makeNotice('error', 'misc-error', 'Cannot Sweep Watch Only Address');
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

    $('#local_currency').click(function() {
        SetCookie('currency', $(this).val());

        queryAPIMultiAddress();
    });

    $('body').click(function() {
        rng_seed_time();
    });


    $('body').keypress(function() {
        rng_seed_time();
    });
    $('#deposit-cash').click(function() {
        window.open('https://www.bitinstant.com');
    });

    $('#deposit-sms').click(function() {
        loadScript(resource + 'wallet/deposit/deposit.js', function() {
            showDepositModal(getPreferredAddress(), 'sms', 'Deposit Using Phone/SMS');
        });
    });

    $('#deposit-sms2').click(function() {
        $('#deposit-sms').trigger('click');
    });

    $('#payment-request').click(function() {
        loadScript(resource + 'wallet/payment-request.js', function() {
            showPaymentRequestModal(getPreferredAddress(), 'Payment Request');
        });
    });

    $('#deposit-bank').click(function() {
        loadScript(resource + 'wallet/deposit/deposit.js', function() {
            showDepositModal(getPreferredAddress(), 'direct', 'Deposit Using Bank Transfer / Credit Card');
        });
    });

    $('#show-import-export').click(function () {
        $('#export-warning').hide();
        $('#import-export-content').show(200);
    });

    $('#run-key-check').click(function() {

        getSecondPassword(function() {
            try {
                checkAllKeys(true);

                backupWallet();
            } catch (e) {
                makeNotice('error', 'misc-error', e);
            }
        });
    });

    $('#restore-password').keypress(function(e) {
        if(e.keyCode == 13) { //Pressed the return key
            $('#restore-wallet-continue').click();
        }
    });

    $('#summary-n-tx-chart').click(function() {
        window.open(root + 'charts/n-transactions?show_header=false&address='+getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
    });

    $('#summary-received-chart').click(function() {
        window.open(root + 'charts/received-per-day?show_header=false&address='+getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
    });

    $('#summary-balance-chart').click(function() {
        window.open(root + 'charts/balance?show_header=false&address='+getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
    });

    $('#notifications-type').change(function() {
        var val = parseInt($(this).val());

        updateKV('Updating Notifications Type', 'update-notifications-type', val);

        $('.notifications-type').hide(200);
        $('.notifications-type.t'+val).show(200);

        //Backup the wallet to syn the pub keys
        backupWallet();
    });

    $('#notifications-on').change(function() {
        updateKV('Updating Notifications Settings', 'update-notifications-on', $(this).val());
    });

    $('#notifications-on').change(function() {
        updateKV('Updating Notifications Settings', 'update-notifications-on', $(this).val());
    });

    $('#auto-email-backup').change(function() {
        updateKV('Updating Auto Backup Settings', 'update-auto-email-backup', $(this).is(':checked'));
    });

    $('#two-factor-select').change(function() {
        var val = parseInt($(this).val());

        updateKV('Updating Two Factor Authentication', 'update-auth-type', val, function() {
            //For Google Authenticator we need to refetch the account info to fetch the QR Code
            if (val == 4) {
                getAccountInfo();
            }

            //Refresh the cache manifest to clear the wallet data
            updateCacheManifest();
        });

        $('.two-factor').hide(200);
        $('.two-factor.t'+val).show(200);
    });

    $("#new-addr").click(function() {
        try {
            getSecondPassword(function() {
                var address = generateNewAddressAndKey();

                labelAddress(address.toString());

                buildVisibleView();

                backupWallet();
            });
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    });

    $('#wallet-email-send').click(function() {
        $('#wallet-email').trigger('change');
    });

    $('#wallet-email').change(function(e) {

        var email = $(this).val();

        if (!validateEmail(email)) {
            makeNotice('error', 'misc-error', 'Email address is not valid');
            return;
        }

        updateKV('Updating Email', 'update-email', email);

        $('#verify-email').show(200);
        $('#email-verified').hide();
    });

    $('#wallet-double-encryption-enable').click(function(e) {
        setDoubleEncryption(true);
    });

    $('#wallet-double-encryption-disable').click(function(e) {
        setDoubleEncryption(false);
    });

    $('#wallet-email-code').change(function(e) {
        verifyEmail($(this).val());
    });

    $('#wallet-yubikey').change(function(e) {
        updateKV('Updating Yubikey', 'update-yubikey', $(this).val());
    });

    $('#wallet-skype').change(function(e) {
        updateKV('Updating Skype Username', 'update-skype', $(this).val());
    });

    $('#wallet-http-url').change(function(e) {
        updateKV('Updating HTTP url', 'update-http-url', $(this).val());
    });

    $('#wallet-phrase').change(function(e) {

        var phrase = $(this).val();

        if (phrase == null || phrase.length == 0 || phrase.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter a secret phrase');
            return;
        }

        updateKV('Updating Secret Phrase', 'update-phrase', phrase);
    });

    $('#wallet-alias').change(function(e) {
        $(this).val($(this).val().replace(/[\.,\/ #!$%\^&\*;:{}=`~()]/g,""));

        if ($(this).val().length > 0) {
            $('.alias').fadeIn(200);
            $('.alias').text('https://blockchain.info/wallet/'+$(this).val());
        }

        updateKV('Updating Alias', 'update-alias', $(this).val());
    });

    $('#filter').change(function(){
        setFilter($(this).val());
    });

    $('#tx_display').change(function(){
        SetCookie("tx_display", $(this).val());

        buildVisibleView();
    });

    $('#update-password-btn').click(function() {
        updatePassword();
    });

    $('#email-backup-btn').click(function() {
        emailBackup();
    });

    $('#dropbox-backup-btn').click(function() {
        window.open(root + 'wallet/dropbox-login?guid=' + guid + '&sharedKey=' + sharedKey);
    });

    $('#gdrive-backup-btn').click(function() {
        window.open(root + 'wallet/gdrive-login?guid=' + guid + '&sharedKey=' + sharedKey);
    });

    $('#wallet-login').unbind().click(function() {

        try {
            //Make sure the last guid the user logged in the ame as this one, if not clear cache
            var tguid = localStorage.getItem('guid');
            if (tguid != null) {
                window.location = root + 'wallet/' + tguid + window.location.hash;
                return;
            }
        } catch (e) {
            console.log(e);
        }

        window.location = root + 'wallet/' + 'login';
    });

    $("#restore-wallet-continue").click(function(e) {
        e.preventDefault();

        var tguid = $('#restore-guid').val();

        if (guid != tguid && tguid != null) {
            window.location = root + 'wallet/' + tguid + window.location.hash;;
            return;
        }

        $(this).attr("disabled", true);

        if (!restoreWallet()) {
            $(this).attr("disabled", false);
        }

    });

    $("#import-export-btn").click(function() {
        if (!isInitialized)
            return;

        $("#import-json-btn").unbind().click(function() {
            if (!isInitialized)
                return;

            $(this).attr("disabled", true);

            try {
                importJSON();
            } catch (e) {
                makeNotice('error', 'misc-error', e);
            }

            $(this).attr("disabled", false);
        });


        $('#import-address-btn').unbind().click(function() {
            var value = $.trim($('#import-address-address').val());

            if (value.length = 0) {
                makeNotice('error', 'misc-error', 'You must enter an address to import');
                return;
            }

            if (walletIsFull())
                return;

            try {
                var address = new Bitcoin.Address(value);

                if (address.toString() != value) {
                    makeNotice('error', 'misc-error', 'Inconsistency between addresses');
                    return;
                }

                if (internalAddKey(value)) {
                    makeNotice('success', 'added-address', 'Sucessfully Added Address ' + address);

                    //Rebuild the list
                    buildVisibleView();

                    //Backup
                    backupWallet('update', function() {
                        queryAPIMultiAddress();
                    });
                } else {
                    makeNotice('error', 'add-error', 'Error Adding Address ' + address);
                }

            } catch (e) {
                makeNotice('error', 'misc-error', 'Error importing address: ' + e);
                return;
            }

        });

        $('#import-private-scan').unbind().click(function() {
            if (!isInitialized)
                return;

            if (walletIsFull())
                return;

            getSecondPassword(function() {
                showPrivateKeyModal(function (key) {

                    var addr = key.getBitcoinAddress().toString();

                    if (internalAddKey(addr, encodePK(key.priv))) {

                        //Rebuild the My-address list
                        buildVisibleView();

                        //Perform a wallet backup
                        backupWallet('update', function() {
                            queryAPIMultiAddress();
                        });

                        makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr);
                    } else {
                        makeNotice('error', 'misc-error', 'Unable to add private key for bitcoin address ' + addr);
                    }

                }, function(e) {
                    makeNotice('error', 'misc-error', e);
                }, 'Any Private Key');
            });
        });


        $('#import-private-btn').unbind().click(function() {
            if (!isInitialized)
                return;

            var value = $('#import-private-key').val();

            try {

                if (value.length == 0) {
                    throw 'You must enter a private key to import';
                }

                if (walletIsFull())
                    return;

                getSecondPassword(function() {
                    try {

                        var format = detectPrivateKeyFormat(value);
                        var key = privateKeyStringToKey(value, format);

                        if (format == 'compsipa') {
                            var addr = key.getBitcoinAddressCompressed().toString();

                            showCompressedPrivateKeyWarning(function() {
                                if (addr == null || addr.length == 0 || addr == 'undefined')
                                    throw 'Unable to decode bitcoin addresses from private key';

                                if (internalAddKey(addr, encodePK(key.priv))) {

                                    //Mark as unsynced
                                    addresses[addr].tag = 1;

                                    //Rebuild the My-address list
                                    buildVisibleView();

                                    //Perform a wallet backup
                                    backupWallet('update', function() {
                                        queryAPIMultiAddress();
                                    });

                                    makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr);
                                }
                            }, function() {
                                loadScript(resource + 'wallet/signer.min.js', function() {
                                    var obj = initNewTx();

                                    obj.from_addresses = [addr];
                                    obj.extra_private_keys[addr] = Base58.encode(key.priv);

                                    obj.start();
                                });
                            });

                        } else {
                            var addr = key.getBitcoinAddress().toString();

                            if (addr == null || addr.length == 0 || addr == 'undefined')
                                throw 'Unable to decode bitcoin addresses from private key';

                            if (internalAddKey(addr, encodePK(key.priv))) {

                                //Mark as unsynced
                                addresses[addr].tag = 1;

                                //Rebuild the My-address list
                                buildVisibleView();

                                //Perform a wallet backup
                                backupWallet('update', function() {
                                    queryAPIMultiAddress();
                                });

                                makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr);
                            } else {
                                throw 'Unable to add private key for bitcoin address ' + addr;
                            }
                        }


                    } catch (e) {
                        makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
                    }
                });

            } catch(e) {
                makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }

            form.find('input[name="key"]').val('');
        });


        changeView($("#import-export"));
    });


    $('#add-address-book-entry-btn').click(function() {
        addAddressBookEntry();
    });

    $("#my-account-btn").click(function() {
        if (!isInitialized)
            return;

        setDoubleEncryptionButton();

        getAccountInfo();

        changeView($("#my-account"));
    });

    $('#large-summary').click(function() {
        toggleSymbol();

        buildVisibleView();
    });

    $("#home-intro-btn").click(function() {
        if (!isInitialized)
            return;

        buildHomeIntroView();

        changeView($("#home-intro"));
    });


    $("#my-transactions-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#my-transactions"));

        buildVisibleView();
    });

    $("#send-coins-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#send-coins"));

        //Easier to rebuild each time the view appears
        buildVisibleView();
    });

    $('#send-quick').on('show', function(e, reset) {

        var self = $(this);

        buildSendForm(self, reset);

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(self, 'quick');
            });
        });
    });

    $('#send-email').on('show', function(e, reset) {
        var self = $(this);

        buildSendForm(self, reset);

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(self, 'email');
            });
        });
    });

    $('#send-qr').on('show', function() {
        //WebCam
        loadScript(resource + 'wallet/llqrcode.js', function() {
            loadScript(resource + 'wallet/qr.code.reader.js', function() {
                //Flash QR Code Reader
                var interval = initQRCodeReader('send-qr-reader', function(code){

                    clearInterval(interval);

                    console.log(code);

                }, resource + 'wallet/');
            });
        });
    });

    $('#send-custom').on('show',  function(e, reset) {
        var self = $(this);

        buildSendForm(self, reset);

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(self, 'custom');
            });
        });

        self.find('.reset').unbind().click(function() {
            buildSendForm(self, true);
        });
    });

    $('#send-facebook').on('show', function(e, reset) {
        var self = $(this);

        buildSendForm(self, reset);

        loadScript('https://connect.facebook.net/en_US/all.js', function() {

            // assume we are already logged in
            FB.init({
                appId: '289188934490223',
                status : true,
                xfbml: false,
                cookie: true
            });

            var did_login = false;

            var facebook_input = self.find(".recipient").find('input[name="send-to-facebook"]');

            facebook_input.attr('readonly', true);

            var fb_map = [];
            FB.getLoginStatus(function(response){
                FB.login(function(response) {
                    if (response.authResponse) {
                        did_login = true;

                        FB.api('/me/friends', function(response) {
                            if (!response || response.error) {
                                makeNotice('error', 'add-error', 'Unknown Facebook Error');
                            } else {
                                var data = [];
                                for (var key in response.data) {
                                    data.push(response.data[key].name);
                                    fb_map[response.data[key].name] = response.data[key].id;
                                }
                                self.find(".recipient").find('input[name="send-to-facebook"]').typeahead({
                                    source : data
                                });

                                facebook_input.attr('readonly', false);
                            }
                        });
                    } else {
                        makeNotice('error', 'add-error', 'User cancelled login or did not fully authorize.');
                    }
                });
            });

            self.find('.send').unbind().click(function() {
                if (did_login) {
                    var fb_id = fb_map[facebook_input.val()];

                    facebook_input.data('fb-id', fb_id);

                    loadScript(resource + 'wallet/signer.min.js', function() {
                        startTxUI(self, 'facebook');
                    });
                }
            });
        });
    });

    $('#address-book').on('show', function() {
        var el = $('#address-book-tbl tbody');

        if (nKeys(address_book) > 0) {
            el.empty();

            for (var key in address_book) {
                el.append('<tr><td>'+ address_book[key] + '</td><td><div class="addr-book-entry">'+ key + '</div></td><td style="width:16px" class="hidden-phone"><img src="'+resource+'delete.png" onclick="deleteAddressBook(\''+key+'\')" /></td></tr>');
            }
        }
    });

    $('a[data-toggle="tab"]').on('show', function(e) {
        $(e.target.hash).trigger('show');
    });

    $('#export-crypted').on('show', function() {
        var data = makeWalletJSON();

        var crypted = encrypt(data, password);

        $("#json-crypted-export").val(crypted);
    });

    $('#export-unencrypted').on('show', function() {
        getSecondPassword(function() {
            $('#export-priv-format').val('base58');
            $("#json-unencrypted-export").val(makeWalletJSON($('#export-priv-format').val()));
        });
    });

    $('#export-paper-btn').click(function() {
        getSecondPassword(function() {
            loadScript(resource + 'wallet/qr.code.creator.js', function() {

                var popup = window.open(null, null, "width=700,height=800");

                if (popup == null) {
                    makeNotice('error', 'misc-error', 'Failed to open popup window');
                    return;
                }

                popup.document.write('<!DOCTYPE html><html><head></head><body></body></html>');

                var container = $("body", popup.document);
                container.empty();

                var table = $('<table style="page-break-after:always;"></table>');

                var ii = 1;
                for (var key in addresses) {
                    var addr = addresses[key];

                    var mode = 'Online Mode';

                    if (addr.tag == 1)
                        mode = 'Offline Mode';

                    if (addr.priv == null) {
                        continue;
                    }

                    var pk = decryptPK(addr.priv);

                    if (pk == null)
                        continue;

                    var row = $('<tr></tr>');

                    //Add Address QR code
                    var qrspan = $('<td><div style="height:225px;overflow:hidden"></div></td>');

                    var qr = makeQRCode(250, 250, 1 , pk);

                    qrspan.children(":first").append(qr);

                    row.append(qrspan);

                    var label = '';
                    if (addr.label != null)
                        label = addr.label + ' - ';

                    var body = $('<td style="padding-top:25px;"><h3>' + addr.addr + '</h3><br /><small><p><b>' + pk + '</b></p></small><br /><p>' + mode + '</p><br /><p>'+label+'Balance ' + formatBTC(addr.balance) + ' BTC</p> </td>');

                    row.append(body);

                    if (addr.balance > 0)
                        table.prepend(row);
                    else
                        table.append(row);

                    if (ii % 3 == 0) {
                        table = $('<table style="page-break-after:always;"></table>');
                        container.append(table);
                    }

                    ii++;
                }
            });
        });
    });

    $("#receive-coins-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#receive-coins"));

        buildVisibleView();
    });

    $('#export-priv-format').change(function (e) {
        $("#json-unencrypted-export").val(makeWalletJSON($('#export-priv-format').val()));
    });

    $('.modal').on('show', function() {
        $(this).center();
    })

    $('.modal').on('shown', function() {
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


function detectPrivateKeyFormat(key) {
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

function privateKeyStringToKey(value, format) {

    var key_bytes = null;

    if (format == 'base58') {
        key_bytes = Base58.decode(value);
    } else if (format == 'base64') {
        key_bytes = Crypto.util.base64ToBytes(value);
    } else if (format == 'hex') {
        key_bytes = Crypto.util.hexToBytes(value);
    } else if (format == 'mini') {
        key_bytes = parseMiniKey(value);
    } else if (format == 'sipa') {
        var tbytes = Base58.decode(value);
        tbytes.shift();
        key_bytes = tbytes.slice(0, tbytes.length - 4);
    } else if (format == 'sipa') {
        var tbytes = Base58.decode(value);
        tbytes.shift();
        key_bytes = tbytes.slice(0, tbytes.length - 4);
    } else if (format == 'compsipa') {
        var tbytes = Base58.decode(value);
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

    if (window.location.protocol == 'http:') {
        makeNotice('error', 'add-error', 'You must use https:// not http://. Please update your link', 0);
        return;
    }

    //Disable auotcomplete in firefox
    $("input").attr("autocomplete","off");

    if (!isSignup) {
        //Add an addresses from the "Add to My Wallet" link
        var map = extractKVFromHash();

        var newAddrVal = map['newaddr'];
        if (newAddrVal != null && addresses[newAddrVal] == null) {
            try {
                //Will throw format exception if invalid
                addressToAdd = new Bitcoin.Address(newAddrVal).toString();
                console.log(addressToAdd);

            } catch (e) {
                makeNotice('error', 'error-addr', 'Could not add Address ' + e);
            }
        }

        //Add a private key to sweep (from email links)
        var newPriv = map['newpriv'];
        if (newPriv != null) {
            try {
                privateKeyToSweep = privateKeyStringToKey(newPriv, detectPrivateKeyFormat(newPriv));
            } catch (e) {
                makeNotice('error', 'error-addr', 'Error Decoding Private Key');
            }
        }
    }

    setTimeout(bind, 100);

    //Load data attributes from html
    encrypted_wallet_data = $('#data-encrypted').text();
    guid = $('#data-guid').text();
    sharedKey = $('#data-sharedKey').text();
    payload_checksum =  $('#data-checksum').text();

    $('body').ajaxStart(function() {
        $('.loading-indicator').fadeIn(200);
    });

    $('body').ajaxStop(function() {
        $('.loading-indicator').fadeOut(200);
    });

    try {
        if (guid.length == 0) {
            try {
                //Make sure the last guid the user logged in the ame as this one, if not clear cache
                var tguid = localStorage.getItem('guid');

                if (tguid != null) {
                    $('#restore-guid').val(tguid);
                } else if (privateKeyToSweep) {
                    showClaimModal(privateKeyToSweep);
                }

            } catch (e) {
                console.log(e);
            }
        }
    } catch (e) { }

    cVisible = $("#restore-wallet");

    cVisible.show();

    //Watch the cache manifest for changes
    window.addEventListener('load', function(e) {
        if (window.applicationCache) {
            window.applicationCache.addEventListener('updateready', function(e) {
                if (window.applicationCache.status == window.applicationCache.UPDATEREADY) {
                    window.applicationCache.swapCache();
                }
            }, false);
        }
    }, false);
});



function showCompressedPrivateKeyWarning(success, error) {
    var modal = $('#compressed-private-key-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        success();
        modal.modal('hide');
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        error();
        modal.modal('hide');
    });
}


function showAddressModal(data) {
    var modal = $('#qr-code-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    var body = modal.find('.modal-body');

    loadScript(resource + 'wallet/qr.code.creator.js', function() {
        var canvas = makeQRCode(300,300,1, data);

        $('#qr-data').empty().append(canvas);
    });

    body.find('.code').text(data);

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');
        labelAddress(data);
    });
}

function internalArchive(addr) {
    buildVisibleView();

    backupWalletDelayed('update', function() {
        queryAPIMultiAddress();
    });
}

function unArchiveAddr(addr) {
    var addr = addresses[addr];
    if (addr.tag == 2) {
        addr.tag = null;

        internalArchive();
    } else {
        makeNotice('error', 'add-error', 'Cannot unarchive this address');
    }
}

function archiveAddr(addr) {
    if (getActiveAddresses().length <= 1) {
        makeNotice('error', 'add-error', 'You must leave at least one active address');
        return;
    }

    var addr = addresses[addr];
    if (addr.tag == null || addr.tag == 0) {
        addr.tag = 2;
        internalArchive();

    } else {
        makeNotice('error', 'add-error', 'Cannot archive this address');
    }
}

function buildReceiveCoinsView() {
    $('#receive-coins').find('.tab-pane.active').trigger('show');

    $('.extrapop') .popover({
        offset: 10,
        placement : 'bottom'
    });

    setupToggle();
}

function generateNewAddressAndKey() {
    if (walletIsFull())
        return false;

    var key = new Bitcoin.ECKey(false);

    if (key == null ) {
        throw 'Unable to generate a new bitcoin address.';
    }

    var addr = key.getBitcoinAddress();

    if (addr == null) {
        throw 'Generated invalid bitcoin address.';
    }

    if (internalAddKey(addr, encodePK(key.priv))) {

        addresses[addr].tag = 1; //Mark as unsynced

        makeNotice('info', 'new-address', 'Generated new bitcoin address ' + addr);

        //Subscribe to tranaction updates through websockets
        try {
            ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');
        } catch (e) { }
    } else {
        throw 'Unable to add generated bitcoin address.';
    }

    return addr;
}