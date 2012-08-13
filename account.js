function updateKV(txt, method, value, success, error) {
    if (!isInitialized || offline) return;

    if (value == null || value.length == 0) {
        makeNotice('error', 'misc-error', txt + ': Invalid value');
        return;
    }

    if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36) {
        makeNotice('error', 'misc-error', 'Shared key is invalid');
        return;
    }

    value = $.trim(value);

    setLoadingText(txt);

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, length : (value+'').length, payload : value+'', method : method, format : 'plain' },  function(data) {
        makeNotice('success', method + '-success', data);

        if (success) success();
    })
        .error(function(data) {
            makeNotice('error', method + '-error', data.responseText);

            if (error) error();
        });
}

function setDoubleEncryptionButton() {
    if (double_encryption) {
        $('.double-encryption-off').hide();
        $('.double-encryption-on').show();
    } else {
        $('.double-encryption-on').hide();
        $('.double-encryption-off').show();
    }

    $('#double-password').val('');
    $('#double-password2').val('');
}

function setDoubleEncryption(value) {

    var panic = function(e) {
        console.log('Panic ' + e);

        //If we caught an exception here the wallet could be in a inconsistent state
        //We probably haven't synced it, so no harm done
        //But for now panic!
        window.location.reload();
    };

    try {
        if (double_encryption == value)
            return;

        if (value) {
            var tpassword = $('#double-password').val();
            var tpassword2 = $('#double-password2').val();

            if (tpassword == null || tpassword.length == 0 || tpassword.length < 4 || tpassword.length > 255) {
                makeNotice('error', 'misc-error', 'Password must be 4 characters or more in length');
                return;
            }

            if (tpassword != tpassword2) {
                makeNotice('error', 'misc-error', 'Passwords do not match.');
                return;
            }

            if (tpassword == password) {
                makeNotice('error', 'misc-error', 'Second password should not be the same as your main password.');
                return;
            }

            //Ask the use again before we backup
            getSecondPassword(function() {
                try {
                    double_encryption = true;
                    dpassword = tpassword;

                    for (var key in addresses) {
                        var addr = addresses[key];

                        if (addr.priv != null) {
                            addr.priv = encodePK(B58.decode(addr.priv));
                        }
                    }

                    //N rounds of SHA 256
                    var round_data = Crypto.SHA256(sharedKey + dpassword, {asBytes: true});
                    for (var i = 1; i < pbkdf2_iterations; ++i) {
                        round_data = Crypto.SHA256(round_data, {asBytes: true});
                    }
                    dpasswordhash = Crypto.util.bytesToHex(round_data);

                    //Clear the password to force the user to login again
                    //Incase they have forgotten their password already
                    dpassword = null;

                    getSecondPassword(function() {
                        try {
                            checkAllKeys();

                            backupWallet('update', function() {
                                setDoubleEncryptionButton();
                            }, function() {
                                panic(e);
                            });
                        } catch(e) {
                            panic(e);
                        }
                    }, function() {
                        panic();
                    });
                } catch(e) {
                    panic(e);
                }

            }, function () {
                panic();
            });
        } else {
            getSecondPassword(function() {
                try {
                    for (var key in addresses) {

                        var addr = addresses[key];

                        if (addr.priv != null) {
                            addr.priv = decryptPK(addr.priv);
                        }
                    }

                    double_encryption = false;

                    dpassword = null;

                    checkAllKeys();

                    backupWallet('update', function() {
                        setDoubleEncryptionButton();
                    }, function() {
                        panic(e);
                    });
                } catch (e) {
                    panic(e);
                }
            }, function() {
                panic();
            });
        }
    } catch (e) {
        panic(e);
    }
}

