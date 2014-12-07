function exceptionToString(err) {
    var vDebug = "";
    for (var prop in err)  {
        vDebug += "property: "+ prop+ " value: ["+ err[prop]+ "]\n";
    }
    return "toString(): " + " value: [" + err.toString() + "]";
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

            var eckey = new Bitcoin.ECKey(bytes);

            if (MyWallet.addPrivateKey(eckey))
                return {key : eckey, miniKey : minikey};
        }
    }
}

function IsCanonicalSignature(vchSig) {
    if (vchSig.length < 9)
        throw 'Non-canonical signature: too short';
    if (vchSig.length > 73)
        throw 'Non-canonical signature: too long';
    var nHashType = vchSig[vchSig.length - 1];
    if (nHashType != SIGHASH_ALL && nHashType != SIGHASH_NONE && nHashType != SIGHASH_SINGLE && nHashType != SIGHASH_ANYONECANPAY)
        throw 'Non-canonical signature: unknown hashtype byte ' + nHashType;
    if (vchSig[0] != 0x30)
        throw 'Non-canonical signature: wrong type';
    if (vchSig[1] != vchSig.length-3)
        throw 'Non-canonical signature: wrong length marker';
    var nLenR = vchSig[3];
    if (5 + nLenR >= vchSig.length)
        throw 'Non-canonical signature: S length misplaced';
    var nLenS = vchSig[5+nLenR];
    if (nLenR+nLenS+7 != vchSig.length)
        throw 'Non-canonical signature: R+S length mismatch';

    var n = 4;
    if (vchSig[n-2] != 0x02)
        throw 'Non-canonical signature: R value type mismatch';
    if (nLenR == 0)
        throw 'Non-canonical signature: R length is zero';
    if (vchSig[n+0] & 0x80)
        throw 'Non-canonical signature: R value negative';
    if (nLenR > 1 && (vchSig[n+0] == 0x00) && !(vchSig[n+1] & 0x80))
        throw 'Non-canonical signature: R value excessively padded';

    var n = 6+nLenR;
    if (vchSig[n-2] != 0x02)
        throw 'Non-canonical signature: S value type mismatch';
    if (nLenS == 0)
        throw 'Non-canonical signature: S length is zero';
    if (vchSig[n+0] & 0x80)
        throw 'Non-canonical signature: S value negative';
    if (nLenS > 1 && (vchSig[n+0] == 0x00) && !(vchSig[n+1] & 0x80))
        throw 'Non-canonical signature: S value excessively padded';

    return true;
}


try {
//Init WebWorker
//Window is not defined in WebWorker
    if (typeof window == "undefined" || !window) {
        var window = {};

        self.addEventListener('message', function(e) {
            var data = e.data;
            try {
                switch (data.cmd) {
                    case 'seed':
                        var word_array = Crypto.util.bytesToWords(Crypto.util.hexToBytes(data.seed));

                        for (var i in word_array) {
                            rng_seed_int(word_array[i]);
                        }
                        break;
                    case 'decrypt':
                        var decoded = Crypto.AES.decrypt(data.data, data.password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : data.pbkdf2_iterations});

                        self.postMessage({cmd : 'on_decrypt', data : decoded});

                        break;
                    case 'load_resource':
                        importScripts(data.path);
                        break;
                    case 'sign_input':
                        var tx = new Bitcoin.Transaction(data.tx);

                        var connected_script = new Bitcoin.Script(data.connected_script);

                        var signed_script = signInput(tx, data.outputN, data.priv_to_use, connected_script);

                        if (signed_script) {
                            self.postMessage({cmd : 'on_sign', script : signed_script, outputN : data.outputN});
                        } else {
                            throw 'Unknown Error Signing Script ' + data.outputN;
                        }
                        break;
                    default:
                        throw 'Unknown Command';
                };
            } catch (e) {
                self.postMessage({cmd : 'on_error', e : exceptionToString(e)});
            }
        }, false);
    }
} catch (e) { }

