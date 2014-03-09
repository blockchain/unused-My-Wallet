isExtension = true;
APP_NAME = 'javascript_blockchain_com_mobile';

$(document).ready(function() {
    var body = $(document.body);

    var data_root = body.data('root');
    if (data_root)
        root = data_root;

    var data_resource = body.data('resource');
    if (data_resource)
        resource = data_resource;

    //Chrome should automatically grant notification permissions
    MyWallet.setHTML5Notifications(true);

    $('#create-account').click(function() {
        Mobile.loadTemplate('create-account')
    });
});

$(document).ready(function() {
    var body = $(document.body);

    var data_root = body.data('root');
    if (data_root)
        root = data_root;

    var data_resource = body.data('resource');
    if (data_resource)
        resource = data_resource;

    //Chrome should automatically grant notification permissions
    MyWallet.setHTML5Notifications(true);

    $('#pair-device-btn').click(function() {
        Mobile.loadTemplate('pair-device')
    });
});


var Mobile = new function() {
    this.loadTemplate = function(name, success, error) {
        $.ajax({
            type: "GET",
            url: '/template',
            data : {format : 'plain', name : name, mobile : true},
            success: function(html) {
                try {
                    $('body').html(html);

                    if (success) success();
                } catch (e) {
                    console.log(e);

                    if (error) error();
                }
            },
            error : function(data) {
                if (error) error();
            }
        });
    }

    function addNotePopover(el, tx_hash) {
        (function(el, tx_hash) {
            el = $(el);

            try {
                el.data('popover').tip().remove();
                el.removeData('popover');
            } catch (e) {}

            console.log('addNotePopover()');

            el.popover({
                title : 'Add Note <span style="float:right"><i class="icon-remove-sign"></i></span>',
                trigger : 'manual',
                content : '<textarea style="width:97%;height:50px;margin-top:2px" placeholder="Enter the note here..."></textarea><div style="text-align:right"><button class="btn btn-small">Save</button></div>'
            });

            el.popover('show');

            el.unbind('mouseleave').mouseleave(function() {
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

            tip.find('i').unbind().click(function() {
                el.popover('hide');
            });


            tip.find('button').click(function() {
                //Strip HTML and replace quotes

                var note = $.trim(tip.find('textarea').val());

                if (!isAlphaNumericSpace(note)) {
                    MyWallet.makeNotice('error', 'misc-error', 'Note must be contain letters and numbers only');
                    return;
                }

                if (note.length > 0) {
                    tx_notes[tx_hash] = note;

                    MyWallet.backupWalletDelayed();
                }

                //buildTransactionsView();
            });
        })(el, tx_hash);
    }



    function openTransactionSummaryModal(txIndex, result) {
        loadScript('wallet/frame-modal', function() {
            showFrameModal({
                title : 'Transaction Summary',
                description : '',
                src : root + 'tx-summary/'+txIndex+'?result='+result+'&symbol_btc='+symbol_btc.code+'&symbol_local='+symbol_local.code
            });
        });
    }


    function showNotePopover(el, content, tx_hash) {
        (function(el, content, tx_hash) {
            el = $(el);

            try {
                el.data('popover').tip().remove();
                el.removeData('popover');
            } catch (e) {}


            var title = 'Note';

            //Only if it is a custom (not public note do we show the delete button
            if (tx_notes[tx_hash])
                title += ' <span style="float:right"><img src="'+resource+'delete.png" /></span>';

            el.popover({
                title : title,
                trigger : 'manual',
                content : content
            })

            el.popover('show');

            el.unbind('mouseleave').mouseleave(function() {
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


    function bindTx(tx_tr, tx) {
        tx_tr.click(function(){
            openTransactionSummaryModal(tx.txIndex, tx.result);
        });

        tx_tr.find('.show-note').unbind('mouseover').mouseover(function() {
            var note = tx.note ? tx.note : tx_notes[tx.hash];
            showNotePopover(this, note, tx.hash);
        });

        tx_tr.find('.add-note').unbind('mouseover').mouseover(function() {
            addNotePopover(this, tx.hash);
        });

        return tx_tr;
    }


    function hidePopovers() {
        try {
            $('.popover').remove();
        } catch (e) {}
    }

    function formatOutputMobile(output, myAddresses, addresses_book) {
        function formatOut(addr, out) {
            var myAddr = null;
            if (myAddresses != null)
                myAddr = myAddresses[addr];

            if (myAddr != null) {
                if (myAddr.label != null)
                    return myAddr.label;
                else
                    return addr;
            } else {
                if (addresses_book && addresses_book[addr])
                    return '<a target="new" href="'+root+'address/'+addr+'">'+addresses_book[addr]+'</a>';
                else if (out.addr_tag) {
                    var link = '';
                    if (out.addr_tag_link)
                        link = ' <a class="external" rel="nofollow" href="'+root + 'r?url='+out.addr_tag_link+'" target="new"></a>';

                    return '<a target="new" href="'+root+'address/'+addr+'" class="tag-address">'+addr+'</a> <span class="tag">('+out.addr_tag+link+')</span>';
                } else {
                    return '<a target="new" href="'+root+'address/'+addr+'">'+addr+'</a>';
                }
            }
        }

        //total_fees -= output.value;
        var str = '';

        if (output.type == 0) {
        } else if (output.type == 1 || output.type == 2 || output.type == 3) {
            str = '(<font color="red">Escrow</font> ' + output.type + ' of ';
        } else {
            str = '<font color="red">Strange</font> ';
        }

        if (output.addr != null)
            str += formatOut(output.addr, output);

        if (output.addr2 != null)
            str += ', ' + formatOut(output.addr2, output);

        if (output.addr3 != null)
            str += ', ' + formatOut(output.addr3, output);

        if (output.type == 1 || output.type == 2 || output.type == 3) {
            str += ')';
        }

        str += '<br />';

        return str;
    }

    function getCompactHTML(tx, myAddresses, addresses_book) {
        var result = tx.result;

        var html = '<div class="row rowlines">';
    	html += '<div class="col-xs-2"> <img class="bound" src="${resource}mobile/images/outbound.png" alt="sent"> </div>';
        html += '<div class="col-xs-8">';
        if (tx.time > 0) {
            html += '<p class="details">' + dateToString(new Date(tx.time * 1000))+ '</p>';
        }

        if (result > 0) {
            html += '<p class="green">'+ formatMoney(result, true)+'</p>';
            html += '<p class="received">Received from:</p>';
        }
        else if (result < 0) {
            html += '<p class="red">'+ formatMoney(result, true)+'</p>';
            html += '<p class="sent">Sent to:</p>';
        }
        else {
            html += '<p>'+ formatMoney(result, true)+'</p>';
            html += '<p class="sent">Between wallet:</p>';
        }

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

                    html += formatOutputMobile(out, myAddresses, addresses_book);
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

                html += formatOutputMobile(out, myAddresses, addresses_book);
            }
        }

        if (all_from_self)
            html += '<span class="label">Moved Between Wallet</info>';


        html += '</div><div class="col-xs-2 text-right"></div></div>';

        return html;
    };


    //Display The My Transactions view
    this.buildTransactionsView = function buildTransactionsView() {
        var wallet_options = MyWallet.getWalletOptions();
        var transactions = MyWallet.getTransactions();
        var tx_page = MyWallet.getTxPage();
        var addresses = MyWallet.getAddresses();
        var address_book = MyWallet.getAddressBook();


        var interval = null;
        var start = 0;

        if (interval != null) {
            clearInterval(interval);
            interval = null;
        }

        var txcontainer;
        if (wallet_options.tx_display == 0) {
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
            for (var i = start; i < transactions.length && i < (start+MyWallet.getNTransactionsPerPage()); ++i) {
                var tx = transactions[i];

                if (wallet_options.tx_display == 0) {

                    txcontainer.append(bindTx($(getCompactHTML(tx, addresses, address_book)), tx));
                } else {
                    txcontainer.append(tx.getHTML(addresses, address_book));
                }
            }

            start += MyWallet.getNTransactionsPerPage();

            if (start < transactions.length) {
                interval = setTimeout(buildSome, 15);
            } else {
                setupSymbolToggle();

                hidePopovers();

                var pagination = $('.pagination ul').empty();

                if (tx_page == 0 && transactions.length < MyWallet.getNTransactionsPerPage()) {
                    pagination.hide();
                    return;
                } else {
                    pagination.show();
                }

                var pages = Math.ceil(n_tx_filtered / MyWallet.getNTransactionsPerPage());

                var disabled = ' disabled';
                if (tx_page > 0)
                    disabled = '';

                var maxPagesToDisplay = 10;

                var start_page = Math.max(0, Math.min(tx_page-(maxPagesToDisplay/2), pages-maxPagesToDisplay));

                pagination.append($('<li class="prev'+disabled+'"><a>&larr; Previous</a></li>').click(function() {
                    MyWallet.setPage(tx_page-1);
                }));

                if (start_page > 0) {
                    pagination.append($('<li><a>≤</a></li>').click(function() {
                        MyWallet.setPage(0);
                    }));
                }

                for (var i = start_page; i < pages && i < start_page+maxPagesToDisplay; ++i) {
                    (function(i){
                        var active = '';
                        if (tx_page == i)
                            active = ' class="active"';

                        pagination.append($('<li'+active+'><a class="hidden-phone">'+(i+1)+'</a></li>').click(function() {
                            MyWallet.setPage(i);
                        }));
                    })(i);
                }

                if (start_page+maxPagesToDisplay < pages) {
                    pagination.append($('<li><a>≥</a></li>').click(function() {
                        MyWallet.setPage(pages-1);
                    }));
                }

                var disabled = ' disabled';
                if (tx_page < pages-1)
                    disabled = '';

                pagination.append($('<li class="next'+disabled+'"><a>Next &rarr;</a></li>').click(function() {
                    MyWallet.setPage(tx_page+1)
                }));
            }
        };

        buildSome();
    }

}


function loadTemplatetransactions() {
    var body = $(document.body);

    var data_root = body.data('root');
    if (data_root)
        root = data_root;

    var data_resource = body.data('resource');
    if (data_resource)
        resource = data_resource;

    //Chrome should automatically grant notification permissions
    MyWallet.setHTML5Notifications(true);

    Mobile.loadTemplate('transactions');
}

function parsePairingCode(raw_code) {

    var success = function(pairing_code) {
        device.execute("didParsePairingCode:", pairing_code);
    }

    var error = function(message) {
        device.execute("errorParsingPairingCode:", message);
    }

    try {
        if (raw_code == null || raw_code.length == 0) {
            throw "Invalid Pairing QR Code";
        }

        var components = raw_code.split("|");

        if (components.length < 3) {
            throw "Invalid Pairing QR Code. Not enough components.";
        }

        var guid = components[1];
        if (guid.length != 36) {
            throw "Invalid Pairing QR Code. GUID wrong length.";
        }

        var encrypted_data = components[2];

        $.ajax({
            type: "POST",
            url: root + 'wallet',
            data : {format : 'plain', method : 'pairing-encryption-password', guid : guid},
            success: function(encryption_phrase) {

                var decrypted = MyWallet.decrypt(encrypted_data, encryption_phrase, MyWallet.getDefaultPbkdf2Iterations(), function(decrypted) {
                    return decrypted != null;
                }, function() {
                    error('Decryption Error');
                });

                if (decrypted != null) {
                    var components2 = decrypted.split("|");

                    success({
                        version : raw_code[0],
                        guid : guid,
                        sharedKey : components2[0],
                        password : UTF8.bytesToString(Crypto.util.hexToBytes(components2[1]))
                    });
                }
            },
            error : function(res) {
                error(res.responseText);
            }
        });

    } catch (e) {
        error('Error ' + e);
    }
}

