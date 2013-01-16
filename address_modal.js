function showAddressModalQRCode(address) {
    var modal = $('#qr-code-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(address);

    loadScript(resource + 'wallet/qr.code.creator.js', function() {
        var canvas = makeQRCode(300,300,1, address);

        modal.find('.address-qr-code').empty().append(canvas);

        modal.center();
    });

    modal.find('.address').text(address);

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}


function verifyMessageModal() {
    var modal = $('#verify-message-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });


    modal.find('.address-result').hide();

    var address_input = modal.find('input[name="address"]');

    var message_textarea = modal.find('textarea[name="message"]');

    var signature_textarea = modal.find('textarea[name="signature"]');

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('textarea').bind('change', function() {
        modal.find('.address-result').hide();
    });

    modal.find('.btn.btn-primary').unbind().click(function() {
        try {
            var address = $.trim(address_input.val());
            if (!address || address.length == 0) {
                throw 'Please enter a Bitcoin Address';
            }

            try {
                new Bitcoin.Address(address);
            } catch(e) {
                throw 'Invalid Bitcoin Address';
            }

            var message = $.trim(message_textarea.val());
            if (!message || message.length == 0) {
                throw 'You Must Enter A Message To Verify';
            }

            var signature = $.trim(signature_textarea.val());
            if (!signature || signature.length == 0) {
                throw 'You Must Enter A Signature To Verify';
            }

            if (Bitcoin.Message.verifyMessage(address, signature, message))
                modal.find('.address-result-txt').html('<font color="green">Message Successfully Verified</font>');
            else
                modal.find('.address-result-txt').html('<font color="red">Error Verifying Message!</font>');

            modal.find('.address-result').show(200);

        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', 'Error Verifying Message' + e);
            modal.modal('hide');
            return;
        }
    });
}


function showAddressModalSignMessage(address) {
    MyWallet.getSecondPassword(function() {
        var modal = $('#sign-message-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.find('.signature').hide();

        var textarea = modal.find('textarea[name="message"]');

        modal.find('.address').text(address);

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });

        textarea.bind('change', function() {
            modal.find('.signature').hide();
        });

        modal.find('.btn.btn-primary').unbind().click(function() {
            var message = $.trim(textarea.val());

            if (!message || message.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You Must Enter A Message To Sign');
                return;
            }

            var signature = MyWallet.signmessage(address, message);

            modal.find('.signature').show(200);

            modal.find('.signature-result').text(signature);
        });
    });
}

function showLabelAddressModal(addr) {
    var modal = $('#label-address-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    var label_input = modal.find('input[name="label"]');

    modal.find('.address').text(addr);

    label_input.val('');

    //Added address book button
    modal.find('.btn.btn-primary').unbind().click(function() {

        modal.modal('hide');

        var label = $.trim($('<div>' + label_input.val() + '</div>').text());

        if (label.length == 0) {
            MyWallet.makeNotice('error', 'misc-error', 'You must enter a label for the address');
            return false;
        }

        if (label.indexOf("\"") != -1) {
            MyWallet.makeNotice('error', 'misc-error', 'Label cannot contain double quotes');
            return false;
        }

        MyWallet.setLabel(addr, label);
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}
