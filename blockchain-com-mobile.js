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

