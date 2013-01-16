function _BlockchainAPI() {
    var BlockchainAPI = this;

    this.get_history = function(success, error, tx_filter, tx_page) {
        MyWallet.setLoadingText('Loading transactions');

        $.ajax({
            type: "POST",
            url: root +'multiaddr?format=json&filter='+tx_filter+'&offset='+tx_page*50,
            data: {'active' : MyWallet.getActiveAddresses().join('|') },
            converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": $.parseXML},
            success: function(data) {

                if (data.error != null) {
                    MyWallet.makeNotice('error', 'misc-error', data.error);
                }

                try {
                    try {
                        //Cache results to show next login
                        if (tx_page == 0 && tx_filter == 0)
                            localStorage.setItem('multiaddr', data);
                    } catch (e) {}

                    success(data);

                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);

                    error();
                }
            },

            error : function(data) {
                MyWallet.makeNotice('error', 'misc-error', data.responseText);

                error();
            }
        });
    }

    //Get the balances of multi addresses (Used for archived)
    this.get_balances = function(addresses, success, error) {
        MyWallet.setLoadingText('Getting Balances');

        $.post(root + "multiaddr", {active : addresses.join('|'), simple : true, format : 'json' },  function(obj) {
            for (var key in obj) {

                if (MyWallet.addressExists(key))
                    MyWallet.setAddressBalance(key, obj[key].final_balance);
            }

            success(obj);
        }).error(function(data) {
                error(data.responseText);
            });
    }

    //Get the balance of an array of addresses
    this.get_balance = function(addresses, success, error) {
        MyWallet.setLoadingText('Getting Balance');

        this.get_balances(addresses, function(obj){
            var balance = 0;
            for (var key in obj) {
                balance += obj[key].final_balance;
            }

            success(balance);
        }, error);
    }

    this.get_ticker = function() {
        MyWallet.setLoadingText('Getting Ticker Data');

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

    this.resolve_firstbits = function(addr, success, error) {
        MyWallet.setLoadingText('Querying Firstbits');

        $.get(root + 'q/resolvefirstbits/'+addr+'?format=plain').success(function(data) {

            if (data == null || data.length == 0)
                error();
            else
                success(data);

        }).error(function(data) {
                error(data);
            });
    }

    this.get_rejection_reason = function(hexhash, success, error) {
        MyWallet.setLoadingText('Querying Rejection Reason');

        $.get(root + 'q/rejected/'+hexhash+'?format=plain').success(function(data) {
            if (data == null || data.length == 0)
                error();
            else
                success(data);
        }).error(function(data) {
                if (error) error(data);
            });
    }

    this.push_tx = function(tx, note, success, error) {
        try {
            MyWallet.setLoadingText('Pushing Transaction');

            var transactions = MyWallet.getTransactions();

            //Record the first transactions we know if it doesn't change then our new transactions wasn't push out propoerly
            if (transactions.length > 0)
                var first_tx_index = transactions[0].txIndex;

            function did_push() {
                success(); //Call success to enable send button again

                function call_history() {
                    MyWallet.get_history(function() {
                        if (transactions.length == 0 || transactions[0].txIndex == first_tx_index) {
                            BlockchainAPI.get_rejection_reason(Crypto.util.bytesToHex(tx.getHash().reverse()), function(reason) {
                                MyWallet.makeNotice('error', 'tx-error', reason);
                            }, function() {
                                MyWallet.makeNotice('error', 'tx-error', 'Unknown Error Pushing Transaction');
                            });
                        } else {
                            playSound('beep');
                        }
                    }, function() {
                        MyWallet.makeNotice('error', 'tx-error', 'Unable to determine if transaction was submitted. Please re-login.');
                    });
                }

                if (!window.WebSocket || ws == null || ws.readyState != WebSocket.OPEN) {
                    call_history(); //If the websocket isn't defined or open call history immediately
                } else {
                    //Otherwise we set an interval to set for a transaction
                    setTimeout(function() {
                        if (transactions.length == 0 || transactions[0].txIndex == first_tx_index) {
                            call_history();
                        }
                    }, 2000);
                }
            };

            var s = tx.serialize();

            function push_normal() {
                var hex = Crypto.util.bytesToHex(s);

                var post_data = {
                    format : "plain",
                    tx: hex
                };

                if (note) {
                    post_data.note = note;
                }

                $.post(root + 'pushtx', post_data, function() {
                    did_push();
                }).error(function(data) {
                        error(data ? data.responseText : null);
                    });
            }

            try {
                var buffer = new ArrayBuffer(s.length);

                var int8_array = new Int8Array(buffer);

                int8_array.set(s);

                var blob = new Blob([buffer], {type : 'application/octet-stream'});

                if (blob.size != s.length)
                    throw 'Inconsistent Data Sizes (blob : ' + blob.size + ' s : ' + s.length + ' buffer : ' + buffer.byteLength + ')';

                var fd = new FormData();

                fd.append('txbytes', blob);

                if (note) {
                    fd.append('note', note);
                }

                fd.append('format', 'plain');

                $.ajax({
                    url: root + 'pushtx',
                    data: fd,
                    processData: false,
                    contentType: false,
                    type: 'POST',
                    success: function(){
                        did_push();
                    },
                    error : function(data) {
                        push_normal();
                    }
                });

            } catch (e) {
                console.log(e);

                push_normal();
            }
        } catch (e) {
            console.log(e);

            error(e);
        }
    }

    this.get_unspent = function(fromAddresses, success, error) {
        //Get unspent outputs
        MyWallet.setLoadingText('Getting Unspent Outputs');

        $.ajax({
            type: "POST",
            url: root +'unspent',
            data: {active : fromAddresses.join('|'), format : 'json'},
            converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": $.parseXML},
            success: function(data) {
                try {
                    var obj = $.parseJSON(data);

                    if (obj == null) {
                        throw 'Unspent returned null object';
                    }

                    if (obj.error != null) {
                        throw obj.error;
                    }

                    if (obj.notice != null) {
                        MyWallet.makeNotice('notice', 'misc-notice', obj.notice);
                    }

                    //Save the unspent cache
                    try {
                        localStorage.setItem('unspent', data);
                    } catch (e) { }

                    success(obj);
                } catch (e) {
                    error(e);
                }
            },
            error: function (data) {
                try {
                    try {
                        var cache = localStorage.getItem('unspent');

                        if (cache != null) {
                            var obj = $.parseJSON(cache);

                            success(obj);

                            return;
                        }
                    } catch (e) {
                        console.log(e);
                    }

                    if (data.responseText)
                        throw data.responseText;
                    else
                        throw 'Error Contacting Server. No unspent outputs available in cache.';

                } catch (e) {
                    error(e);
                }
            }
        });
    }
}

var BlockchainAPI = new _BlockchainAPI();