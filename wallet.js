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
var address_book = {}; //Holds the address book addr = label
var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
var double_encryption = false; //If wallet has a second password
var tx_page = 0; //Multi-address page
var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)
var maxAddr = 1000; //Maximum number of addresses
var nconnected; //Number of nodes blockchain.info is connected to
var addresses = []; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
var offline = false; //If on offline or online mode
var payload_checksum = null; //SHA256 hash of the current wallet.aes.json
var addressToAdd = null; //a watch only address to add from #newaddr hash value (String)
var privateKeyToSweep = null; //a private key to sweep from #newpriv hash value (ECKey)
var isSignup = false; //Set when on new account signup page
var archTimer; //Delayed Backup wallet timer
var mixer_fee = 1.5; //Default mixer fee 1.5%
var fee_policy = 0; //Default Fee policy (-1 Tight, 0 Normal, 1 High)
var pbkdf2_iterations = 10; //Not ideal, but limitations of using javascript
var html5_notifications = false;
var tx_notes = {}

function hidePopovers() {
    try {
        $('.pop').popover('hide');
    } catch (e) {}
}

$(window).resize(function() {
    $('.modal:visible').center();

    hidePopovers();
});

function setLoadingText(txt) {
    $('.loading-text').text(txt);
}

function hideNotice(id) {
    $('#'+id).remove();
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
                    updateCacheManifest();

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

                /* Calculate the result */
                var result = 0;
                var at_least_one_active = false;

                for (var i = 0; i < tx.inputs.length; ++i) {
                    var output = tx.inputs[i].prev_out;

                    //If it is our address then subtract the value
                    var addr = addresses[output.addr];
                    if (addr) {
                        var value = parseInt(output.value);

                        if (addr.tag != 2) {
                            result -= value;
                            total_sent += value;
                            at_least_one_active = true;
                        }

                        addr.balance -= value;
                    }
                }

                for (var ii = 0; ii < tx.out.length; ++ii) {
                    var output = tx.out[ii];

                    var addr = addresses[output.addr];
                    if (addr) {
                        var value = parseInt(output.value);

                        if (addr.tag != 2) {
                            result += value;
                            total_received += value;
                            at_least_one_active = true;
                        }

                        addr.balance += value;
                    }
                }

                if (!at_least_one_active) return;

                if (html5_notifications) {
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

                            $(getCompactHTML(tx, addresses, address_book)).prependTo(txcontainer.find('tbody')).find('div').hide().slideDown('slow');

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
            var addrs = getActiveAddresses();
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
    var bytes = decodePK(x);

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

    if (fee_policy != 0) {
        out += '	"fee_policy" : '+fee_policy+',\n';
    }

    if (html5_notifications) {
        out += '	"html5_notifications" : '+html5_notifications+',\n';
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

    if (nKeys(tx_notes) > 0) {
        out += ',\n	"tx_notes" : ' + JSON.stringify(tx_notes)
    }

    out += '\n}';

    //Write the address book

    return out;
}

function deleteAddressBook(addr) {
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
    loadScript(resource + 'wallet/frame-modal.js', function() {
        showFrameModal({
            title : 'Transaction Summary',
            description : '',
            src : root + 'tx-summary/'+txIndex+'?result='+result+'&guid='+guid
        });
    });
}

function deleteNote(tx_hash) {
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

            if (tx_notes[tx_hash])
                title += ' <span style="float:right"><img src="'+resource+'delete.png" onclick="deleteNote(\''+tx_hash+'\')" /></span>';

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

        tip.mouseleave(function() {
            el.__timeout = setTimeout(function() {
                el.popover('hide');
            }, 250);
        });
    })(el, content, tx_hash);
}


function getCompactHTML(tx, myAddresses, addresses_book) {
    var result = tx.result;

    var html = '<tr class="pointer" onclick=\'openTransactionSummaryModal('+tx.txIndex+', '+tx.result+')\'><td class="hidden-phone" style="width:365px"><div><ul style="margin-left:0px;" class="short-addr">';

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
        html += '<img src="'+resource+'note.png" class="pop" onclick="return false;" onmouseover="showNotePopover(this, \''+ note +'\', \''+tx.hash+'\')"> ';
    } else {
        html += '<img src="'+resource+'note_grey.png" class="pop"  onclick="return false;"  onmouseover="addNotePopover(this, \''+tx.hash+'\')"> ';
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
function buildVisibleViewPre(reset) {
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
        buildTransactionsView(reset);
}

function buildHomeIntroView(reset) {
    $('#summary-n-tx').html(n_tx);

    $('#summary-received').html(formatMoney(total_received, true));

    $('#summary-sent').html(formatMoney(total_sent, true));

    $('#summary-balance').html(formatMoney(final_balance, symbol));

    var preferred = getPreferredAddress();

    $('#tweet-for-btc').unbind().click(function() {
        window.open('https://twitter.com/share?url=https://blockchain.info/wallet&hashtags=tweet4btc,bitcoin,'+preferred.addr+'&text=Sign Up For a Free Bitcoin Wallet @ Blockchain.info', "", "toolbar=0, status=0, width=650, height=360");
    });

    if (preferred.priv == null) {
        $('.no-watch-only').hide();
    } else {
        $('.no-watch-only').show();

        var primary_address = $('#my-primary-address');
        if (primary_address.text() != preferred.addr) {
            primary_address.text(preferred.addr);

            $('#my-primary-addres-qr-code').html('<img style="padding-right:10px;padding-bottom:10px" src="'+root+'qr?data='+preferred.addr+'&size=125">');
        }
    }
}

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
                txcontainer.append(getCompactHTML(tx, addresses, address_book));
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

            pagination.append('<li onclick="setPage(tx_page-1)" class="prev'+disabled+'"><a>&larr; Previous</a></li>');

            for (var i = 0; i < pages && i <= 10; ++i) {
                var active = '';
                if (tx_page == i)
                    active = ' class="active"';

                pagination.append('<li onclick="setPage('+i+')"'+active+'><a class="hidden-phone">'+i+'</a></li>');
            }

            var disabled = ' disabled';
            if (tx_page < pages)
                disabled = '';

            pagination.append('<li onclick="setPage(tx_page+1)" class="next'+disabled+'"><a>Next &rarr;</a></li>');
        }
    };

    buildSome();
}

