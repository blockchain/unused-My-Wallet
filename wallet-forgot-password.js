$(document).ready(function() {

    $('input[name="mnemonic"]').change(function() {
        var val = $.trim($(this).val());

        if (val.length == 0)
            return;

        try {
            if (check_mn(val)) {
                $('#mnemonic-result').show().text(mn_decode_pass(val));
            } else {
                $('#mnemonic-result').show().text('Mnemonic Contains Invalid Word');
            }
        } catch (e) {
            $('#mnemonic-result').show().text(e);
        }
    });
});