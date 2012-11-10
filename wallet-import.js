function uploadWallet(url, file, success, error, password, kaptcha) {
    $('.loading-indicator').fadeIn(200);

    var formData = new FormData();

    formData.append('file', file);
    formData.append('password', password);
    formData.append('kaptcha', kaptcha);

    var xhr = new XMLHttpRequest();

    xhr.open('POST', url, true);

    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4) {
            $('.loading-indicator').fadeOut(200);

            if (xhr.status == 200 ) {
                success(xhr.responseText);
            } else {
                error(xhr.responseText, xhr.status);
            }
        }
    }

    xhr.onerror = function () {
        $('.loading-indicator').fadeOut(200);

        error(xhr.responseText, xhr.status);
    };

    xhr.send(formData);  // multipart/form-data
}

function showKaptchaModal(success) {
    var modal = $('#kaptcha-modal');

    $('#captcha-value').val('');

    $("#captcha").attr("src", root + "kaptcha.jpg?timestamp=" + new Date().getTime());

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    //Center
    modal.center();

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');

        success($('#captcha-value').val());
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}

function getNewPassword(success) {

    var modal = $('#new-password-modal');

    modal.modal({
        keyboard: true,
        backdrop: "static",
        show: true
    });

    //Center
    modal.center();

    modal.find('.btn.btn-primary').unbind().click(function() {
        modal.modal('hide');

        if (checkAndSetPassword())
            success();
    });

    modal.find('.btn.btn-secondary').unbind().click(function() {
        modal.modal('hide');
    });
}

function guidGenerator() {
    var S4 = function() {
        return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}


function insertWallet() {
    getNewPassword(function() {
        showKaptchaModal(function(kaptcha) {
            sharedKey = guidGenerator();

            guid = guidGenerator();

            if (guid.length != 36) {
                makeNotice('error', 'misc-error', 'Error generating wallet identifier');
                return false;
            }

            backupWallet('insert', function(){
                SetCookie('cguid', guid);

                try {
                    localStorage.setItem('guid', guid);
                } catch (e) {}

                window.location = root + 'wallet/' + guid;
            }, function() {

                $("#captcha").attr("src", root + "kaptcha.jpg?timestamp=" + new Date().getTime());

            },'?kaptcha='+$('#captcha-value').val());
        });
    });
}

function handleFileSelect(evt) {
    evt.stopPropagation();
    evt.preventDefault();

    var files = evt.dataTransfer.files; // FileList object.
    var r = new FileReader();

    // files is a FileList of File objects. List some properties.
    for (var i = 0, f; f = files[i]; i++) {

        if (f.size > 10485760) {
            makeNotice('error', 'misc-error', 'The maximum file size is 10MB');
            return;
        }

        if (f.name) {
            if (f.name.indexOf('.aes.json') == f.name.length - 9) {
                r.onload = function(e) {

                    loadScript(resource + 'wallet/wallet-backups.min.js', function() {
                        appendModals();

                        getPassword($('#import-password-modal'), function(password) {
                            addresses = [];

                            $('.loading-indicator').fadeIn(200);

                            importJSON(e.target.result, {password : password}, function() {
                                $('.loading-indicator').fadeOut(200);

                                insertWallet();
                            }, function(e) {
                                $('.loading-indicator').fadeOut(200);

                                makeNotice('error', 'misc-error', e);
                            });
                        });
                    });
                };

                r.readAsText(f);

                return;
            } else if (f.name.indexOf('.dat') == f.name.length - 4) {
                loadScript(resource + 'wallet/wallet-backups.min.js', function() {
                    appendModals();

                    showKaptchaModal(function(kaptcha) {
                        getPassword($('#import-password-modal'), function(password) {
                            uploadWallet(root + 'upload_wallet', f, function(response) {
                                addresses = [];

                                $('.loading-indicator').fadeIn(200);

                                importJSON(response, {}, function() {
                                    $('.loading-indicator').fadeOut(200);

                                    insertWallet();
                                }, function(e) {
                                    $('.loading-indicator').fadeOut(200);

                                    makeNotice('error', 'misc-error', e);
                                });
                            }, function(response) {
                                makeNotice('error', 'misc-error', response);
                            }, password, kaptcha);
                        });
                    });
                });
            } else {
                makeNotice('error', 'misc-error', 'Unknown File Type ' + f.name);
            }

            return;
        }
    }
}

function handleDragOver(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}

$(document).ready(function() {
    $('body').ajaxStart(function() {
        $('.loading-indicator').fadeIn(200);
    });

    $('body').ajaxStop(function() {
        $('.loading-indicator').fadeOut(200);
    });

    // Check for the various File API support.
    if (window.File && window.FileReader && window.FileList && window.Blob) {
        // Great success! All the File APIs are supported.

        // Setup the dnd listeners.
        var dropZone = document.getElementById('holder');
        dropZone.addEventListener('dragover', handleDragOver, false);
        dropZone.addEventListener('drop', handleFileSelect, false);

    } else {
        makeNotice('error', 'misc-error', 'The File APIs are not fully supported in this browser.');
    }
});