//Get email address, secret phrase, yubikey etc.
function getAccountInfo() {
    setLoadingText('Getting Wallet Info');

    $.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info' },  function(data) {

        if (data.email != null) {
            $('#wallet-email').val(data.email);
            $('.my-email').text(data.email);
        }

        $('#wallet-phrase').val(data.phrase);

        $('#two-factor-select').val(data.auth_type);
        $('.two-factor').hide();
        $('.two-factor.t'+data.auth_type).show(200);

        var notifications_type_el = $('#notifications-type');

        notifications_type_el.find(':checkbox').prop("checked", false);
        notifications_type_el.find('[class^="type"]').hide();

        for (var i in data.notifications_type) {
            var type = data.notifications_type[i];
            console.log(type);

            notifications_type_el.find(':checkbox[value="'+type+'"]').prop("checked", true);
            notifications_type_el.find('.type-'+type).show();
        }

        $('#notifications-confirmations').val(data.notifications_confirmations);
        $('#notifications-on').val(data.notifications_on);

        if (data.alias != null && data.alias.length > 0) {
            $('#wallet-alias').val(data.alias);
            $('.alias').text('https://blockchain.info/wallet/'+data.alias);
            $('.alias').show(200);
        }

        loadScript(resource + 'wallet/qr.code.creator.js', function() {
            var device_qr = makeQRCode(300, 300, 1 , guid + '|' + sharedKey + '|' + password);

            $('#device-qr-code').empty().append(device_qr);

            if (data.google_secret_url != null && data.google_secret_url.length > 0) {

                var qr = makeQRCode(300, 300, 1 , data.google_secret_url);

                $('#wallet-google-qr').empty().append(qr);
            }
        });

        if (data.auto_email_backup == 1)
            $('#auto-email-backup').prop("checked", true);
        else
            $('#auto-email-backup').prop("checked", false);

        $('#wallet-http-url').val(data.http_url);

        $('#wallet-http-url').val(data.http_url);
        $('#wallet-skype').val(data.skype_username);
        $('#wallet-yubikey').val(data.yubikey);

        $('#password-hint1').val(data.password_hint1);
        $('#password-hint2').val(data.password_hint2);

        $('#ip-lock').val(data.ip_lock);
        $('#my-ip').text(data.my_ip);

        if (data.ip_lock_on == 1)
            $('#ip-lock').prop("checked", true);
        else
            $('#ip-lock').prop("checked", false);


        if (data.email_verified == 0) {
            $('#verify-email').show();
            $('#email-verified').hide();
        } else {
            $('#verify-email').hide();
            $('#email-verified').show();
        }

        if (data.sms_verified == 0) {
            $('.sms-unverified').show();
            $('.sms-verified').hide();
        } else {
            $('.sms-verified').show();
            $('.sms-unverified').hide();
        }


        $.get(resource + 'wallet/country_codes.html').success(function(data) {
            $('.wallet-sms-country-codes').html(data);
        }).error(function () {
                makeNotice('error', 'misc-error', 'Error Downloading SMS Country Codes')
            });

    })
        .error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });
}

