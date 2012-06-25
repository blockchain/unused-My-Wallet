$(document).ready(function() {

    var form = $('#reset-two-factor');

    $('#initial_error, #initial_success').hide();

    form.find('button[name="submit"]').unbind().click(function() {
        var guid = $.trim(form.find('input[name="guid"]').val());
        var alias = $.trim(form.find('input[name="alias"]').val());
        var email = $.trim(form.find('input[name="email"]').val());
        var skype_username = $.trim(form.find('input[name="skype_username"]').val());
        var secret_phrase = $.trim(form.find('input[name="secret_phrase"]').val());
        var contact_email = $.trim(form.find('input[name="contact_email"]').val());


        $.post(root + 'wallet/reset-two-factor', { guid: guid, alias: alias, email : email, skype_username : skype_username, secret_phrase : secret_phrase, contact_email : contact_email, method : 'reset-two-factor' },  function(data) {
            $('#initial_error').hide();
            $('#initial_success').show(200).text(data);
        }).error(function(data) {
                $('#initial_success').hide();
                $('#initial_error').show(200).text(data.responseText);
            });
    });
});