function showPrivateKeyModal(success, error, addr) {

    var modal = $('#private-key-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.center();

    modal.find('.address').text(addr);

    var scanned_key = null;
    var compressed = false;
    var error_msg = null;
    var key_input = modal.find('input[name="key"]');

    key_input.val('');

    modal.find('.qrcodeicon span').click(function() {
        modal.modal('hide');

        MyWallet.scanQRCode(function(code) {
            console.log('Scanned ' + code);

            modal.modal('show');

            key_input.val(code);

            modal.find('.btn.btn-primary').trigger('click');
        }, function(e) {
            modal.modal('show');

            MyWallet.makeNotice('error', 'misc-error', e);
        });
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        var value = $.trim(key_input.val());

        try {
            if (value.length == 0) {
                throw  'You must enter a private key to import';
            }

            var format = MyWallet.detectPrivateKeyFormat(value);

            console.log('PK Format ' + format);

            if (format == 'bip38') {
                modal.modal('hide');

                loadScript('wallet/import-export', function() {
                    MyWallet.getPassword($('#import-private-key-password'), function(_password) {
                        ImportExport.parseBIP38toECKey(value, _password, function(key, isCompPoint) {
                            scanned_key = key;
                            compressed = isCompPoint;

                            modal.modal('hide');

                            if (scanned_key)
                                success(scanned_key);
                            else
                                error(error_msg);

                        }, error);
                    }, error);
                }, error);

                return;
            }

            scanned_key = MyWallet.privateKeyStringToKey(value, format);
            compressed = (format == 'compsipa');

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

    var address_book = MyWallet.getAddressBook();
    for (var key in address_book) {
        var a_label = MyWallet.getAddressBookLabel(key);
        if (a_label.toLowerCase() == label) {
            return $.trim(key);
        }
    }

    var addresses = MyWallet.getAllAddresses();
    for (var i = 0; i < addresses.length; ++i) {
        var key = addresses[i];
        var a_label = MyWallet.getAddressLabel(key);
        if (a_label && a_label.toLowerCase() == label)
            return key;
    }

    return null;
}


//Check for inputs and get unspent for before signing
function startTxUI(el, type, pending_transaction, dont_ask_for_anon) {

    function resetForm() {
        el.find('input[name="send-value"]').val('');
        el.find('input[name="send-to-address"]').val('');
    }

    try {
        el.find('input,select,button').prop('disabled', true);

        pending_transaction.addListener({
            on_success : function(e) {
                el.find('input,select,button').prop('disabled', false);
            },
            on_start : function(e) {
                el.find('input,select,button').prop('disabled', true);
            },
            on_error : function(e) {
                el.find('input,select,button').prop('disabled', false);
            }
        });

        var total_value = 0;
        el.find('input[name="send-value"]').each(function() {
            total_value += parseFloat($(this).val());
        });

        var custom_ask_for_fee = true;
        if (total_value > precisionFromBTC(10)) {
            if (type == 'email' || type == 'sms') {
                throw 'Cannot Send More Than 10 BTC via email or sms';
            } else if (type == 'quick') { //Any quick transactions over 10 BTC make them custom
                type = 'custom';
                custom_ask_for_fee = false;
            }
        } else if (type == 'shared' && total_value < precisionFromBTC(0.1)) {
            throw 'The Minimum Amount You Can Send Shared is ' + formatPrecision(precisionFromBTC(0.1));
        } else if (type == 'shared' && total_value > precisionFromBTC(250)) {
            throw 'The Maximum Amount You Can Send Shared is ' +  formatPrecision(precisionFromBTC(250));
        }


        if (type == 'custom' || type == 'shared') {

            var listener = {
                on_error : function(e) {
                    if (this.modal)
                        this.modal.modal('hide');
                },
                on_success : function() {
                    resetForm();
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
                    this.modal.find('.btn.btn-primary').prop('disabled', true);

                    this.modal.find('.btn.btn-primary').text('Send Transaction');

                    this.modal.find('.btn.btn-secondary').unbind().click(function() {
                        if (self.modal)
                            self.modal.modal('hide');

                        self.cancel();
                    });
                },
                on_begin_signing : function() {
                    $('#tx-sign-progress').show().find('.t').text(this.tx.ins.length);
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

                    if (self.modal)
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
                        if (self.modal)
                            self.modal.modal('show'); //Show the progress modal again
                    });
                };

                pending_transaction.ask_to_increase_fee = function(yes, no, customFee, recommendedFee) {
                    var self = this;

                    if (self.modal)
                        self.modal.modal('hide'); //Hide the transaction progress modal

                    var modal = $('#ask-to-increase-fee');

                    modal.modal({
                        keyboard: false,
                        backdrop: "static",
                        show: true
                    });

                    var modal_body = modal.find('.modal-body');

                    var spans = modal_body.find('span');

                    spans.eq(0).text(formatSymbol(customFee.intValue(), symbol_btc));

                    spans.eq(1).text(formatSymbol(recommendedFee.intValue(), symbol_btc));

                    modal.find('.btn.btn-primary').unbind().click(function() {
                        modal.modal('hide');

                        yes();
                    });

                    modal.find('.btn.btn-secondary').unbind().click(function() {
                        modal.modal('hide');

                        no();
                    });

                    modal.unbind().on('hidden', function () {
                        if (self.modal)
                            self.modal.modal('show'); //Show the progress modal again
                    });
                };
            }

            pending_transaction.ask_to_send = function() {
                var self = this;
                try {
                    self.modal.find('.modal-header h3').html(self.ready_to_send_header);

                    self.modal.find('#missing-private-key').hide();

                    self.modal.find('#review-tx').show();

                    setReviewTransactionContent(self.modal, self.tx, self.type);

                    setAdv(false);

                    self.modal.center();

                    //We have the transaction ready to send, check if were online or offline
                    var btn = self.modal.find('.btn.btn-primary');

                    MyWallet.setLoadingText('Checking Connectivity');

                    $.ajax({
                        timeout: 60000,
                        type: "GET",
                        url: root + 'ping',
                        data : {format : 'plain', date : new Date().getTime()},
                        success: function() {
                            btn.removeAttr('disabled');

                            btn.text('Send Transaction');

                            btn.unbind().click(function() {
                                btn.prop('disabled', true);

                                if (self.modal)
                                    self.modal.modal('hide');

                                self.send();
                            });
                        },
                        error : function() {
                            self.modal.find('.modal-header h3').html('Created Offline Transaction.');

                            btn.removeAttr('disabled');

                            btn.text('Show Offline Instructions');

                            btn.unbind().click(function() {

                                btn.prop('disabled', true);

                                self.modal.find('#missing-private-key').hide();
                                self.modal.find('#review-tx').hide();
                                self.modal.find('.offline-transaction').show();

                                var s = self.tx.serialize();

                                var hex = Crypto.util.bytesToHex(s);

                                self.modal.find('.offline-transaction textarea[name="data"]').val(hex);
                            });

                            self.modal.center();
                        }
                    });
                } catch (e) {
                    self.error(e);
                }
            };
        } else if (type == 'quick' || type == 'email' || type == 'dice' || type == 'sms') {
            var listener = {
                on_error : function(e) {
                    el.find('.send').show();
                    if (this.p)
                        this.p.hide();
                },
                on_success : function() {
                    try {
                        el.find('.send').show();

                        if (type != 'dice') {
                            resetForm();
                        }

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

            if (type == 'sms') {
                pending_transaction.ask_to_send = function() {
                    try {
                        var self = this;

                        MyWallet.securePost('send-via', {
                            type : 'sms',
                            to : self.sms_data.number,
                            priv : self.sms_data.miniKey,
                            hash : Crypto.util.bytesToHex(self.tx.getHash().reverse())
                        }, function() {
                            self.send();
                        }, function(data) {
                            self.error(data ? data.responseText : null);
                        });
                    } catch (e) {
                        self.error(e);
                    }
                };
            } else if (type == 'email') {
                pending_transaction.ask_to_send = function() {
                    var self = this;

                    var modal = $('#send-email-modal');

                    try {
                        MyWallet.securePost("wallet", { method : 'get-info', format : 'json' }, function(data) {
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
                                    from_name = 'Shared'

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
                                        MyWallet.securePost('send-via', {
                                            type : 'email',
                                            to : self.email_data.email,
                                            priv : self.email_data.priv,
                                            hash : Crypto.util.bytesToHex(self.tx.getHash().reverse())
                                        }, function(data) {
                                            self.send();
                                        }, function(data) {
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
                        }, function(e) {
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
        pending_transaction.insufficient_funds = function(amount_required, amount_available, yes, no) {
            var self = this;

            if (self.modal)
                self.modal.modal('hide'); //Hide the transaction progress modal

            var modal = $('#insufficient-funds');


            modal.find('.amount-required').text(formatBTC(amount_required));

            modal.find('.amount-available').text(formatBTC(amount_available));

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
                if (self.modal)
                    self.modal.modal('show'); //Show the progress modal again
            });
        };

        //Modal for when private key is missing (Watch Only)
        pending_transaction.ask_for_private_key = function(success, error, addr) {
            var self = this;

            if (self.modal)
                self.modal.modal('hide'); //Hide the transaction progress modal

            showPrivateKeyModal(function(key, compressed) {
                if (self.modal)
                    self.modal.modal('show'); //Show the progress modal again

                success(key, compressed);
            }, function (e) {
                if (self.modal)
                    self.modal.modal('show'); //Show the progress modal again

                error(e);
            }, addr)
        };

        pending_transaction.type = type;

        //Default is 0.0001 Base Fee, No fee
        if (MyWallet.getFeePolicy() == 1) {
            pending_transaction.base_fee = BigInteger.valueOf(100000); //0.001 BTC
            pending_transaction.fee = BigInteger.valueOf(100000); //0.001 BTC
        } else if (MyWallet.getFeePolicy() == -1) {
            pending_transaction.base_fee = BigInteger.valueOf(10000); //0.0001 BTC
            pending_transaction.ask_for_fee = function(yes, no) {
                no();
            };
        }

        MyWallet.getSecondPassword(function() {
            try {
                //Get the from address, if any
                var from_select = el.find('select[name="from"]');
                var fromval = from_select.val();
                if (fromval == null || fromval == 'any') {
                    pending_transaction.from_addresses = MyWallet.getActiveAddresses();
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

                var changeAddressVal = $.trim(el.find('select[name="change"]').val());

                if (changeAddressVal.length > 0) {
                    if (changeAddressVal == 'new') {
                        var key = MyWallet.generateNewKey();

                        var bitcoin_address = key.getBitcoinAddress();

                        pending_transaction.change_address = bitcoin_address;

                        pending_transaction.generated_addresses.push(bitcoin_address.toString());

                    } else if (changeAddressVal != 'any') {
                        try {
                            pending_transaction.change_address = new Bitcoin.Address(changeAddressVal);
                        } catch (e) {
                            throw 'Invalid change address: ' + e;
                        };
                    }
                }

                var input_fee_string = el.find('input[name="fees"]').val();
                if (input_fee_string != null && input_fee_string.length > 0) {
                    var input_fee = precisionToSatoshiBN(input_fee_string);
                    if (input_fee.compareTo(BigInteger.ZERO) >= 0) {
                        pending_transaction.fee = input_fee;
                        pending_transaction.did_specify_fee_manually = true;
                    }
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
                        var send_to_sms_input = child.find('input[name="send-to-sms"]');

                        var value = 0;
                        try {
                            value = precisionToSatoshiBN(value_input.val());

                            if (value == null || value.compareTo(BigInteger.ZERO) <= 0)
                                throw 'You must enter a value greater than zero';
                        } catch (e) {
                            console.log(e);

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

                                if (type == 'shared') {
                                    if (!address) {
                                        throw 'Invalid Bitcoin Address';
                                    }

                                    MyWallet.setLoadingText('Creating Forwarding Address');

                                    MyWallet.securePost("forwarder", { action : "create-mix", address : address, shared : true, format : 'json'}, function(obj) {
                                        try {
                                            if (obj.destination != address) {
                                                throw 'Mismatch between requested and returned destination address';
                                            }

                                            if (obj.fee_percent != MyWallet.getMixerFee()) {
                                                MyWallet.get_history();

                                                throw 'The mixer fee may have changed';
                                            }

                                            pending_transaction.to_addresses.push({address: new Bitcoin.Address(obj.input_address), value : value});

                                            //Call again now we have got the forwarding address
                                            try_continue();
                                        } catch (e) {
                                            pending_transaction.error(e);
                                        }
                                    }, function(data) {
                                        pending_transaction.error(data ? data.responseText : null);
                                    });
                                } else {
                                    if (address) {
                                        pending_transaction.to_addresses.push({address: new Bitcoin.Address(address), value : value});
                                    } else if (send_to_address.length < 10) {
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
                                    } else {
                                        pending_transaction.error('Invalid to address: ' + send_to_address);
                                    }
                                }
                            }
                        } else if (send_to_sms_input.length > 0) {
                            var mobile_number = $.trim(send_to_sms_input.val());

                            if (mobile_number.charAt(0) == '0')
                                mobile_number = mobile_number.substring(1);

                            if (mobile_number.charAt(0) != '+')
                                mobile_number = '+' + child.find('select[name="sms-country-code"]').val() + mobile_number;

                            //Send to email address
                            var miniKeyAddrobj = generateNewMiniPrivateKey();

                            //Fetch the newly generated address
                            var address = miniKeyAddrobj.key.getBitcoinAddress().toString();

                            //Archive the address
                            MyWallet.setAddressTag(address, 2);

                            MyWallet.setAddressLabel(address, mobile_number + ' Sent Via SMS');

                            pending_transaction.generated_addresses.push(address);

                            pending_transaction.to_addresses.push({address: new Bitcoin.Address(address), value : value});

                            if (pending_transaction.sms_data)
                                throw 'Cannot send to more than one SMS recipient at a time';

                            pending_transaction.sms_data = {
                                number : mobile_number,
                                miniKey:  miniKeyAddrobj.miniKey
                            };
                        } else if (send_to_email_input.length > 0) {
                            //Send to email address

                            var send_to_email = $.trim(send_to_email_input.val());

                            function validateEmail(str) {
                                var lastAtPos = str.lastIndexOf('@');
                                var lastDotPos = str.lastIndexOf('.');
                                return (lastAtPos < lastDotPos && lastAtPos > 0 && str.indexOf('@@') == -1 && lastDotPos > 2 && (str.length - lastDotPos) > 2);
                            }

                            if (validateEmail(send_to_email)) {
                                //Send to email address
                                var key = MyWallet.generateNewKey();

                                //Fetch the newly generated address
                                var address = key.getBitcoinAddress().toString();

                                //Archive the address
                                MyWallet.setAddressTag(address, 2);

                                MyWallet.setAddressLabel(address, send_to_email + ' Sent Via Email');

                                pending_transaction.generated_addresses.push(address);

                                pending_transaction.to_addresses.push({address: new Bitcoin.Address(address), value : value});

                                if (pending_transaction.email_data)
                                    throw 'Cannot send to more than one email recipient at a time';

                                pending_transaction.email_data = {
                                    email : send_to_email,
                                    priv : B58.encode(key.priv),
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
        }, function() {
            pending_transaction.error();
        });
    } catch (e) {
        pending_transaction.error(e);
    }

    return pending_transaction;
};


function signInput(tx, inputN, base58Key, connected_script, type) {

    type = type ? type : SIGHASH_ALL;

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

    var hash = tx.hashTransactionForSignature(connected_script, inputN, type);

    var rs = key.sign(hash);

    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    // Append hash type
    signature.push(type);

    if (!IsCanonicalSignature(signature)) {
        throw 'IsCanonicalSignature returned false';
    }

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

        if (resolve_labels && MyWallet.addressExists(addr_string) && MyWallet.getAddressLabel(addr_string))
            str = MyWallet.getAddressLabel(addr_string);
        else if (resolve_labels && MyWallet.getAddressBookLabel(addr_string))
            str = MyWallet.getAddressBookLabel(addr_string);
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

        $('#rtc-from').append(addr + ' <font color="green">' + formatBTC(input.outpoint.value.toString()) + ' <br />');
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

        $('#rtc-to').append(formatAddresses(m, out_addresses) + ' <font color="green">' + formatBTC(val.toString()) + ' </font><br />');

        total = total.add(val);

        total_fees = total_fees.subtract(val);

        //If it's an escrow transaction we always subtract it from the wallet effect
        //As technically we are not in control of the funds anymore
        if (out_addresses.length > 1) {

            if (!isFirst) {
                basic_str += ' and ';
            }

            basic_str += '<b>' + formatBTC(val.toString())  + '</b> to ' + formatAddresses(m, out_addresses, true);

            all_txs_to_self = false;

            wallet_effect = wallet_effect.subtract(val);

            //check if it's an address in our wallet
            //If it is then we don't need to subtract it from wallet effect
        } else if (out_addresses.length > 0) {
            var address = out_addresses[0].toString();
            if (!MyWallet.addressExists(address)|| MyWallet.getAddressTag(address) == 2) {

                if (val.compareTo(BigInteger.ZERO) == 0)
                    continue;

                //Our fees
                if (!isFirst) {
                    basic_str += ' and ';
                }

                if (type && type == 'shared') {
                    basic_str += '<b>' + formatBTC(val.toString())  + '</b> Shared';
                } else {
                    basic_str += '<b>' + formatBTC(val.toString())  + '</b> to ' + formatAddresses(1, [address], true);
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
        basic_str = 'move <b>' + formatBTC(total.toString()) + '</b> between your own bitcoin addresses';
    }

    $('#rtc-basic-summary').html(basic_str);

    $('#rtc-effect').html("-" + formatBTC(wallet_effect.toString()));

    $('#rtc-fees').html(formatBTC(total_fees.toString()));

    $('#rtc-value').html(formatBTC(total.toString()));
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
        extra_private_keys : {},
        listeners : [],
        is_cancelled : false,
        base_fee : BigInteger.valueOf(10000),
        min_free_output_size : BigInteger.valueOf(1000000),
        min_non_standard_output_size : BigInteger.valueOf(5460),
        allow_adjust : true,
        ready_to_send_header : 'Transaction Ready to Send.',
        min_input_confirmations : 0,
        do_not_use_unspent_cache : false,
        min_input_size : BigInteger.ZERO,
        did_specify_fee_manually : false,
        addListener : function(listener) {
            this.listeners.push(listener);
        },
        invoke : function (cb, obj, ob2) {
            for (var key in this.listeners) {
                try {
                    if (this.listeners[key][cb])
                        this.listeners[key][cb].call(this, obj, ob2);
                } catch(e) {
                    console.log(e);
                }
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

                                if (script.getOutType() == 'Strange')
                                    throw 'Strange Script';

                            } catch(e) {
                                MyWallet.makeNotice('error', 'misc-error', 'Error decoding script: ' + e); //Not a fatal error
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
                }, self.min_input_confirmations, self.do_not_use_unspent_cache);
            } catch (e) {
                self.error(e);
            }
        },
        isSelectedValueSufficient : function(txValue, availableValue) {
            return availableValue.compareTo(txValue) == 0 || availableValue.compareTo(txValue.add(this.min_free_output_size)) >= 0;
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

                var availableValue = BigInteger.ZERO;

                //Add the miners fees
                if (self.fee != null) {
                    txValue = txValue.add(self.fee);
                }

                var priority = 0;
                var addresses_used = [];
                var forceFee = false;

                //First try without including watch only
                //If we don't have enough funds ask for the watch only private key
                var unspent_copy = self.unspent.slice(0);
                function parseOut(out) {
                    var addr = new Bitcoin.Address(out.script.simpleOutPubKeyHash()).toString();

                    if (addr == null) {
                        throw 'Unable to decode output address from transaction hash ' + out.tx_hash;
                    }

                    if (out.script == null) {
                        throw 'Output script is null (' + out.tx_hash + ':' + out.tx_output_n + ')';
                    }

                    var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(out.tx_hash));

                    var input = new Bitcoin.TransactionIn({outpoint: {hash: b64hash, index: out.tx_output_n, value:out.value}, script: out.script, sequence: 4294967295});

                    return {addr : addr , input : input}
                };

                //Loop once without watch only, then again with watch only
                var includeWatchOnly = false;
                while(true) {
                    for (var i = 0; i < unspent_copy.length; ++i) {
                        var out = unspent_copy[i];

                        if (!out) continue;

                        try {
                            var addr_input_obj = parseOut(out);

                            if (!includeWatchOnly && MyWallet.isWatchOnly(addr_input_obj.addr)) {
                                continue;
                            }

                            if (self.from_addresses != null && $.inArray(addr_input_obj.addr, self.from_addresses) == -1) {
                                continue;
                            }

                            //Ignore inputs less than min_input_size
                            if (out.value.compareTo(self.min_input_size) < 0) {
                                continue;
                            }

                            //If the output happens to be greater than tx value then we can make this transaction with one input only
                            //So discard the previous selected outs
                            //out.value.compareTo(self.min_free_output_size) >= 0 because we want to prefer a change output of greater than 0.01 BTC
                            //Unless we have the extact tx value
                            if (out.value.compareTo(txValue) == 0 || self.isSelectedValueSufficient(txValue, out.value)) {
                                self.selected_outputs = [addr_input_obj.input];

                                unspent_copy[i] = null; //Mark it null so we know it is used

                                addresses_used = [addr_input_obj.addr];

                                priority = out.value.intValue() * out.confirmations;

                                availableValue = out.value;

                                break;
                            } else {
                                //Otherwise we add the value of the selected output and continue looping if we don't have sufficient funds yet
                                self.selected_outputs.push(addr_input_obj.input);

                                unspent_copy[i] = null; //Mark it null so we know it is used

                                addresses_used.push(addr_input_obj.addr);

                                priority += out.value.intValue() * out.confirmations;

                                availableValue = availableValue.add(out.value);

                                if (self.isSelectedValueSufficient(txValue, availableValue))
                                    break;
                            }
                        } catch (e) {
                            //An error, but probably recoverable
                            MyWallet.makeNotice('info', 'tx-error', e);
                        }
                    }

                    if (self.isSelectedValueSufficient(txValue, availableValue))
                        break;

                    if (includeWatchOnly)
                        break;

                    includeWatchOnly = true;
                }

                function insufficientError() {
                    self.error('Insufficient funds. Value Needed ' +  formatBTC(txValue.toString()) + '. Available amount ' + formatBTC(availableValue.toString()));
                }

                var difference = availableValue.subtract(txValue);
                if (difference.compareTo(BigInteger.ZERO) < 0) {
                    //Can only adjust when there is one recipient
                    if (self.to_addresses.length == 1 && availableValue.compareTo(BigInteger.ZERO) > 0 && self.allow_adjust) {
                        self.insufficient_funds(txValue, availableValue, function() {

                            //Subtract the difference from the to address
                            var adjusted = self.to_addresses[0].value.add(difference);
                            if (adjusted.compareTo(BigInteger.ZERO) > 0 && adjusted.compareTo(txValue) <= 0) {
                                self.to_addresses[0].value = adjusted;

                                self.makeTransaction();

                                return;
                            } else {
                                insufficientError();
                            }
                        }, function() {
                            insufficientError();
                        });
                    } else {
                        insufficientError();
                    }

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

                for (var i =0; i < self.to_addresses.length; ++i) {
                    var addrObj = self.to_addresses[i];
                    if (addrObj.m != null) {
                        sendTx.addOutputScript(Bitcoin.Script.createMultiSigOutputScript(addrObj.m, addrObj.pubkeys), addrObj.value);
                    } else {
                        sendTx.addOutput(addrObj.address, addrObj.value);
                    }

                    //If less than 0.01 BTC force fee
                    if (addrObj.value.compareTo(self.min_free_output_size) < 0) {
                        forceFee = true;
                    }
                }

                //Now deal with the change
                var	changeValue = availableValue.subtract(txValue);

                //Consume the change if it would create a very small none standard output
                //Perhaps this behaviour should be user specified
                if (changeValue.compareTo(self.min_non_standard_output_size) > 0) {
                    if (self.change_address != null) //If change address specified return to that
                        sendTx.addOutput(self.change_address, changeValue);
                    else if (addresses_used.length > 0) { //Else return to a random from address if specified
                        sendTx.addOutput(new Bitcoin.Address(addresses_used[Math.floor(Math.random() * addresses_used.length)]), changeValue);
                    } else { //Otherwise return to random unarchived
                        sendTx.addOutput(new Bitcoin.Address(MyWallet.getPreferredAddress()), changeValue);
                    }

                    //If less than 0.01 BTC force fee
                    if (changeValue.compareTo(self.min_free_output_size) < 0) {
                        forceFee = true;
                    }
                }

                //Now Add the public note
                /*

                 function makeArrayOf(value, length) {
                 var arr = [], i = length;
                 while (i--) {
                 arr[i] = value;
                 }
                 return arr;
                 }

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
                var estimatedSize = sendTx.serialize(sendTx).length + (138 * sendTx.ins.length);

                priority /= estimatedSize;

                var kilobytes = Math.max(1, Math.ceil(parseFloat(estimatedSize / 1000)));

                var fee_is_zero = (!self.fee || self.fee.compareTo(self.base_fee) < 0);

                var set_fee_auto = function() {
                    //Forced Fee
                    self.fee = self.base_fee.multiply(BigInteger.valueOf(kilobytes));

                    self.makeTransaction();
                }

                //Priority under 57 million requires a 0.0005 BTC transaction fee (see https://en.bitcoin.it/wiki/Transaction_fees)
                if (fee_is_zero && (forceFee || kilobytes > 1)) {
                    if (self.fee && self.did_specify_fee_manually) {
                        self.ask_to_increase_fee(function() {
                            set_fee_auto();
                        }, function() {
                            self.tx = sendTx;

                            self.determinePrivateKeys(function() {
                                self.signInputs();
                            });
                        }, self.fee, self.base_fee.multiply(BigInteger.valueOf(kilobytes)));
                    } else {
                        //Forced Fee
                        set_fee_auto();
                    }
                } else if (fee_is_zero && (MyWallet.getRecommendIncludeFee() || priority < 77600000)) {
                    self.ask_for_fee(function() {
                        set_fee_auto();
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
        ask_to_increase_fee : function(yes, no, customFee, recommendedFee) {
            yes();
        },
        insufficient_funds : function(amount_required, amount_available, yes, no) {
            no();
        },
        determinePrivateKeys: function(success) {
            var self = this;

            try {
                if (self.is_cancelled) {
                    throw 'Transaction Cancelled';
                }

                if (self.selected_outputs.length != self.tx.ins.length) {
                   throw 'Selected Outputs Count != Tx Inputs Length'
                }

                var tmp_cache = {};

                for (var i = 0; i < self.selected_outputs.length; ++i) {
                    var connected_script = self.selected_outputs[i].script;

                    if (connected_script == null) {
                        console.log('Output:')
                        console.log(self.selected_outputs[i]);
                        throw 'determinePrivateKeys() Connected script is null';
                    }

                    if (connected_script.priv_to_use == null) {
                        var pubKeyHash = connected_script.simpleOutPubKeyHash();
                        var inputAddress = new Bitcoin.Address(pubKeyHash).toString();

                        //Find the matching private key
                        if (tmp_cache[inputAddress]) {
                            connected_script.priv_to_use = tmp_cache[inputAddress];
                        } else if (self.extra_private_keys && self.extra_private_keys[inputAddress]) {
                            connected_script.priv_to_use = Bitcoin.Base58.decode(self.extra_private_keys[inputAddress]);
                        } else if (MyWallet.addressExists(inputAddress) && !MyWallet.isWatchOnly(inputAddress)) {
                            try {
                                connected_script.priv_to_use = MyWallet.decodePK(MyWallet.getPrivateKey(inputAddress));
                            } catch (e) {
                                console.log(e);
                            }
                        }

                        if (connected_script.priv_to_use == null) {
                            //No private key found, ask the user to provide it
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
                                //User did not provide it, try and re-construct without it
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
        signWebWorker : function(success, _error) {
            var didError = false;
            var error = function(e) {
                if (!didError) { _error(e); didError = true; }
            }

            try {
                var self = this;
                var nSigned = 0;
                var nWorkers = Math.min(3, self.tx.ins.length);
                var rng = new SecureRandom();

                self.worker = [];
                for (var i = 0; i < nWorkers; ++i)  {
                    self.worker[i] =  new Worker(MyWallet.getWebWorkerLoadPrefix() + 'signer' + (min ? '.min.js' : '.js'));

                    self.worker[i].addEventListener('message', function(e) {
                        var data = e.data;

                        try {
                            switch (data.cmd) {
                                case 'on_sign':
                                    self.invoke('on_sign_progress', parseInt(data.outputN)+1);

                                    self.tx.ins[data.outputN].script = new Bitcoin.Script(data.script);

                                    ++nSigned;

                                    if (nSigned == self.tx.ins.length) {
                                        self.terminateWorkers();
                                        success();
                                    }

                                    break;
                                case 'on_message': {
                                    console.log(data.message);
                                    break;
                                }
                                case 'on_error': {
                                    throw data.e;
                                }
                            };
                        } catch (e) {
                            self.terminateWorkers();
                            error(e);
                        }
                    }, false);

                    self.worker[i].addEventListener('error', function(e) {
                        error(e);
                    });

                    self.worker[i].postMessage({cmd : 'load_resource' , path : MyWallet.getWebWorkerLoadPrefix() + 'bitcoinjs' + (min ? '.min.js' : '.js')});

                    //Generate and pass seed to the webworker
                    var seed = new Array(32);

                    rng.nextBytes(seed);

                    self.worker[i].postMessage({cmd : 'seed', seed : Crypto.util.bytesToHex(seed)});
                }

                for (var outputN = 0; outputN < self.selected_outputs.length; ++ outputN) {
                    var connected_script = self.selected_outputs[outputN].script;

                    if (connected_script == null) {
                       throw 'signWebWorker() Connected Script Is Null';
                    }

                    self.worker[outputN % nWorkers].postMessage({cmd : 'sign_input', tx : self.tx, outputN : outputN, priv_to_use : connected_script.priv_to_use, connected_script : connected_script});
                }
            } catch (e) {
                error(e);
            }
        },
        signNormal : function(success, error) {
            var self = this;
            var outputN = 0;

            var signOne = function() {
                setTimeout(function() {
                    if (self.is_cancelled) {
                        error();
                        return;
                    }

                    try {
                        self.invoke('on_sign_progress', outputN+1);

                        var connected_script = self.selected_outputs[outputN].script;

                        if (connected_script == null) {
                            throw 'signNormal() Connected Script Is Null';
                        }

                        var signed_script = signInput(self.tx, outputN, connected_script.priv_to_use, connected_script);

                        if (signed_script) {
                            self.tx.ins[outputN].script = signed_script;

                            outputN++;

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

                //Be sure the RNG is fully seeded
                MyWallet._seed();

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
                for (var i = 0; i < this.worker.length; ++i)  {
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

                MyWallet.backupWallet('update', function() {
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
            this.send(); //By Default Just Send
        },
        error : function(error) {
            if (this.is_cancelled) //Only call once
                return;

            this.is_cancelled = true;

            if (!this.has_pushed && this.generated_addresses.length > 0) {
                //When an error occurs during send (or user cancelled) we need to remove the addresses we generated
                for (var i = 0; i < this.generated_addresses.length; ++i) {
                    MyWallet.deleteAddress(this.generated_addresses[i]);
                }

                if (this.has_saved_addresses)
                    MyWallet.backupWallet();
            }

            this.invoke('on_error', error);
        },
        success : function() {
            this.invoke('on_success');
        }
    };

    pending_transaction.addListener({
        on_error : function(e) {
            console.log(e);

            if(e) {
                MyWallet.makeNotice('error', 'tx-error', e);
            }
        },
        on_begin_signing : function() {
            this.start = new Date().getTime();
        },
        on_finish_signing : function() {
            console.log('Signing Took ' + (new Date().getTime() - this.start) + 'ms');
        }
    });

    return pending_transaction;
}