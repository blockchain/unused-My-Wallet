

$(document).ready(function() {
    var root = "https://blockchain.info/";

    function loadScript(src, success, error) {
        if ($('script[src="'+src+'"]').length > 0) {
            success();
            return;
        }

        var error_fired = false;
        var s = document.createElement('script');
        s.type = "text/javascript";
        s.async = true;
        s.src = src;
        s.addEventListener('error', function(e){ error_fired = true;  if (error) error('Error Loading Script. Are You Offline?'); }, false);
        s.addEventListener('load', function (e) { if (error_fired) return; success(); }, false);
        var head = document.getElementsByTagName('head')[0];
        head.appendChild(s);
    }

    var buttons = $('.blockchain-btn');

    buttons.find('.blockchain').hide();
    buttons.find('.stage-begin').trigger('show').show();

    buttons.each(function(index) {
        var _button = $(this);

        (function() {
            var button = _button;

            button.click(function() {
                var receivers_address = $(this).data('address');
                var anonymous = $(this).data('anonymous');
                var test = $(this).data('test');

                if (!anonymous) anonymous = false;

                var callback_url = $(this).data('callback');

                if (!callback_url) callback_url = '';

                button.find('.blockchain').hide();

                button.find('.stage-loading').trigger('show').show();

                $.getJSON(root + 'api/receive?method=create&address='+encodeURIComponent(receivers_address)+'&anonymous='+anonymous+'&callback='+callback_url).success(function(response) {
                    button.find('.qr-code').empty();

                    button.find('.blockchain').hide();

                    if (!response || !response.input_address) {
                        button.find('.stage-error').trigger('show').show().html(button.find('.stage-error').html().replace('[[error]]', 'Unknown Error'));
                        return;
                    }

                    function checkBalance() {
                        $.get(root + 'q/getreceivedbyaddress/'+response.input_address, function(response) {
                            if (!response) return;

                            var value = parseInt(response);

                            if (value > 0 || test) {
                                button.find('.blockchain').hide();
                                button.find('.stage-paid').trigger('show').show().html(button.find('.stage-paid').html().replace('[[value]]', value / 100000000));
                            } else {
                                setTimeout(checkBalance, 5000);
                            }
                        });
                    }

                    try {
                        ws = new WebSocket('ws://api.blockchain.info:8335/inv');

                        if (!ws) return;

                        ws.onmessage = function(e) {
                            try {
                                var obj = $.parseJSON(e.data);

                                if (obj.op == 'utx') {
                                    var tx = obj.x;

                                    var result = 0;
                                    for (var i = 0; i < tx.out.length; i++) {
                                        var output = tx.out[i];

                                        if (output.addr == response.input_address) {
                                            result += parseInt(output.value);
                                        }
                                    }
                                }

                                button.find('.blockchain').hide();
                                button.find('.stage-paid').trigger('show').show().html(button.find('.stage-paid').html().replace('[[value]]', result / 100000000));

                                ws.close();
                            } catch(e) {
                                console.log(e);

                                console.log(e.data);
                            }
                        };

                        ws.onopen = function() {
                            ws.send('{"op":"addr_sub", "addr":"'+ response.input_address +'"}');
                        };
                    } catch (e) {
                        console.log(e);
                    }

                    button.find('.stage-ready').trigger('show').show().html(button.find('.stage-ready').html().replace('[[address]]', response.input_address));

                    loadScript(root + 'Resources/wallet/qr.code.creator.js', function() {
                        var claim_qr = makeQRCode(200, 200, 1 , response.input_address);

                        button.find('.qr-code').empty().append(claim_qr);
                    });


                    button.unbind();

                    ///Check for incoming payment
                    setTimeout(checkBalance, 5000);
                }).error(function(e) {
                        button.find('.blockchain').hide();

                        button.find('.stage-error').show().trigger('show').html(button.find('.stage-error').html().replace('[[error]]', e.responseText));
                    });
            });
        })();
    });
});