function bindAccountButtons() {
    var notifications_type_el = $('#notifications-type');
    notifications_type_el.find(':checkbox').unbind().change(function() {

        var val = [];
        notifications_type_el.find(':checkbox:checked').each(function () {
            val.push($(this).val());
        });

        //If Empty Add Zero Val
        if (!val.length) val.push(0);

        updateKV('Updating Notifications Type', 'update-notifications-type', val.join('|'));

        notifications_type_el.find('.type-'+$(this).val()).toggle();

        //Backup the wallet to syn the pub keys
        backupWallet();
    });

    $('#password-hint1').unbind().change(function() {
        updateKV('Updating Main Password Hint', 'update-password-hint1', $(this).val());
    });

    $('#password-hint2').unbind().change(function() {
        updateKV('Updating Second Password Hint', 'update-password-hint2', $(this).val());
    });

    $('#ip-lock-on').unbind().change(function() {
        updateKV('Updating IP Lock', 'update-ip-lock-on', $(this).is(':checked'));
    });

    $('#ip-lock').unbind().change(function() {
        updateKV('Updating Locked Ip Addresses', 'update-ip-lock', $(this).val());
    });

    $('#notifications-on').unbind().change(function() {
        updateKV('Updating Notifications Settings', 'update-notifications-on', $(this).val());
    });

    $('#auto-email-backup').unbind().change(function() {
        updateKV('Updating Auto Backup Settings', 'update-auto-email-backup', $(this).is(':checked'));
    });

    $('#two-factor-select').unbind().change(function() {
        var val = parseInt($(this).val());

        updateKV('Updating Two Factor Authentication', 'update-auth-type', val, function() {
            //For Google Authenticator we need to refetch the account info to fetch the QR Code
            if (val == 4) {
                getAccountInfo();
            }

            //Refresh the cache manifest to clear the wallet data
            updateCacheManifest();
        });

        $('.two-factor').hide(200);
        $('.two-factor.t'+val).show(200);
    });

    $('#wallet-email-send').click(function() {
        $('#wallet-email').trigger('change');
    });

    $('#wallet-email').unbind().change(function(e) {

        var email = $(this).val();

        if (!validateEmail(email)) {
            makeNotice('error', 'misc-error', 'Email address is not valid');
            return;
        }

        updateKV('Updating Email', 'update-email', email);

        $('#verify-email').show(200);
        $('#email-verified').hide();
    });

    $('#wallet-double-encryption-enable').click(function(e) {
        setDoubleEncryption(true);
    });

    $('#wallet-double-encryption-disable').click(function(e) {
        setDoubleEncryption(false);
    });

    $('#wallet-email-code').unbind().change(function(e) {
        if (!isInitialized || offline) return;

        var code = $(this).val();

        if (code == null || code.length == 0 || code.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter a code to verify');
            return;
        }

        code = $.trim(code);

        setLoadingText('Verifying Email');

        $.post("/wallet", { guid: guid, payload: code, sharedKey: sharedKey, length : code.length, method : 'verify-email' },  function(data) {
            makeNotice('success', 'misc-success', data);

            $('#verify-email').hide();
            $('#email-verified').show(200);
        }).error(function(data) {
                makeNotice('error', 'misc-error', data.responseText);
                $('#verify-email').show(200);
                $('#email-verified').hide();
            });
    });

    $('.wallet-sms-code').unbind().change(function(e) {
        var code = $(this).val();

        if (code == null || code.length == 0 || code.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter an SMS code to verify');
            return;
        }

        code = $.trim(code);

        setLoadingText('Verifying SMS Code');

        $.post("/wallet", { guid: guid, payload: code, sharedKey : sharedKey, length : code.length, method : 'verify-sms' },  function(data) {
            makeNotice('success', 'misc-success', data);

            $('.sms-unverified').hide();
            $('.sms-verified').show(200);
        }).error(function(data) {
                makeNotice('error', 'misc-error', data.responseText);
                $('.sms-verified').hide();
                $('.sms-unverified').show(200);
            });
    });

    $('.wallet-sms').unbind().change(function(e) {

        var val = $.trim($(this).val());

        if (val == null || val.length == 0) {
            return;
        }

        if (val.charAt(0) == '0')
            val = val.substring(1);

        if (val.charAt(0) != '+')
            val = '+' + $('.wallet-sms-country-codes').val() + val;

        updateKV('Updating Cell Number', 'update-sms',val);

        $('.sms-unverified').show(200);
        $('.sms-verified').hide();
    });

    $('#run-key-check').click(function() {
        getSecondPassword(function() {
            try {
                checkAllKeys(true);

                backupWallet();
            } catch (e) {
                makeNotice('error', 'misc-error', e);
            }
        });
    });



    $('#notifications-confirmations').unbind().change(function(e) {
        updateKV('Updating Notification Confirmations', 'update-notifications-confirmations', $(this).val());
    });

    $('#wallet-yubikey').unbind().change(function(e) {
        updateKV('Updating Yubikey', 'update-yubikey', $(this).val());
    });

    $('#wallet-skype').unbind().change(function(e) {
        updateKV('Updating Skype Username', 'update-skype', $(this).val());
    });

    $('#wallet-http-url').unbind().change(function(e) {
        updateKV('Updating HTTP url', 'update-http-url', $(this).val());
    });

    $('#wallet-phrase').unbind().change(function(e) {

        var phrase = $(this).val();

        if (phrase == null || phrase.length == 0 || phrase.length > 255) {
            makeNotice('error', 'misc-error', 'You must enter a secret phrase');
            return;
        }

        updateKV('Updating Secret Phrase', 'update-phrase', phrase);
    });

    $('#wallet-alias').unbind().change(function(e) {
        $(this).val($(this).val().replace(/[\.,\/ #!$%\^&\*;:{}=`~()]/g,""));

        if ($(this).val().length > 0) {
            $('.alias').fadeIn(200);
            $('.alias').text('https://blockchain.info/wallet/'+$(this).val());
        }

        updateKV('Updating Alias', 'update-alias', $(this).val());
    });
}