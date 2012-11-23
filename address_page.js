
function goToWallet(addr) {
    try {
        if (localStorage) {
            var guid = localStorage.getItem('guid');

            if (guid != null) {
                if (addr == null) {
                    window.location='https://blockchain.info/wallet/'+guid;
                } else {
                    window.location='https://blockchain.info/wallet/'+guid+'#newaddr|'+addr;
                }

                return;
            }
        }
    } catch(e) {
        console.log(e);
    }

    if (addr == null) {
        window.location='https://blockchain.info/wallet';
    } else {
        window.location='https://blockchain.info/wallet/new#newaddr|'+addr;
    }
}

$(document).ready(function() {

    $('#add-to-wallet').click(function() {
        goToWallet(address);
    });

    $('#deposit').click(function() {
        loadScript(resource + 'wallet/frame-modal.js', function() {
            showFrameModal({
                title : 'Deposit Using Cash',
                description : 'Deposit into address <b>'+address+'</b>',
                top_right : 'Have Questions? Read <a href="https://www.bitinstant.com/howitworks/cash" target="new">How It Works</a>',
                src : root + 'deposit?address='+address+'&ptype=bitinstant'
            });
        });
    });

    $('#payment-request').click(function() {
        loadScript(resource + 'wallet/frame-modal.js', function() {
            showFrameModal({
                title : 'Create Payment Request',
                description : 'Request Payment into address <b>'+address+'</b>',
                src : root + 'payment_request?address='+address
            });
        });
    });

    $('#create-donation-button').click(function() {
        loadScript(resource + 'wallet/frame-modal.js', function() {
            showFrameModal({
                title : 'Create Donation Button',
                description : 'Create Donation Button To Address <b>'+address+'</b>',
                src : root + 'create_donation_button?address='+address,
                height : '600px'
            });
        });
    });

    $('#filter').change(function(){
        $(this).parent().submit();
    });

    if (filter == 0) {
        webSocketConnect(function(ws) {
            ws.onmessage = function(e) {
                var obj = $.parseJSON(e.data);

                if (obj.op == 'status') {
                    $('#status').html(obj.msg);
                } else if (obj.op == 'utx') {

                    op = obj.x;

                    try {
                        playSound('beep');
                    } catch(e) { console.log(e); }

                    var tx = TransactionFromJSON(op);

                    tx.setConfirmations(0);

                    /* Calculate the result */
                    var result = 0;

                    for (var i = 0; i < tx.inputs.length; i++) {
                        var input = tx.inputs[i];

                        console.log(input.prev_out.addr);

                        //If it is our address then subtract the value
                        if (input.prev_out.addr == address) {
                            result -= parseInt(input.prev_out.value);
                        }
                    }

                    console.log('result ' + result);

                    var total_received = 0;
                    for (var i = 0; i < tx.out.length; i++) {
                        var output = tx.out[i];

                        if (output.addr == address) {
                            total_received += parseInt(output.value);
                        }
                    }

                    $('#total_received span').attr('data-c', parseInt($('#total_received span').attr('data-c')) + total_received);

                    result += total_received;

                    $('#final_balance span').attr('data-c', parseInt($('#final_balance span').attr('data-c')) + result);

                    flashTitle('New Transaction');

                    tx.result = result;

                    $('#no_tx').hide();

                    var tx_html = tx.getHTML();

                    $('#tx_container').prepend(tx_html);

                    tx_html.hide().slideDown('slow');

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
