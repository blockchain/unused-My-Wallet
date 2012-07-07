$(document).ready(function() {

    var forwarding_result = $('#forwarding-result');

    forwarding_result.hide();

    var button = $('#create-forwarding').find('button');

    button.click(function() {
        $(this).text('Working...').attr('disabled', true);

        var address = $.trim($('#create-forwarding').find('input[name="input-address"]').val());

        $.post("/forwarder", { action : "create-mix", address : address }, function(obj) {
            button.text('Create New Forwarding Address').attr('disabled', false);

            if (obj.destination != address) {
                throw 'Mismatch between requested and returned destination address';
            }

            forwarding_result.show(500);

            forwarding_result.find('.input_address').text(obj.input_address);
            forwarding_result.find('.output_address').text(obj.destination);

        }).error(function(data) {
                button.text('Create New Forwarding Address').attr('disabled', false);

                alert(data.responseText);
        });
    });

});