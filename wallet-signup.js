(function() {
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

    function generateNewWallet() {
        if (MyWallet.getAllAddresses().length == 0)
            MyWallet.generateNewKey();

        $('body').click(function() {
            rng_seed_time();
        }).keypress(function() {
                rng_seed_time();
            });

        var tpassword = $.trim($("#password").val());
        var tpassword2 = $.trim($("#password2").val());

        if (tpassword != tpassword2) {
            makeNotice('error', 'misc-error', 'Passwords do not match.');
            return false;
        }

        if (tpassword.length == 0 || tpassword.length < 10 || tpassword.length > 255) {
            makeNotice('error', 'misc-error', 'Password length must be between 10 and 255 characters in length');
            return false;
        }

        password = tpassword;

        if(navigator.userAgent.match(/MeeGo/i)) {
            makeNotice('error', 'misc-error', 'MeeGo browser currently not supported.');
            return false;
        }

        if (guid.length != 36 || sharedKey.length != 36) {
            makeNotice('error', 'misc-error', 'Error generating wallet identifier');
            return false;
        }

        var alias = encodeURIComponent($.trim($('#alias-value').val()));

        var captcha_code = $.trim($('#captcha-value').val());

        MyWallet.insertWallet(guid, sharedKey, tpassword, '?kaptcha='+encodeURIComponent(captcha_code)+'&alias='+alias, function(){

            SetCookie('cguid', guid);

            showMnemonicModal(tpassword, function() {
                //Redirect to Login
                if (alias && alias.length > 0)
                    window.location = root + 'wallet/' + alias + window.location.hash;
                else
                    window.location = root + 'wallet/' + guid + window.location.hash;
            });
        }, function(e) {
            $("#captcha").attr("src", root + "kaptcha.jpg?timestamp=" + new Date().getTime());

            $('#captcha-value').val('');

            makeNotice('error', 'misc-error', e);

        });
    }

    function showMnemonicModal(password, success) {
        var modal = $('#mnemonic-modal');

        modal.modal({
            keyboard: false,
            backdrop: "static",
            show: true
        });

        modal.center();

        try {
            $('#mnemonic').text(mn_encode_pass(password));
        } catch (e) {
            console.log(e);

            makeNotice('error', 'misc-error', e);

            modal.modal('hide');

            return;
        }

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

        guid = $('body').data('guid');
        sharedKey = $('body').data('sharedkey');

        //Disable auotcomplete in firefox
        $("input, button").attr("autocomplete","off");

        $('#password-strength').fadeIn(200);

        $("#new-wallet-continue").click(function() {
            $(this).attr("disabled", true);

            try {
                generateNewWallet();

                $(this).attr("disabled", false);
            } catch (e) {
                makeNotice('error', 'misc-error', e, 5000);

                $(this).attr("disabled", false);
            }
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