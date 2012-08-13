var satoshi_dice_games = null;

function calculateProfitLoss() {
    setLoadingText('Calculating Profit / Loss');

    if (!satoshi_dice_games) return;

    var output_addresses = [];
    for (var i in satoshi_dice_games) {
        output_addresses.push(satoshi_dice_games[i].address);
    }

    $.get(root + 'walletprofitloss?input_address='+getActiveAddresses().join('|')+'&output_address='+output_addresses.join('|')+'&format=plain').success(function(obj) {
        var form = $('#send-satoshi-dice');

        var container = form.find('.profit-loss').show(200);

        container.find('.n-bets').text(obj.n_sent + obj.n_received);
        container.find('.n-pending').text(obj.n_sent - obj.n_received);

        var winnings = obj.total_received - obj.total_sent;

        if (winnings > 0)
            container.find('.winnings').html('<font color="green">'+formatMoney(winnings, true)+'</font>');
        else if (winnings < 0)
            container.find('.winnings').html('<font color="red">'+formatMoney(winnings, true)+'</font>');
        else
            container.find('.winnings').html(formatMoney(winnings, true));

        container.find('.refresh').unbind().click(function() {
            calculateProfitLoss();
        });
    });
}

function buildForm() {

    if (satoshi_dice_games)
        return;

    var form = $('#send-satoshi-dice');

    $.get(root + 'satoshidice').success(function(obj) {

        satoshi_dice_games = obj;

        var container = form.find('.recipient-container');

        container.empty();

        var control_group = $('<div class="control-group"><label class="control-label">Win Odds</label><div class="controls"><p class="help-block">Enter the amounts you wish to bet below:</p></div></div>');

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
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(form, 'dice', initNewTx());
            });
        });

        try {
            calculateProfitLoss();
        } catch (e) {
            console.log(e);
        }
    }).error(function() {
            makeNotice('error', 'misc-error', 'Error Downloading SatoshiDICE Bets')
        });
}
