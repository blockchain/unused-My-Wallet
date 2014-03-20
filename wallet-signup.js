(function() {
    //temporary fix: change root from / to following. Because now signup is on index, so need to change root here
    var root = "https://blockchain.info/";

    //Save the javascript wallet to the remote server
    function insertWallet(guid, sharedKey, password, extra, successcallback, errorcallback) {
        var _errorcallback = function(e) {
            MyWallet.makeNotice('error', 'misc-error', 'Error Saving Wallet: ' + e, 10000);

            if (errorcallback != null)
                errorcallback(e);

            else throw e;
        };

        try {
            var data = MyWallet.makeCustomWalletJSON(null, guid, sharedKey);

            //Everything looks ok, Encrypt the JSON output
            var crypted = MyWallet.encryptWallet(data, password);

            if (crypted.length == 0) {
                throw 'Error encrypting the JSON output';
            }

            //Now Decrypt the it again to double check for any possible corruption
            MyWallet.decryptWallet(crypted, password, function() {
                try {
                    //SHA256 new_checksum verified by server in case of curruption during transit
                    var new_checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));

                    MyWallet.setLoadingText('Saving wallet');

                    if (extra == null) {
                        extra = '';
                    }

                    // made change from securePost to securePostWithIndexRoot, so that endpoint for post request is
                    // always at / and not /wallet when mobile param is true
                    MyWallet.securePostWithIndexRoot('wallet' + extra, { length: crypted.length, payload: crypted, checksum: new_checksum, method : 'insert', format : 'plain', sharedKey : sharedKey, guid : guid, active : MyWallet.getActiveAddresses().join('|') }, function(data) {
                        MyWallet.makeNotice('success', 'misc-success', data);

                        if (successcallback != null)
                            successcallback();
                    }, function(e) {
                        _errorcallback(e.responseText);
                    });
                } catch (e) {
                    _errorcallback(e);
                };
            });
        } catch (e) {
            _errorcallback(e);
        }
    }

    var guid;
    var sharedKey;
    var password;

    function makeNotice(type, id, msg, timeout) {

        if (msg == null || msg.length == 0)
            return;

        console.log(msg);

        if (timeout == null)
            timeout = 5000;

        var el = $('<div class="alert alert-block alert-'+type+'"></div>');

        el.text(''+msg);

        if ($('#'+id).length > 0) {
            el.attr('id', id);
            return;
        }

        $("#notices").append(el).hide().fadeIn(200);

        if (timeout > 0) {
            (function() {
                var tel = el;

                setTimeout(function() {
                    tel.fadeOut(250, function() {
                        $(this).remove();
                    });
                }, timeout);
            })();
        }
    }

    function generateUUIDs(n, success, error) {
        $.ajax({
            type: "GET",
            url: root + 'uuid-generator',
            data: { format : 'json', n : n },
            success: function(data) {

                if (data.uuids && data.uuids.length == n)
                    success(data.uuids);
                else
                    error('Unknown Error');
            },
            error : function(data) {
                error(data.responseText);
            }
        });

    }

    function generateNewWallet(success, error) {
        generateUUIDs(2, function(uuids) {
            try {
                guid = uuids[0];
                sharedKey = uuids[1];

                rng_seed_time();

                var tpassword = $("#password").val();
                var tpassword2 = $("#password2").val();

                if (tpassword != tpassword2) {
                    throw 'Passwords do not match.';
                }

                if (tpassword.length < 10) {
                    throw 'Passwords must be at least 10 characters long';
                }

                if (tpassword.length > 255) {
                    throw 'Passwords must be at shorter than 256 characters';
                }

                password = tpassword;

                if (MyWallet.getAllAddresses().length == 0)
                    MyWallet.generateNewKey(password);

                //User reported this browser generated an invalid private key
                if(navigator.userAgent.match(/MeeGo/i)) {
                    throw 'MeeGo browser currently not supported.';
                }

                if (guid.length != 36 || sharedKey.length != 36) {
                    throw 'Error generating wallet identifier';
                }

                var email = encodeURIComponent($.trim($('#email').val()));

                var captcha_code = $.trim($('#captcha-value').val());

                insertWallet(guid, sharedKey, tpassword, '?kaptcha='+encodeURIComponent(captcha_code)+'&email='+email, function(){
                    success(guid, sharedKey, tpassword);
                }, function(e) {
                    $("#captcha").attr("src", root + "kaptcha.jpg?timestamp=" + new Date().getTime());

                    $('#captcha-value').val('');

                    error(e);
                });
            } catch (e) {
                error(e);
            }
        }, error);
    }

    function showMnemonicModal(password, guid, success) {
        var modal = $('#mnemonic-modal');

        modal.modal({
            keyboard: false,
            backdrop: "static",
            show: true
        });

        modal.center();

        var paper_wallet_btn = modal.find('.btn.btn-success');

        paper_wallet_btn.prop('disabled', true);

        mn_encode_pass({password : password, guid : guid}, function(mnemonic) {
            $('#mnemonic').text(mnemonic);

            loadScript('wallet/paper-wallet', function() {
                PaperWallet.preLoad(function() {
                    paper_wallet_btn.prop('disabled', false);

                    paper_wallet_btn.unbind().click(function() {
                        modal.modal('hide');

                        PaperWallet.showModal();

                        success();
                    });
                }, {
                    guid : guid,
                    password : password
                });
            });
        }, function (e) {
            makeNotice('error', 'misc-error', e);

            modal.modal('hide');
        });

        modal.find('.btn.btn-primary').unbind().click(function() {
            modal.modal('hide');

            success();
        });
    }

    $(document).ready(function() {
        if (!$.isEmptyObject({})) {
            makeNotice('error', 'error', 'Object.prototype has been extended by a browser extension. Please disable this extensions and reload the page.');
            return;
        }

        $('body').click(function() {
            rng_seed_time();
        }).keypress(function() {
                rng_seed_time();
            }).mousemove(function(event) {
                if (event) {
                    rng_seed_int(event.clientX * event.clientY);
                }
            });

        //Disable auotcomplete in firefox
        $("input, button").attr("autocomplete","off");

        $('#password-strength').fadeIn(200);

        $("#new-wallet-continue").click(function() {
            var self = $(this);

            self.prop("disabled", true);

            generateNewWallet(function(guid, sharedKey, password) {
                MyStore.clear();

                MyStore.put('guid', guid);

                if (MyWallet.getIsMobile()) {
                    window.location.reload();

                } else {
                    showMnemonicModal(password, guid, function() {
                        //Redirect to the claim page when we have a private key embedded in the URL
                        if (window.location.hash && window.location.hash.length > 0)
                            window.location = root + 'wallet/claim' + window.location.hash;
                        else
                            window.location = root + 'wallet/' + guid + window.location.hash;
                    });

                }
            }, function (e) {
                self.removeAttr("disabled");

                makeNotice('error', 'misc-error', e, 5000);
            });
        });

        $("#captcha").attr("src", root + "kaptcha.jpg?timestamp=" + new Date().getTime());

        //Password strength meter
        $('#password').bind('change keypress keyup', function() {

            var warnings = document.getElementById('password-warnings');
            var result = document.getElementById('password-result');
            var password = $(this).val();

            var cps = HSIMP.convertToNumber('250000000'),
                time, i, checks;

            warnings.innerHTML = '';
            if(password) {
                time = HSIMP.time(password, cps.numeric);
                time = HSIMP.timeInPeriods(time);

                $('#password-result').fadeIn(200);

                if (time.period === 'seconds') {
                    if (time.time < 0.000001) {
                        result.innerHTML = 'Your password would be hacked <span>Instantly</span>';
                    } else if (time.time < 1) {
                        result.innerHTML = 'It would take a desktop PC <span>' + time.time+' '+time.period+ '</span> to hack your password';
                    } else {
                        result.innerHTML = 'It would take a desktop PC <span>About ' + time.time+' '+time.period+ '</span> to hack your password';
                    }
                } else {

                    result.innerHTML = 'It would take a desktop PC <span>About ' + time.time+' '+time.period+ '</span> to hack your password';
                }

                checks = HSIMP.check(password);
                HSIMP.formatChecks(checks.results, warnings);

                if (checks.insecure) {
                    result.innerHTML = '';
                    $('#password-result').fadeOut(200);
                }

            } else {
                result.innerHTML = '';
                $('#password-result').fadeOut(200);
            }
        });
    });
})();