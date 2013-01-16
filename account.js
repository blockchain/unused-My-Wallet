function _AccountSettings() {
    function validateEmail(str) {
        var lastAtPos = str.lastIndexOf('@');
        var lastDotPos = str.lastIndexOf('.');
        return (lastAtPos < lastDotPos && lastAtPos > 0 && str.indexOf('@@') == -1 && lastDotPos > 2 && (str.length - lastDotPos) > 2);
    }

    function updateKV(txt, method, value, success, error) {
        value = $.trim(value);

        if ( value.length == 0) {
            MyWallet.makeNotice('error', 'misc-error', txt + ': Invalid value');
            return;
        }

        if (value.length == 0) {
            MyWallet.makeNotice('error', method + '-error', data.responseText);

            if (error) error();

            return;
        }

        MyWallet.setLoadingText(txt);

        MyWallet.securePost("wallet", { length : (value+'').length, payload : value+'', method : method }).success(function(data) {
            MyWallet.makeNotice('success', method + '-success', data);

            if (success) success();
        }).error(function(data) {
                MyWallet.makeNotice('error', method + '-error', data.responseText);

                if (error) error();
            });
    }

    function setDoubleEncryptionButton() {
        if (MyWallet.getDoubleEncryption()) {
            $('.double-encryption-off').hide();
            $('.double-encryption-on').show();
        } else {
            $('.double-encryption-on').hide();
            $('.double-encryption-off').show();
        }

        $('#double-password').val('');
        $('#double-password2').val('');
    }

    function updateMnemonics() {
        loadScript(resource + 'wallet/mnemonic.js', function() {
            MyWallet.getMainPassword(function(main_password){
                MyWallet.getSecondPassword(function(second_password) {
                    try {
                        $('#password_mnemonic1').show().find('span').text(mn_encode_pass(main_password));

                        if (second_password)
                            $('#password_mnemonic2').show().find('span').text(mn_encode_pass(second_password));
                        else
                            $('#password_mnemonic2').hide();
                    } catch (e) {
                        console.log(e);

                        collapseAll();
                    }
                }, function() {
                    collapseAll();
                });
            }, function() {
                collapseAll();
            });
        });
    }

    function bind() {
        setDoubleEncryptionButton();

        bindAccountButtons();

        getAccountInfo();
    }

    this.init = function(container, success, error) {
        MyWallet.setLoadingText('Loading Account Settings');

        if (!container.is(':empty')) {
            bind();
            success();
            return;
        }

        $.get(root + 'wallet/account-settings-template').success(function(html) {

            try {
                container.html(html);

                bind();

                success();
            } catch (e) {
                console.log(e);

                error();
            }
        }).error(function() {
                MyWallet.makeNotice('error', 'misc-error', 'Error Downloading Account Settings Template');

                error();
            });
    }

    //Get email address, secret phrase, yubikey etc.
    function getAccountInfo(parent_el) {

        $('a[data-toggle="tab"]').on('show', function(e) {
            $(e.target.hash).trigger('show');
        });

        MyWallet.setLoadingText('Getting Wallet Info');

        MyWallet.securePost("wallet", {method : 'get-info'}).success(function(data) {

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

                notifications_type_el.find(':checkbox[value="'+type+'"]').prop("checked", true);
                notifications_type_el.find('.type-'+type).show();
            }


            $('.logl').hide();

            $('.logl.l'+data.logging_level).show();

            $('#logging-level').val(data.logging_level);
            $('#notifications-confirmations').val(data.notifications_confirmations);
            $('#notifications-on').val(data.notifications_on);

            if (data.alias != null && data.alias.length > 0) {
                $('#wallet-alias').val(data.alias);
                $('.alias').text('https://blockchain.info/wallet/'+data.alias);
                $('.alias').show(200);
            }

            var local_currency = $('#local_currency').empty();
            for (var currency in data.currencies) {
                var currency_name = data.currencies[currency];

                local_currency.append('<option value="'+currency+'">'+currency_name+'</option>');
            }

            local_currency.val(data.currency);

            var language_select = $('#language_select').empty();

            for (var language in data.languages) {
                var language_name = data.languages[language];

                language_select.append('<option value="'+language+'">'+language_name+'</option>');
            }

            language_select.val(data.language);

            if (data.auto_email_backup == 1)
                $('#auto-email-backup').prop("checked", true);
            else
                $('#auto-email-backup').prop("checked", false);


            if (data.never_save_auth_type == 1)
                $('#never-save-auth-type').prop("checked", true);
            else
                $('#never-save-auth-type').prop("checked", false);


            //Show Google Auth QR Code
            if (data.google_secret_url != null && data.google_secret_url.length > 0) {
                loadScript(resource + 'wallet/qr.code.creator.js', function() {
                    try {
                        var qr = makeQRCode(300, 300, 1 , data.google_secret_url);

                        $('#wallet-google-qr').empty().append(qr);

                    } catch (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    }
                });
            }

            $('#wallet-http-url').val(data.http_url);

            $('#wallet-http-url').val(data.http_url);
            $('#wallet-skype').val(data.skype_username);
            $('#wallet-boxcar').val(data.boxcar_email);

            $('#wallet-yubikey').val(data.yubikey);

            if (data.password_hint1)
                $('#password-hint1').val(data.password_hint1);

            if (data.password_hint2)
                $('#password-hint2').val(data.password_hint2);

            $('#ip-lock').val(data.ip_lock);
            $('#my-ip').text(data.my_ip);

            if (data.ip_lock_on == 1)
                $('#ip-lock-on').prop("checked", true);
            else
                $('#ip-lock-on').prop("checked", false);

            $('input[name="fee-policy"]').each(function() {
                if (parseInt($(this).val()) == MyWallet.getFeePolicy()) {
                    $(this).attr('checked', true);
                }
            });

            if (data.email_verified == 0) {
                $('#verify-email').show();
                $('#email-verified').hide();
            } else {
                $('#verify-email').hide();
                $('#email-verified').show();
            }

            $('#my-ip').text(data.my_ip);

            var country_code = '1';

            if (data.sms_number) {
                var sms_split = data.sms_number.split(' ');
                if (data.sms_number[0] == '+' && sms_split.length > 1) {
                    country_code = sms_split[0].substring(1);

                    $('.wallet-sms').val(sms_split[1]);
                } else {
                    $('.wallet-sms').val(data.sms_number);
                }
            }

            if (data.sms_verified == 0) {
                $('.sms-unverified').show();
                $('.sms-verified').hide();
            } else {
                $('.sms-verified').show().trigger('show');
                $('.sms-unverified').hide();
            }

            $.get(resource + 'wallet/country_codes.html').success(function(data) {
                $('select[class="wallet-sms-country-codes"]').html(data).val(country_code);
            }).error(function () {
                    MyWallet.makeNotice('error', 'misc-error', 'Error Downloading SMS Country Codes')
                });


            //HTML 5 notifications request permission
            var request_notification_permission = function(success, error, request) {
                try {
                    if (window.webkitNotifications && navigator.userAgent.indexOf("Chrome") > -1) {
                        var permission = webkitNotifications.checkPermission();
                        if (permission == 1 && request) {
                            webkitNotifications.requestPermission(request_notification_permission);
                        } else if (permission == 0) {
                            success();
                        } else {
                            error();
                        }

                    } else if (window.Notification) {
                        if (Notification.permissionLevel() === 'default' && request) {
                            Notification.requestPermission(request_notification_permission);
                        } else if (window.Notification.permissionLevel() == "granted") {
                            success();
                        } else {
                            error();
                        }
                    } else {
                        error();
                    }
                } catch (e) {
                    console.log(e);

                    error();
                }
            };

            var html5_notifications_checkbox = $('#html5-notifications-checkbox');

            html5_notifications_checkbox.unbind().change(function() {
                if ($(this).is(':checked')) {
                    request_notification_permission(function() {
                        MyWallet.makeNotice('success', 'misc-success', "HTML5 Notifications Enabled");

                        MyWallet.setHTML5Notifications(true);

                        MyWallet.backupWallet();
                    }, function() {
                        MyWallet.makeNotice('error', 'misc-error', "Error Enabling HTML5 Notifications");

                        MyWallet.setHTML5Notifications(false);

                        MyWallet.backupWallet();

                    }, true);
                } else {
                    MyWallet.setHTML5Notifications(false);

                    MyWallet.backupWallet();
                }
            });

            if (MyWallet.getHTML5Notifications()) {
                html5_notifications_checkbox.attr('checked', true);
            } else {
                html5_notifications_checkbox.attr('checked', false);
            };

        }).error(function(data) {
                MyWallet.makeNotice('error', 'misc-error', data.responseText);
            });
    }

    function updatePassword() {
        collapseAll();

        var modal = $('#update-password-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.center();

        modal.find('.btn.btn-primary').unbind().click(function() {
            modal.modal('hide');

            var tpassword = $.trim($("#password").val());
            var tpassword2 = $.trim($("#password2").val());

            if (tpassword != tpassword2) {
                MyWallet.makeNotice('error', 'misc-error', 'Passwords do not match.');
                return false;
            }

            if (tpassword.length == 0 || tpassword.length < 10 || tpassword.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'Password length must be between least 10  & 255 characters');
                return false;
            }

            MyWallet.setMainPassword(tpassword);
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    function collapseAll() {
        $('.accordion-body').collapse('hide');
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

            MyWallet.get_history();
        });

        $('input[name=fee-policy]').unbind().change(function() {
            MyWallet.setFeePolicy($('input[name=fee-policy]:checked').val());

            //Fee Policy is stored in wallet so must save it
            MyWallet.backupWallet();
        });

        $('#password_mnemonic').unbind().on('shown', function() {
            updateMnemonics();
        });

        $('#pairing_code').unbind().on('shown', function() {
            var container = $('#device-qr-code');

            container.empty();

            MyWallet.makePairingQRCode(function(device_qr) {
                container.empty().append(device_qr);

                setTimeout(function() {
                    container.empty();

                    collapseAll();
                }, 30000);
            });
        })

        $('#update-password-btn').unbind().click(function() {
            updatePassword();
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

        $('#never-save-auth-type').unbind().change(function() {
            updateKV('Updating Auth Saving Settings', 'update-never-save-auth-type', $(this).is(':checked'));
        });

        $('#two-factor-select').unbind().change(function() {
            var val = parseInt($(this).val());

            updateKV('Updating Two Factor Authentication', 'update-auth-type', val, function() {
                //For Google Authenticator we need to refetch the account info to fetch the QR Code
                if (val == 4) {
                    getAccountInfo();
                }

                //Refresh the cache manifest to clear the wallet data
                MyWallet.updateCacheManifest();
            });

            $('.two-factor').hide(200);
            $('.two-factor.t'+val).show(200);
        });

        var previous_email = '';
        $('#wallet-email-send').click(function() {
            previous_email = '';
            $('#wallet-email').trigger('change');
        });

        $('#wallet-email').unbind().change(function(e) {
            var email = $.trim($(this).val());

            if (email.length == 0)
                return;

            if (previous_email == email)
                return;

            if (!validateEmail(email)) {
                MyWallet.makeNotice('error', 'misc-error', 'Email address is not valid');
                return;
            }

            updateKV('Updating Email', 'update-email', email, function() {
                previous_email = email;
            }, function() {
                previous_email = '';
            });

            previous_email = email;

            $('#verify-email').show(200);
            $('#email-verified').hide();
        });

        $('#wallet-double-encryption-enable').unbind().click(function(e) {
            collapseAll();

            MyWallet.setDoubleEncryption(true);
        });

        $('#wallet-double-encryption-disable').unbind().click(function(e) {
            collapseAll();

            MyWallet.setDoubleEncryption(false);
        });

        $('#wallet-email-code').unbind().change(function(e) {
            var code = $.trim($(this).val());

            if (code.length == 0 || code.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a code to verify');
                return;
            }

            MyWallet.setLoadingText('Verifying Email');

            MyWallet.securePost("wallet", { payload: code, length : code.length, method : 'verify-email' }).success(function(data) {
                MyWallet.makeNotice('success', 'misc-success', data);

                $('#verify-email').hide();
                $('#email-verified').show(200);
            }).error(function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText);
                    $('#verify-email').show(200);
                    $('#email-verified').hide();
                });
        });

        $('.wallet-sms-code').unbind().change(function(e) {
            var code = $.trim($(this).val());

            if (code.length == 0 || code.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter an SMS code to verify');
                return;
            }

            MyWallet.setLoadingText('Verifying SMS Code');

            MyWallet.securePost("wallet", { payload:code, length : code.length, method : 'verify-sms' }).success(function(data) {
                MyWallet.makeNotice('success', 'misc-success', data);

                $('.sms-unverified').hide();
                $('.sms-verified').show(200).trigger('show');
            }).error(function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText);
                    $('.sms-verified').hide();
                    $('.sms-unverified').show(200);
                });
        });

        var wallet_sms_val = '';
        $('.send-code').unbind().click(function() {
            wallet_sms_val = '';
            $(this).parent().find('.wallet-sms').trigger('change');
        });

        $('select[class="wallet-sms-country-codes"]').unbind().change(function(){
            wallet_sms_val = '';
            $('.wallet-sms').trigger('change');
        });

        $('.wallet-sms').unbind().change(function() {
            var val = $.trim($(this).val());

            if (val == null || val.length == 0)
                return;

            if (val.charAt(0) != '+') {
                val = '+' + $('.wallet-sms-country-codes').val() + val;
            }

            if (wallet_sms_val == val) {
                return;
            }

            wallet_sms_val = val;

            updateKV('Updating Cell Number', 'update-sms', val, function() {
                $('.sms-unverified').show(200);
                $('.sms-verified').hide();
            });
        });

        $('#run-key-check').unbind().click(function() {
            MyWallet.getSecondPassword(function() {
                try {
                    MyWallet.checkAllKeys(true);

                    MyWallet.backupWallet();
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            });
        });

        $('#local_currency').unbind().change(function() {
            if (symbol != symbol_local)
                toggleSymbol();

            updateKV('Updating Local Currency', 'update-country', $(this).val(), function() {
                MyWallet.get_history();
            });
        });

        $('#language_select').unbind().change(function() {
            updateKV('Updating Language', 'update-language', $(this).val(), function() {
                MyWallet.updateCacheManifest(function() {
                    window.location.reload();
                });
            });
        });

        $('#notifications-confirmations').unbind().change(function(e) {
            updateKV('Updating Notification Confirmations', 'update-notifications-confirmations', $(this).val());
        });


        $('#account-logging').unbind().on('show', function() {

            var table = $(this).find('table').hide();

            var tbody = table.find('tbody');

            MyWallet.securePost('wallet', {method : 'list-logs'}).success(function(obj) {
                try {
                    table.show();

                    tbody.empty();

                    if (obj == null) {
                        throw 'Failed to get backups';
                    }

                    var results = obj.results;

                    if (results.length == 0) {
                        throw 'No logs found';
                    }

                    for (var i in results) {
                        var result = results[i];


                        tbody.append('<tr><td style="width:130px">'+dateToString(new Date(result.time))+'</td><td style="width:170px">'+result.action+'</td><td style="text-overflow: ellipsis;max-width:100px;overflow: hidden;">'+result.ip_address+'</td><td>'+result.user_agent+'</td></tr>')
                    }
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            }).error(function(data) {
                    MyWallet.makeNotice('error', 'misc-error', data.responseText);
                });
        });

        $('#logging-level').unbind().change(function(e) {

            $('.logl').hide();

            $('.logl.l'+$(this).val()).show();

            updateKV('Updating Logging Level', 'update-logging-level', $(this).val(), function() {
                $('#account-logging').trigger('show');
            });
        });

        $('#wallet-yubikey').unbind().change(function(e) {
            updateKV('Updating Yubikey', 'update-yubikey', $(this).val());
        });

        $('#wallet-skype').unbind().change(function(e) {
            updateKV('Updating Skype Username', 'update-skype', $(this).val());
        });

        $('#wallet-boxcar').unbind().change(function(e) {
            updateKV('Updating Boxcar Email', 'update-boxcar', $(this).val());
        });

        $('#wallet-http-url').unbind().change(function(e) {
            updateKV('Updating HTTP url', 'update-http-url', $(this).val());
        });

        $('#wallet-phrase').unbind().change(function(e) {
            var phrase = $.trim($(this).val());

            if (phrase == null || phrase.length == 0 || phrase.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a secret phrase');
                return;
            }

            updateKV('Updating Secret Phrase', 'update-phrase', phrase);
        });

        $('#wallet-alias').unbind().change(function(e) {
            var alias_field = $(this);

            var old_value = $.trim(alias_field.val());

            alias_field.val(alias_field.val().replace(/[\.,\/ #!$%\^&\*;:{}=`~()]/g,""));

            var new_value = $.trim(alias_field.val());

            if (new_value.length > 0) {
                $('.alias').fadeIn(200);
                $('.alias').text('https://blockchain.info/wallet/'+new_value);
            }

            updateKV('Updating Alias', 'update-alias', new_value, null, function(){
                alias_field.val(old_value);
            });
        });
    }
}

var AccountSettings = new _AccountSettings();