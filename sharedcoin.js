var SharedCoin = new function() {
    var SharedCoin = this;

    var options = {};
    var version = 2;
    var URL = MyWallet.getSharedcoinEndpoint() + '?version=' + version;
    var extra_private_keys = {};
    var seed_prefix = 'sharedcoin-seed:';

    var progressModal = {
        show : function () {
            var self = this;

            self.modal = $('#sharedcoin-modal');

            self.modal.modal({
                keyboard: false,
                backdrop: "static",
                show: true
            });

            self.modal.find('.btn.btn-secondary').unbind().click(function() {
                self.hide();
            });
        },
        setAddressAndAmount : function(address, amount) {
            if (this.modal) {
                this.modal.find('.total_value').text(formatBTC(amount));
                this.modal.find('.address').text(address);
            }
        },
        hide : function() {
            if (this.modal) {
                this.modal.modal('hide');
            }
        },
        disableCancel : function() {
            if (this.modal) {
                this.modal.find('.alert-warning').show();
                this.modal.find('.alert-error').hide();
                this.modal.find('.btn.btn-secondary').prop('disabled', true);
            }
        },
        enableCancel : function() {
            if (this.modal) {
                this.modal.find('.alert-error').show();
                this.modal.find('.alert-warning').hide();
                this.modal.find('.btn.btn-secondary').prop('disabled', false);
            }
        }
    }
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
                        success(obj.tx_hash)
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
            calculateFee : function() {
                var self = this;

                var totalValueInput= BigInteger.ZERO;
                for (var i in self.offered_outpoints) {
                    totalValueInput = totalValueInput.add(BigInteger.valueOf(self.offered_outpoints[i].value));
                }

                var totalValueOutput = BigInteger.ZERO;
                for (var i in self.request_outputs) {
                    totalValueOutput = totalValueOutput.add(BigInteger.valueOf(self.request_outputs[i].value));
                }

                return totalValueInput.subtract(totalValueOutput);
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
            isOutputChange : function (output) {
                var self = this;

                var array = output.value.slice(0);

                array.reverse();

                var scriptHex = Crypto.util.bytesToHex(output.script.buffer);

                var value = new BigInteger(array);

                for (var ii in self.request_outputs) {
                    var request_output = self.request_outputs[ii];
                    if (request_output.script.toString() == scriptHex.toString() && value.toString() == request_output.value.toString()) {
                        return request_output.exclude_from_fee;
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

                    var outpoints_to_offer_next_stage = [];

                    var output_matches = 0;
                    for (var i = 0; i < tx.outs.length; ++i) {
                        if (self.isOutputOneWeRequested(tx.outs[i])) {

                            if (!self.isOutputChange(tx.outs[i])) {
                                var array = tx.outs[i].value.slice(0);

                                array.reverse();

                                var value = new BigInteger(array);

                                outpoints_to_offer_next_stage.push({hash : null, index : parseInt(i), value : value.toString()});
                            }

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

                    success(tx, outpoints_to_offer_next_stage);
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
                        else if (obj.status == 'complete')
                            error('Transaction Already Completed');
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
                        } else if (extra_private_keys[inputAddress]) {
                            connected_script.priv_to_use = Bitcoin.Base58.decode(extra_private_keys[inputAddress]);
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

    this.generateAddressFromCustomSeed = function(seed, n) {
        var hash = Crypto.SHA256(seed + n, {asBytes: true});

        var key = new Bitcoin.ECKey(hash);

        if (hash[0] % 2 == 0) {
            var address = key.getBitcoinAddress();
        } else {
            var address = key.getBitcoinAddressCompressed();
        }

        extra_private_keys[address.toString()] = Bitcoin.Base58.encode(key.priv);

        return address;
    }

    this.newPlan = function() {
        return {
            offers : [], //Array of Offers for each stage
            n_stages : 0, //Total number of stages
            address_seed  : new SecureRandom().nextBytes(16),
            address_seen_n : 0,
            generateAddressFromSeed : function() {

                if (this.address_seed == null) {
                    var array = [];

                    array.length = 18;

                    new SecureRandom().nextBytes(array);

                    this.address_seed = Crypto.util.bytesToHex(array);

                    MyWallet.addAdditionalSeeds(seed_prefix + this.address_seed);
                }

                var address = SharedCoin.generateAddressFromCustomSeed(seed_prefix + this.address_seed,  this.address_seen_n);

                this.address_seen_n++;

                return address;
            },
            executeOffer : function(offer, success, error) {
                offer.submit(function() {
                    console.log('Successfully Submitted Offer');

                    offer.pollForProposalID(function(proposal_id) {
                        console.log('Proposal ID ' + proposal_id);

                        offer.getProposal(proposal_id, function(proposal) {
                            console.log('Got Proposal');

                            offer.checkProposal(proposal, function(tx, outpoints_to_offer_next_stage) {
                                console.log('Proposal Looks Good');

                                offer.signInputs(proposal, tx, function(signatures) {
                                    console.log('Inputs Signed');

                                    offer.submitInputScripts(proposal, signatures, function (obj) {
                                        console.log('Submitted Input Scripts');

                                        proposal.pollForCompleted(function(tx_hash) {
                                            console.log('Poll For Completed Success');

                                            //Connect the newly discovered transaction hash
                                            for (var i in outpoints_to_offer_next_stage) {
                                                outpoints_to_offer_next_stage[i].hash = tx_hash;
                                            }

                                            success(outpoints_to_offer_next_stage);
                                        }, error);
                                    }, error);
                                }, error);
                            }, error)
                        }, error);
                    }, error);
                }, error);
            },
            execute : function(success, error) {
                var self = this;

                var execStage = function(ii) {
                    var offerForThisStage = self.offers[ii];

                    console.log('Executing Stage ' + ii);

                    self.executeOffer(offerForThisStage, function(outpoints_to_offer_next_stage) {
                        ii++;

                        if (ii < self.n_stages) {
                            //Connect the outputs created from the previous stage to the inputs to use this stage
                            self.offers[ii].offered_outpoints = outpoints_to_offer_next_stage;

                            execStage(ii);
                        } else if (ii == self.n_stages) {
                            success();
                        }
                    }, error);
                };

                MyWallet.backupWallet('update', function() {
                    console.log('Saved Wallet');

                    execStage(0);
                }, error);
            },
            constructRepetitions : function(initial_offer, fee_each_repetition, success, error) {
                try {
                    var self = this;

                    var totalValueInput= BigInteger.ZERO;
                    for (var i in initial_offer.offered_outpoints) {
                        totalValueInput = totalValueInput.add(BigInteger.valueOf(initial_offer.offered_outpoints[i].value));
                    }

                    var totalValueLeftToConsume = totalValueInput;

                    for (var ii = 0; ii < self.n_stages-1; ++ii) {
                        var offer = SharedCoin.newOffer();

                        //Copy the inputs from the last offer
                        if (ii == 0) {
                            for (var i in initial_offer.request_outputs) {
                                if (initial_offer.request_outputs[i].exclude_from_fee) {
                                    var changeoutput = initial_offer.request_outputs.splice(i, 1)[0];

                                    offer.request_outputs.push(changeoutput);

                                    totalValueLeftToConsume = totalValueLeftToConsume.subtract(BigInteger.valueOf(changeoutput.value));

                                    break;
                                }
                            }

                            offer.offered_outpoints = initial_offer.offered_outpoints.slice(0);

                            initial_offer.offered_outpoints = [];
                        }

                        totalValueLeftToConsume = totalValueLeftToConsume.subtract(fee_each_repetition[ii]);

                        var splitValues = [10,5,2,1,0.5,0.1];
                        var outputsAdded = false;
                        while (true) {
                            for (var sK in splitValues) {
                                var variance = (splitValues[sK] / 100) * ((Math.random()*30)-15);

                                var splitValue = BigInteger.valueOf(Math.round((splitValues[sK] + variance) * satoshi));

                                var valueAndRemainder = totalValueLeftToConsume.divideAndRemainder(splitValue);

                                if (valueAndRemainder[0].intValue() >= 1) {
                                    if (valueAndRemainder[1].compareTo(BigInteger.ZERO) == 0 || valueAndRemainder[1].compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) >= 0) {
                                        for (var iii  = 0; iii < valueAndRemainder[0].intValue(); ++iii) {
                                            var new_address = self.generateAddressFromSeed();

                                            offer.request_outputs.push({
                                                value : splitValue.toString(),
                                                script : Crypto.util.bytesToHex(Script.createOutputScript(new_address).buffer)
                                            });
                                        }

                                        if (valueAndRemainder[1].compareTo(BigInteger.ZERO) > 0) {
                                            var new_address = self.generateAddressFromSeed();

                                            offer.request_outputs.push({
                                                value : valueAndRemainder[1].toString(),
                                                script : Crypto.util.bytesToHex(Script.createOutputScript(new_address).buffer)
                                            });
                                        }

                                        outputsAdded = true;

                                        break;
                                    }
                                }
                            }

                            if (outputsAdded) break;
                        }

                        self.offers.push(offer);
                    }

                    self.offers.push(initial_offer);

                    success(self);
                } catch (e) {
                    error(e);
                }
            }
        };
    };

    this.generateNewAddress = function(success, error) {
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

    this.getMinimumInputValue = function() {
        return options.minimum_input_value;
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
            var fee_each_repetition = [];
            for (var i in newTx.to_addresses) {
                var to_address = newTx.to_addresses[i];

                to_values_before_fees.push(to_address.value);

                for (var ii = 0; ii < repetitions; ++ii) {
                    var feeThisOutput = SharedCoin.calculateFeeForValue(to_address.value);

                    to_address.value = to_address.value.add(feeThisOutput);

                    var existing = fee_each_repetition[ii];
                    if (existing) {
                        fee_each_repetition[ii] = existing.add(feeThisOutput);
                    } else {
                        fee_each_repetition[ii] = feeThisOutput;
                    }
                }
            }

            //Build the last offer
            SharedCoin.generateNewAddress(function(change_address) {

                newTx.min_input_confirmations = 1;
                newTx.allow_adjust = false;
                newTx.change_address = change_address;
                newTx.base_fee = BigInteger.ZERO;
                newTx.min_input_size = BigInteger.valueOf(SharedCoin.getMinimumInputValue());
                newTx.min_free_output_size = BigInteger.valueOf(SharedCoin.getMinimumOutputValue());
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

                            offer.offered_outpoints.push({hash : hexHash, index : input.outpoint.index, value : input.outpoint.value.toString()});
                        }

                        for (var i = 0; i < self.tx.outs.length; ++i) {
                            var output = self.tx.outs[i];

                            var array = output.value.slice(0);

                            array.reverse();

                            var value = new BigInteger(array);

                            var pubKeyHash = new Bitcoin.Script(output.script).simpleOutPubKeyHash();

                            var outputAddress = new Bitcoin.Address(pubKeyHash).toString();

                            if (outputAddress.toString() == change_address.toString()) {
                                offer.request_outputs.push({value : value.toString(), script : Crypto.util.bytesToHex(output.script.buffer), exclude_from_fee : true});
                            } else {
                                offer.request_outputs.push({value : to_values_before_fees[i].toString(), script : Crypto.util.bytesToHex(output.script.buffer)});
                            }
                        }

                        var plan = SharedCoin.newPlan();

                        plan.n_stages = repetitions;
                        plan.c_stage = 0;

                        plan.constructRepetitions(offer, fee_each_repetition, success, function(e) {
                            error(e);
                        });

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
        $('#additional_seeds').remove();

        var additional_seeds = MyWallet.getAdditionalSeeds();

        var seeds_to_show = [];
        for (var key in additional_seeds) {
            var seed = additional_seeds[key];

            if (seed.indexOf(seed_prefix) == 0) {
                seeds_to_show.push(seed);
            }
        }

        if (seeds_to_show.length > 0){
            var div = $('<div class="well" id="additional_seeds"></div>');

            for (var key in seeds_to_show) {
                (function(seed) {
                    var p = $('<p>'+ seed +' - (<a href="#">Recover</a>)</p>');

                    div.append(p);

                    p.find('a').click(function() {
                        var addresses = []
                        for (var i = 0; i < 100; ++i) {
                            addresses.push(SharedCoin.generateAddressFromCustomSeed(seed, i).toString());
                        }

                        MyWallet.sweepAddressesModal(addresses, extra_private_keys);
                    });
                })(seeds_to_show[key]);
            }

            el.append(div);
        }

        var send_button = el.find('.send');
        var send_options = el.find('.send-options');
        var repetitionsSelect = el.find('select[name="repetitions"]');

        send_button.unbind().prop('disabled', true);

        el.find('input[name="send-value"]').bind('keyup change', function() {
            enableSendButton();
        });

        send_options.hide();

        function setSendOptions() {
            var spans = send_options.find('span');

            spans.eq(0).text(formatBTC(SharedCoin.getMaximumOutputValue()));
            spans.eq(1).text(formatBTC(SharedCoin.getMinimumOutputValue()));
            spans.eq(2).text(SharedCoin.getFee());
            spans.eq(3).text(formatBTC(SharedCoin.getMinimumFee()));

            send_options.show();
        }

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
                        MyWallet.disableLogout(true);

                        var error = function(e) {
                            el.find('input,select,button').prop('disabled', false);

                            enableSendButton();

                            MyWallet.disableLogout(false);

                            MyWallet.makeNotice('error', 'misc-error', e);

                            progressModal.enableCancel();
                        };

                        var success = function(){
                            el.find('input,select,button').prop('disabled', false);

                            MyWallet.makeNotice('success', 'misc-success', 'Sharedcoin Transaction Successfully Completed');

                            MyWallet.disableLogout(false);

                            progressModal.hide();

                            enableSendButton();
                        }

                        MyWallet.getSecondPassword(function() {
                            loadScript('wallet/signer', function() {

                                progressModal.show();

                                progressModal.disableCancel();

                                var value = precisionToSatoshiBN(el.find('input[name="send-value"]').val());
                                var address = el.find('input[name="send-to-address"]').val();

                                progressModal.setAddressAndAmount(address, value);

                                el.find('input,select,button').prop('disabled', true);

                                SharedCoin.constructPlan(el, function(plan) {

                                    console.log('Created Plan');

                                    console.log(plan);

                                    plan.execute(success, error);
                                }, error);
                            }, error);
                        }, error);
                    });
                }
            } else {
                send_button.prop('disabled', true);
            }
        }

        if ($.isEmptyObject(options)) {
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

                        setSendOptions();

                        repetitionsSelect.empty();

                        for (var ii = obj.recommended_min_iterations; ii <= obj.recommended_max_iterations; ii+=1) {
                            repetitionsSelect.append('<option value="'+(ii)+'">'+(ii)+' Repetitions (Fee: '+((ii)*SharedCoin.getFee()).toFixed(3)+'%)</option>');
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
        } else {
            setSendOptions();
        }
    }
}