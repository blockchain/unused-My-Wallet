if (window.opener != null)
    window.opener.open_pk;

var escrow = null;

$(document).ready(function() {

    $('#new-request').hide();
    $('#request').hide();
    $('#private-key').hide();

    showEscrow();

    $('#decline-request').click(function() {
        declineRequest();
    });

    $('#approve-request').click(function() {
        approveRequest();
    });
});


function showRequest() {

    var container = $('#request');

    container.show();

    var request = escrow.redemption_request;

    $('#request-addr').empty();
    $('#sigs').empty();

    var myAddr = null;
    if (key != null) {
        $('#approve-request').hide();
        myAddr = key.getBitcoinAddress().toString();
    }

    for (var i = 0; i < request.outs.length; ++ i) {
        var out = request.outs[i];
        $('#request-addr').append('<p>Release ' + formatBTC(out.value) + ' BTC to bitcoin address ' + formatOutput(out) + '</p>');
    }

    $('#m-needed').text(escrow.m - escrow.redemption_request.nsigned);

    for (var i = 0; i < request.sigs.length; ++ i) {
        var sig = request.sigs[i];

        if (sig.status) {
            $('#sigs').append('<li>'+sig.addr+' - <font color="green">Approved</font></li>');
        } else {
            $('#sigs').append('<li>'+sig.addr+' - <font color="red">Approval Needed</font></li>');

            if (myAddr != null && myAddr == sig.addr) {
                $('#approve-request').show();
            }
        }
    }

}

//Make a new transaction to the specified address and submit it to the server for the other parties to sign
function internalApproveRequest(key) {

    var hashType = parseInt(1); // SIGHASH_ALL

    //Make the transaction hash
    var sendTx = Bitcoin.Transaction.deserialize(Crypto.util.hexToBytes(escrow.redemption_request.txhex));

    var hash = sendTx.hashTransactionForSignature(new Bitcoin.Script(Crypto.util.hexToBytes(script)), 0, hashType);

    //Sign in with our private key
    var rs = key.sign(hash);

    //Serialize the sig
    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    // Append hash type
    signature.push(hashType);

    //Create a timestamp and sign it with our private key
    //Use for server side validation (Expires after approx 30 seconds)
    var timestamp = parseInt(new Date().getTime() / 1000);
    var rs = key.sign(BigInteger.valueOf(timestamp).toByteArray());

    //Hex encode all byte[]
    var pubHex = Crypto.util.bytesToHex(key.getPub());
    var sigHex = Crypto.util.bytesToHex(signature);

    //Submit the request
    $.post(root + 'escrow', {'method' : 'approve', 'txIndex' : txIndex, 'txOutputN' : txOutputN, 'pubKey' : pubHex, 'timestamp' : timestamp, 'r' : rs.r.toString(), 's' : rs.s.toString(), 'sig' :sigHex},  function(response) {

        MyWallet.makeNotice('success', 'misc-success', response);

        showEscrow();

    }).error(function(data) {

            MyWallet.makeNotice('error', 'misc-error', data.responseText);

            //Clear the key incase the user entered an incorrect one
            key = null;
        });

}

