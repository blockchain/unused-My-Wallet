//Included in wallet pages when visiting a /wallet-legacy/claim link

var privateKeyToSweep;

function showClaimModal(key) {
    var modal = $('#claim-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.balance').text('Loading...');

    var from_addresses = [key.getBitcoinAddress().toString(), key.getBitcoinAddressCompressed().toString()];

    BlockchainAPI.get_balance(from_addresses, function(data) {

        if (data == 0) {
            modal.find('.spent').show(200);
        } else {
            modal.find('.spent').hide(200);
        }

        modal.find('.balance').text('Amount: ' + formatBTC(data));
    }, function() {
        modal.find('.balance').text('Error Fetching Balance');
    });

    modal.find('.create').unbind().click(function() {
        window.location = root + 'wallet/new#' + B58.encode(privateKeyToSweep.priv);
    });

    modal.find('.login').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.forward').unbind().click(function() {

        $('#claim-manual').show(200);

        $('#claim-manual-send').unbind().click(function() {
            loadScript('wallet/signer', function() {
                try {
                    var to_address = $.trim($('#claim-manual-address').val());

                    try {
                        var bitcoin_address = new Bitcoin.Address(to_address);
                    } catch (e) {
                        MyWallet.makeNotice('error', 'misc-error', 'Invalid Bitcoin Address');
                        return;
                    }

                    BlockchainAPI.get_balance(from_addresses, function(value) {
                        modal.modal('hide');

                        var obj = initNewTx();

                        obj.fee = obj.base_fee; //Always include a fee
                        obj.to_addresses.push({address: bitcoin_address, value : BigInteger.valueOf(value).subtract(obj.fee)});
                        obj.from_addresses = from_addresses;

                        for (var i in from_addresses) {
                            var from_address = from_addresses[i];
                            obj.extra_private_keys[from_address] = B58.encode(privateKeyToSweep.priv);
                        }

                        obj.ready_to_send_header = 'Bitcoins Ready to Claim.';

                        obj.start();

                    }, function() {
                        MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                    });
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            });
        });

        $(this).hide();
    });
}

$(document).ready(function() {

    //Add an addresses from the "Add to My Wallet" link
    //Check if we have any addresses to add
    var hash = decodeURI(window.location.hash.replace("#", ""));

    if (hash.indexOf('bitcoin:') == 0) {
        MyWallet.makeNotice('error', 'error-addr', 'Hash appears to be a URI not a private key');
        return;
    }

    //Hash No Longer Needed
    window.location.hash = '';

    //HTML5 remove hash
    if ("pushState" in history)
        history.pushState("", document.title, window.location.pathname + window.location.search);

    if (!hash || hash.length == 0)
        return;

    try {
        var format = MyWallet.detectPrivateKeyFormat(hash);

        privateKeyToSweep = MyWallet.privateKeyStringToKey(hash, format);
    } catch (e) {
        console.log(e);

        MyWallet.makeNotice('error', 'error-addr', 'Error Decoding Private Key. Could not claim coins.');
    }

    if (privateKeyToSweep) {
        //If No guid available show the user the "claim modal" which includes a signup link
        showClaimModal(privateKeyToSweep);

        MyWallet.addEventListener(function(event) {
            if (event == 'did_decrypt') {
                if (privateKeyToSweep) {
                    loadScript('wallet/signer', function() {
                        var from_addresses = [privateKeyToSweep.getBitcoinAddress().toString(), privateKeyToSweep.getBitcoinAddressCompressed().toString()];

                        BlockchainAPI.get_balance(from_addresses, function(value) {
                            if (value == 0) {
                                MyWallet.makeNotice('error', 'misc-error', 'The payment has already been claimed');
                                return;
                            }

                            var obj = initNewTx();

                            obj.fee = obj.base_fee; //Always include a fee
                            obj.to_addresses.push({address: new Bitcoin.Address(MyWallet.getPreferredAddress()), value : BigInteger.valueOf(value).subtract(obj.fee)});
                            obj.from_addresses = from_addresses;

                            for (var i in from_addresses) {
                                var from_address = from_addresses[i];
                                obj.extra_private_keys[from_address] = B58.encode(privateKeyToSweep.priv);
                            }

                            obj.start();

                        }, function() {
                            MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                        });
                    });
                }
            }
        });
    }
})
