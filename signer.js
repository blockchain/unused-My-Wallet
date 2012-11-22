function exceptionToString(err) {
    var vDebug = "";
    for (var prop in err)  {
        vDebug += "property: "+ prop+ " value: ["+ err[prop]+ "]\n";
    }
    return "toString(): " + " value: [" + err.toString() + "]";
}

try {
//Init WebWoker
//Window is not defined in WebWorker
    if (typeof window == "undefined" || !window) {
        importScripts('/Resources/wallet/bitcoinjs.min.js');

        self.addEventListener('message', function(e) {
            var data = e.data;
            switch (data.cmd) {
                case 'sign_input':
                    try {
                        var tx = new Bitcoin.Transaction(data.tx);

                        var connected_script = new Bitcoin.Script(data.connected_script);

                        var signed_script = signInput(tx, data.outputN, data.priv_to_use, connected_script);
                        if (signed_script) {
                            self.postMessage({cmd : 'on_sign', script : signed_script, outputN : data.outputN});
                        } else {
                            throw 'Unknown Error Signing Script ' + data.outputN;
                        }

                    } catch (e) {
                        self.postMessage({cmd : 'on_error', e : exceptionToString(e)});
                    }
                    break;
                default:
                    self.postMessage({cmd : 'on_error', e : 'Unknown Command'});
            };
        }, false);
    }
} catch (e) { }

Bitcoin.Transaction.prototype.addOutputScript = function (script, value) {
    if (arguments[0] instanceof Bitcoin.TransactionOut) {
        this.outs.push(arguments[0]);
    } else {
        if (value instanceof BigInteger) {
            value = value.toByteArrayUnsigned().reverse();
            while (value.length < 8) value.push(0);
        } else if (Bitcoin.Util.isArray(value)) {
            // Nothing to do
        }

        this.outs.push(new Bitcoin.TransactionOut({
            value: value,
            script: script
        }));
    }
};



