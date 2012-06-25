

function buildForm() {
    var form = $('#send-satoshi-dice');

    $.get('/satoshidice').success(function(obj) {

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
        });

        container.find('input[name="send-value"]').keyup(function() {
             if ($(this).val() > 0)
                $(this).parent().find('.send-win-amount').html('Win Amount: ' + parseFloat($(this).val()) *  parseFloat($(this).data('multiplier')) + ' BTC');
            else
                $(this).parent().find('.send-win-amount').html('No Bet');
        });

        form.find('.send').unbind().click(function() {
            loadScript(resource + 'wallet/signer.min.js', function() {
                startTxUI(form, 'quick', initNewTx());
            });
        });
    });
}
