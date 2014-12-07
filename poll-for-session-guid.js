var counter = 0;
var isPolling = false;

function pollForSessionGUID() {
    if (isPolling) return;

    isPolling = true;

    console.log('pollForSessionGUID()');

    MyWallet.setLoadingText('Waiting For Authorization');

    $.ajax({
        dataType: 'json',
        type: "GET",
        url: root + 'wallet/poll-for-session-guid',
        success: function (obj) {
            var self = this;
            if (obj.guid) {
                isPolling = false;

                MyWallet.makeNotice('success', 'misc-success', 'Authorization Successful');

                MyWallet.setGUID(obj.guid, false);
            } else {
                if (counter < 600) {
                    ++counter;
                    setTimeout(function() {
                        $.ajax(self);
                    }, 2000);
                } else {
                    isPolling = false;
                }
            }
        },
        error : function() {
            isPolling = false;
        }
    });
};

$(document).ready(function() {
    pollForSessionGUID();
});