//Make a new transaction to the specified address and submit it to the server for the other parties to sign
function internalMakeRequest(key, addr) {

    //Create a new transaction
    var sendTx = new Bitcoin.Transaction();

    //The value of output were going to redeem
    var value = BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(escrow.hexvalue));

    //Hash to the transaction were redeeming from
    var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(txHash));

    //Add the input of the escorw were redeeming
    sendTx.addInput(new Bitcoin.TransactionIn({outpoint: {hash: b64hash, index: txOutputN}, sequence: 4294967295}));

    //var minersFee = BigInteger.valueOf(1000000); // 0.01 BTC

    //value = value.subtract(minersFee);

    //Add an output to the specified address
    sendTx.addOutput(addr, value);

    var hashType = parseInt(1); // SIGHASH_ALL

    //Make the transaction hash
    var hash = sendTx.hashTransactionForSignature(new Bitcoin.Script(Crypto.util.hexToBytes(script)), 0, hashType);

    //Sign in with our private key
    var rs = key.sign(hash);

    //Serialize the sig
    var signature = Bitcoin.ECDSA.serializeSig(rs.r, rs.s);

    // Append hash type
    signature.push(hashType);

    //Create a timestamp and sign it with our private key
    //Use for server side validation (Expires after approx 30 seconds)
    var timestamp = parseInt(new Date().getTime() / 1000);
    var rs = key.sign(BigInteger.valueOf(timestamp).toByteArray());

    //Hex encode all byte[]
    var txHex = Crypto.util.bytesToHex(sendTx.serialize());
    var pubHex = Crypto.util.bytesToHex(key.getPub());
    var hashHex = Crypto.util.bytesToHex(hash);
    var sigHex = Crypto.util.bytesToHex(signature);

    //Submit the request
    $.post(root + 'escrow', {'method' : 'request', 'txIndex' : txIndex, 'txOutputN' : txOutputN, 'pubKey' : pubHex, 'timestamp' : timestamp, 'r' : rs.r.toString(), 's' : rs.s.toString(), 'hash' : hashHex, 'sig' :sigHex, 'tx' : txHex},  function(response) {

        MyWallet.makeNotice('success', 'misc-success', response);

        showEscrow();

    }).error(function(data) {

            MyWallet.makeNotice('error', 'misc-error', data.responseText);

            //Clear the key incase the user entered an incorrect one
            key = null;
        });

}

function showMakeRequest() {

    var value = BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(escrow.hexvalue));

    var container = $('#new-request');

    container.show();

    container.find('.value').text(formatBTC(value.toString()));

    var addrinput = container.find('input[name="from-address"]');

    addrinput.val('');

    $('#new-request-btn').unbind().click(function() {

        if (addrinput == null) {
            MyWallet.makeNotice('error', 'misc-error', 'No address entered');
            return;
        }

        var addr = null;

        try {
            addr = new Bitcoin.Address(addrinput.val());
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', 'Invalid bitcoin address');
            return;
        }

        if (key == null) {

            showPrivateKeyModal(function(nkey) {
                internalMakeRequest(nkey, addr);
            }, function(e) {
                MyWallet.makeNotice('error', 'misc-error', e, 5000);
                return;
            }, 'Multiple Addresses');
        } else {
            internalMakeRequest(key, addr);
        }

    });
}

function internalDeclineRequest(key) {
    var timestamp = parseInt(new Date().getTime() / 1000);

    var rs = key.sign(BigInteger.valueOf(timestamp).toByteArray());

    var pubHex = Crypto.util.bytesToHex(key.getPub());

    $.post(root + 'escrow', {'method' : 'decline', 'txIndex' : txIndex, 'txOutputN' : txOutputN, 'pubKey' : pubHex, 'timestamp' : timestamp, 'r' : rs.r.toString(), 's' : rs.s.toString()},  function(data) {
        MyWallet.makeNotice('success', 'misc-success', data);

        showEscrow();
    }).error(function(data) {
            MyWallet.makeNotice('error', 'misc-error', data.responseText);
            return;
        });
}

function declineRequest() {

    if (key == null) {
        showPrivateKeyModal(function(key) {
            internalDeclineRequest(key);
        }, function(e) {
            MyWallet.makeNotice('error', 'misc-error', e, 5000);
            return;
        });
    } else {
        internalDeclineRequest(key);
    }
}

function approveRequest() {

    if (key == null) {
        showPrivateKeyModal(function(key) {
            internalApproveRequest(key);
        }, function(e) {
            MyWallet.makeNotice('error', 'misc-error', e, 5000);
            return;
        });
    } else {
        internalApproveRequest(key);
    }
}
function showEscrow() {

    $('#new-request').hide();
    $('#request').hide();

    var timestamp = parseInt(new Date().getTime() / 1000);

    $.post(root + 'escrow', {'method' : 'fetch', 'txIndex' : txIndex, 'txOutputN' : txOutputN, 'timestamp' : timestamp},  function(_escrow) {

        escrow = _escrow;

        if (escrow.redemption_request == null) {
            showMakeRequest();
        } else {
            showRequest();
        }
    }).error(function(data) {
            MyWallet.makeNotice('error', 'misc-error', data.responseText);
            return;
        });
}

