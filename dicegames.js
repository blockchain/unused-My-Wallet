function calculateProfitLoss(form) {
    setLoadingText('Calculating Profit / Loss');

    var to_inputs = form.find('input[name="send-to-address"]');

    var output_addresses = [];
    $(to_inputs).each(function() {
        output_addresses.push($(this).val());
    });

    if (output_addresses.length == 0)
        return;

    $.get(root + 'walletprofitloss?input_address='+getActiveAddresses().join('|')+'&output_address='+output_addresses.join('|')+'&format=plain').success(function(obj) {

        var container = form.find('.profit-loss').show(200);

        container.find('.n-bets').text(obj.n_sent);

        var winnings = obj.result;

        if (winnings > 0)
            container.find('.winnings').html('<font color="green">'+formatMoney(winnings, true)+'</font>');
        else if (winnings < 0)
            container.find('.winnings').html('<font color="red">'+formatMoney(winnings, true)+'</font>');
        else
            container.find('.winnings').html(formatMoney(winnings, true));

        container.find('.refresh').unbind().click(function() {
            calculateProfitLoss(form);
        });
    });
}

function multiBetWarningModal(times, success, error) {

    var modal = $('<div class="modal hide">\
        <div class="modal-header">\
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>\
            <h3>Confirm Multiple Bets</h3>\
        </div>\
        <div class="modal-body">\
            <p>This bet will be repeated <b class="times"></b> times. Please confirm this is correct.</p>\
        </div>\
        <div class="modal-footer">\
            <a href="#" class="btn btn-secondary">Cancel</a>\
            <a href="#" class="btn btn-primary">Continue</a>\
        </div>\
    </div>');

    $('body').append(modal);

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.times').text(times);

    modal.center();

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');

        modal.remove();

        if (success) success();
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');

        modal.remove();

        if (error) error();
    });
}

function buildForm(form) {
    var container = form.find('.recipient-container');

    if (!container.is(':empty'))
        return;

    $.get(root + 'dicegames?game='+form.data('name')).success(function(obj) {

        container.empty();

        var control_group = $('<div class="control-group"><label class="control-label">Win Odds</label><div class="controls"><p>Enter the amounts you wish to bet below:</p></div></div>');

        container.append(control_group);

        for (var i in obj) {
            var game = obj[i];

            if (game.popular) {
                container.append('<div class="control-group recipient"><label class="control-label">'+game.odds+'%</label><div class="controls"><input name="send-to-address" type="hidden" value="'+game.address+'" /><div class="input-append"> <input class="send-value" style="width:auto;max-width:145px;" data-optional="true" name="send-value" data-multiplier="'+game.multiplier+'" data-minbet="'+game.minBet+'" data-maxbet="'+game.maxBet+'" placeholder="Bet Amount (BTC)" type="text" /><span class="add-on send-win-amount">No Bet</span> </div></div></div>');
            }
        }

        function setWinAmount(el) {
            if (el.val() > 0)
                el.parent().find('.send-win-amount').html('Win Amount: ' + (parseFloat(el.val()) *  parseFloat(el.data('multiplier'))).toFixed(4) + ' BTC');
            else
                el.parent().find('.send-win-amount').html('No Bet');
        }

        container.find('input[name="send-value"]').change(function() {
            if ($(this).val() > $(this).data('maxbet')) {
                $(this).val($(this).data('maxbet'));

                makeNotice('error', 'misc-error', 'The Maximum Bet is '+ $(this).data('maxbet') + ' BTC');
            }

            if ($(this).val() == 0) {
                $(this).val('');
            } else if ($(this).val() < $(this).data('minbet')) {
                $(this).val($(this).data('minbet'));

                makeNotice('error', 'misc-error', 'The Minimum Bet is '+ $(this).data('minbet') + ' BTC');
            }

            setWinAmount($(this));
        });

        container.find('input[name="send-value"]').keyup(function() {
            setWinAmount($(this));
        });

        form.find('.send').unbind().click(function() {
            var ii = 0;
            var repeat = $(this).data('repeat');

            if (!repeat)
                repeat = 0;
            else
                repeat = parseInt(repeat);


            var listener = {
                on_success : function() {
                    ++ii;

                    if (ii < repeat) {
                        setTimeout(send, 100);
                    }
                }
            };

            var send = function() {
                console.log('Send Called');

                var tx = initNewTx();

                tx.addListener(listener);

                startTxUI(form, 'dice', tx);
            }

            if (repeat > 1) {
                multiBetWarningModal(repeat, function() {
                    loadScript(resource + 'wallet/signer.min.js', function() {
                        send();
                    });
                });
            } else {
                loadScript(resource + 'wallet/signer.min.js', function() {
                    send();
                });
            }
        });

        $.get('http://src.satoshidice.com/longpoll.php?tx=3077b277e467087addf76dc532a8c4066cc2e9452a8d473a0495f5d14c163351').success(function(obj) {
           console.log(obj);
        });

       // calculateProfitLoss(form);
    }).error(function(e) {
            makeNotice('error', 'misc-error', e)
        });
}
