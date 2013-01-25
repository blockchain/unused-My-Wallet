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

    //Make sure the last guid the user logged in the same as this one, if not clear cache
    var local_guid = localStorage.getItem('guid');

    if (local_guid && local_guid.length == 36) {
        MyWallet.setGUID(local_guid, false);
    }
})