function showPrivateKeyModal(success, error, addr) {

    var modal = $('#private-key-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(addr);

    var scanned_key = null;
    var error_msg = null;

    //WebCam
    loadScript(resource + 'wallet/llqrcode.js', function() {
        loadScript(resource + 'wallet/qr.code.reader.js', function() {
            //Flash QR Code Reader
            var interval = initQRCodeReader('qr-code-reader', function(code){
                console.log('Scanned ' + code);

                try {
                    scanned_key = privateKeyStringToKey(code, detectPrivateKeyFormat(code));

                    if (scanned_key == null) {
                        throw 'Error decoding private key';
                    }
                } catch(e) {
                    error_msg = 'Error decoding private key ' + e;
                }

                modal.modal('hide');

                if (scanned_key)
                    success(scanned_key);
                else
                    error(error_msg);

                clearInterval(interval);

            }, resource + 'wallet/');
        });
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        var value = modal.find('input[name="key"]').val();

        try {
            if (value.length == 0) {
                throw  'You must enter a private key to import';
            }

            scanned_key = privateKeyStringToKey(value, detectPrivateKeyFormat(value));

            if (scanned_key == null) {
                throw 'Could not decode private key';
            }
        } catch(e) {
            error_msg = 'Error importing private key ' + e;
        }

        modal.modal('hide');

        if (scanned_key)
            success(scanned_key);
        else
            error(error_msg);
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
        error('User Cancelled');
    });
}


function resolveAddress(label) {
    label = $.trim(label);

    try {
        return new Bitcoin.Address(label).toString();
    } catch (e) {}

    label = label.toLowerCase();

    for (var key in address_book) {
        var a_label = address_book[key];
        if (a_label.toLowerCase() == label) {
            return $.trim(key);
        }
    }
    for (var key in addresses) {
        var a_label = addresses[key].label;
        if (a_label && a_label.toLowerCase() == label)
            return key;
    }
    return null;
}


//Check for inputs and get unspent for before signing
function startTxUI(el, type, pending_transaction, dont_ask_for_anon) {

    try {
        var total_value = 0;
        el.find('input[name="send-value"]').each(function() {
            total_value += parseFloat($(this).val());
        });

        var custom_ask_for_fee = true;
        if (total_value > 10) {
            if (type == 'email' || type == 'facebook' || type == 'sms') {
                throw 'Cannot Send More Than 10 BTC via email or facebook';
            } else if (type == 'quick') { //Any quick transactions over 20 BTC make them custom
                type = 'custom';
                custom_ask_for_fee = false;
            }
        } else if ( type == 'anonymous' && total_value < 0.5) {
            throw 'The Minimum Amount You Can Send Anonymously is 0.5 BTC';
        }

        if (mixer_fee && mixer_fee < 0 && (type == 'custom' || type == 'quick') && total_value >= 5 && getCookie('anonymous-never-ask') != 'true' && !dont_ask_for_anon) {

            var last_accepted_time = getCookie('anonymous-accepted-time');
            if (!last_accepted_time || parseInt(last_accepted_time) < new Date().getTime()-43200000) {
                var modal = $('#ask-for-anonymous');

                modal.find('.bonus-percent').text(- mixer_fee);
                modal.find('.bonus-value').text((total_value / 100) * - mixer_fee);

                var delay_span = modal.find('.delay');
                if (total_value <= 10)
                    delay_span.text('20 Seconds');
                else if (total_value <= 25)
                    delay_span.text('10 Minutes');
                else if (total_value <= 250)
                    delay_span.text('20 Minutes');
                else
                    delay_span.text('1 hour');

                modal.modal({
                    keyboard: false,
                    backdrop: "static",
                    show: true
                });

                modal.find('.btn.btn-primary').unbind().click(function() {
                    var anon_pending = startTxUI(el, 'anonymous', pending_transaction);

                    anon_pending.addListener({
                        on_success : function() {
                            //Set a cookie to not ask again within 12 hours
                            SetCookie('anonymous-accepted-time', new Date().getTime());
                        }
                    });

                    modal.modal('hide');
                });

                modal.find('.btn.btn-secondary').unbind().click(function() {
                    modal.modal('hide');

                    startTxUI(el, type, pending_transaction, true)
                });

                return;
            }
        }

        var listener = {};
        if (type == 'custom' || type == 'anonymous') {
            var listener = {
                on_error : function(e) {
                    if (this.modal)
                        this.modal.modal('hide');
                },
                on_success : function() {
                    buildVisibleView(true);
                },
                on_start : function() {
                    //Show the modal on start
                    var self = this;

                    //Create the modal
                    this.modal = $('#new-transaction-modal');

                    this.modal.modal({
                        keyboard: false,
                        backdrop: "static",
                        show: true
                    });

                    this.modal.find('.offline-transaction').hide();
                    this.modal.find('#missing-private-key').hide();
                    this.modal.find('#review-tx').hide();

                    this.modal.find('.modal-header h3').html('Creating transaction');

                    this.modal.find('#tx-sign-progress').hide();

                    //disable primary for now
                    this.modal.find('.btn.btn-primary').attr('disabled', true);

                    this.modal.find('.btn.btn-primary').text('Send Transaction');

                    this.modal.find('.btn.btn-secondary').unbind().click(function() {
                        self.modal.modal('hide');
                        self.cancel();
                    });
                },
                on_begin_signing : function() {
                    $('#tx-sign-progress').show(200).find('.t').text(this.tx.ins.length);
                },
                on_sign_progress : function(i) {
                    $('#tx-sign-progress').find('.n').text(i);
                },
                on_finish_signing : function() {
                    $('#tx-sign-progress').hide();
                }
            };

            pending_transaction.addListener(listener);


            if (custom_ask_for_fee) {
                pending_transaction.ask_for_fee = function(yes, no) {
                    var self = this;

                    self.modal.modal('hide'); //Hide the transaction progress modal

                    var modal = $('#ask-for-fee');

                    modal.modal({
                        keyboard: false,
                        backdrop: "static",
                        show: true
                    });

                    modal.find('.btn.btn-primary').unbind().click(function() {
                        modal.modal('hide');

                        yes();
                    });

                    modal.find('.btn.btn-secondary').unbind().click(function() {
                        modal.modal('hide');

                        no();
                    });

                    modal.unbind().on('hidden', function () {
                        self.modal.modal('show'); //Show the progress modal again
                    });
                };
            }

            pending_transaction.ask_to_send = function() {
                var self = this;
                try {
                    if (privateKeyToSweep == null)
                        self.modal.find('.modal-header h3').html('Transaction Ready to Send.');
                    else
                        self.modal.find('.modal-header h3').html('Bitcoins Ready to Claim.');

                    self.modal.find('#missing-private-key').hide();

                    self.modal.find('#review-tx').show();

                    setReviewTransactionContent(self.modal, self.tx, self.type);

                    setAdv(false);

                    self.modal.center();

                    //We have the transaction ready to send, check if were online or offline
                    var btn = self.modal.find('.btn.btn-primary');

                    setLoadingText('Checking Connectivity');

                    //Check if were able to contact blockchain.info
                    $.get(root + 'ping?'+new Date().getTime()).success(function(data) {
                        btn.attr('disabled', false);

                        btn.text('Send Transaction');

                        btn.unbind().click(function() {
                            btn.attr('disabled', true);

                            self.modal.modal('hide');

                            self.send();
                        });
                    }).error(function(data) {
                            self.modal.find('.modal-header h3').html('Created Offline Transaction.');

                            btn.attr('disabled', false);

                            btn.text('Show Offline Instructions');

                            btn.unbind().click(function() {

                                btn.attr('disabled', true);

                                self.modal.find('#missing-private-key').hide();
                                self.modal.find('#review-tx').hide();
                                self.modal.find('.offline-transaction').show();

                                var s = self.tx.serialize();

                                var hex = Crypto.util.bytesToHex(s);

                                self.modal.find('.offline-transaction textarea[name="data"]').val(hex);
                            });

                            self.modal.center();
                        });
                } catch (e) {
                    self.error(e);
                }
            };
        } else if (type == 'quick' || type == 'email' || type == 'dice' || type == 'facebook' || type == 'sms') {
            var listener = {
                on_error : function(e) {
                    el.find('.send').show(200);
                    if (this.p)
                        this.p.hide();
                },
                on_success : function() {
                    try {
                        el.find('.send').show(200);

                        if (type != 'dice')
                            buildVisibleView(true);

                        if (this.p)
                            this.p.hide();
                    } catch (e) {
                        console.log(e);
                    }
                },
                on_start : function() {
                    this.p = el.find('.progress');

                    el.find('.send').hide();

                    this.p.show();

                    this.p.children().css('width', '10%');
                },
                on_begin_signing : function() {
                    this.p.children().css('width', '25%');
                },
                on_sign_progress : function(i) {
                    this.p.children().css('width', 25 + ((100 / this.tx.ins.length) * i) + '%');
                },
                on_finish_signing : function() {
                    this.p.children().css('width', '100%');
                }
            };

            pending_transaction.addListener(listener);

            if (type == 'email') {
                pending_transaction.ask_to_send = function() {
                    var self = this;

                    var modal = $('#send-email-modal');

                    try {
                        $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info', format : 'plain' },  function(data) {
                            try {

                                modal.modal({
                                    keyboard: true,
                                    backdrop: "static",
                                    show: true
                                });

                                var from_name = data.alias;
                                if (from_name == null)
                                    from_name = data.email

                                if (from_name == null)
                                    from_name = 'Anonymous'

                                modal.find('.amount').text(formatBTC(self.email_data.amount.toString()));

                                modal.find('.email').text(self.email_data.email);

                                modal.find('.frame').html('<iframe frameBorder="0" style="box-sizing:border-box;width:100%;height:100%" src="'+root+'email-template?from_name='+from_name+'&amount='+self.email_data.amount+'&priv=Preview&type=send-bitcoins-get"></iframe>');

                                modal.find('.btn.btn-secondary').unbind().click(function() {
                                    self.cancel();
                                    modal.modal('hide');
                                });

                                modal.find('.btn.btn-primary').unbind().click(function() {
                                    modal.modal('hide');

                                    try {
                                        $.get(root + 'send-via?type=email&format=plain&to=' + self.email_data.email + '&guid='+ guid + '&priv='+ decryptPK(self.email_data.addr.priv) + '&sharedKey=' + sharedKey+'&hash='+Crypto.util.bytesToHex(self.tx.getHash().reverse())).success(function(data) {
                                            self.send();
                                        }).error(function(data) {
                                                self.error(data ? data.responseText : null);
                                            });

                                    } catch (e) {
                                        self.error(e);
                                    }
                                });
                            } catch (e) {
                                modal.modal('hide');

                                self.error(e);
                            }
                        }).error(function(e) {
                                modal.modal('hide');

                                self.error('Error Getting Account Data');
                            });
                    } catch (e) {
                        modal.modal('hide');

                        self.error(e);
                    }
                };
            }
        }

        //Modal for when private key is missing (Watch Only)
        pending_transaction.ask_for_private_key = function(success, error, addr) {
            var self = this;

            if (self.modal)
                self.modal.modal('hide'); //Hide the transaction progress modal

            showPrivateKeyModal(function(key) {
                if (self.modal)
                    self.modal.modal('show'); //Show the progress modal again

                success(key);
            }, function (e) {
                if (self.modal)
                    self.modal.modal('show'); //Show the progress modal again

                error(e);
            }, addr)
        };

        pending_transaction.type = type;

        if (fee_policy == 1) {
            pending_transaction.fee = BigInteger.valueOf(100000);
        } else if (fee_policy == -1) {
            pending_transaction.ask_for_fee = function(yes, no) {
                no();
            };
        }

        getSecondPassword(function() {
            try {
                var silentReturn = false;

                //Get the from address, if any
                var from_select = el.find('select[name="from"]');
                var fromval = from_select.val();
                if (fromval == null || fromval == 'any') {
                    pending_transaction.from_addresses = getActiveAddresses();
                } else if (from_select.attr('multiple') == 'multiple') {
                    pending_transaction.from_addresses = fromval;
                } else {
                    pending_transaction.from_addresses = [fromval];
                }

                var note = el.find('textarea[name="public-note"]').val();
                if (note != null && note.length > 0) {

                    if (note.length > 255)
                        throw 'Notes are restricted to 255 characters in length';

                    pending_transaction.note = note;
                }

                var changeAddressVal = el.find('select[name="change"]').val();

                if (changeAddressVal != null) {
                    if (changeAddressVal == 'new') {
                        var generatedAddr = generateNewAddressAndKey();

                        pending_transaction.change_address = generatedAddr;

                        pending_transaction.generated_addresses.push(generatedAddr.toString());

                    } else if (changeAddressVal != 'any') {
                        try {
                            pending_transaction.change_address = new Bitcoin.Address(changeAddressVal);
                        } catch (e) {
                            throw 'Invalid change address: ' + e;
                        };
                    }
                }

                var input_fee = el.find('input[name="fees"]').val();

                if (input_fee != null && input_fee.length > 0) {
                    pending_transaction.fee = Bitcoin.Util.parseValue(input_fee);

                    if (pending_transaction.fee.compareTo(BigInteger.ZERO) < 0)
                        throw 'Fees cannot be negative';
                }

                var recipients = el.find(".recipient");

                if (recipients.length == 0) {
                    throw 'A transaction must have at least one recipient';
                }

                var n_recipients = recipients.length;

                var try_continue = function() {
                    if (n_recipients == 0)  {
                        pending_transaction.error('Nothing to send.');
                        return;
                    }

                    //Check that we have resolved all to addresses
                    if (pending_transaction.to_addresses.length < n_recipients)
                        return;

                    //Check that we have resolved all to addresses
                    if (pending_transaction.to_addresses.length > n_recipients) {
                        pending_transaction.error('We seem to have more recipients than required. Unknown error');
                        return;
                    }

                    //If we do have the correct number of recipients start the transaction
                    pending_transaction.start();
                }

                //Constuct the recepient address array
                recipients.each(function() {
                    try {
                        var child = $(this);

                        /* Parse The Value */
                        var value_input = child.find('input[name="send-value"]');
                        var send_to_input = child.find('input[name="send-to-address"]');
                        var send_to_email_input = child.find('input[name="send-to-email"]');
                        var send_to_facebook_input = child.find('input[name="send-to-facebook"]');
                        var send_to_sms_input = child.find('input[name="send-to-sms"]');

                        var value = 0;
                        try {
                            value = Bitcoin.Util.parseValue(value_input.val());

                            if (value == null || value.compareTo(BigInteger.ZERO) <= 0)
                                throw 'You must enter a value greater than zero';
                        } catch (e) {

                            if (value_input.data('optional') == true) {
                                --n_recipients;
                                return true;
                            } else {
                                throw 'Invalid send amount';
                            }
                        };

                        if (send_to_input.length > 0) {
                            //Trim and remove non-printable characters
                            var send_to_address = $.trim(send_to_input.val()).replace(/[\u200B-\u200D\uFEFF]/g, '');

                            if (send_to_address == null || send_to_address.length == 0) {
                                throw 'You must enter a bitcoin address for each recipient';
                            }  else {

                                var address = resolveAddress(send_to_address);

                                if (type == 'anonymous') {
                                    if (!address) {
                                        throw 'Invalid Bitcoin Address';
                                    }

                                    setLoadingText('Creating Forwarding Address');

                                    $.post(root + "forwarder", { action : "create-mix", address : address, format : 'plain' }, function(obj) {
                                        try {
                                            console.log('Generated Forwarding Address ' + obj.input_address);

                                            if (obj.destination != address) {
                                                throw 'Mismatch between requested and returned destination address';
                                            }

                                            if (obj.fee_percent != mixer_fee) {
                                                BlockchainAPI.get_history();

                                                throw 'The mixer fee may have changed';
                                            }

                                            pending_transaction.to_addresses.push({address: new Bitcoin.Address(obj.input_address), value : value});

                                            //Call again now we have got the forwarding address
                                            try_continue();
                                        } catch (e) {
                                            pending_transaction.error(e);
                                        }
                                    }).error(function(data) {
                                            pending_transaction.error(data ? data.responseText : null);
                                        });
                                } else {

                                    if (address) {
                                        pending_transaction.to_addresses.push({address: new Bitcoin.Address(address), value : value});
                                    } else {
                                        //Try and Resolve firstbits
                                        BlockchainAPI.resolve_firstbits(send_to_address, function(data) {
                                            try {
                                                pending_transaction.to_addresses.push({address: new Bitcoin.Address(data), value : value});

                                                //Call again now we have resolved the address
                                                try_continue();
                                            } catch (e) {
                                                pending_transaction.error(e);
                                            }
                                        }, function() {
                                            pending_transaction.error('Invalid to address: ' + send_to_address);
                                        });

                                        return false;
                                    }
                                }
                            }
                        } else if (send_to_facebook_input.length > 0) {
                            var send_to_facebook = $.trim(send_to_facebook_input.val());

                            //Send to email address
                            var generatedAddr = generateNewAddressAndKey();

                            //Fetch the newly generated address
                            var addr = addresses[generatedAddr.toString()];

                            addr.tag = 2;
                            addr.label = send_to_facebook + ' (Sent Via Facebook)';

                            pending_transaction.generated_addresses.push(addr.addr);

                            pending_transaction.to_addresses.push({address: generatedAddr, value : value});

                            if (pending_transaction.facebook)
                                throw 'Cannot send to more than one facebook recipient at a time';

                            var to = send_to_facebook_input.data('fb-id');
                            if (to == null)
                                to = send_to_facebook;

                            pending_transaction.facebook = {
                                to : to,
                                addr : addr,
                                amount : value
                            };
                        } else if (send_to_sms_input.length > 0) {
                            var mobile_number = $.trim(send_to_sms_input.val());

                            if (mobile_number.charAt(0) == '0')
                                mobile_number = mobile_number.substring(1);

                            if (mobile_number.charAt(0) != '+')
                                mobile_number = '+' + child.find('select[name="sms-country-code"]').val() + mobile_number;

                            //Send to email address
                            var miniKeyAddrobj = generateNewMiniPrivateKey();

                            //Fetch the newly generated address
                            var addr = addresses[miniKeyAddrobj.addr.toString()];

                            addr.tag = 2;
                            addr.label = mobile_number + ' (Sent Via SMS)';

                            pending_transaction.generated_addresses.push(addr.addr);

                            pending_transaction.to_addresses.push({address: miniKeyAddrobj.addr, value : value});

                            if (pending_transaction.sms)
                                throw 'Cannot send to more than one SMS recipient at a time';

                            pending_transaction.sms = {
                                number : mobile_number,
                                miniKey:  miniKeyAddrobj.miniKey,
                                addr : addr,
                                amount : value
                            };

                            pending_transaction.ask_to_send = function() {
                                try {
                                    var self = this;

                                    $.get(root + 'send-via?type=sms&format=plain&to=' + encodeURIComponent(self.sms.number) + '&guid='+ guid + '&priv='+ self.sms.miniKey + '&sharedKey=' + sharedKey+'&hash='+Crypto.util.bytesToHex(self.tx.getHash().reverse())).success(function(data) {
                                        self.send();
                                    }).error(function(data) {
                                            self.error(data ? data.responseText : null);
                                        });
                                } catch (e) {
                                    self.error(e);
                                }
                            };
                        } else if (send_to_email_input.length > 0) {
                            var send_to_email = $.trim(send_to_email_input.val());

                            if (validateEmail(send_to_email)) {

                                //Send to email address
                                var generatedAddr = generateNewAddressAndKey();

                                //Fetch the newly generated address
                                var addr = addresses[generatedAddr.toString()];

                                addr.tag = 2;
                                addr.label = send_to_email + ' (Sent Via Email)';

                                pending_transaction.generated_addresses.push(addr.addr);

                                pending_transaction.to_addresses.push({address: generatedAddr, value : value});

                                if (pending_transaction.email)
                                    throw 'Cannot send to more than one email recipient at a time';

                                pending_transaction.email_data = {
                                    email : send_to_email,
                                    addr : addr,
                                    amount : value
                                }
                            } else {
                                throw 'Invalid Email Address';
                            }
                        }
                    } catch (e) {
                        console.log(e);

                        pending_transaction.error(e);
                    }
                });

                try_continue();

            } catch (e) {
                pending_transaction.error(e);
            }
        });
    } catch (e) {
        pending_transaction.error(e);
    }

    return pending_transaction;
};

