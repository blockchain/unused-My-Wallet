isExtension = false;
APP_NAME = 'javascript_blockchain_com_mobile';

$(document).ready(function() {
    MyWallet.setIsMobile(true);
    var isIOSDevice = ( navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? true : false );
    MyWallet.setIsIOSDevice(isIOSDevice);

    var body = $(document.body);

    var data_root = body.data('root');
    if (data_root)
        root = data_root;

    var data_resource = body.data('resource');
    if (data_resource)
        resource = data_resource;

    //Chrome should automatically grant notification permissions
    MyWallet.setHTML5Notifications(true);

    if (! MyWallet.getIsIOSDevice()) {
        //change type from file to text if device is not iOS
        $(".scanqrinput").attr('type', "text");
    }

    // dont ever logout in mobile
    MyWallet.setLogoutTime("86400000");

    var guid = null;
    MyStore.get('guid', function(result) {
        guid = result;
    });

    var passphrase = null;
    MyStore.get('passphrase', function(result) {
        passphrase = result;
    });

    if (guid != null && passphrase != null) {
        $('#restore-guid').val(guid);
        $('#restore-password').val(passphrase);

        MyWallet.addEventListener(function(event) {
            if (event == 'did_set_guid')
                $('#restore-wallet-continue').trigger('click');
        });

        MyWallet.setGUID(guid, false);
    } else {
        $("#landing-container").show();
    }


    $('#unpairdevice').click(function() {
        MyStore.clear();
        $('#logout').trigger('click');
    });

    $('#create-account-btn').click(function() {
        $("#landing-container").hide();
        $("#createacct-container").show();
    });

    $('#pair-device-btn').click(function() {
        $("#landing-container").hide();
        $("#restore-wallet").show();
        $("#pairdevice-stage1").show();
    });

    $('#pairdevice-Continue1').click(function() {
        $("#pairdevice-stage1").hide();
        $("#pairdevice-stage2").show();
    });

    $('#pairdevice-Continue2').click(function() {
        $("#pairdevice-stage2").hide();
        $("#pairdevice-stage3").show();
    });

    function toFixed(value, precision) {
        var power = Math.pow(10, precision || 0);
        return String(Math.round(value * power) / power);
    }

    $('#myModalAddress').on('show', function() {
        var address = document.getElementById("bitcoin-address").innerHTML;

        $('#request-payment-btn').click(function() {
            $('#myModalAddress').modal('hide');
            var modal = $('#myModalQr');
            modal.modal('show');
            loadScript('wallet/jquery.qrcode', function() {
                modal.find('.address-qr-code').empty().qrcode({width: 300, height: 300, text: address});
            });

            $('#requestAmount').unbind().bind('keyup change', function() {
                var value = parseFloat($('#requestAmount').val());
                var result = toFixed(value, 8);
                var bitcoinURI = "bitcoin://"+ address +"?amount=" + result;
                console.log('bitcoinURI: ' + bitcoinURI);
                $('#myModalQr').find('.address-qr-code').empty().qrcode({width: 300, height: 300, text: bitcoinURI});
            });
        });

        $('#archive-address-btn').click(function() {
            MyWallet.archiveAddr(address);
            $('#myModalAddress').modal('hide');
        });

        $('#set-label-btn').click(function() {
            $('#myModalAddress').modal('hide');
            loadScript('wallet/address_modal', function() {
                showLabelAddressModal(address);
            });
        });
    });


    $('#change-password-btn').click(function() {
        $('#password').val($('#change-password').val());
        $('#password2').val($('#change-password2').val());
        $('#update-password-btn').trigger('click');
    });

    $('#active-addresses-table').on('click', '.modal-address', function(){
        var address = $(this).attr('id');
        var addr = document.getElementById("bitcoin-address");
        addr.innerHTML = address;
    });


    function importScannedPrivateKey(value, success, error) {
       try {
            if (value.length == 0) {
                throw  'You must enter a private key to import';
            }

            var format = MyWallet.detectPrivateKeyFormat(value);

            console.log('PK Format ' + format);

            if (format == 'bip38') {
                loadScript('wallet/import-export', function() {

                    MyWallet.getPassword($('#import-private-key-password'), function(_password) {
                        ImportExport.parseBIP38toECKey(value, _password, function(key, isCompPoint) {
                            scanned_key = key;
                            compressed = isCompPoint;

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

        if (scanned_key)
            success(scanned_key);
        else
            error(error_msg);

    }

    $('#import-private-scan').on('click', function (e) {
        MyWallet.getSecondPassword(function() {

            MyWallet.scanQRCode(function(code) {
                  importScannedPrivateKey(code, function (key, compressed) {

                            if (MyWallet.addPrivateKey(key, {compressed : compressed, app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION})) {

                                //Perform a wallet backup
                                MyWallet.backupWallet('update', function() {
                                    MyWallet.get_history();
                                });

                                MyWallet.makeNotice('success', 'added-address', 'Imported Bitcoin Address ' + key.getBitcoinAddress());
                            } else {
                                throw 'Unable to add private key for bitcoin address ' + key.getBitcoinAddress();
                            }

                        }, function(e) {

                            MyWallet.makeNotice('error', 'misc-error', e);
                        });

            }, function(e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });

        });
    });

    $('#import-address-scan').on('click', function (e) {
        MyWallet.scanQRCode(function(data) {
            importWatchOnlyAddress(data);
        }, function(e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        });
    });

    function importWatchOnlyAddress(value) {
            if (value.length = 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter an address to import');
                return;
            }

            try {
                 var address = new Bitcoin.Address(value);

                 if (address.toString() != value) {
                     throw 'Inconsistency between addresses';
                 }

                    try {
                        if (MyWallet.addWatchOnlyAddress(value)) {
                            MyWallet.makeNotice('success', 'added-address', 'Successfully Added Address ' + address);

                            try {
                                ws.send('{"op":"addr_sub", "addr":"'+address+'"}');
                            } catch (e) { }

                            //Backup
                            MyWallet.backupWallet('update', function() {
                                MyWallet.get_history();
                            });
                        } else {
                            throw 'Wallet Full Or Addresses Exists'
                        }
                    } catch (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    }
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Error importing address: ' + e);
                return;
            }
    }


    /*
    $('#overlay').on('click', function (e) {
        $(this).fadeOut();
        e.preventDefault();
    });
    window.mySwipe = new Swipe(document.getElementById('#mySwipe'), {
        continuous: false,
        callback: function(index, elem) {
            document.getElementById('#pagenum').innerHTML=mySwipe.getPos() + 1;
        }
    });

    $('.jumpNext').on('click', function (e) {
        mySwipe.next();
        e.preventDefault();
    });
    */

    $('#camPlaceholder').on('click', function (e) {
        MyWallet.scanQRCode(function(data) {
            console.log('Scanned: ' + data);
            var components = data.split("|");

            var guid = components[0];
            var sharedKey = components[1];
            var password = components[2];

            $('#restore-guid').val(guid);
            $('#restore-password').val(password);

             MyWallet.addEventListener(function(event) {
                 if (event == 'did_decrypt') {
                    MyStore.put('passphrase', password);
                 }
             });

             MyWallet.addEventListener(function(event) {
                 if (event == 'did_set_guid') {
                    $('#restore-wallet-continue').trigger('click');
                 }
             });

            MyWallet.setGUID(guid, false);
        }, function(e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        });
    });

    $("#scanpaircode").on("change", function(event) {
        $('#camPlaceholder').trigger('click');
    });
});
