function showAddressModalMenu(address) {
    var addr = addresses[address];

    if (addr == null) {
        makeNotice('error', 'misc-error', 'Address Not Found');
        return;
    }

    var modal = $('#address-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    modal.find('.address').text(address);

    if (addr.tag == 2)
        modal.find('.address-archive-button').hide();

    if (addr.priv == null)
        modal.find('.address-sign-message').hide();

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });

    modal.find('.address-label-button').unbind().click(function() {
        modal.modal('hide');

        showLabelAddressModal(address);
    });

    modal.find('.address-qr-code-button').unbind().click(function() {
        modal.modal('hide');

        showAddressModalQRCode(address);
    });

    modal.find('.address-sign-message').unbind().click(function() {
        modal.modal('hide');

        showAddressModalSignMessage(address);
    });

    modal.find('.address-archive-button').unbind().click(function() {
        modal.modal('hide');

        archiveAddr(address);
    });
}

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


    console.log('Verify Message');

    modal.find('.address-result').hide();

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
            var message = $.trim(message_textarea.val());
            if (!message || message.length == 0) {
                makeNotice('error', 'misc-error', 'You Must Enter A Message To Verify');
                return;
            }

            var signature = $.trim(signature_textarea.val());
            if (!signature || signature.length == 0) {
                makeNotice('error', 'misc-error', 'You Must Enter A Signature To Verify');
                return;
            }


            console.log(message + ' ' + signature);

            var address = Bitcoin.Message.verifyMessage(signature, message);

            modal.find('.address-result-txt').text(address);

            modal.find('.address-result').show(200);

        } catch (e) {
            makeNotice('error', 'misc-error', 'Error Verifying Message' + e);
            modal.modal('hide');
            return;
        }
    });
}


function showAddressModalSignMessage(address) {
    getSecondPassword(function() {
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

            var addr = addresses[address];

            if (!addr || !addr.priv) {
                modal.modal('hide');
                return;
            }

            var message = $.trim(textarea.val());

            if (!message || message.length == 0) {
                makeNotice('error', 'misc-error', 'You Must Enter A Message To Sign');
                return;
            }

            var decryptedpk = decodePK(addr.priv);

            var key = new Bitcoin.ECKey(decryptedpk);

            var signature = Bitcoin.Message.signMessage(key, message, addr.addr);

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

    modal.find('.address').text(addr);

    var label_input = modal.find('input[name="label"]');

    modal.find('.address').text(addr);

    label_input.val('');

    //Added address book button
    modal.find('.btn.btn-primary').unbind().click(function() {

        modal.modal('hide');

        var label = label_input.val();

        if (label.length == 0) {
            makeNotice('error', 'misc-error', 'you must enter a label for the address');
            return false;
        }

        addresses[addr].label = label;

        backupWalletDelayed();

        buildVisibleView();
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}