function setFilter(i) {
    tx_page = 0;
    tx_filter = i;

    BlockchainAPI.get_history();
}

function setPage(i) {
    tx_page = i;

    scroll(0,0);

    BlockchainAPI.get_history();
}

function parseMultiAddressJSON(json, cached) {
    var obj = $.parseJSON(json);

    if (!cached) {
        mixer_fee = obj.mixer_fee;
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
        transactions.push(TransactionFromJSON(obj.txs[i]));
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

var BlockchainAPI = {
    //Get the list of transactions from the http API, after that it will update through websocket
    get_history: function(success, error) {
        if (!isInitialized || offline) return;

        setLoadingText('Loading transactions');

        $.ajax({
            type: "POST",
            url: root +'multiaddr?format=json&filter='+tx_filter+'&offset='+tx_page*50,
            data: {'active' : getActiveAddresses().join('|'), 'archived' : getArchivedAddresses().join('|') },
            converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": $.parseXML},
            success: function(data) {

                if (data.error != null) {
                    makeNotice('error', 'misc-error', data.error);
                }

                try {
                    parseMultiAddressJSON(data, false);

                    //Rebuild the my-addresses list with the new updated balances (Only if visible)
                    buildVisibleView();

                    try {
                        //Cache results to show next login
                        if (tx_page == 0 && tx_filter == 0)
                            localStorage.setItem('multiaddr', data);
                    } catch (e) {

                    }

                    if (success) success();

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
    },
    //Get the balances of multi addresses (Used for archived)
    get_balances : function(_addresses, success, error) {
        setLoadingText('Getting Balances');

        $.post("/multiaddr", {active : _addresses.join('|'), simple : true, format : 'json' },  function(obj) {
            success(obj);
        }).error(function(data) {
                error(data.responseText);
            });
    },
    //Get the balance of an array of addresses
    get_balance : function(addresses, success, error) {
        setLoadingText('Getting Balance');

        this.get_balances(addresses, function(obj){
            var balance = 0;
            for (var key in obj) {
                balance += obj[key].final_balance;
            }

            success(balance);
        }, error);
    },
    get_ticker : function() {
        setLoadingText('Getting Ticker Data');

        $.get(root + 'ticker?format=json').success(function(data) {
            var container = $('#send-ticker ul').empty();

            container.append('<li class="nav-header">Exchange Rates</li>');

            for (var code in data) {
                container.append('<li><div style="width:35px;padding-left:10px;font-weight:bold;display:inline-block">'+code+'</div>  <i class="icon-user" style="background-image:url('+ resource + ((data[code]['15m'] >= data[code]['24h']) ? 'up_green.png' : 'down_red.png') + ');width:14px;background-position:0px"></i>' + data[code]['15m'] +'</li>');
            }

            container.append('<li style="font-size:10px;padding-left:10px;">Delayed By Up To 15 minutes</li>')
        }).error(function(e) {
                console.log(e);
            });
    }
}

function showClaimModal(key) {

    var modal = $('#claim-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.balance').text('Loading...');

    var address = key.getBitcoinAddress().toString();

    loadScript(resource + 'wallet/qr.code.creator.js', function() {
        var claim_qr = makeQRCode(300, 300, 1 , address);

        $('#claim-qr-code').empty().append(claim_qr);
    });

    BlockchainAPI.get_balance([address], function(data) {

        if (data == 0) {
            modal.find('.spent').show(200);
        } else {
            modal.find('.spent').hide(200);
        }

        modal.find('.balance').text('Amount: ' + formatBTC(data) + ' BTC');
    }, function() {
        modal.find('.balance').text('Error Fetching Balance');
    });

    modal.find('.create').unbind().click(function() {
        window.location = root + 'wallet/new' + window.location.hash;
    });

    modal.find('.login').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.forward').unbind().click(function() {

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

                modal.modal('hide');

                var obj = initNewTx();

                obj.from_addresses = [from_address];
                obj.extra_private_keys[from_address] = B58.encode(privateKeyToSweep.priv);

                obj.start();
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

        showWatchOnlyWarning(addressToAdd, function() {
            if (internalAddKey(addressToAdd)) {
                makeNotice('success', 'added-addr', 'Added Watch Only Address ' + addressToAdd);

                backupWalletDelayed();
            } else {
                makeNotice('error', 'error-addr', 'Error Adding Bitcoin Address');
            }
        });
    }

    if (privateKeyToSweep != null) {
        loadScript(resource + 'wallet/signer.min.js', function() {

            var address = privateKeyToSweep.getBitcoinAddress().toString();

            var obj = initNewTx();

            obj.from_addresses = [address];
            obj.extra_private_keys[address] = B58.encode(privateKeyToSweep.priv);

            obj.start();
        });
    }

    //We have dealt the the hash values, don't need them anymore
    window.location.hash = '';

    try {
        //Make sure the last guid the user logged in the ame as this one, if not clear cache
        var local_guid = localStorage.getItem('guid');

        if (local_guid != guid) {
            localStorage.clear();

            //Demo Account Guid
            if (guid != 'abcaa314-6f67-6705-b384-5d47fbe9d7cc')
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
    BlockchainAPI.get_history();

    changeView($("#home-intro"));

    $('#initial_error').remove();
    $('#initial_success').remove();
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

            BlockchainAPI.get_history();

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

        if (obj.double_encryption && obj.dpasswordhash) {
            double_encryption = obj.double_encryption;
            dpasswordhash = obj.dpasswordhash;
        }

        if (obj.fee_policy) {
            fee_policy = obj.fee_policy;
        }

        if (obj.html5_notifications) {
            html5_notifications = obj.html5_notifications;
        }

        addresses = [];
        for (var i = 0; i < obj.keys.length; ++i) {

            var key = obj.keys[i];
            if (key.addr == null || key.addr.length == 0 || key.addr == 'undefined') {
                makeNotice('error', 'null-error', 'Your wallet contains an undefined address. This is a sign of possible corruption, please double check all your BTC is accounted for. Backup your wallet to remove this error.', 15000);
                continue;
            }

            addresses[key.addr] = key;
        }

        address_book = {};
        if (obj.address_book != null) {
            for (var i = 0; i < obj.address_book.length; ++i) {
                internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
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
        makeNotice('error', 'misc-error', e);
    }

    return false;
}

function getPassword(modal, success, error) {

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    //Center
    modal.center();

    var input = modal.find('input[name="password"]');

    input.unbind().keypress(function(e) {
        if(e.keyCode == 13) { //Pressed the return key
            e.preventDefault();
            modal.find('.btn.btn-primary').click();
        }
    });

    input.val('');

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');

        setTimeout(function() {
            success(input.val());
        },100);
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        makeNotice('error', 'misc-error', 'User cancelled, password needed to continue.');

        modal.modal('hide');

        if (error) {
            try { error(); } catch (e) { makeNotice('error', 'misc-error', e); }
        }
    });
}

function getSecondPassword(success, error) {

    if (!double_encryption || dpassword != null) {
        if (success) {
            try { success(); } catch (e) { makeNotice('error', 'misc-error', e);  }
        }
        return;
    }

    getPassword($('#second-password-modal'), function(_password) {
        if (vaidateDPassword(_password)) {
            if (success) {
                try { success(); } catch (e) { makeNotice('error', 'misc-error', e); }
            }
        } else {
            makeNotice('error', 'misc-error', 'Password incorrect.');
            if (error) {
                try { error(); } catch (e) { makeNotice('error', 'misc-error', e); }
            }
        }
    }, error);
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

    hideNotice('password-error');

    //If we don't have any wallet data then we must have two factor authentication enabled
    if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
        setLoadingText('Validating Authentication key');

        var auth_key = $.trim($('#restore-auth-key').val());

        if (auth_key.length == 0 || auth_key.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter a Two Factor Authentication code');
            return false;
        }

        $.post("/wallet", { guid: guid, payload: auth_key, length : auth_key.length,  method : 'get-wallet', format : 'plain' },  function(data) {
            try {
                if (data == null || data.length == 0) {
                    makeNotice('error', 'misc-error', 'Server Return Empty Wallet Data');
                    return;
                }

                encrypted_wallet_data = data;

                if (internalRestoreWallet()) {
                    didDecryptWallet();
                }
            } catch (e) {
                makeNotice('error', 'misc-error', e);
            }
        }).error(function(data) {
                makeNotice('error', 'misc-error', data.responseText);
            });
    } else {

        if (internalRestoreWallet()) {
            didDecryptWallet();
        }
    }


    return true;
}

function setIsIntialized() {
    isInitialized = true;

    webSocketConnect(wsSuccess);

    $('#tech-faq').hide();

    $('#intro-text').hide();

    $('#large-summary').show();

    $('#status-container').show();
}

function importPrivateKeyUI(value, label, success) {
    getSecondPassword(function() {
        try {
            if (!value || value.length == 0) {
                throw 'You must enter a private key to import';
            }

            if (walletIsFull())
                return;

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

                        if (label && label.length > 0)
                            addresses[addr].label = label;

                        //Perform a wallet backup
                        backupWallet('update', function() {
                            BlockchainAPI.get_history();
                        });

                        if (success) success();

                        makeNotice('success', 'added', 'Added bitcoin address ' + addr);
                    }
                }, function() {
                    //Sweep the address
                    loadScript(resource + 'wallet/signer.min.js', function() {
                        var obj = initNewTx();

                        obj.from_addresses = [addr];
                        obj.extra_private_keys[addr] = B58.encode(key.priv);

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

                    if (label && label.length > 0)
                        addresses[addr].label = label;

                    //Perform a wallet backup
                    backupWallet('update', function() {
                        BlockchainAPI.get_history();
                    });

                    if (success) success();

                    makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr);
                } else {
                    throw 'Unable to add private key for bitcoin address ' + addr;
                }
            }


        } catch (e) {
            makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
        }
    });
}

function quickSendNoUI(to, value, listener) {
    //Sweep the address
    loadScript(resource + 'wallet/signer.min.js', function() {
        getSecondPassword(function() {
            try {
                var obj = initNewTx();

                obj.from_addresses = getActiveAddresses();

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
function validateEmail(str) {
    var lastAtPos = str.lastIndexOf('@');
    var lastDotPos = str.lastIndexOf('.');
    return (lastAtPos < lastDotPos && lastAtPos > 0 && str.indexOf('@@') == -1 && lastDotPos > 2 && (str.length - lastDotPos) > 2);
}

function emailBackup() {
    if (!isInitialized || offline) return;

    setLoadingText('Sending email backup');

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'email-backup', format : 'plain' },  function(data) {
        makeNotice('success', 'backup-success', data);
    }).error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}

function updateCacheManifest(done) {
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
        backupWallet(method, success, error, extra);
    }, 3000);
}

//Save the javascript walle to the remote server
function backupWallet(method, successcallback, errorcallback, extra) {
    try {
        if (method == null)
            method = 'update';

        if (!isInitialized && method != 'insert')
            throw 'Wallet not initialized';

        if (guid.length != 36) {
            throw 'Invalid wallet identifier';
        }

        var data = makeWalletJSON();

        //Everything looks ok, Encrypt the JSON output
        var crypted = encrypt(data, password);

        if (crypted.length == 0) {
            throw 'Error encrypting the JSON output';
        }

        //Now Decrypt the it again to double check for any possible corruption
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
            throw 'Error Decrypting Previously encrypted JSON. Not Saving Wallet.';
        }

        //SHA256 new_checksum verified by server in case of curruption during transit
        var new_checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));

        setLoadingText('Saving wallet');

        if (extra == null)
            extra = '';

        encrypted_wallet_data = crypted;

        $.ajax({
            type: "POST",
            url: root + 'wallet' + extra,
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

                makeNotice('success', 'misc-success', data);

                buildVisibleView();

                if (successcallback != null)
                    successcallback();

                updateCacheManifest();
            },
            error : function(data) {
                makeNotice('error', 'misc-error', data.responseText, 10000);

                buildVisibleView();

                if (errorcallback != null)
                    errorcallback();
            }
        });
    } catch (e) {
        makeNotice('error', 'misc-error', 'Error Saving Wallet: ' + e, 10000);

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

        return encrypt(base58, sharedKey + dpassword);
    } else {
        return base58;
    }

    return null;
}

function isBase58(str, base) {
    for (var i = 0; i < str.length; ++i) {
        if (str[i] < 0 || str[i] > 58) {
            return false;
        }
    }
    return true;
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

function encodePK(priv) {
    var base58 = B58.encode(priv);
    return encryptPK(base58);
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
        return B58.decode(decrypted);
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
    var tpassword = $.trim($("#password").val());
    var tpassword2 = $.trim($("#password2").val());

    if (tpassword != tpassword2) {
        makeNotice('error', 'misc-error', 'Passwords do not match.');
        return false;
    }

    if (tpassword.length == 0 || tpassword.length < 10 || tpassword.length > 255) {
        makeNotice('error', 'misc-error', 'Password length must be between least 10  & 255 characters');
        return false;
    }

    password = tpassword;

    return true;
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

function internalDeleteAddress(addr) {
    delete addresses[addr];
}

function internalAddAddressBookEntry(addr, label) {
    address_book[addr] = label;
}

function walletIsFull() {
    if (nKeys(addresses) >= maxAddr) {
        makeNotice('error', 'misc-error', 'We currently support a maximum of '+maxAddr+' private keys, please remove some unused ones.');
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

        var label = $.trim($('<div>' + labelField.val() + '</div>').text());

        var bitcoinAddress = $.trim(addrField.val());

        if (label.length == 0) {
            makeNotice('error', 'misc-error', 'You must enter a label for the address book entry');
            return false;
        }

        if (label.indexOf("\"") != -1) {
            makeNotice('error', 'misc-error', 'Label cannot contain double quotes');
            return false;
        }

        if (bitcoinAddress.length == 0) {
            makeNotice('error', 'misc-error', 'You must enter a bitcoin address for the address book entry');
            return false;
        }

        var addr;

        try {
            addr = new Bitcoin.Address(bitcoinAddress);

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

        $('#send-coins').find('.tab-pane').trigger('show', true);
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

            ++i;

            changeMind();

            if (i == changeMindTime) {
                try {
                    //Really delete address
                    $('#delete-address-modal').modal('hide');

                    makeNotice('warning', 'warning-deleted', 'Address & Private Key Removed From Wallet');

                    for (var ii in addrs) {
                        internalDeleteAddress(addrs[ii]);
                    }

                    buildVisibleView();

                    backupWallet('update', function() {
                        BlockchainAPI.get_history();
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
    getSecondPassword(function() {
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
            loadScript(resource + 'wallet/signer.min.js', function() {
                var obj = initNewTx();

                obj.from_addresses = addresses;
                if (sweepSelect.val() != 'any') {
                    obj.change_address = new Bitcoin.Address(sweepSelect.val());
                }

                obj.start();
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

function showAddressModal(address, func) {
    loadScript(resource + 'wallet/address_modal.min.js', function() {
        try{
            window[func](address);
        } catch (e) {
            makeNotice('error', 'misc-error', 'Unable To Load Address Modal');
        }
    });
}

function showPaymentRequest(address) {
    showFrameModal({
        title : 'Create Payment Request',
        description : 'Request Payment into address <b>'+address+'</b>',
        src : root + 'payment_request?address='+address
    });
}

function bind() {

    $('.dropdown-toggle').dropdown();

    $('#chord-diagram').click(function() {
        window.open(root + 'taint/' + getActiveAddresses().join('|'), null, "width=850,height=850");
    });

    $('#verify-message').click(function() {
        loadScript(resource + 'wallet/address_modal.min.js', function() {
            verifyMessageModal();
        });
    });

    $('#group-received').click(function() {
        loadScript(resource + 'wallet/taint_grouping.min.js', function() {
            try{
                loadTaintData();
            } catch (e) {
                makeNotice('error', 'misc-error', 'Unable To Load Taint Grouping Data');
            }
        });
    });

    buildPopovers();

    $('.download-backup-btn').click(function() {
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
        window.location = root + 'wallet/logout';
    });

    $('#refresh').click(function () {
        getWallet();

        BlockchainAPI.get_history();
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
        loadScript(resource + 'wallet/anonymous-addresses.min.js', function() {
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

            var thtml = '<tr><td><div class="short-addr"><a class="pop" title="Your Addresses" data-content="These are your personal bitcoin addresses. Share these with people and they can send you bitcoins." href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatMoney(addr.balance, true) + '</span></td>\
            <td><div class="btn-group pull-right"><a class="btn btn-mini dropdown-toggle" data-toggle="dropdown" href="#"><span class="hidden-phone">Actions </span><span class="caret"></span></a><ul class="dropdown-menu"> \
            <li><a href="#" class="pop" title="Archive Address" data-content="Click this button to hide the address from the main view. You can restore or delete later by finding it in the Archived addresses tab." onclick="archiveAddr(\''+addr.addr+'\')">Archive Address</a></li>\
            <li><a href="#" class="pop" title="Label Address" data-content="Set the label for this address." onclick="showAddressModal(\''+addr.addr+'\',\'showLabelAddressModal\')">Label Address</a></li>\
            <li><a href="#" class="pop" title="Show QR Code" data-content="Show a QR Code for this address." onclick="showAddressModal(\''+addr.addr+'\',\'showAddressModalQRCode\')">QR Code</a></li>\
            <li><a href="#" class="pop" title="Sign Message" data-content="Sign A message with this address." onclick="showAddressModal(\''+addr.addr+'\',\'showAddressModalSignMessage\')">Sign Message</a></li>\
            <li><a href="#" class="pop" title="Request Payment" data-content="Click here to create a new QR Code payment request. The QR Code can be scanned using most popular bitcoin software and mobile apps." onclick="showPaymentRequest(\''+addr.addr+'\')">Create Payment Request</a></li>\
            </ul></div></td></tr>';

            if (addr.balance > 0 && addr.priv)  {
                table.prepend(thtml);
            } else {
                table.append(thtml);
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

        var archived = getArchivedAddresses();

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

                var thtml = '<tr><td style="width:20px;"><input type="checkbox" class="archived_checkbox" value="'+addr.addr+'" disabled></td><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatBTC(addr.balance) + '<span class="hidden-phone"> BTC</span></span></td><td style="width:16px"><img src="'+resource+'unarchive.png" onclick="unArchiveAddr(\''+addr.addr+'\')" /></td></tr>';

                if (addr.balance > 0 && addr.priv)  {
                    table.prepend(thtml);
                } else {
                    table.append(thtml);
                }
            }
        }

        build();

        BlockchainAPI.get_balances(archived, function(obj) {
            for (var key in obj) {
                addresses[key].balance = obj[key].final_balance;
            }

            build();
        }, function(e) {
            makeNotice('error', 'misc-error', e);
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

    $('#anonymous-never-ask').click(function() {
        SetCookie('anonymous-never-ask', $(this).is(':checked'));
    });

    $('#export-history').click(function() {
        loadScript(resource + 'wallet/frame-modal.js', function() {
            showFrameModal({
                title : 'Export History',
                description : '',
                src : root + 'export-history?active='+getActiveAddresses().join('|')+'&archived='+getArchivedAddresses().join("|")
            });
        });
    });

    $('.deposit-btn').click(function() {
        var self = $(this);
        var address = getPreferredAddress().addr;
        loadScript(resource + 'wallet/frame-modal.js', function() {
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
        getSecondPassword(function() {
            var address = getPreferredAddress().addr;
            loadScript(resource + 'wallet/frame-modal.js', function() {
                showFrameModal({
                    title : self.data('title'),
                    description : 'Your Wallet Balance is <b>'+formatBTC(final_balance)+' BTC</b>',
                    src : root + 'withdraw?method='+self.data('type')+'&address='+address+'&balance='+final_balance+'&guid='+guid+'&sharedKey='+sharedKey
                });
            });
        });
    });

    $('#show-import-export').click(function () {
        $('#export-warning').hide();
        $('#import-export-content').show(200);
    });

    $('#show-account-settings').click(function () {
        $('#account-settings-warning').hide();
        $('#my-account-content').show(200);
    });

    $('#restore-password').keypress(function(e) {
        if(e.keyCode == 13) { //Pressed the return key
            e.preventDefault();

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

    $("#new-addr").click(function() {
        try {
            getSecondPassword(function() {
                var address = generateNewAddressAndKey();

                loadScript(resource + 'wallet/address_modal.min.js', function() {
                    showLabelAddressModal(address.toString());
                });

                backupWallet();
            });
        } catch (e) {
            makeNotice('error', 'misc-error', e);
        }
    });

    $('#filter').change(function(){
        setFilter($(this).val());
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

    $('#wallet-login').unbind().click(function() {

        try {
            //Make sure the last guid the user logged in the same as this one, if not clear cache
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

    $("#restore-wallet-continue").unbind().click(function(e) {
        e.preventDefault();

        var tguid = $('#restore-guid').val();

        if (guid != tguid && tguid != null) {
            window.location = root + 'wallet/' + tguid + window.location.hash;;
            return;
        }

        restoreWallet();
    });

    $("#import-export-btn").click(function() {
        if (!isInitialized)
            return;

        $("#import-json-btn").unbind().click(function() {
            if (!isInitialized)
                return;

            $(this).attr("disabled", true);

            loadScript(resource + 'wallet/wallet-backups.min.js', function() {
                importTextArea($('#import-json'));
            });

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
                    throw 'Inconsistency between addresses';
                }

                $('#import-address-address').val('');

                showWatchOnlyWarning(value, function() {
                    try {
                        if (internalAddKey(value)) {
                            makeNotice('success', 'added-address', 'Successfully Added Address ' + address);

                            try {
                                ws.send('{"op":"addr_sub", "addr":"'+address+'"}');
                            } catch (e) { }

                            //Backup
                            backupWallet('update', function() {
                                BlockchainAPI.get_history();
                            });
                        } else {
                            throw 'Wallet Full Or Addresses Exists'
                        }
                    } catch (e) {
                        makeNotice('error', 'misc-error', e);
                    }
                });
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
                loadScript(resource + 'wallet/signer.min.js', function() {
                    showPrivateKeyModal(function (key) {

                        var addr = key.getBitcoinAddress().toString();

                        if (internalAddKey(addr, encodePK(key.priv))) {

                            //Perform a wallet backup
                            backupWallet('update', function() {
                                BlockchainAPI.get_history();
                            });

                            makeNotice('success', 'added-address', 'Added bitcoin address ' + addr);
                        } else {
                            throw 'Unable to add private key for bitcoin address ' + addr;
                        }

                    }, function(e) {
                        makeNotice('error', 'misc-error', e);
                    }, 'Any Private Key');
                });
            });
        });

        $('#import-private-btn').unbind().click(function() {
            if (!isInitialized)
                return;

            var input = $('#import-private-key');

            try {
                importPrivateKeyUI($.trim(input.val()));
            } catch(e) {
                makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }

            input.val('');
        });

        $('#import-brain-wallet-btn').unbind().click(function() {
            if (!isInitialized)
                return;

            var input = $('#import-brain-wallet');

            var phrase = $.trim(input.val());

            // enforce a minimum passphrase length
            if (phrase.length < 15) {
                makeNotice('error', 'misc-error', 'The passphrase must be at least 15 characters long');
                return;
            }
            var bytes = Crypto.SHA256(phrase, { asBytes: true });

            try {
                importPrivateKeyUI(Bitcoin.Base58.encode(bytes), 'Brain Wallet');
            } catch(e) {
                makeNotice('error', 'misc-error', 'Error importing private key: ' + e);
            }

            input.val('');
        });

        changeView($("#import-export"));
    });


    $('#add-address-book-entry-btn').click(function() {
        addAddressBookEntry();
    });

    $("#my-account-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#my-account"));

        loadScript(resource + 'wallet/account.min.js', function() {
            $.get(root + 'wallet/account-settings-template').success(function(html) {
                $("#my-account-content").html(html);

                setDoubleEncryptionButton();

                bindAccountButtons();

                getAccountInfo();

            }).error(function() {
                makeNotice('error', 'misc-error', 'Error Downloading Account Settings Template');

                    changeView($("#home-intro"));
                });
        }, function (e) {
            makeNotice('error', 'misc-error', e);

            changeView($("#home-intro"));
        });
    });

    $('#large-summary').click(function() {
        toggleSymbol();

        buildVisibleView();
    });

    $("#home-intro-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#home-intro"));
    });


    $("#my-transactions-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#my-transactions"));
    });

    $("#send-coins-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#send-coins"));
    });

    $('#send-quick').on('show', function(e, reset) {

        var self = $(this);

        buildSendForm(self, reset);

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(self, 'quick', initNewTx());
            });
        });
    });

    $('#send-email').on('show', function(e, reset) {
        var self = $(this);

        buildSendForm(self, reset);

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
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
            loadScript(resource + 'wallet/signer.min.js', function() {
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
            loadScript(resource + 'wallet/signer.min.js', function() {
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

        loadScript(resource + 'wallet/dicegames.min.js', function() {
            try {
                buildForm($(self));
            } catch (e) {
                console.log(e);

                makeNotice('error', 'misc-error', 'Unable To Load Dice Bets');
            }
        }, function (e) {
            makeNotice('error', 'misc-error', e);
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
                makeNotice('error', 'misc-error', 'Error Downloading SMS Country Codes')
            });

        self.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                var pending_transaction = initNewTx();

                startTxUI(self, 'sms', pending_transaction);
            });
        });
    });

    $('#send-facebook').on('show', function(e, reset) {
        if (reset)
            return;

        var self = $(this);
        var loaded_contacts;

        buildSendForm(self);

        loadScript('https://connect.facebook.net/en_US/all.js', function() {

            // assume we are already logged in
            FB.init({
                appId: '289188934490223',
                status : true,
                xfbml: false,
                cookie: true
            });

            var facebook_input = self.find(".recipient").find('input[name="send-to-facebook"]');
            var send_button =  self.find('.send');

            send_button.text('Facebook Login');
            send_button.addClass("btn-primary");
            send_button.removeClass("btn-success");

            facebook_input.attr('readonly', true);

            var fb_map = [];
            function load_contacts() {
                FB.api('/me/friends', function(response) {
                    loaded_contacts = true;

                    send_button.text('Send Payment');
                    send_button.removeClass("btn-primary");
                    send_button.addClass("btn-success");

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
            };

            if (!loaded_contacts) {
                FB.getLoginStatus(function(response){
                    if (response.status === 'connected') {
                        load_contacts();
                    }
                });
            }

            loadScript(resource + 'wallet/signer.min.js', function() {
                send_button.unbind().click(function() {
                    if (!loaded_contacts) {
                        FB.login(function(response) {
                            if (response.authResponse) {
                                load_contacts();
                            } else {
                                makeNotice('error', 'add-error', 'User cancelled login or did not fully authorize.');
                            }
                        });
                    } else {
                        var fb_id = fb_map[facebook_input.val()];

                        facebook_input.data('fb-id', fb_id);

                        var pending_transaction = initNewTx();

                        pending_transaction.ask_to_send = function() {
                            var self = this;
                            try {
                                FB.ui({
                                    display : 'iframe',
                                    method: 'send',
                                    name: 'You have received bitcoins!',
                                    description: 'You have been sent ' + formatBTC(self.facebook.amount.toString()) + ' BTC. Copy the following link to claim them. ' + 'http://blockchain.info/wallet/claim#'+ decryptPK(self.facebook.addr.priv),
                                    to: self.facebook.to,
                                    link: 'http://www.weusecoins.com/',
                                    picture: 'http://blockchain.info/Resources/Bitcoin-logo.png'
                                }, function(response) {
                                    try {
                                        if (response) {
                                            self.send();
                                        } else {
                                            throw 'Facebook message was not sent.';
                                        }
                                    } catch (e) {
                                        self.error(e);
                                    }
                                });
                            } catch (e) {
                                self.error(e);
                            }
                        };

                        startTxUI(self, 'facebook', pending_transaction);
                    }
                });
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

    $('#import-backup').on('show', function() {
        var self = this;
        loadScript(resource + 'wallet/wallet-backups.min.js', function() {
            loadBackupsList($(self));
        });
    });

    $('#sync-bitcoind').on('show', function() {
        $('#rpc-step-1').hide();
        $('#rpc-step-2').hide();
        $('#rpc-body').hide();

        loadScript(resource + 'wallet/bitcoindrpc.js', function() {
            checkForExtension(function(data) {
                $('#rpc-step-2').show(200);

                syncWallet(function() {
                    $('#rpc-step-2').hide();
                    $('#rpc-body').show();
                });
            }, function(e) {
                $('#rpc-step-1').show(200);
            });

            $("#sync-bitcoind-btn").unbind().click(function() {
                syncWallet();
            });

            $("#rpc-continue-btn").unbind().click(function() {
                $('#rpc-step-2').hide();
                $('#rpc-body').show(200);
            });
        });
    });

    $('#export-paper-btn').click(function() {
        getSecondPassword(function() {
            var popup = window.open(null, null, "width=700,height=800,toolbar=1");

            loadScript(resource + 'wallet/qr.code.creator.js', function() {
                try {
                    if (popup == null) {
                        makeNotice('error', 'misc-error', 'Failed to open popup window');
                        return;
                    }

                    var addresses_array = getAllAddresses();

                    popup.document.write('<!DOCTYPE html><html><head></head><body><h1>Paper Wallet</h1></body></html>');

                    var container = $('body', popup.document);

                    var table = $('<table style="page-break-after:always;"></table>', popup.document);

                    container.append(table);

                    var ii = 0;
                    var ii_appended = 0;
                    var append = function() {
                        try {
                            var addr = addresses[addresses_array[ii]];

                            if (!addr) return;

                            ++ii;

                            if (addr.tag && addr.tag == 2) {//Skip archived
                                setTimeout(append, 10);
                                return;
                            } else if (addr.priv == null) {
                                setTimeout(append, 10);
                                return;
                            }

                            var display_pk = base58ToSipa(addr.priv, addr.addr);

                            var row = $('<tr></tr>', popup.document);

                            //Add Address QR code
                            var qrspan = $('<td><div style="height:225px;overflow:hidden"></div></td>', popup.document);

                            var qr = makeQRCode(250, 250, 1 , display_pk, popup.document);

                            qrspan.children(":first").append(qr);

                            row.append(qrspan);

                            var label = '';
                            if (addr.label != null)
                                label = addr.label + ' - ';

                            var body = $('<td><h3>' + addr.addr + '</h3><small><p><b>' + display_pk + '</b></p></small><p>'+label+'Balance ' + formatBTC(addr.balance) + ' BTC</p> </td>', popup.document);

                            row.append(body);

                            if (addr.balance > 0)
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
                            makeNotice('error', 'error-paper', e);
                        }
                    };

                    append();

                } catch (e) {
                    makeNotice('error', 'error-paper', e);
                }
            });
        });
    });

    $("#receive-coins-btn").click(function() {
        if (!isInitialized)
            return;

        changeView($("#receive-coins"));
    });

    $('#export-priv-format').change(function (e) {
        $("#json-unencrypted-export").val(makeWalletJSON($('#export-priv-format').val()));
    });

    $('.show_adv').click(function() {
        $('.modal:visible').center();
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

    if (!$.isEmptyObject({})) {
        makeNotice('error', 'error', 'Object.prototype has been extended by a browser extension. Please disable this extensions and reload the page.');
        return;
    }

    //Disable auotcomplete in firefox
    $("input, button").attr("autocomplete","off");

    try {
        if (!isSignup) {
            //Add an addresses from the "Add to My Wallet" link
            //Check if we have any addresses to add
            var hash = decodeURI(window.location.hash.replace("#", ""));
            var map = {};

            if (hash != null && hash.length > 0) {
                var components = hash.split("|");
                for (var i = 0; i < components.length; i += 2) {
                    var key = components[i];
                    var value = components[i+1];
                    if (key && value)
                        map[key] = value;
                }
            }

            if (nKeys(map) == 0 && hash.length > 0) {
                try {
                    privateKeyToSweep = privateKeyStringToKey(hash, detectPrivateKeyFormat(hash));
                } catch (e) {
                    makeNotice('error', 'error-addr', 'Error Decoding Private Key. Could not claim bitcoins.');
                }
            }

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
                    makeNotice('error', 'error-addr', 'Error Decoding Private Key. Could not claim bitcoins.');
                }
            }
        }
    } catch (e) { console.log(e); }

    var body = $('body');

    body.ajaxStart(function() {
        $('.loading-indicator').fadeIn(200);
    }).ajaxStop(function() {
            $('.loading-indicator').hide();
        }).click(function() {
            rng_seed_time();
        }).keypress(function() {
            rng_seed_time();
        });

    bind();

    //Load data attributes from html
    encrypted_wallet_data = body.data('payload');
    guid = body.data('guid');
    sharedKey = body.data('sharedkey');
    payload_checksum =  body.data('payload-checksum');

    try {
        if (guid.length == 0) {
            if (privateKeyToSweep)
                showClaimModal(privateKeyToSweep);

            try {
                //Make sure the last guid the user logged in the ame as this one, if not clear cache
                var tguid = localStorage.getItem('guid');

                if (tguid != null) {
                    $('#restore-guid').val(tguid);
                }

            } catch (e) {
                console.log(e);
            }
        }
    } catch (e) { }

    cVisible = $("#restore-wallet");

    cVisible.show();

    //Show a warnign when the Users copies a tch only address to the clipboard
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


function showWatchOnlyWarning(address, success) {
    var modal = $('#watch-only-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(address);

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        success();

        modal.modal('hide');
    });
}


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

function internalArchive(addr) {
    buildVisibleView();

    backupWalletDelayed('update', function() {
        BlockchainAPI.get_history();
    });
}

function unArchiveAddr(addr) {
    var addr = addresses[addr];
    if (addr.tag == 2) {
        addr.tag = null;

        internalArchive();
    } else {
        makeNotice('error', 'add-error', 'Cannot Unarchive This Address');
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
        makeNotice('error', 'add-error', 'Cannot Archive This Address');
    }
}

function buildReceiveCoinsView() {
    $('#receive-coins').find('.tab-pane.active').trigger('show');

    setupToggle();
}

function _addPrivateKey(key) {
    if (walletIsFull())
        return false;

    if (key == null ) {
        throw 'Unable to generate a new bitcoin address.';
    }

    var addr = key.getBitcoinAddress();

    console.log('Add Address ' + addr);

    if (addr == null) {
        throw 'Generated invalid bitcoin address.';
    }

    if (internalAddKey(addr.toString(), encodePK(key.priv))) {
        addresses[addr].tag = 1; //Mark as unsynced

        if (isInitialized) {
            makeNotice('info', 'new-address', 'Generated new bitcoin address ' + addr);

            //Subscribe to tranaction updates through websockets
            try {
                ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');
            } catch (e) { }
        }
    } else {
        throw 'Unable to add generated bitcoin address.';
    }

    return addr;
}

function generateNewMiniPrivateKey() {

    while (true) {
        //Use a normal ECKey to generate random bytes
        var key = new Bitcoin.ECKey(false);

        //Make Candidate Mini Key
        var minikey = 'S' + Bitcoin.Base58.encode(key.priv).substr(0, 21);

        //Append ? & hash it again
        var bytes_appended = Crypto.SHA256(minikey + '?', {asBytes: true});

        //If zero byte then the key is valid
        if (bytes_appended[0] == 0) {

            //SHA256
            var bytes = Crypto.SHA256(minikey, {asBytes: true});

            return {addr : _addPrivateKey(new Bitcoin.ECKey(bytes)), miniKey : minikey};
        }
    }
}

function generateNewAddressAndKey() {
    var key = new Bitcoin.ECKey(false);

    return _addPrivateKey(key);
}