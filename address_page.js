var address;
var filter;

function insertParam(key, value) {
    key = escape(key); value = escape(value);

    var kvp = document.location.search.substr(1).split('&');
    if (kvp == '') {
        document.location.search = '?' + key + '=' + value;
    }
    else {

        var i = kvp.length; var x; while (i--) {
            x = kvp[i].split('=');

            if (x[0] == key) {
                x[1] = value;
                kvp[i] = x.join('=');
                break;
            }
        }

        if (i < 0) { kvp[kvp.length] = [key, value].join('='); }

        //this will reload the page, it's likely better to store this until finished
        document.location.search = kvp.join('&');
    }
}

$(document).ready(function() {

    filter = parseInt($(document.body).data('filter'));
    address = $(document.body).data('address');

    $('#payment-request').click(function() {
        loadScript('wallet/frame-modal', function() {
            showFrameModal({
                title : 'Create Payment Request',
                description : 'Request Payment into address <b>'+address+'</b>',
                src : root + 'payment_request?address='+address
            });
        });
    });

    $('#create-donation-button').click(function() {
        loadScript('wallet/frame-modal', function() {
            showFrameModal({
                title : 'Create Donation Button',
                description : 'Create Donation Button To Address <b>'+address+'</b>',
                src : root + 'create_donation_button?address='+address,
                height : '600px'
            });
        });
    });

    $('.tx_filter a').click(function(){
        var value = $(this).data('value');
        if (value == 'export') {
            loadScript('wallet/frame-modal', function() {
                showFrameModal({
                    title : 'Export History',
                    description : '',
                    src : root + 'export-history?active='+address
                });
            });

            return;
        }


        insertParam('filter', $(this).data('value'));
    });

    if (filter == 0) {
        webSocketConnect(function(ws) {
            ws.onmessage = function(e) {
                var obj = $.parseJSON(e.data);

                if (obj.op == 'status') {
                    $('#status').html(obj.msg);
                } else if (obj.op == 'utx') {

                    op = obj.x;

                    playSound('beep');

                    var tx = TransactionFromJSON(op);

                    tx.setConfirmations(0);

                    /* Calculate the result */
                    var result = 0;
                    var total_sent = 0;
                    var total_received = 0;

                    for (var i = 0; i < tx.inputs.length; i++) {
                        var input = tx.inputs[i];

                        if (!input.prev_out)
                            continue;

                        var value = parseInt(input.prev_out.value);

                        //If it is our address then subtract the value
                        if (input.prev_out.addr == address) {
                            result -= value;
                            total_sent += value;
                        }
                    }

                    for (var i = 0; i < tx.out.length; i++) {
                        var output = tx.out[i];

                        var value = parseInt(output.value);

                        if (output.addr == address) {
                            result += value;
                            total_received += value;
                        }
                    }

                    //Don't include change
                    var no_change = Math.max(0, total_received-total_sent);

                    $('#total_received span').data('c', parseInt($('#total_received span').data('c')) + no_change);

                    $('#final_balance span').data('c', parseInt($('#final_balance span').data('c')) + result);

                    tx.result = result;

                    $('#no_tx').hide();

                    var tx_html = $(tx.getHTML());

                    var container = $('#tx_container');

                    container.prepend(tx_html);

                    setupSymbolToggle();

                    tx_html.hide().slideDown('slow');

                    if (container.find('.txdiv').length > 50) {
                        container.find('.txdiv:last-child').remove();
                    }

                    $('#n_transactions').text(parseInt($('#n_transactions').text())+1);

                    calcMoney();
                }
            };

            ws.onopen = function() {
                $('#status').html('Connected. ');

                ws.send('{"op":"addr_sub", "addr":"'+address+'"}');
            };

            ws.onclose = function() {
                $('#status').html('Disconnected');
            };
        });
    }
});
