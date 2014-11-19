$(document).ready(function() {

    $('input[name="mnemonic"]').change(function() {
        var container = $('#mnemonic-result-container');
        var error_container = $('#mnemonic-result-error');

        container.hide();
        error_container.hide();

        container.find('.guid-result-container').hide();

        var val = $.trim($(this).val());

        if (val.length == 0)
            return;

        mn_decode_pass(val, function(obj) {
            container.show();

            if (obj.guid) {
                container.find('.guid-result-container').show();
                container.find('.guid-result').html('<a href="' + com_root + "wallet/" + obj.guid + '" target="new">' + location.protocol + "//" + location.host + "/" + obj.guid + '</a>');
            } else {
                container.find('.guid-result-container').hide();
            }

            container.find('.password-result').val(obj.password);
        }, function(e) {
            error_container.show().text(e);
        });
    });
});