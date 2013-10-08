isExtension = true;
APP_NAME = 'javascript_chrome';

$(document).ready(function() {
    var body = $(document.body);

    var data_root = body.data('root');
    if (data_root)
        root = data_root;

    var data_resource = body.data('resource');
    if (data_resource)
        resource = data_resource;

    //Chrome should automatically grant notification permissions
    MyWallet.setHTML5Notifications(true);

    $('body').css('padding-bottom', '0px');

    $('html').css('overflow-y', 'auto');

    $('.quickstart').css('background-image', 'linear-gradient(rgb(255, 255, 255), rgb(245, 245, 245))');

});

MyStore = new function() {
    this.put = function(key, value) {
        var obj = {};

        obj[key] = value;

        try {
            chrome.storage.local.set(obj);
        } catch(e) {
            console.log(e);
        }
    }

    this.get = function(key, callback) {
        try {
            chrome.storage.local.get(key, function(result) {
                callback(result[key]);
            });
        } catch(e) {
            console.log(e);
        }
    }

    this.remove = function(key) {
        try {
            chrome.storage.local.remove(key);
        } catch(e) {
            console.log(e);
        }
    }

    this.clear = function() {
        try {
            chrome.storage.local.clear();
        } catch(e) {
            console.log(e);
        }
    }
}