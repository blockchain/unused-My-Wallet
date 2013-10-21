var SharedCoin = new function() {
    var SharedCoin = this;

    var options = {};
    var version = 2;
    var URL = MyWallet.getSharedcoinEndpoint() + '?version=' + version;

    this.newProposal = function() {
        return {
            _pollForCompleted : function(success, error) {
                var self = this;

                console.log('Offer._pollForCompleted()');

                MyWallet.setLoadingText('Waiting For Others Participants To Sign');

                $.ajax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    data : {method : 'poll_for_proposal_completed', format : 'json', proposal_id : self.proposal_id},
                    success: function (obj) {
                        success(obj);
                    },
                    error : function(e) {
                        error(e.responseText);
                    }
                });
            },
            pollForCompleted : function(success, error) {
                var self = this;

                var handleObj = function(obj) {
                    if (obj.status == 'waiting') {
                        self._pollForCompleted(handleObj, error)
                    } else if (obj.status == 'not_found') {
                        error('Proposal ID Not Found');
                    } else if (obj.status == 'complete'){
                        success(self)
                    } else {
                        error('Unknown status ' + obj.status)
                    }
                }

                self._pollForCompleted(handleObj, error)
            }
        }
    };

    this.newOffer = function() {
        return {
            offered_outpoints : [], //The outpoints we want to offer
            request_outputs : [], //The outputs we want in return
            offer_id : 0, //A unique ID for this offer (set by server)
            submit : function(success, error) {
                var self = this;

                MyWallet.setLoadingText('Submitting Offer');

                $.ajax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    data : {method : 'submit_offer', format : 'json', offer : JSON.stringify(self)},
                    success: function (obj) {
                        if (!obj.offer_id) {
                            error('Null offer_id returned');
                        } else {
                            self.offer_id = obj.offer_id;

                            success();
                        }
                    },
                    error : function(e) {
                        error(e.responseText);
                    }
                });
            },
            _pollForProposalID : function(success, error) {
                var self = this;

                console.log('Offer._pollForProposalID()');

                MyWallet.setLoadingText('Waiting For Other Participants');

                $.ajax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    data : {method : 'get_offer_id', format : 'json', offer_id : self.offer_id},
                    success: function (obj) {
                        success(obj);
                    },
                    error : function(e) {
                        error(e.responseText);
                    }
                });
            },
            pollForProposalID : function(success, error) {
                var self = this;

                var handleObj = function(obj) {
                    if (obj.status == 'waiting') {
                        self._pollForProposalID(handleObj, error)
                    } else if (obj.status == 'not_found') {
                        error('Offer ID Not Found');
                    } else if (obj.status == 'active_proposal'){
                        success(obj.proposal_id)
                    }  else {
                        error('Unknown status ' + obj.status)
                    }
                }

                self._pollForProposalID(handleObj, error)
            },
            getProposal : function(proposal_id, success, error) {
                var self = this;

                console.log('SharedCoin.getProposal()');

                MyWallet.setLoadingText('Fetching Proposal');

                $.ajax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    data : {method : 'get_proposal_id', format : 'json', offer_id : self.offer_id, proposal_id : proposal_id},
                    success: function (obj) {

                        var proposal = SharedCoin.newProposal();

                        var clone = jQuery.extend(proposal, obj);

                        if (clone.status == 'not_found') {
                            error('Proposal or Offer ID Not Found');
                        } else {
                            success(clone);
                        }
                    },
                    error : function(e) {
                        error(e.responseText);
                    }
                });
            },
            isOutpointOneWeOffered : function (input) {
                var self = this;

                var base64Hash = input.outpoint.hash;

                var hexHash = Crypto.util.bytesToHex(Crypto.util.base64ToBytes(base64Hash).reverse());

                var index = input.outpoint.index;

                for (var ii in self.offered_outpoints) {
                    var request_outpoint = self.offered_outpoints[ii];
                    if (request_outpoint.hash.toString() == hexHash.toString() && request_outpoint.index.toString() == index.toString()) {
                        return true;
                    }
                }

                return false;
            },
            isOutputOneWeRequested : function (output) {
                var self = this;

                var array = output.value.slice(0);

                array.reverse();

                var scriptHex = Crypto.util.bytesToHex(output.script.buffer);

                var value = new BigInteger(array);

                for (var ii in self.request_outputs) {
                    var request_output = self.request_outputs[ii];
                    if (request_output.script.toString() == scriptHex.toString() && value.toString() == request_output.value.toString()) {
                        return true;
                    }
                }

                return false;
            },
            checkProposal : function(proposal, success, error) {
                console.log('Offer.checkProposal()');

                var self = this;

                try {
                    if (proposal.tx == null) {
                        throw 'Proposal Transaction Is Null';
                    }

                    var hexTx = Crypto.util.hexToBytes(proposal.tx);


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

                    var tx = Bitcoin.Transaction.deserialize(hexTx);

                    if (tx == null) {
                        throw 'Error deserializing transaction';
                    }

                    var output_matches = 0;
                    for (var i = 0; i < tx.outs.length; ++i) {
                        if (self.isOutputOneWeRequested(tx.outs[i])) {
                            ++output_matches;
                        }
                    }

                    if (output_matches < self.request_outputs.length) {
                        throw 'Could not find all our requested outputs (' + output_matches + ' < ' + self.request_outputs.length + ')';
                    }

                    var input_matches = 0;
                    for (var i = 0; i < proposal.signature_requests.length; ++i) {
                        var tx_index = proposal.signature_requests[i].tx_input_index;

                        if (self.isOutpointOneWeOffered(tx.ins[tx_index])) {
                            ++input_matches;
                        }
                    }

                    if (self.offered_outpoints.length != input_matches) {
                        throw 'Could not find all our offered outpoints ('+self.offered_outpoints.length + ' != ' + input_matches + ')';
                    }

                    success(tx);
                } catch (e) {
                    error(e);
                }
            },
            signNormal : function(tx, connected_scripts, success, error) {
                console.log('Offer.signNormal()');

                var index = 0;

                var signatures = [];

                var signOne = function() {
                    setTimeout(function() {
                        try {
                            var connected_script = connected_scripts[index];

                            var signed_script = signInput(tx, connected_script.tx_input_index, connected_script.priv_to_use, connected_script, SIGHASH_ALL);

                            if (signed_script) {
                                index++;

                                signatures.push({tx_input_index : connected_script.tx_input_index, input_script : Crypto.util.bytesToHex(signed_script.buffer), offer_outpoint_index : connected_script.offer_outpoint_index});

                                if (index == connected_scripts.length) {
                                    success(signatures);
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
            submitInputScripts : function(proposal, input_scripts, success, error) {
                console.log('Offer.submitInputScripts()');

                var self = this;

                MyWallet.setLoadingText('Submitting Signatures');

                $.ajax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    data : {method : 'submit_signatures', format : 'json', input_scripts : JSON.stringify(input_scripts), offer_id : self.offer_id, proposal_id : proposal.proposal_id},
                    success: function (obj) {
                        if (obj.status == 'not_found')
                            error('Proposal Expired or Not Found');
                        else if (obj.status == 'verification_failed')
                            error('Signature Verification Failed');
                        else if (obj.status == 'signatures_accepted')
                            success('Signatures Accepted');
                        else
                            error('Unknown status ' + obj.status);
                    },
                    error : function(e) {
                        error(e.responseText);
                    }
                });
            },
            signInputs : function(proposal, tx, success, error) {

                console.log('Offer.signInputs()');

                var self = this;

                try {
                    var tmp_cache = {};

                    var connected_scripts = [];
                    for (var i = 0; i < proposal.signature_requests.length; ++i) {
                        var request = proposal.signature_requests[i];

                        var connected_script = new Bitcoin.Script(Crypto.util.hexToBytes(request.connected_script));

                        connected_script.tx_input_index = request.tx_input_index;
                        connected_script.offer_outpoint_index = request.offer_outpoint_index;

                        var pubKeyHash = connected_script.simpleOutPubKeyHash();
                        var inputAddress = new Bitcoin.Address(pubKeyHash).toString();

                        //Find the matching private key
                        if (tmp_cache[inputAddress]) {
                            connected_script.priv_to_use = tmp_cache[inputAddress];
                        } else if (MyWallet.addressExists(inputAddress) && !MyWallet.isWatchOnly(inputAddress)) {
                            connected_script.priv_to_use = MyWallet.decodePK(MyWallet.getPrivateKey(inputAddress));
                        }

                        if (connected_script.priv_to_use == null) {
                            throw 'Private key not found';
                        } else {
                            //Performance optimization
                            //Only Decode the key once sand save it in a temporary cache
                            tmp_cache[inputAddress] = connected_script.priv_to_use;
                        }

                        connected_scripts.push(connected_script);
                    }

                    self.signNormal(tx, connected_scripts, function(signatures) {
                        success(signatures);
                    }, function(e) {
                        error(e);
                    });
                } catch (e) {
                    error(e);
                }
            }
        };
    };

    this.newPlan = function() {
        return {
            offers : [], //Array of Offers for each stage
            n_stages : 0, //Total number of stages
            c_stage : 0,  //Current stage
            executeOffer : function(offer, success, error) {
                offer.submit(function() {
                    console.log('Successfully Submitted Offer');

                    offer.pollForProposalID(function(proposal_id) {
                        console.log('Proposal ID ' + proposal_id);

                        MyWallet.backupWallet('update', function() {
                            console.log('Saved Wallet');

                            offer.getProposal(proposal_id, function(proposal) {
                                console.log('Got Proposal');

                                console.log(proposal);

                                offer.checkProposal(proposal, function(tx) {
                                    console.log('Proposal Looks Good');

                                    offer.signInputs(proposal, tx, function(signatures) {
                                        console.log('Inputs Signed');

                                        offer.submitInputScripts(proposal, signatures, function (obj) {
                                            console.log('Submitted Input Scripts');

                                            proposal.pollForCompleted(function() {
                                                console.log('Poll For Completed Success');

                                                success();
                                            }, function(e) {
                                                error(e);
                                            });
                                        }, function(e) {
                                            error(e);
                                        });
                                    }, function(e) {
                                        error(e);
                                    });
                                }, function(e) {
                                    error(e);
                                })
                            }, function(e) {
                                error(e);
                            });
                        }, function(e) {
                            error(e);
                        });
                    }, function(e) {
                        error(e);
                    });
                }, function(e) {
                    error(e);
                });
            },
            execute : function(success, error) {
                var self = this;

                var offerForThisStage = self.offers[self.c_stage];

                if (offerForThisStage.offer_id == 0) {
                    self.executeOffer(offerForThisStage, function() {
                        success();
                    }, function(e) {
                        error(e);
                    });
                }
            }
        };
    };

    this.generateAndSaveNewAddress = function(success, error) {
        try {
            var key = MyWallet.generateNewKey();

            var bitcoin_address = key.getBitcoinAddress();

            MyWallet.setAddressLabel(bitcoin_address.toString(), 'SharedCoin Change');

            success(bitcoin_address);
        } catch (e) {
            error(e);
        }
    }

    this.getMinimumOutputValue = function() {
        return options.minimum_output_value;
    }

    this.getMinimumSupportedVersion = function() {
        return options.min_supported_version;
    }

    this.getIsEnabled = function() {
        return options.enabled;
    }

    this.getMaximumOutputValue = function() {
        return options.maximum_output_value;
    }

    this.getFee = function() {
        return options.fee_percent;
    }

    this.getMinimumFee = function() {
        return options.minimum_fee ? options.minimum_fee : 0;
    }

    this.constructPlan = function(el, success, error) {
        try {
            var repetitionsSelect = el.find('select[name="repetitions"]');

            var repetitions = parseInt(repetitionsSelect.val());

            if (repetitions <= 0) {
                throw 'invalid number of repetitions';
            }

            var newTx = initNewTx();

            //Get the from address, if any
            var from_select = el.find('select[name="from"]');
            var fromval = from_select.val();
            if (fromval == null || fromval == 'any') {
                newTx.from_addresses = MyWallet.getActiveAddresses();
            } else if (from_select.attr('multiple') == 'multiple') {
                newTx.from_addresses = fromval;
            } else {
                newTx.from_addresses = [fromval];
            }

            var recipients = el.find(".recipient");
            recipients.each(function() {
                try {
                    var child = $(this);

                    var value_input = child.find('input[name="send-value"]');
                    var send_to_input = child.find('input[name="send-to-address"]');

                    var value = 0;
                    try {
                        value = precisionToSatoshiBN(value_input.val());

                        if (value == null || value.compareTo(BigInteger.ZERO) <= 0)
                            throw 'You must enter a value greater than zero';
                    } catch (e) {
                        console.log(e);
                        throw 'Invalid send amount';
                    };

                    //Trim and remove non-printable characters
                    var send_to_address = $.trim(send_to_input.val()).replace(/[\u200B-\u200D\uFEFF]/g, '');

                    if (send_to_address == null || send_to_address.length == 0) {
                        throw 'You must enter a bitcoin address for each recipient';
                    }

                    var address = resolveAddress(send_to_address);

                    if (address == null || address.length == 0) {
                        throw 'You must enter a bitcoin address for each recipient';
                    }

                    newTx.to_addresses.push({address: new Bitcoin.Address(address), value : value});
                } catch (e) {
                    error(e);
                }
            });

            //Check that we have resolved all to addresses
            if (newTx.to_addresses.length == 0 || newTx.to_addresses.length < recipients.length) {
                return;
            }

            var to_values_before_fees = [];
            for (var i in newTx.to_addresses) {
                var to_address = newTx.to_addresses[i];

                to_values_before_fees.push(to_address.value);

                for (var ii = 0; ii < repetitions; ++ii) {
                    var totalFee = SharedCoin.calculateFeeForValue(to_address.value);

                    to_address.value = to_address.value.add(totalFee);
                }
            }

            SharedCoin.generateAndSaveNewAddress(function(change_address) {

                newTx.min_input_confirmations = 1;
                newTx.allow_adjust = false;
                newTx.change_address = change_address;
                newTx.base_fee = BigInteger.ZERO;
                newTx.min_free_output_size = SharedCoin.getMinimumOutputValue();
                newTx.fee = BigInteger.ZERO
                newTx.ask_for_fee = function(yes, no) {
                    no();
                };

                var offer = SharedCoin.newOffer();

                newTx.signInputs = function() {

                    try {
                        var self = this;

                        for (var i = 0; i < self.tx.ins.length; ++i) {
                            var input = self.tx.ins[i];

                            var base64Hash = input.outpoint.hash;

                            var hexHash = Crypto.util.bytesToHex(Crypto.util.base64ToBytes(base64Hash).reverse());

                            offer.offered_outpoints.push({hash : hexHash, index : input.outpoint.index});
                        }

                        for (var i = 0; i < self.tx.outs.length; ++i) {
                            var output = self.tx.outs[i];

                            var array = output.value.slice(0);

                            array.reverse();

                            var pubKeyHash = new Bitcoin.Script(output.script).simpleOutPubKeyHash();

                            var outputAddress = new Bitcoin.Address(pubKeyHash).toString();

                            var value = new BigInteger(array);

                            if (outputAddress.toString() == change_address.toString()) {
                                offer.request_outputs.push({value : value.toString(), script : Crypto.util.bytesToHex(output.script.buffer), exclude_from_fee : true});
                            } else {
                                //Split here_before_fees
                                offer.request_outputs.push({value : to_values_before_fees[i].toString(), script : Crypto.util.bytesToHex(output.script.buffer)});
                            }
                        }

                        var plan = SharedCoin.newPlan();

                        plan.offers.push(offer);
                        plan.n_stages = repetitions;
                        plan.c_stage = 0;

                        success(plan);

                    } catch (e) {
                        error(e);
                    }
                };

                newTx.addListener({
                    on_error : function(e) {
                        error();
                    }
                });

                newTx.start();
            }, function(e) {
                error(e);
            });
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        }
    }

    this.calculateFeeForValue = function(input_value) {
        if (input_value.compareTo(BigInteger.ZERO) > 0) {
            var mod = Math.ceil(100 / SharedCoin.getFee());

            var fee = input_value.divide(BigInteger.valueOf(mod));

            var minFee = BigInteger.valueOf(SharedCoin.getMinimumFee());

            if (minFee.compareTo(fee) > 0) {
                return minFee;
            } else {
                return fee;
            }
        } else {
            return BigInteger.ZERO;
        }
    }

    this.init = function(el) {
        var send_button = el.find('.send');
        var repetitionsSelect = el.find('select[name="repetitions"]');

        send_button.unbind().prop('disabled', true);

        el.find('input[name="send-value"]').unbind().bind('keyup change', function() {
            enableSendButton();
        });

        function enableSendButton() {
            var repetitions = parseInt(repetitionsSelect.val());

            if (repetitions > 0 && SharedCoin.getIsEnabled() && version >= SharedCoin.getMinimumSupportedVersion()) {
                var input_value = precisionToSatoshiBN(el.find('input[name="send-value"]').val());

                if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) < 0) {
                    send_button.prop('disabled', true);
                } else if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMaximumOutputValue())) > 0) {
                    send_button.prop('disabled', true);
                } else {
                    send_button.prop('disabled', false);

                    send_button.unbind().click(function() {
                        MyWallet.getSecondPassword(function() {
                            loadScript('wallet/signer', function() {
                                el.find('input,select,button').prop('disabled', true);

                                SharedCoin.constructPlan(el, function(plan) {
                                    console.log('Created Plan');

                                    //TODO display modal here asking to confirm plan
                                    plan.execute(function() {
                                        el.find('input,select,button').prop('disabled', false);

                                        MyWallet.makeNotice('success', 'misc-success', 'Sharedcoin Transaction Successfully Completed');

                                    }, function(e) {
                                        el.find('input,select,button').prop('disabled', false);

                                        MyWallet.makeNotice('error', 'misc-error', e);
                                    })
                                }, function(e) {
                                    el.find('input,select,button').prop('disabled', false);

                                    MyWallet.makeNotice('error', 'misc-error', e);
                                });
                            }, function(e) {
                                MyWallet.makeNotice('error', 'misc-error', e);
                            });
                        }, function(e) {
                            MyWallet.makeNotice('error', 'misc-error', e);
                        });
                    });
                }
            } else {
                send_button.prop('disabled', true);
            }
        }

        MyWallet.setLoadingText('Fetching SharedCoin Info');

        $.ajax({
            dataType: 'json',
            type: "POST",
            url: URL,
            data : {method : 'get_info', format : 'json'},
            success: function (obj) {
                try {
                    options = obj;

                    if (!SharedCoin.getIsEnabled()) {
                        throw 'Shared Coin is currently disabled';
                    }

                    if (version < SharedCoin.getMinimumSupportedVersion()) {
                        throw 'Version out of date. Please update your client or reload the page.';
                    }

                    repetitionsSelect.empty();

                    for (var ii = obj.recommended_min_iterations; ii <= obj.recommended_max_iterations; ii+=1) {
                        repetitionsSelect.append('<option value="'+(ii)+'">'+(ii)+' Repetitions (Fee: '+((ii)*SharedCoin.getFee()).toFixed(2)+'%)</option>');
                    }

                    repetitionsSelect.val(obj.recommended_iterations);
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }

                enableSendButton();
            },
            error : function(e) {
                send_button.prop('disabled', true);
                MyWallet.makeNotice('error', 'misc-error', e.responseText);
            }
        });
    }
}