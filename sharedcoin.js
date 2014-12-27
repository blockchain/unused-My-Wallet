var SharedCoin = new function() {
    var SharedCoin = this;
    var DonationPercentMin = 0.5;
    var DonationPercentMax = 1.0;
    var AjaxTimeout = 120000;
    var AjaxRetry = 3;
    var LastSignatureSubmitTime = 0;
    var MinTimeBetweenSubmits = 120000;
    var options = {};
    var version = 6;
    var URL;
    var extra_private_keys = {};
    var seed_prefix = 'sharedcoin-seed-v2:';
    var seed_prefix_v1 = 'sharedcoin-seed:';
    var ProgressCallbacksPerOffer = 7;

    //Count the number of keys in an object
    function nKeys(obj) {
        var size = 0, key;
        for (key in obj) {
            size++;
        }
        return size;
    };

    //Indent a number of lines for debug printing
    function indentString(str) {
        var lines = str.split('\n');
        var joined = '';
        for (var i in lines) {
            joined += '     ' + lines[i] + '\n';
        }
        return joined;
    }

    //Divide a big integer into n random parts
    function splitBigInt(value, n) {
        if (n == 0)  throw 'Invalid N';

        var values = [];
        var total = BigInteger.ZERO;
        for (var i = 0; i < n; ++i) {
            values[i] = value.multiply(BigInteger.valueOf(Math.round(Math.random()*100)));
            total = total.add(values[i]);
        }

        var mod = total.divide(value);
        total = BigInteger.ZERO;
        for (var i = 0; i < n; ++i) {
            values[i] = values[i].divide(mod);
            total = total.add(values[i]);
        }

        var randIndex = Math.ceil(Math.random()*values.length)-1;

        //Add any remainder to a random index
        values[randIndex] = values[randIndex].add(value.subtract(total));

        return values;
    }

    //Count the number of digits in a big int
    function getDigitCount(number) {
        var factor = Math.log(2) / Math.log(10);
        var digitCount = Math.ceil((factor * number.bitLength() + 1));
        if (BigInteger.valueOf(10).pow(BigInteger.valueOf(digitCount - 1)).compareTo(number) > 0) {
            return digitCount - 1;
        }
        return digitCount;
    }

    //Return random value between x & y
    function randomLong(x, y) {
        return Math.round(x + (Math.random() * (y - x)));
    }

    //Round one big integer and add the remainder to the second returning an array
    function randomRound(val1, val2, minSignificant) {
        var total = val1.add(val2);

        var digitCount = getDigitCount(val1);

        minSignificant = Math.min(digitCount-1, minSignificant);

        var modifier = BigInteger.valueOf(Math.pow(10, randomLong(1, digitCount - 1)));

        var val1Rounded = val1.divide(modifier).multiply(modifier);

        var roundedRemainder = total.subtract(val1Rounded);

        return [val1Rounded, roundedRemainder];
    }

    //Duration in milliseconds to minutes and hours (used for estimation time)
    function timeToMinutesSeconds(millis) {
       var oneHour = 3600 * 1000;
       var oneMinute = 60 * 1000;
       var hours   = Math.floor(millis / oneHour);
       var minutes = Math.floor((millis - (hours * oneHour)) / oneMinute);
       var seconds = Math.round((millis - (hours * oneHour) - (minutes * oneMinute)) / 1000);

       var str = '';
       if (minutes > 0) str += minutes + ' minutes';
       if (seconds > 0) str += (str.length > 0 ? ' ' : '') + seconds + ' seconds';
       return str;
    }

    /*globals jQuery, window */
    (function($) {
        $.retryAjax = function (ajaxParams) {
            var errorCallback;
            ajaxParams.tryCount = (!ajaxParams.tryCount) ? 0 : ajaxParams.tryCount;
            ajaxParams.retryLimit = (!ajaxParams.retryLimit) ? 2 : ajaxParams.retryLimit;
            ajaxParams.suppressErrors = true;

            if (ajaxParams.error) {
                errorCallback = ajaxParams.error;
                delete ajaxParams.error;
            } else {
                errorCallback = function () {

                };
            }

            ajaxParams.complete = function (jqXHR, textStatus) {
                if ($.inArray(textStatus, ['timeout', 'abort', 'error']) > -1) {
                    this.tryCount++;
                    if (this.tryCount <= this.retryLimit) {

                        // fire error handling on the last try
                        if (this.tryCount === this.retryLimit) {
                            this.error = errorCallback;
                            delete this.suppressErrors;
                        }

                        (function(self) {
                            //try again after delay
                            setTimeout(function() {
                                $.ajax(self);
                            }, 5000);
                        })(this);

                        return true;
                    }
                    return true;
                }
            };

            $.ajax(ajaxParams);
        };
    }(jQuery));

    Bitcoin.Transaction.deserialize = function (buffer)
    {

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

            return BigInteger.fromByteArrayUnsigned(tbytes);
        }

        function readUInt32(buffer) {
            return new BigInteger(buffer.splice(0, 4).reverse()).intValue();
        }

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

    function divideUniformlyRandomly(sum, n)
    {
        var nums = [];
        var upperbound = Math.round(sum * 1.0 / n);
        var offset = Math.round(0.5 * upperbound);

        var cursum = 0;
        for (var i = 0; i < n; i++)
        {
            var rand = Math.floor((Math.random() * upperbound) + offset);
            if (cursum + rand > sum || i == n - 1)
            {
                rand = sum - cursum;
            }
            cursum += rand;
            nums[i] = rand;
            if (cursum == sum)
            {
                break;
            }
        }
        return nums;
    }

    var reviewModal = {
        show : function (plan, success, error) {
            var self = this;

            self.modal = $('#sharedcoin-review-modal');

            self.success = success;

            self.error = error;

            self.modal.modal({
                keyboard: false,
                backdrop: "static",
                show: true
            });

            self.modal.find('.btn.btn-primary').unbind().click(function() {
                self.success();

                self.hide();
            });

            self.modal.find('.btn.btn-secondary').unbind().click(function() {
                self.error();

                self.hide();
            });

            self.setPlan(plan);
        },
        hide : function() {
            if (this.modal) {
                this.modal.modal('hide');

                this.success = null;
                this.error = null;
            }
        },
        setPlan : function(plan) {
            if (this.modal) {
                this.modal.find('.estimated-time').text(timeToMinutesSeconds(plan.getEstimatedTimeLeft()));
                this.modal.find('.n-repetitions').text(plan.offers.length);
                this.modal.find('.network-fees').text(formatBTC(plan.offers.length * SharedCoin.getMinimumFee()));
                this.modal.find('.total-fee').text(formatBTC(plan.calculateTotalFee().toString()));

                var to = this.modal.find('.to');

                to.empty();
                for (var address in plan.to_addresses) {
                    var value = plan.to_addresses[address];

                    to.append(address + ' ('+ formatBTC(value.toString()) +')<br/>');
                }
            }
        }
    };

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
        setEstimatedTime : function(estimatedTime) {
            if (this.modal) {
                var span = this.modal.find('.estimated-time');
                var subHeader = this.modal.find('h3').find('small');

                if (estimatedTime <= 0) {
                    span.hide();
                    subHeader.hide();
                } else {
                    subHeader.show();
                    span.show();
                    span.text(timeToMinutesSeconds(estimatedTime));
                }
            }
        },
        setProgressError : function() {
            if (this.modal) {
                var progress = this.modal.find('.progress');

                progress.addClass('progress-danger');
                progress.removeClass('progress-success');
                progress.removeClass('progress-info');
            }
        },
        setProgressSuccess : function() {
            if (this.modal) {
                var progress = this.modal.find('.progress');

                progress.addClass('progress-success');
                progress.removeClass('progress-danger');
                progress.removeClass('progress-info');
            }
        },
        setProgressInfo : function() {
            if (this.modal) {
                var progress = this.modal.find('.progress');

                progress.addClass('progress-info');
                progress.removeClass('progress-success');
                progress.removeClass('progress-danger');
            }
        },
        setProgress : function(stage, max_stage) {
            if (this.modal) {
                var width = (stage / max_stage) * 100;

                var progress = this.modal.find('.progress');

                if (stage >= max_stage) {
                    progress.removeClass('active');
                } else {
                    progress.addClass('active');
                }

                progress.children().css('width', width + '%');
            }
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
    };

    this.newProposal = function() {
        return {
            _pollForCompleted : function(success, error) {
                var self = this;

                console.log('Offer._pollForCompleted()');

                MyWallet.setLoadingText('Waiting For Other Participants To Sign');

                $.retryAjax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    timeout: AjaxTimeout,
                    retryLimit: 4,
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
                        success(obj.tx_hash, obj.tx)
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
            fee_percent : 0, //The Offer fee percentage
            wait_time : 60000,
            time_submitted : 0,
            toString : function() {
                var self = this;

                var str = '---- OFFER ----\n';

                str += 'ID ' + self.offer_id + '\n';
                str += 'Fee Percent ' + self.fee_percent + '\n';
                str += 'Actual Fee ' + self.calculateFee() + '\n';
                str += 'Wait Time ' + self.wait_time + '\n';

                str += 'Inputs [\n';

                for (var i in self.offered_outpoints) {
                    var offered_outpoint = self.offered_outpoints[i];

                    if (offered_outpoint.hash  == null) {
                        var script = new Script(Crypto.util.hexToBytes(offered_outpoint.script));

                        var addresses = [];

                        script.extractAddresses(addresses);

                        str += '    Awaiting Connection (Address ' + addresses[0]+ ')';
                    } else {
                        str += '    Hash : ' + offered_outpoint.hash;
                    }

                    str += ' Value : ' + offered_outpoint.value;

                    str += '\n';
                }
                str += ']\n';

                str += 'Outputs [\n';

                for (var i in self.request_outputs) {
                    var request_output = self.request_outputs[i];

                    var script = new Script(Crypto.util.hexToBytes(request_output.script));

                    var addresses = [];

                    script.extractAddresses(addresses);

                    str += '    Address : ' + addresses[0] + ' Value : ' + request_output.value;

                    if (request_output.exclude_from_fee)
                        str += ' Change Output';

                    str += '\n';
                }
                str += ']\n';

                str += '---- END OFFER ----';

                return str;
            },
            submit : function(success, error, complete) {
                var self = this;

                self.time_submitted = new Date().getTime();

                MyWallet.setLoadingText('Submitting Offer');

                $.retryAjax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    timeout: AjaxTimeout,
                    retryLimit: AjaxRetry,
                    data : {
                            method : 'submit_offer',
                            fee_percent : self.fee_percent,
                            format : 'json',
                            token : SharedCoin.getToken(),
                            offer : JSON.stringify(self),
                            offer_max_age : self.wait_time
                    },
                    success: function (obj) {
                        if (obj.status == 'complete') {
                            complete(obj.tx_hash, obj.tx);
                        } else if (!obj.offer_id) {
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

                MyWallet.setLoadingText('Waiting For Outputs To Be Joined');

                $.retryAjax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    timeout: AjaxTimeout,
                    retryLimit: AjaxRetry,
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
            getProposal : function(proposal_id, success, error, complete) {
                var self = this;

                console.log('SharedCoin.getProposal()');

                MyWallet.setLoadingText('Fetching Proposal');

                $.retryAjax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    timeout: AjaxTimeout,
                    retryLimit: AjaxRetry,
                    data : {method : 'get_proposal_id', format : 'json', offer_id : self.offer_id, proposal_id : proposal_id},
                    success: function (obj) {

                        var proposal = SharedCoin.newProposal();

                        var clone = jQuery.extend(proposal, obj);

                        if (clone.status == 'not_found') {
                            error('Proposal or Offer ID Not Found');
                        } else if (clone.status == 'complete') {
                            complete(clone.tx_hash, clone.tx);
                        } else if (clone.status == 'signatures_needed') {
                            success(clone);
                        } else if (clone.status == 'waiting') {
                            self.getProposal(proposal_id, success, error, complete)
                        } else {
                            error('Unknown get_proposal_id status')
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
            determineOutputsToOfferNextStage : function(tx_hash, tx_hex, success, error) {
                //Determine which outputs from a transaction are available for spending in the next stage
                var self = this;

                try {
                    var decodedTx = Crypto.util.hexToBytes(tx_hex);

                    var tx = Bitcoin.Transaction.deserialize(decodedTx);

                    var outpoints_to_offer_next_stage = [];

                    for (var i = 0; i < tx.outs.length; ++i) {
                        var output = tx.outs[i];

                        if (self.isOutputOneWeRequested(output)) {
                            if (!self.isOutputChange(output)) {
                                var array = output.value.slice(0);

                                array.reverse();

                                var value = new BigInteger(array);

                                outpoints_to_offer_next_stage.push({
                                    script : Crypto.util.bytesToHex(output.script.buffer),
                                    hash : tx_hash,
                                    index : parseInt(i),
                                    value : value.toString()
                                });
                            }
                        }
                    }

                    success(outpoints_to_offer_next_stage);
                } catch (e) {
                    error(e);
                }
            },
            checkProposal : function(proposal, success, error) {
                console.log('Offer.checkProposal()');

                var self = this;

                try {
                    if (proposal.tx == null) {
                        throw 'Proposal Transaction Is Null';
                    }

                    var decodedTx = Crypto.util.hexToBytes(proposal.tx);

                    var tx = Bitcoin.Transaction.deserialize(decodedTx);

                    if (tx == null) {
                        throw 'Error deserializing transaction';
                    }

                    var output_matches = 0;
                    for (var i = 0; i < tx.outs.length; ++i) {
                        var output = tx.outs[i];

                        if (self.isOutputOneWeRequested(output)) {
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

                            if (connected_script == null) {
                                throw 'Null connected script';
                            }

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
            submitInputScripts : function(proposal, input_scripts, success, error, complete) {
                console.log('Offer.submitInputScripts()');

                var self = this;

                MyWallet.setLoadingText('Submitting Signatures');

                LastSignatureSubmitTime = new Date().getTime();

                $.retryAjax({
                    dataType: 'json',
                    type: "POST",
                    url: URL,
                    timeout: AjaxTimeout,
                    retryLimit: AjaxRetry,
                    data : {method : 'submit_signatures', format : 'json', input_scripts : JSON.stringify(input_scripts), offer_id : self.offer_id, proposal_id : proposal.proposal_id},
                    success: function (obj) {
                        if (obj.status == 'not_found') {
                            error('Proposal Expired or Not Found');
                        } else if (obj.status == 'verification_failed') {
                            error('Signature Verification Failed');
                        } else if (obj.status == 'complete') {
                            complete(obj.tx_hash, obj.tx);
                        } else if (obj.status == 'signatures_accepted') {
                            success('Signatures Accepted');
                        } else {
                            error('Unknown status ' + obj.status);
                        }
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

                        if (connected_script == null) {
                            throw 'signInputs() Connected script is null';
                        }

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

    this.generateAddressAndKeyFromCustomSeed = function(seed, n) {
        var hash = Crypto.SHA256(seed + n, {asBytes: true});

        var key = new Bitcoin.ECKey(hash);

        if (seed.indexOf(seed_prefix) == 0) {
            //current seed version
            var address = key.getBitcoinAddressCompressed();
        } else {
            //Assume seed v1
            if (hash[0] % 2 == 0) {
                var address = key.getBitcoinAddress();
            } else {
                var address = key.getBitcoinAddressCompressed();
            }
        }

        return {address: address, key: key};
    }

    this.generateAddressFromCustomSeed = function(seed, n) {
        var key_container = this.generateAddressAndKeyFromCustomSeed(seed, n);

        extra_private_keys[key_container.address.toString()] = Bitcoin.Base58.encode(key_container.key.priv);

        return key_container.address;
    }

    this.newPlan = function() {
        return {
            offers : [], //Array of Offers for each stage
            c_stage : 0, //The current stage
            address_seed  : null, //The address seed for recovery
            address_seen_n : 0, //The current seed index
            generated_addresses : [], //Change Addresses we have generated
            fee_percent_each_repetition : [], //The fee_percent per iteration
            fee_each_repetition : [], //The fee in satoshi per iteration
            to_addresses : {}, //Record to addresses from form for debugging
            generateAddressFromSeed : function() {

                if (this.address_seed == null) {
                    MyWallet._seed();

                    var array = new Array(18);

                    new SecureRandom().nextBytes(array);

                    this.address_seed = Crypto.util.bytesToHex(array);

                    MyWallet.addAdditionalSeeds(seed_prefix + this.address_seed);
                }

                if (this.address_seen_n >= 100) {
                    throw 'Generating An Address Seed Greater than 100 Index. Please file an issue on Shared Coin github';
                }

                var address = SharedCoin.generateAddressFromCustomSeed(seed_prefix + this.address_seed,  this.address_seen_n);

                this.address_seen_n++;

                return address;
            },
            sanityCheck : function(success, error) {
                try {
                    var self = this;

                    if (self.offers.length == 0)
                        throw 'No Offers';

                    var networkFee = BigInteger.valueOf(SharedCoin.getMinimumFee());

                    var to_addresses_copy = $.extend({}, self.to_addresses);

                    for (var i in self.offers) {
                        var offer = self.offers[i];

                        var valueInput = BigInteger.ZERO;
                        var valueOutput = BigInteger.ZERO;

                        if (offer.offered_outpoints.length > SharedCoin.getMaximumOfferNumberOfInputs())
                            throw 'Number of inputs greater than maximum';

                        for (var ii in offer.offered_outpoints) {
                            var offered_outpoint = offer.offered_outpoints[ii];

                            if (offered_outpoint.value < SharedCoin.getMinimumInputValue())
                                throw 'Input value less than minimum';

                            if (offered_outpoint.value > SharedCoin.getMaximumInputValue())
                                throw 'Input value greater than maximum';

                            valueInput = valueInput.add(BigInteger.valueOf(offered_outpoint.value));
                        }

                        if (offer.request_outputs.length > SharedCoin.getMaximumOfferNumberOfOutputs())
                            throw 'Number of outputs greater than maximum';

                        var feePayingOutputValue = BigInteger.ZERO;
                        for (var ii in offer.request_outputs) {
                           var request_output = offer.request_outputs[ii];

                           if (!request_output.script)
                                throw 'Output script null';

                           if (request_output.value <= 0)
                                throw 'Output value <= 0';

                           if (request_output.exclude_from_fee) {
                               if (request_output.value < SharedCoin.getMinimumOutputValueExcludingFee())
                                    throw 'Output value less than minimum value excluding fee';
                           } else {
                               if (request_output.value < SharedCoin.getMinimumOutputValue())
                                    throw 'Output value less than minimum';
                           }

                           if (request_output.value > SharedCoin.getMaximumOutputValue())
                               throw 'Output value greater than maximum';

                           var script = new Script(Crypto.util.hexToBytes(request_output.script));

                           var addresses = [];

                           script.extractAddresses(addresses);

                           if (addresses.length > 1)
                               throw 'Multiple output addresses';

                           var address = addresses[0].toString();

                           var valueBN = BigInteger.valueOf(request_output.value);

                           if (to_addresses_copy[address]) {
                              //Recipient - fine
                              if (to_addresses_copy[address].compareTo(valueBN) != 0) {
                                  throw 'Wrong Value Sent To ' + address;
                              } else {
                                  delete to_addresses_copy[address];
                              }
                           } else if (MyWallet.addressExists(address)) {
                             //Change output - fine
                           } else if (extra_private_keys[address]) {
                             //Seed address - fine
                           } else {
                              throw 'Unknown Address ' + address;
                           }

                           valueOutput = valueOutput.add(valueBN);

                           if (!request_output.exclude_from_fee)
                               feePayingOutputValue = feePayingOutputValue.add(valueBN);
                        }

                        if (valueInput.compareTo(valueOutput) < 0)
                            throw 'valueInput < valueOutput';

                        var fee = valueInput.subtract(valueOutput);

                        if (fee.compareTo(networkFee) < 0)
                            throw 'Fee is too small';

                        if (fee.compareTo(BigInteger.valueOf(satoshi)) > 0)
                            throw 'Fee seems unusually large';

                        var feeThisOutput = SharedCoin.calculateFeeForValue(offer.fee_percent, feePayingOutputValue);

                        //We cant enforce an error on fee too low because change added to the next iteration isn't allocated for (increasing the total output value)
                        if (fee.compareTo(feeThisOutput.add(networkFee)) > 0)
                            throw 'Fee greater than expected';

                        if (feePayingOutputValue.compareTo(BigInteger.valueOf(SharedCoin.getMaxTotalFeePayingOutputValue())) > 0)
                            throw 'Fee paying output value greater than maximum';
                    }

                    if (nKeys(to_addresses_copy) != 0)
                       throw 'Some recipient outputs missing';

                    success();
                } catch(e) {
                    console.log(e);

                    error('Sanity Check Failed ' + e + ' : Please report to developers');
                }
            },
            toString : function() {
                var self = this;

                var str = '----- PLAN -----' + '\n';
                str += 'fee_percent_each_repetition ' + self.fee_percent_each_repetition + '\n';
                str += 'fee_each_repetition ' + self.fee_each_repetition + '\n';
                str += 'address_seen_n ' + self.address_seen_n + '\n';
                str += 'address_seed ' + self.address_seed + '\n';
                str += 'generated_addresses ' + self.generated_addresses + '\n';

                str += 'Offers ['+ '\n';

                for (var i in self.offers) {
                    str += indentString(self.offers[i].toString()) + '\n';
                }

                str += ']'+ '\n';
                str += '----- END PLAN -----';

                return str;
            },
            calculateTotalFee : function() {
                var self = this;

                var totalFee = BigInteger.ZERO;
                for (var i in self.offers) {
                    totalFee = totalFee.add(self.offers[i].calculateFee());
                }

                return totalFee;
            },
            generateChangeAddress : function() {
                var obj = MyWallet.generateNewKey();

                if (!obj || !obj.addr)
                    throw 'Error Generating Change Address';

                var change_address = obj.addr;

                this.generated_addresses.push(change_address);

                return new Bitcoin.Address(change_address);
            },
            getEstimatedTimeLeft : function() { //Estimate the time left for this plan to execute
                var self = this;

                var totalTime = 0;
                for (var i = self.c_stage; i < self.offers.length; ++i) {
                    var offer = self.offers[i];

                    //Estimate 10 seconds overhead per offer for other participants to sign
                    totalTime += 10000;

                    if (i == self.c_stage && offer.time_submitted > 0) {
                        //If this the offer we are executing now subtract the time past from the wait time
                        totalTime += Math.max(offer.wait_time - (new Date().getTime() - offer.time_submitted), 0);
                    } else {
                        //Else just total the wait time
                        totalTime += offer.wait_time;
                    }
                }

                return totalTime;
            },
            executeOffer : function(offer, success, error, progress) {

                function complete(tx_hash, tx) {
                    console.log('executeOffer.complete');

                    offer.determineOutputsToOfferNextStage(tx_hash, tx, function(outpoints_to_offer_next_stage) {
                        success(outpoints_to_offer_next_stage);
                    }, error);
                }

                var cProg = 0;

                progress(++cProg, ProgressCallbacksPerOffer);

                offer.submit(function() {
                    console.log('Successfully Submitted Offer');

                    progress(++cProg, ProgressCallbacksPerOffer);

                    offer.pollForProposalID(function(proposal_id) {
                        console.log('Proposal ID ' + proposal_id);

                        progress(++cProg, ProgressCallbacksPerOffer);

                        offer.getProposal(proposal_id, function(proposal) {
                            console.log('Got Proposal');

                            progress(++cProg, ProgressCallbacksPerOffer);

                            offer.checkProposal(proposal, function(tx) {
                                console.log('Proposal Looks Good');

                                progress(++cProg, ProgressCallbacksPerOffer);

                                offer.signInputs(proposal, tx, function(signatures) {
                                    console.log('Inputs Signed');

                                    progress(++cProg, ProgressCallbacksPerOffer);

                                    offer.submitInputScripts(proposal, signatures, function (obj) {
                                        console.log('Submitted Input Scripts');

                                        progress(++cProg, ProgressCallbacksPerOffer);

                                        proposal.pollForCompleted(complete, error);
                                    }, error, complete);
                                }, error);
                            }, error)
                        }, error, complete);
                    }, error);
                }, error, complete);
            },
            execute : function(success, error, progress) {
                var self = this;

                var execStage = function(ii) {
                    self.c_stage = ii;

                    var offerForThisStage = self.offers[ii];

                    console.log('Executing Stage ' + ii);

                    var _success = function(outpoints_to_offer_next_stage) {
                        try {
                            ii++;

                            //Do we still have stages left to complete?
                            if (ii < self.offers.length) {
                                var next_offer = self.offers[ii];

                                //Connect the outputs created from the previous stage to the inputs to use this stage

                                //I hate js (iii)
                                for (var iii in outpoints_to_offer_next_stage) {
                                    var outpoint_to_offer = outpoints_to_offer_next_stage[iii];

                                    //I despise js (iiii)
                                    for (var iiii in next_offer.offered_outpoints) {
                                        var offered_outpoint = next_offer.offered_outpoints[iiii];

                                        if (outpoint_to_offer.script == offered_outpoint.script && outpoint_to_offer.value == offered_outpoint.value) {
                                            //Script and value is equal - we have a match connect the outpoint
                                            $.extend(offered_outpoint, outpoint_to_offer);
                                            break;
                                        }
                                    }
                                }

                                execStage(ii);
                            } else if (ii == self.offers.length) {
                            //No stages left, success!
                                success();
                            }
                        } catch (e) {
                            error(e);
                        }
                    };

                    for (var _ii in offerForThisStage.offered_outpoints) {
                         var offerOutpoint = offerForThisStage.offered_outpoints[_ii];
                         if (!offerOutpoint.hash)
                            throw 'Failed to connect input ' + ii;
                    }

                    var _progress = function(stage) {
                       progress(stage + (ProgressCallbacksPerOffer*self.c_stage), ProgressCallbacksPerOffer*self.offers.length);
                    }

                    self.executeOffer(offerForThisStage, _success, function(e) {
                        //Retry the offer if it fails
                        console.log('executeOffer failed ' + e);

                        setTimeout(function() {
                            self.executeOffer(offerForThisStage, _success, error, _progress);
                        }, 5000);
                    }, _progress);
                };

                MyWallet.backupWallet('update', function() {
                    console.log('Saved Wallet');

                    var additional_seeds = MyWallet.getAdditionalSeeds();

                    var found = false;

                    for (var key in additional_seeds) {
                        var seed = additional_seeds[key];

                        if (seed.indexOf(self.address_seed) >= 0) {
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        error('Address Seed Not Found');
                    } else {
                        execStage(0);
                    }
                }, error);
            },
            constructOffers : function(initial_offer, inputTotalChangeValue, repetitions, waitTime, targetNumberOfChangeAddresses, success, error) {
                try {
                    var self = this;

                    var totalValueInput= BigInteger.ZERO;
                    for (var i in initial_offer.offered_outpoints) {
                        totalValueInput = totalValueInput.add(BigInteger.valueOf(initial_offer.offered_outpoints[i].value));
                    }

                    var totalValueLeftToConsume = totalValueInput.subtract(inputTotalChangeValue);

                    var totalChangeValueLeftToConsume = inputTotalChangeValue;

                    initial_offer.fee_percent = self.fee_percent_each_repetition[self.fee_percent_each_repetition.length-1];

                    initial_offer.wait_time = waitTime;

                    var last_offer;
                    for (var ii = 0; ii < repetitions-1; ++ii) {
                        var offer = SharedCoin.newOffer();

                        offer.wait_time = waitTime;

                        //Were going to extend the middle
                        //So Copy the inputs from the last offer to the first
                        if (ii == 0) {
                            offer.offered_outpoints = initial_offer.offered_outpoints.slice(0);

                            initial_offer.offered_outpoints = [];
                        } else {
                            //Copy the address and value from the last outputs so we can connect which inputs we need to this offer
                            for (var _i in last_offer.request_outputs) {
                                var last_offer_request_output = last_offer.request_outputs[_i];

                                 if (!last_offer_request_output.exclude_from_fee)
                                    offer.offered_outpoints.push(last_offer_request_output);
                            }
                        }

                        offer.fee_percent = self.fee_percent_each_repetition[ii];

                        totalValueLeftToConsume = totalValueLeftToConsume.subtract(self.fee_each_repetition[ii]);

                        //Determine the change value for this iteration
                        var changeValue = BigInteger.ZERO;

                        if (totalChangeValueLeftToConsume.compareTo(BigInteger.ZERO) < 0) {
                            throw 'totalChangeValueLeftToConsume < 0';
                        } else if (totalChangeValueLeftToConsume.compareTo(BigInteger.ZERO) > 0) {

                            //Number of change addresses we want to generate
                            //2 less than the number of iterations but less than targetNumberOfChangeAddresses and greater than 0
                            //TODO iteration to combine change outputs
                            var realTargetNumberOfChangeAddresses = Math.min(Math.max(repetitions-2, 1), targetNumberOfChangeAddresses);

                            //We aim for each change +-25% on each iteration
                            var changePercent =  (100 / realTargetNumberOfChangeAddresses) * ((Math.random()*0.5)+0.75);

                            changeValue = inputTotalChangeValue.divide(BigInteger.valueOf(100)).multiply(BigInteger.valueOf(Math.ceil(changePercent)));
                        }

                        //If the change value is less then getMinimumOutputValue() then ignore it and consume the entire change left
                        if (changeValue.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) <= 0 || totalChangeValueLeftToConsume.subtract(changeValue).compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) <= 0) {
                            changeValue = totalChangeValueLeftToConsume;
                            totalChangeValueLeftToConsume = BigInteger.ZERO;
                        } else {
                        //Else subtract the changeValue from the change left
                            totalChangeValueLeftToConsume = totalChangeValueLeftToConsume.subtract(changeValue);
                        }

                        if (totalChangeValueLeftToConsume.compareTo(BigInteger.ZERO) < 0) {
                            throw 'totalChangeValueLeftToConsume < 0';
                        }

                        //Add the change left to consume to the current outputs to pass it through to the next iteration
                        var totalValue = totalValueLeftToConsume.add(totalChangeValueLeftToConsume);

                        //Check that the total value of our non change outputs doesnt exceed SharedCoin.getMaxTotalFeePayingOutputValue()
                        var valueExceedingMaximum = totalValue.subtract(BigInteger.valueOf(SharedCoin.getMaxTotalFeePayingOutputValue()));
                        if (valueExceedingMaximum.compareTo(BigInteger.ZERO) > 0) {
                            //Subtract the amount we are exceeding from the total
                            totalValue = totalValue.subtract(valueExceedingMaximum);

                            //Add the exceed amount as change
                            changeValue = changeValue.add(valueExceedingMaximum);

                            //Subtract the newly added change from the change amount remaining
                            totalChangeValueLeftToConsume = totalChangeValueLeftToConsume.subtract(valueExceedingMaximum);
                        }

                        //Maximum and minimum number of outputs to aim for
                        var maxSplits = SharedCoin.getMaxOutputSplits();
                        var minSplits = SharedCoin.getMinOutputSplits();

                        //Only make split mandatory if the value is high enough
                        if (totalValue.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue() * (SharedCoin.getMinOutputSplits() + 1))) < 0) {
                            minSplits = 1;
                        }

                        //Generate random output values
                        var finalSplits = [];
                        while(true) {
                            var nSplits = Math.round((Math.random()*(maxSplits-minSplits))+minSplits);

                            var proposedSplits = splitBigInt(totalValue, nSplits);

                            if (proposedSplits.length > 1) {
                                //Round at least one output
                                var rounded = randomRound(proposedSplits[0], proposedSplits[1], SharedCoin.getRandomRoundMinSignificant());

                                proposedSplits[0] = rounded[0];
                                proposedSplits[1] = rounded[1];

                                //Round a second output more rarely
                                if (proposedSplits.length > 2) {
                                    rounded = randomRound(proposedSplits[1], proposedSplits[2], SharedCoin.getRandomRoundMinSignificant());

                                    proposedSplits[1] = rounded[0];
                                    proposedSplits[2] = rounded[1];
                                }
                            }

                            var allWithinRange = true;
                            for (var _i in proposedSplits) {
                                var proposedSplit = proposedSplits[_i];
                                if (proposedSplit.compareTo(BigInteger.valueOf(SharedCoin.getMinimumInputValue())) < 0 ||
                                    proposedSplit.compareTo(BigInteger.valueOf(SharedCoin.getMaximumOutputValue())) > 0) {
                                    allWithinRange = false;
                                    break;
                                }
                            }

                            if (allWithinRange) {
                                finalSplits = proposedSplits;
                                break;
                            }
                        }

                        //Add the Outputs
                        for (var _i in finalSplits) {
                            var splitValue = finalSplits[_i];

                            var new_address = self.generateAddressFromSeed();

                            offer.request_outputs.push({
                                value : splitValue.toString(),
                                script : Crypto.util.bytesToHex(Script.createOutputScript(new_address).buffer)
                            });
                        }

                        //Consume Change
                        if (changeValue.compareTo(BigInteger.ZERO) > 0) {
                            var change_address = self.generateChangeAddress();

                            if (changeValue.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValueExcludingFee())) < 0)
                                throw 'Change Value Too Small 0 (' + changeValue.toString() + ' < ' + SharedCoin.getMinimumOutputValueExcludingFee()+ ")";

                            offer.request_outputs.push({
                                value : changeValue.toString(),
                                script : Crypto.util.bytesToHex(Script.createOutputScript(change_address).buffer),
                                exclude_from_fee : true
                            });
                        }

                        self.offers.push(offer);

                        last_offer = offer;
                    }

                    //Now deal with the final offer (initial_offer is the final)
                    //Copy the address and value from the last outputs so we can connect which inputs we need to this offer
                    for (var _i in last_offer.request_outputs) {
                        var last_offer_request_output = last_offer.request_outputs[_i];

                         if (!last_offer_request_output.exclude_from_fee)
                            initial_offer.offered_outpoints.push(last_offer_request_output);
                    }

                    //Consume Change
                    if (totalChangeValueLeftToConsume.compareTo(BigInteger.ZERO) > 0) {
                        var change_address = self.generateChangeAddress();

                        if (totalChangeValueLeftToConsume.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValueExcludingFee())) < 0)
                            throw 'Change Value Too Small 1 (' + totalChangeValueLeftToConsume.toString() + ' < ' + SharedCoin.getMinimumOutputValueExcludingFee()+ ")";

                        initial_offer.request_outputs.push({
                            value : totalChangeValueLeftToConsume.toString(),
                            script : Crypto.util.bytesToHex(Script.createOutputScript(change_address).buffer),
                            exclude_from_fee : true
                        });
                    }

                    self.offers.push(initial_offer);

                    success(self);
                } catch (e) {
                    error(e);
                }
            }
        };
    };

    this.getRandomRoundMinSignificant = function() {
        return options.random_round_min_significant;
    }

    this.getMaxOutputSplits = function() {
        return options.max_output_splits;
    }

    this.getMinOutputSplits = function() {
        return options.min_output_splits;
    }

    this.getMaxTotalFeePayingOutputValue = function() {
        return options.max_total_fee_paying_output_value;
    }

    this.getMaximumOfferNumberOfInputs = function() {
        return options.maximum_offer_number_of_inputs;
    }

    this.getMaximumOfferNumberOfOutputs = function() {
        return options.maximum_offer_number_of_outputs;
    }

    this.getMinimumOutputValue = function() {
        return options.minimum_output_value;
    }

    this.getMinimumOutputValueExcludingFee = function() {
        return options.minimum_output_value_exclude_fee;
    }

    this.getToken = function() {
        return options.token;
    }

    this.getMinimumInputValue = function() {
        return options.minimum_input_value;
    }

    this.getMaximumInputValue = function() {
        return options.maximum_input_value;
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

    //Get Fee is mostly obsolete. Not many scenarios in which it would be re-introduced
    this.getFee = function() {
        return options.fee_percent;
    }

    this.getMinimumFee = function() {
        return options.minimum_fee ? options.minimum_fee : 0;
    }

    this.getMinRecommendedIterations = function() {
        return options.recommended_min_iterations;
    }

    this.getMaxRecommendedIterations = function() {
        return options.recommended_max_iterations;
    }

    this.getMinRecommendedWaitTime = function() {
        return options.recommended_min_wait_time;
    }

    this.getMaxRecommendedWaitTime = function() {
        return options.recommended_max_wait_time;
    }

    this.constructPlan = function(el, success, error) {
        try {
            var self = this;

            var privacySelect = el.find('select[name="privacy-required"]');

            var donate = el.find('input[name="shared-coin-donate"]').is(':checked');

            var privacyRequired = privacySelect.val();

            if (privacyRequired == 'normal') {
                //Min repetitions +-1
                var repetitions = SharedCoin.getMinRecommendedIterations() + (Math.random() < 0.5 ? -1 : 1);

                var waitTime = SharedCoin.getMinRecommendedWaitTime();

                var targetNumberOfChangeAddresses = 2;
            } else if (privacyRequired == 'higher') {
                //Max repetitions +-1
                var repetitions = SharedCoin.getMaxRecommendedIterations() + (Math.random() < 0.5 ? -1 : 1);

                var waitTime = SharedCoin.getMaxRecommendedWaitTime();

                var targetNumberOfChangeAddresses = 3;
            } else {
                throw 'Unknown privacy setting. Try refreshing the page?'
            }

            //Wait time +-25%
            waitTime += Math.round(waitTime * ((Math.random() * 0.5)-0.25));

            if (repetitions <= 0 || isNaN(repetitions)) {
                throw 'Invalid number of repetitions';
            }

            if (waitTime <= 0 || isNaN(waitTime)) {
                throw 'Invalid waitTime';
            }

            if (targetNumberOfChangeAddresses < 0 || isNaN(targetNumberOfChangeAddresses)) {
                throw 'Invalid Number Of Target Change Addresses';
            }

            console.log('constructPlan() Number Of Repetitions ' + repetitions + ' Donate ' + donate + ' privacyRequired ' + privacyRequired + ' waitTime ' + waitTime + ' targetNumberOfChangeAddresses ' + targetNumberOfChangeAddresses);

            var plan = SharedCoin.newPlan();

            function _error(e) {
                for (var key in plan.generated_addresses) {
                    MyWallet.deleteAddress(plan.generated_addresses[key]);
                }

                error(e);
            }

            //Just using initNewTx to fetch the unspent outputs
            //Very hacky but we can use the existing unspent outputs and makeTransaction routines to construct a transaction as a base for constructOffers
            var newTx = initNewTx();

            //We always need to use multiple addresses
            newTx.from_addresses = MyWallet.getActiveAddresses();

            var recipients = el.find(".recipient");

            if (recipients.length > SharedCoin.getMaximumOfferNumberOfOutputs()) {
                throw 'The Maximum Number Of Recipients is ' + SharedCoin.getMaximumOfferNumberOfOutputs();
            }

            var recipientsSeen = {};
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

                    if (value.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) < 0)
                        throw 'Output Value Too Small';

                    //Trim and remove non-printable characters
                    var send_to_address = $.trim(send_to_input.val()).replace(/[\u200B-\u200D\uFEFF]/g, '');

                    if (send_to_address == null || send_to_address.length == 0) {
                        throw 'You must enter a bitcoin address for each recipient';
                    }

                    var address = resolveAddress(send_to_address);

                    if (address == null || address.length == 0) {
                        throw 'You must enter a bitcoin address for each recipient';
                    }

                    if (recipientsSeen[address]) {
                        throw 'Shared Coin does not support multiple outputs to the same recipient';
                    }

                    recipientsSeen[address] = true;

                    var addressObject = new Bitcoin.Address(address);

                    if (addressObject.version != 0) {
                        throw 'Shared Coin only supports sending payments to regular bitcoin addresses';
                    }

                    newTx.to_addresses.push({address: addressObject, value : value});

                    plan.to_addresses[address] = value;
                } catch (e) {
                    _error(e);
                }
            });

            //Check that we have resolved all to addresses
            if (newTx.to_addresses.length == 0 || newTx.to_addresses.length < recipients.length) {
                return;
            }

            var to_values_before_fees = [];
            var fee_each_repetition = [];
            var fee_percent_each_repetition = [];

            var donationSplits = [];

            if (donate) {
                var DonationPercent = (Math.random() * (DonationPercentMax-DonationPercentMin)) + DonationPercentMin;

                //Favour larger split second
                var split = (DonationPercent / 2) * ((Math.random() * 1.8) + 0.2);

                donationSplits.push((split).toFixed(2));
                donationSplits.push((DonationPercent - split).toFixed(2));
            }

            for (var i = repetitions-1; i >= 0; --i) {
                var feePercent = SharedCoin.getFee();

                //At the donation reduction at the the end of the iterations
                if (donationSplits.length > 0) {
                    feePercent += donationSplits.pop();
                }

                fee_percent_each_repetition[i] = feePercent;
                fee_each_repetition[i] = BigInteger.ZERO;
            }

            var totalFee = BigInteger.ZERO;
            for (var i in newTx.to_addresses) {
                var to_address = newTx.to_addresses[i];

                to_values_before_fees.push(to_address.value);

                for (var ii = repetitions-1; ii >= 0; --ii) {
                    var feeThisOutput = SharedCoin.calculateFeeForValue(fee_percent_each_repetition[ii], to_address.value);

                    totalFee = totalFee.add(feeThisOutput);

                    fee_each_repetition[ii] = fee_each_repetition[ii].add(feeThisOutput);
                }
            }

            var networkFee = BigInteger.valueOf(SharedCoin.getMinimumFee());

            //Add the network fee for each repetition
            totalFee = totalFee.add(networkFee.multiply(BigInteger.valueOf(repetitions)));

            newTx.to_addresses[0].value = newTx.to_addresses[0].value.add(totalFee);

            //Add the network fee
            for (var i in fee_each_repetition) {
                 fee_each_repetition[i] = fee_each_repetition[i].add(networkFee);
            }

            var ChangeAddressHack = '1BitcoinEaterAddressDontSendf59kuE';  //Fixed address so we can identify the change output. Obviously this isn't used

            newTx.min_input_confirmations = 1;
            newTx.do_not_use_unspent_cache = true;
            newTx.allow_adjust = false;
            newTx.change_address = new Bitcoin.Address(ChangeAddressHack);
            newTx.base_fee = BigInteger.ZERO;
            newTx.min_input_size = BigInteger.valueOf(SharedCoin.getMinimumInputValue());
            newTx.fee = BigInteger.ZERO;
            newTx.ask_for_fee = function(yes, no) {
                no();
            };

            //If the address or outpoint hash is the same it counts as a duplicate input
            function nUniqueInputs(inputs) {
                var addrMap = {};
                var hashMap = {}

                for (var i in inputs) {
                    var input = inputs[i];

                    var addr = new Bitcoin.Address(input.script.simpleOutPubKeyHash()).toString();

                    addrMap[addr] = true;
                    hashMap[input.outpoint.hash] = true;
                }
                return Math.min(nKeys(addrMap), nKeys(hashMap));
            }

            var minChangeTarget = BigInteger.valueOf(satoshi); //Try and leave at least 1 BTC change

            //Sort by value highest
            newTx.sortOutputs = function(outputs) {
                outputs = outputs.sort(function(a, b){
                  return b.value.compareTo(a.value);
                });

                return outputs;
            };

            //We consume all selected outpoints
            newTx.isSelectedValueSufficient = function(txValue, availableValue, inputs) {
                if (!inputs) {
                   throw 'isSelectedValueSufficient inputs null. Please clear your cache and refresh the page';
                }

                var self = this;

                //Ensure we don't select too many inputs
                if (self.selected_outputs.length >= SharedCoin.getMaximumOfferNumberOfInputs()) {
                    return true;
                }

                //If we have at least minChangeTarget of change and have used more than one unique address return true
                //This is ideal
                if (availableValue.compareTo(txValue.add(minChangeTarget)) >= 0 && nUniqueInputs(inputs) > 1) {
                    return true;
                }

                return false;
            }

            var offer = SharedCoin.newOffer();

            newTx.addListener({
                on_error : function(e) {
                    _error();
                }
            });

            newTx.signInputs = function() {
                try {
                    var self = this;

                    if (self.tx.ins.length > SharedCoin.getMaximumOfferNumberOfInputs()) {
                        _error('Maximum number of inputs exceeded. Please consolidate some or lower the send amount');
                        return;
                    }

                    for (var i = 0; i < self.tx.ins.length; ++i) {
                        var input = self.tx.ins[i];

                        var base64Hash = input.outpoint.hash;

                        var hexHash = Crypto.util.bytesToHex(Crypto.util.base64ToBytes(base64Hash).reverse());

                        offer.offered_outpoints.push({hash : hexHash, index : input.outpoint.index, value : input.outpoint.value.toString()});
                    }


                    var changeValue = BigInteger.ZERO;
                    for (var i = 0; i < self.tx.outs.length; ++i) {
                        var output = self.tx.outs[i];

                        var array = output.value.slice(0);

                        array.reverse();

                        var value = new BigInteger(array);

                        var pubKeyHash = new Bitcoin.Script(output.script).simpleOutPubKeyHash();

                        var outputAddress = new Bitcoin.Address(pubKeyHash).toString();

                        if (outputAddress.toString() == ChangeAddressHack) {
                            //Ignore this. constructOffers() will consume the change properly.
                            changeValue = changeValue.add(value);
                        } else {
                            offer.request_outputs.push({value : to_values_before_fees[i].toString(), script : Crypto.util.bytesToHex(output.script.buffer)});
                        }
                    }

                    if (changeValue.compareTo(BigInteger.ZERO) == 0) {
                        throw 'Transaction does not have any change. Shared Coin cannot send the exact amount available in the wallet.'
                    }

                    plan.fee_each_repetition = fee_each_repetition;
                    plan.fee_percent_each_repetition = fee_percent_each_repetition;

                    plan.constructOffers(offer, changeValue, repetitions, waitTime, targetNumberOfChangeAddresses, success, function(e) {
                        _error(e);
                    });

                } catch (e) {
                    _error(e);
                }
            };

            newTx.start();
        } catch (e) {
            _error(e);
        }
    }

    this.calculateFeeForValue = function(fee_percent, input_value) {
        if (input_value.compareTo(BigInteger.ZERO) > 0 && fee_percent > 0) {
            var mod = Math.ceil(100 / fee_percent);

            var fee = input_value.divide(BigInteger.valueOf(mod));

            return fee;
        } else {
            return BigInteger.ZERO;
        }
    }

    this.recoverSeeds = function(shared_coin_seeds, _success, _error) {

        //Disable auto logout as recovery can take a while
        MyWallet.disableLogout(true);

        var modal = $('#sharedcoin-recover-progress-modal');

        var progress = modal.find('.bar');

        modal.modal('show');

        progress.width('0%');

        var error = function(e) {
            modal.modal('hide');

            _error(e);
        }

        var success = function(m) {
            modal.modal('hide');

            _success(m);
        }

        var index = 0;

        var final_balance_recovered = 0;

        function doNext() {

            if (!modal.is(':visible')) {
                return;
            }

            if (index >= shared_coin_seeds.length) {
                if (final_balance_recovered > 0) {
                    MyWallet.get_history();

                    MyWallet.makeNotice('success', 'misc-success', formatBTC(final_balance_recovered) + ' recovered from intermediate addresses');
                }

                success();

                return;
            }

            progress.width(((index / shared_coin_seeds.length) * 100) + '%');

            var seed = shared_coin_seeds[index];

            ++index;

            var keys = {};

            for (var i = 0; i < 100; ++i) {
                var key_container = SharedCoin.generateAddressAndKeyFromCustomSeed(seed, i);

                var address = key_container.address.toString();

                if (!MyWallet.addressExists(address)) {
                    keys[address] = key_container.key;
                }
            }

            BlockchainAPI.get_balances(Object.keys(keys), function(results) {
                try {
                    var total_balance = 0;
                    for (var address in results) {
                        var balance = results[address].final_balance;
                        if (balance > 0) {
                            console.log('Balance ' + address + ' = ' + balance);

                            var ecKey = keys[address];

                            var uncompressed_address = ecKey.getBitcoinAddress().toString();

                            try {
                                if (MyWallet.addPrivateKey(ecKey, {
                                    compressed : address != uncompressed_address,
                                    app_name : IMPORTED_APP_NAME,
                                    app_version : IMPORTED_APP_VERSION
                                })) {
                                    console.log('Imported ' + address);
                                }
                            } catch (e) {
                                console.log('Error importing ' + address);
                            }
                        }

                        total_balance += balance;
                    }

                    if (total_balance > 0) {
                        final_balance_recovered += total_balance;

                        MyWallet.backupWalletDelayed('update', function() {
                            setTimeout(doNext, 500);
                        });
                    } else {
                        setTimeout(doNext, 500);
                    }
                } catch (e) {
                    error(e);
                }
            }, error);
        }

        setTimeout(doNext, 100);
    }

    this.init = function(el, i) {
         if (!MyWallet.getSharedcoinEndpoint() || MyWallet.getSharedcoinEndpoint().length == 0) {
            (function(self, el, i) {
                if (!el.is(':visible')) return;
                if (i > 10) return; ++i;
                setTimeout(function() {
                    self.init(el);
                }, 2000);
            })(this, el, i);
            return;
         }

         URL = MyWallet.getSharedcoinEndpoint() + '?version=' + version;

        $('#sharedcoin-recover').unbind().click(function() {
            var self = $(this);

            MyWallet.getSecondPassword(function() {
                self.prop('disabled', true);

                var original_text = self.text();

                self.text('Working. Please Wait...');

                var additional_seeds = MyWallet.getAdditionalSeeds();

                var shared_coin_seeds = [];
                for (var key in additional_seeds) {
                    var seed = additional_seeds[key];

                    if (seed.indexOf(seed_prefix) == 0 || seed.indexOf(seed_prefix_v1) == 0) {
                        shared_coin_seeds.push(seed);
                    }
                }

                //Reverse to scan newest first
                shared_coin_seeds.reverse();

                SharedCoin.recoverSeeds(shared_coin_seeds, function() {
                    self.prop('disabled', false);
                    self.text(original_text);
                }, function(e) {
                    self.prop('disabled', false);
                    self.text(original_text);
                    MyWallet.makeNotice('error', 'misc-error', e);
                });
            });
        });

        var send_button = el.find('.send');
        var send_options = el.find('.send-options');

        send_button.unbind().prop('disabled', true);

        el.find('input[name="send-value"]').bind('keyup change', function() {
            enableSendButton();
        });

        send_options.hide();

        function setSendOptions() {
            var spans = send_options.find('span');

            spans.eq(0).text(formatBTC(SharedCoin.getMaximumOutputValue()));
            spans.eq(1).text(formatBTC(SharedCoin.getMinimumOutputValue()));

            send_options.show();
        }

        function totalValueBN() {
            var total_value = BigInteger.ZERO;
            el.find('input[name="send-value"]').each(function(){
                total_value = total_value.add(precisionToSatoshiBN($(this).val()));
            });
            return total_value;
        }

        function enableSendButton() {
            send_button.unbind();

            if (SharedCoin.getIsEnabled() && version >= SharedCoin.getMinimumSupportedVersion()) {
                var input_value = totalValueBN();

                if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) < 0) {
                    send_button.prop('disabled', true);
                } else if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMaximumOutputValue())) > 0) {
                    send_button.prop('disabled', true);
                } else {
                    send_button.prop('disabled', false);


                    send_button.unbind().click(function() {
                        var timerInterval;
                        if (timerInterval) {
                            clearInterval(timerInterval);
                            timerInterval = null;
                        }

                        MyWallet.disableLogout(true);

                        var error = function(e, plan) {
                            console.log('Fatal Error');

                            progressModal.setProgressError();

                            progressModal.setEstimatedTime(0);

                            if (timerInterval) {
                                clearInterval(timerInterval);
                                timerInterval = null;
                            }

                            el.find('input,select,button').prop('disabled', false);

                            enableSendButton();

                            MyWallet.disableLogout(false);

                            MyWallet.makeNotice('error', 'misc-error', e, (plan && plan.c_stage) > 0 ? 60000 : 10000);

                            setTimeout(function() {
                                if (plan && plan.c_stage >= 0) {
                                    console.log('Recover Seeds');

                                    progressModal.hide();

                                    SharedCoin.recoverSeeds([seed_prefix + plan.address_seed], function() {
                                        progressModal.show();
                                    }, function() {
                                        progressModal.show();
                                    });
                                }
                            }, 1000);

                            progressModal.enableCancel();
                        };

                        var success = function(){
                            progressModal.setProgressSuccess();

                            progressModal.setEstimatedTime(0);

                            if (timerInterval) {
                                clearInterval(timerInterval);
                                timerInterval = null;
                            }

                            el.find('input,select,button').prop('disabled', false);

                            MyWallet.makeNotice('success', 'misc-success', 'Shared Coin Transaction Successfully Completed');

                            MyWallet.disableLogout(false);

                            progressModal.hide();

                            enableSendButton();
                        }

                        if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMinimumOutputValue())) < 0) {
                            MyWallet.makeNotice('error', 'misc-error', 'The Minimum Send Value is ' +  formatPrecision(SharedCoin.getMinimumOutputValue()));
                            return;
                        } else if (input_value.compareTo(BigInteger.valueOf(SharedCoin.getMaximumOutputValue())) > 0) {
                            MyWallet.makeNotice('error', 'misc-error', 'The Maximum Send Value is ' +  formatPrecision(SharedCoin.getMaximumOutputValue()));
                            return;
                        }

                        MyWallet.getSecondPassword(function() {
                            loadScript('wallet/signer', function() {

                                progressModal.show();

                                progressModal.setProgressInfo();

                                progressModal.disableCancel();

                                progressModal.setProgress(0, 1);

                                progressModal.setEstimatedTime(0);

                                var displayValue = totalValueBN();

                                var recipients = el.find(".recipient");
                                if (recipients.length == 1)
                                    var displayAddress = recipients.find('input[name="send-to-address"]').val();
                                else
                                    var displayAddress = 'Multiple Recipients';

                                progressModal.setAddressAndAmount(displayAddress, displayValue);

                                el.find('input,select,button').prop('disabled', true);

                                MyWallet.setLoadingText('Constructing Plan. Please Wait.');

                                var timeSinceLastSubmit = new Date().getTime() - LastSignatureSubmitTime;

                                var interval = Math.max(0, MinTimeBetweenSubmits - timeSinceLastSubmit);

                                if (interval > 0 ) {
                                    $('.loading-indicator').fadeIn(200);
                                }

                                setTimeout(function() {
                                    $('.loading-indicator').hide();

                                    SharedCoin.constructPlan(el, function(plan) {
                                        console.log('Created Plan');

                                        //console.log(plan.toString());

                                        timerInterval = setInterval(function() {
                                            progressModal.setEstimatedTime(plan.getEstimatedTimeLeft());
                                        }, 500);

                                        plan.sanityCheck(function() {
                                            console.log('Sanity Check OK');

                                            progressModal.hide();

                                            reviewModal.show(plan, function() {
                                                progressModal.show();

                                                plan.execute(success, function(e) {
                                                    error(e, plan);
                                                }, function(stage, max_stage) {
                                                    //Progress listener
                                                    progressModal.setProgress(stage, max_stage);
                                                });
                                            }, function () {
                                                progressModal.show();
                                                error();
                                            });
                                        }, error);
                                    }, error);
                                }, interval)
                            }, error);
                        }, error);
                    });
                }
            } else {
                send_button.prop('disabled', true);
            }
        }

        MyWallet.setLoadingText('Fetching Shared Coin Info');

        $.retryAjax({
            dataType: 'json',
            type: "POST",
            url: URL,
            timeout: AjaxTimeout,
            retryLimit: AjaxRetry,
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

        enableSendButton();
    }
}