if (typeof BlockchainAPI == "undefined" || !BlockchainAPI)
    var BlockchainAPI = {};

BlockchainAPI.resolve_firstbits = function(addr, success, error) {
    setLoadingText('Querying Firstbits');

    $.get(root + 'q/resolvefirstbits/'+addr+'?format=plain').success(function(data) {

        if (data == null || data.length == 0)
            error();
        else
            success(data);

    }).error(function(data) {
            error();
        });
}

BlockchainAPI.get_pubkey = function(addr, success, error) {
    setLoadingText('Resolving Pub Key');

    $.get(root + 'q/pubkeyaddr/'+addr+'?format=plain').success(function(data) {

        if (data == null || data.length == 0)
            error();
        else
            success(Crypto.util.hexToBytes(data));

    }).error(function(data) {
            error();
        });
}

BlockchainAPI.get_rejection_reason = function(hexhash, success, error) {
    setLoadingText('Querying Rejection Reason');

    $.get(root + 'q/rejected/'+hexhash+'?format=plain').success(function(data) {
        if (data == null || data.length == 0)
            error();
        else
            success(data);
    }).error(function(data) {
            if (error) error();
        });
}

BlockchainAPI.push_tx = function(tx, note, success, error) {
    try {
        setLoadingText('Pushing Transaction');

        //Record the first transactions we know if it doesn't change then our new transactions wasn't push out propoerly
        if (transactions.length > 0)
            var first_tx_index = transactions[0].txIndex;

        function did_push() {
            success(); //Call success to enable send button again

            function call_history() {
                BlockchainAPI.get_history(function() {
                    if (transactions.length == 0 || transactions[0].txIndex == first_tx_index) {
                        BlockchainAPI.get_rejection_reason(Crypto.util.bytesToHex(tx.getHash().reverse()), function(reason) {
                            makeNotice('error', 'tx-error', reason);
                        }, function() {
                            makeNotice('error', 'tx-error', 'Unknown Error Pushing Transaction');
                        });
                    } else {
                        playSound('beep');
                    }
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
                    error(data ? data.responseText : null);
                }
            });

        } catch (e) {
            console.log(e);

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
    } catch (e) {
        error(e);
    }
}

BlockchainAPI.get_unspent = function(fromAddresses, success, error) {
    //Get unspent outputs
    setLoadingText('Getting Unspent Outputs');

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
                    makeNotice('notice', 'misc-notice', obj.notice);
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

function readVarInt(buff) {
    var tbyte, tbytes;

    tbyte = buff.splice(0, 1)[0];

    if (tbyte < 0xfd) {
        tbytes = [tbyte];
    } else if (tbyte == 0xfd) {
        tbytes = buff.splice(0, 2);
    } else if (tbyte == 0xfe) {
        tbytes = buff.splice(0, 4);
    } else {
        tbytes = buff.splice(0, 8);
    }

    return new BigInteger(tbytes);
}

function readUInt32(buffer) {
    return new BigInteger(buffer.splice(0, 4).reverse()).intValue();
}

Bitcoin.Transaction.deserialize = function (buffer)
{
    var tx = new Bitcoin.Transaction();

    tx.version = readUInt32(buffer);

    var txInCount = readVarInt(buffer).intValue();

    for (var i = 0; i < txInCount; i++) {

        var outPointHashBytes = buffer.splice(0,32);
        var outPointHash = Crypto.util.bytesToBase64(outPointHashBytes);

        var outPointIndex = readUInt32(buffer);

        var scriptLength = readVarInt(buffer).intValue();
        var script = new Bitcoin.Script(buffer.splice(0, scriptLength));
        var sequence = readUInt32(buffer);

        var input = new Bitcoin.TransactionIn({outpoint : {hash: outPointHash, index : outPointIndex}, script: script,  sequence: sequence});

        tx.ins.push(input);
    }

    var txOutCount = readVarInt(buffer).intValue();
    for (var i = 0; i < txOutCount; i++) {

        var valueBytes = buffer.splice(0, 8);
        var scriptLength = readVarInt(buffer).intValue();
        var script = new Bitcoin.Script(buffer.splice(0, scriptLength));

        var out = new Bitcoin.TransactionOut({script : script, value : valueBytes})

        tx.outs.push(out);
    }

    tx.lock_time = readUInt32(buffer);

    return tx;
};

function signInput(tx, inputN, base58Key, connected_script) {

    var pubKeyHash = connected_script.simpleOutPubKeyHash();

    var inputBitcoinAddress = new Bitcoin.Address(pubKeyHash).toString();

    var key = new Bitcoin.ECKey(base58Key);

    var compressed;
    if (key.getBitcoinAddress().toString() == inputBitcoinAddress.toString()) {
        compressed = false;
    } else if (key.getBitcoinAddressCompressed().toString() == inputBitcoinAddress.toString()) {
        compressed = true;
    } else {
        throw 'Private key does not match bitcoin address ' + inputBitcoinAddress.toString() + ' = ' + key.getBitcoinAddress().toString() + ' | '+ key.getBitcoinAddressCompressed().toString();
    }

    var hashType = parseInt(1); // SIGHASH_ALL

    var hash = tx.hashTransactionForSignature(connected_script, inputN, hashType);

    var rs = key.sign(hash);

    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    // Append hash type
    signature.push(hashType);

    var script;

    if (compressed)
        script = Bitcoin.Script.createInputScript(signature, key.getPubCompressed());
    else
        script = Bitcoin.Script.createInputScript(signature, key.getPub());

    if (script == null) {
        throw 'Error creating input script';
    }

    return script;
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

function setReviewTransactionContent(modal, tx, type) {

    $('#rtc-hash').html(Crypto.util.bytesToHex(tx.getHash()));
    $('#rtc-version').html(tx.version);
    $('#rtc-from').html('');
    $('#rtc-to').html('');

    var total = BigInteger.ZERO;
    var total_fees =  BigInteger.ZERO;
    var wallet_effect =  BigInteger.ZERO;
    var basic_str = 'send ';
    var all_txs_to_self = true;
    var amount =  BigInteger.ZERO;

    for (var i = 0; i < tx.ins.length; ++i) {
        var input = tx.ins[i];

        total_fees = total_fees.add(input.outpoint.value);

        wallet_effect = wallet_effect.add(input.outpoint.value);

        var addr = null;
        try {
            addr = new Bitcoin.Address(input.script.simpleInPubKeyHash());
        } catch(e) {
            addr = 'Unable To Decode Address';
        }

        $('#rtc-from').append(addr + ' <font color="green">' + formatBTC(input.outpoint.value.toString()) + ' BTC <br />');
    }

    var isFirst = true;
    for (var i = 0; i < tx.outs.length; ++i) {
        var out = tx.outs[i];

        var array = out.value.slice();

        array.reverse();

        var val =  new BigInteger(array);

        var out_addresses = [];

        var m = 1;

        try {
            m = out.script.extractAddresses(out_addresses);
        } catch (e) {
            console.log(e);

            out_addresses.push('Unknown Address!');
        }

        $('#rtc-to').append(formatAddresses(m, out_addresses) + ' <font color="green">' + formatBTC(val.toString()) + ' BTC </font><br />');

        total = total.add(val);

        total_fees = total_fees.subtract(val);

        //If it's an escrow transaction we always subtract it from the wallet effect
        //As technically we are not in control of the funds anymore
        if (out_addresses.length > 1) {

            if (!isFirst) {
                basic_str += ' and ';
            }

            basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + formatAddresses(m, out_addresses, true);

            all_txs_to_self = false;

            wallet_effect = wallet_effect.subtract(val);

            //check if it's an address in our wallet
            //If it is then we don't need to subtract it from wallet effect
        } else if (out_addresses.length > 0) {
            var address = out_addresses[0].toString();
            if (addresses[address] == null || addresses[address].tag == 2) {

                if (val.compareTo(BigInteger.ZERO) == 0)
                    continue;

                //Our fees
                if (!isFirst) {
                    basic_str += ' and ';
                }

                if (type && type == 'anonymous') {
                    basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> Anonymously';
                } else {
                    basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + formatAddresses(1, [address], true);
                }

                all_txs_to_self = false;
            } else {
                wallet_effect = wallet_effect.subtract(val);

                amount = amount.add(val);
            }
        }

        isFirst = false;
    }

    if (total_fees.compareTo(BigInteger.valueOf(1).multiply(BigInteger.valueOf(satoshi))) >= 0) {
        alert('Warning fees are very high for this transaction. Please double check each output!');
    }

    if (all_txs_to_self == true) {
        if (privateKeyToSweep == null)
            basic_str = 'move <b>' + formatBTC(total.toString()) + ' BTC</b> between your own bitcoin addresses';
        else
            basic_str = 'claim <b>' + formatBTC(amount.toString()) + ' BTC</b> into your bitcoin wallet';
    }

    $('#rtc-basic-summary').html(basic_str);

    $('#rtc-effect').html("-" + formatBTC(wallet_effect.toString()) + ' BTC');

    $('#rtc-fees').html(formatBTC(total_fees.toString()) + ' BTC');

    $('#rtc-value').html(formatBTC(total.toString()) + ' BTC');
}

function makeArrayOf(value, length) {
    var arr = [], i = length;
    while (i--) {
        arr[i] = value;
    }
    return arr;
}

function stringToBytes ( str ) {
    var ch, st, re = [];
    for (var i = 0; i < str.length; i++ ) {
        ch = str.charCodeAt(i);  // get char
        st = [];                 // set up "stack"
        do {
            st.push( ch & 0xFF );  // push byte to stack
            ch = ch >> 8;          // shift value down by 1 byte
        }
        while ( ch );
        // add stack contents to result
        // done because chars have "wrong" endianness
        re = re.concat( st.reverse() );
    }
    // return an array of bytes
    return re;
}

/*

 pending_transaction {
 change_address : BitcoinAddress
 from_addresses : [String]
 to_addresses : [{address: BitcoinAddress, value : BigInteger}]
 generated_addresses : [String]
 extra_private_keys : {addr : String, priv : ECKey}
 fee : BigInteger
 on_error : function
 on_success : function
 on_ready_to_send : function
 on_before_send : function
 }
 */
function initNewTx() {
    var pending_transaction = {
        generated_addresses : [],
        to_addresses : [],
        fee : BigInteger.ZERO,
        extra_private_keys : [],
        listeners : [],
        is_cancelled : false,
        ask_to_send_anonymously : false,
        base_fee : BigInteger.valueOf(50000),
        addListener : function(listener) {
            this.listeners.push(listener);
        },
        invoke : function (cb, obj, ob2) {
            for (var key in this.listeners) {
                if (this.listeners[key][cb])
                    this.listeners[key][cb].call(this, obj, ob2);
            }
        }, start : function() {
            var self = this;

            try {
                self.invoke('on_start');

                BlockchainAPI.get_unspent(self.from_addresses, function (obj) {
                    try {
                        if (self.is_cancelled) {
                            throw 'Transaction Cancelled';
                        }

                        if (obj.unspent_outputs == null || obj.unspent_outputs.length == 0) {
                            throw 'No Free Outputs To Spend';
                        }

                        self.unspent = [];

                        for (var i = 0; i < obj.unspent_outputs.length; ++i) {
                            var script;
                            try {
                                script = new Bitcoin.Script(Crypto.util.hexToBytes(obj.unspent_outputs[i].script));
                            } catch(e) {
                                makeNotice('error', 'misc-error', 'Error decoding script: ' + e); //Not a fatal error
                                continue;
                            }

                            var out = {script : script,
                                value : BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(obj.unspent_outputs[i].value_hex)),
                                tx_output_n : obj.unspent_outputs[i].tx_output_n,
                                tx_hash : obj.unspent_outputs[i].tx_hash,
                                confirmations : obj.unspent_outputs[i].confirmations
                            };

                            self.unspent.push(out);
                        }

                        self.makeTransaction();
                    } catch (e) {
                        self.error(e);
                    }
                }, function(e) {
                    self.error(e);
                });
            } catch (e) {
                self.error(e);
            }
        },
        //Select Outputs and Construct transaction
        makeTransaction : function() {
            var self = this;

            try {
                if (self.is_cancelled) {
                    throw 'Transaction Cancelled';
                }

                self.selected_outputs = [];

                var txValue = BigInteger.ZERO;

                for (var i = 0; i < self.to_addresses.length; ++i) {
                    txValue = txValue.add(self.to_addresses[i].value);
                }

                var isSweep = (self.to_addresses.length == 0);

                var isEscrow = false;

                //If we have any escrow outputs we increase the fee to 0.05 BTC
                for (var i =0; i < self.to_addresses.length; ++i) {
                    var addrObj = self.to_addresses[i];
                    if (addrObj.m != null) {
                        isEscrow = true;
                        break;
                    }
                }

                var availableValue = BigInteger.ZERO;

                //Add the miners fees
                if (self.fee != null) {
                    txValue = txValue.add(self.fee);
                }

                var priority = 0;
                var addresses_used = [];
                var unspent_watch_only = [];
                var looping_array = self.unspent;

                var forceFee = false;

                for (var i = 0; i < looping_array.length; ++i) {
                    var out = looping_array[i];

                    try {
                        var addr = new Bitcoin.Address(out.script.simpleOutPubKeyHash()).toString();

                        if (addr == null) {
                            throw 'Unable to decode output address from transaction hash ' + out.tx_hash;
                        }

                        if (looping_array != unspent_watch_only) {
                            //When we have reached the last one element add the watch only addresses back in
                            if (i == looping_array.length-1) {
                                //Change the looping array to loop over the watch only
                                looping_array = unspent_watch_only;

                                i = -1;
                            } else if (addresses[addr] != null && addresses[addr].priv == null)  {
                                unspent_watch_only.push(out); //Skip watch only addresses first
                                continue;
                            }
                        }

                        if (self.from_addresses != null && $.inArray(addr, self.from_addresses) == -1) {
                            continue;
                        }

                        var hexhash = Crypto.util.hexToBytes(out.tx_hash);

                        var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(out.tx_hash));

                        var new_in =  new Bitcoin.TransactionIn({outpoint: {hash: b64hash, hexhash: hexhash, index: out.tx_output_n, value:out.value}, script: out.script, sequence: 4294967295});

                        //If the output happens to be greater than tx value then we can make this transaction with one input only
                        //So discard the previous selected outs
                        if (!isSweep && out.value.compareTo(txValue) >= 0) {
                            self.selected_outputs = [new_in];

                            addresses_used = [addr];

                            priority = out.value * out.confirmations;

                            availableValue = out.value;

                            break;
                        } else {
                            //Otherwise we add the value of the selected output and continue looping if we don't have sufficient funds yet
                            self.selected_outputs.push(new_in);

                            addresses_used.push(addr);

                            priority += out.value * out.confirmations;

                            availableValue = availableValue.add(out.value);

                            if (!isSweep && availableValue.compareTo(txValue) >= 0)
                                break;
                        }
                    } catch (e) {
                        //An error, but probably recoverable
                        makeNotice('info', 'tx-error', e);
                    }
                }

                if (availableValue.compareTo(txValue) < 0) {
                    self.error('Insufficient funds. Value Needed ' +  formatBTC(txValue.toString()) + ' BTC. Available amount ' + formatBTC(availableValue.toString()) + ' BTC');
                    return;
                }

                if (self.selected_outputs.length == 0) {
                    self.error('No Available Outputs To Spend.');
                    return;
                }

                var sendTx = new Bitcoin.Transaction();

                for (var i = 0; i < self.selected_outputs.length; i++) {
                    sendTx.addInput(self.selected_outputs[i]);
                }

                var askforfee = false;
                for (var i =0; i < self.to_addresses.length; ++i) {
                    var addrObj = self.to_addresses[i];
                    if (addrObj.m != null) {
                        sendTx.addOutputScript(Bitcoin.Script.createMultiSigOutputScript(addrObj.m, addrObj.pubkeys), addrObj.value);
                    } else {
                        sendTx.addOutput(addrObj.address, addrObj.value);
                    }

                    //If less than 0.01 BTC force fee
                    if (addrObj.value.compareTo(BigInteger.valueOf(1000000)) <= 0) {
                        forceFee = true;
                    }
                }

                //Now deal with the change
                var	changeValue = availableValue.subtract(txValue);
                if (changeValue.compareTo(BigInteger.ZERO) > 0) {
                    if (self.change_address != null) //If change address speicified return to that
                        sendTx.addOutput(self.change_address, changeValue);
                    else if (!isSweep && addresses_used.length > 0) { //Else return to a random from address if specified
                        sendTx.addOutput(new Bitcoin.Address(addresses_used[Math.floor(Math.random() * addresses_used.length)]), changeValue);
                    } else { //Otherwise return to random unarchived
                        sendTx.addOutput(new Bitcoin.Address(getPreferredAddress().addr), changeValue);
                    }

                    //If less than 0.01 BTC force fee
                    if (changeValue.compareTo(BigInteger.valueOf(1000000)) <= 0) {
                        forceFee = true;
                    }
                }

                //Now Add the public note
                /*
                 if (self.note)  {
                 var bytes = stringToBytes('Message: ' + self.note);

                 var ibyte = 0;
                 while (true) {
                 var tbytes = bytes.splice(ibyte, ibyte+120);

                 if (tbytes.length == 0)
                 break;

                 //Must pad to at least 33 bytes
                 //Decode function should strip appending zeros
                 if (tbytes.length < 33) {
                 tbytes = tbytes.concat(makeArrayOf(0, 33-tbytes.length));
                 }

                 sendTx.addOutputScript(Bitcoin.Script.createPubKeyScript(tbytes), BigInteger.ZERO);

                 ibyte += 120;
                 }
                 }  */

                //Estimate scripot sig (Cannot use serialized tx size yet becuase we haven't signed the inputs)
                //18 bytes standard header
                //standard scriptPubKey 24 bytes
                //Stanard scriptSig 64 bytes
                var estimatedSize = sendTx.serialize(sendTx).length + (114 * sendTx.ins.length);

                priority /= estimatedSize;

                var kilobytes = Math.ceil(parseFloat(estimatedSize / 1024));

                var fee_is_zero = (!self.fee || self.fee.compareTo(self.base_fee) < 0);

                //Priority under 57 million requires a 0.0005 BTC transaction fee (see https://en.bitcoin.it/wiki/Transaction_fees)
                if (fee_is_zero && forceFee) {
                    //Forced Fee
                    self.fee = self.base_fee;

                    self.makeTransaction();
                } else if (fee_is_zero && (priority < 57600000 || kilobytes > 1 || isEscrow || askforfee)) {
                    self.ask_for_fee(function() {

                        if (kilobytes > 1) {
                            self.fee = self.base_fee.multiply(BigInteger.valueOf(kilobytes)); //0.0005 BTC * kilobytes + 1
                        } else {
                            self.fee = self.base_fee; //0.0005 BTC
                        }

                        self.makeTransaction();
                    }, function() {
                        self.tx = sendTx;

                        self.determinePrivateKeys(function() {
                            self.signInputs();
                        });
                    });
                } else {
                    self.tx = sendTx;

                    self.determinePrivateKeys(function() {
                        self.signInputs();
                    });
                }
            } catch (e) {
                this.error(e);
            }
        },
        ask_for_fee : function(yes, no) {
            yes();
        },
        determinePrivateKeys: function(success) {
            var self = this;

            try {
                if (self.is_cancelled) {
                    throw 'Transaction Cancelled';
                }

                var tmp_cache = {};

                for (var i in self.selected_outputs) {
                    var connected_script = self.selected_outputs[i].script;

                    if (connected_script.priv_to_use == null) {
                        var pubKeyHash = connected_script.simpleOutPubKeyHash();
                        var inputAddress = new Bitcoin.Address(pubKeyHash).toString();

                        //Find the matching private key
                        if (tmp_cache[inputAddress]) {
                            connected_script.priv_to_use = tmp_cache[inputAddress];
                        } else if (self.extra_private_keys[inputAddress]) {
                            connected_script.priv_to_use = Bitcoin.Base58.decode(self.extra_private_keys[inputAddress]);
                        } else if (addresses[inputAddress] && addresses[inputAddress].priv) {
                            try {
                                connected_script.priv_to_use = decodePK(addresses[inputAddress].priv);
                            } catch (e) {
                                console.log(e);
                            }
                        }

                        if (connected_script.priv_to_use == null) {
                            self.ask_for_private_key(function (key) {
                                try {
                                    if (inputAddress == key.getBitcoinAddress().toString() || inputAddress == key.getBitcoinAddressCompressed().toString()) {
                                        self.extra_private_keys[inputAddress] = Bitcoin.Base58.encode(key.priv);

                                        self.determinePrivateKeys(success); //Try Again
                                    } else {
                                        throw 'The private key you entered does not match the bitcoin address';
                                    }
                                } catch (e) {
                                    self.error(e);
                                }
                            }, function(e) {

                                //Remove the address from the from list
                                self.from_addresses = $.grep(self.from_addresses, function(v) {
                                    return v != inputAddress;
                                });

                                //Remake the transaction without the address
                                self.makeTransaction();

                            }, inputAddress);

                            return false;
                        } else {
                            //Performance optimization
                            //Only Decode the key once sand save it in a temporary cache
                            tmp_cache[inputAddress] = connected_script.priv_to_use;
                        }
                    }
                }

                success();
            } catch (e) {
                self.error(e);
            }
        },
        signWebWorker : function(success, error) {
            try {
                var self = this;
                var nSigned = 0;
                var nWorkers = Math.min(3, self.tx.ins.length);

                self.worker = [];
                for (var i = 0; i < nWorkers; ++i)  {
                    self.worker[i] =  new Worker('/Resources/wallet/signer.min.js');

                    self.worker[i].addEventListener('message', function(e) {
                        var data = e.data;

                        try {
                            switch (data.cmd) {
                                case 'on_sign':
                                    self.invoke('on_sign_progress', parseInt(data.outputN)+1);

                                    self.tx.ins[data.outputN].script  = new Bitcoin.Script(data.script);

                                    ++nSigned;

                                    if (nSigned == self.tx.ins.length) {
                                        self.terminateWorkers();
                                        success();
                                    }

                                    break;
                                case 'on_error': {
                                    throw data.e;
                                }
                            };
                        } catch (e) {
                            self.terminateWorkers();
                            self.error(e);
                        }
                    }, false);

                    self.worker[i].addEventListener('error', function(e) {
                        error(e);
                    });
                }

                for (var outputN in self.selected_outputs) {
                    var connected_script = self.selected_outputs[outputN].script;
                    self.worker[outputN % nWorkers].postMessage({cmd : 'sign_input', tx : self.tx, outputN : outputN, priv_to_use : connected_script.priv_to_use, connected_script : connected_script});
                }
            } catch (e) {
                error(e);
            }
        },
        signNormal : function(success, error) {
            var self = this;
            var outputN = 0;

            signOne = function() {
                setTimeout(function() {
                    if (self.is_cancelled) {
                        error();
                        return;
                    }

                    try {
                        self.invoke('on_sign_progress', outputN+1);

                        var connected_script = self.selected_outputs[outputN].script;

                        var signed_script = signInput(self.tx, outputN, connected_script.priv_to_use, connected_script);

                        if (signed_script) {
                            self.tx.ins[outputN].script = signed_script;

                            ++outputN;

                            if (outputN == self.tx.ins.length) {
                                success();
                            } else {
                                signOne(); //Sign The Next One
                            }
                        } else {
                            throw 'Unknown error signing transaction';
                        }
                    } catch (e) {
                        error(e);
                    }

                }, 1);
            };

            signOne();
        },
        signInputs : function() {
            var self = this;

            try {
                self.invoke('on_begin_signing');

                var success = function() {
                    self.invoke('on_finish_signing');

                    self.is_ready = true;
                    self.ask_to_send();
                };

                self.signWebWorker(success, function(e) {
                    console.log(e);
                    self.signNormal(success, function(e){
                        self.error(e);
                    });
                });
            } catch (e) {
                self.error(e);
            }
        },
        terminateWorkers : function() {
            if (this.worker) {
                for (var i in this.worker)  {
                    try {
                        this.worker[i].terminate();
                    } catch (e) { }
                }
            }
        },
        cancel : function() {
            if (!this.has_pushed) {
                this.terminateWorkers();
                this.error('Transaction Cancelled');
            }
        },
        send : function() {
            var self = this;

            if (self.is_cancelled) {
                self.error('This transaction has already been cancelled');
                return;
            }

            if (!self.is_ready) {
                self.error('Transaction is not ready to send yet');
                return;
            }

            self.invoke('on_before_send');

            if (self.generated_addresses.length > 0) {
                self.has_saved_addresses = true;

                backupWallet('update', function() {
                    self.pushTx();
                }, function() {
                    self.error('Error Backing Up Wallet. Cannot Save Newly Generated Keys.')
                });
            } else {
                self.pushTx();
            }
        },
        pushTx : function() {
            var self = this;

            if (self.is_cancelled) //Only call once
                return;

            self.has_pushed = true;

            BlockchainAPI.push_tx(self.tx, self.note, function(response) {
                self.success(response);
            }, function(response) {
                self.error(response);
            });
        },
        ask_for_private_key : function(success, error) {
            error('Cannot ask for private key without user interaction disabled');
        },
        ask_to_send : function() {
            this.send(); //By Defualt Just Send
        },
        error : function(error) {
            if (this.is_cancelled) //Only call once
                return;

            this.is_cancelled = true;

            if (!this.has_pushed && this.generated_addresses.length > 0) {
                //When an error occurs during send (or user cancelled) we need to remove the addresses we generated
                for (var key in this.generated_addresses) {
                    internalDeleteAddress(this.generated_addresses[key]);
                }

                if (this.has_saved_addresses)
                    backupWallet();
            }

            this.invoke('on_error', error);
        },
        success : function() {
            this.invoke('on_success');
        }
    };

    var base_listener = {
        on_error : function(e) {
            if(e)
                makeNotice('error', 'tx-error', e);

            $('.send').attr('disabled', false);
        },
        on_success : function(e) {
            try {
                $('.send').attr('disabled', false);
            } catch (e) {
                console.log(e);
            }
        },
        on_start : function(e) {
            $('.send').attr('disabled', true);
        },
        on_begin_signing : function() {
            this.start = new Date().getTime();
        },
        on_finish_signing : function() {
            console.log('Took ' + (new Date().getTime() - this.start) + 'ms');
        }
    };

    pending_transaction.addListener(base_listener);

    return pending_transaction;
}