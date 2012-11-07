var forwards;

function extendForwarding(input_address) {

    $.get(root + "forwarder", { method : "extend", input_address : input_address, time : 86400000,  guid : guid, sharedKey : sharedKey, format : 'plain' }, function(data) {
        makeNotice('success', 'misc-success', data);

        buildAnonymousTable($('#anonymous-addresses'));
    }).error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);
        });

}

function buildAnonymousTable(el) {
    var forward_table = el.find('table');
    var forward_tbody =  forward_table.find('tbody');

    $.get(root + "forwarder", { method : "get", guid : guid, sharedKey : sharedKey, format : 'plain' }, function(obj) {
        setLoadingText('Loading Anonymous Addresses');

        forward_tbody.empty();

        forwards = obj.forwards;

        if (forwards && forwards.length > 0 ) {
            for (var i in forwards) {
                var forward = forwards[i];

                var time_left = forward.expires - new Date().getTime();
                function milliToStr(milliseconds) {
                    var seconds = milliseconds / 1000;
                    var numdays = Math.floor((seconds % 31536000) / 86400);
                    if(numdays){
                        return numdays + ' day' + ((numdays > 1) ? 's' : '');
                    }
                    var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
                    if(numhours){
                        return numhours + ' hour' + ((numhours > 1) ? 's' : '');
                    }
                    var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
                    if(numminutes){
                        return numminutes + ' minute' + ((numminutes > 1) ? 's' : '');
                    }
                    return '<font color="red">Pending Deletion</font>'; //'just now' //or other string you like;
                }

                var destination_addr = addresses[forward.destination_address];

                if (destination_addr != null) {
                    var desintation_desc;

                    if (destination_addr.label)
                        desintation_desc = destination_addr.label;
                    else
                        desintation_desc = destination_addr.addr;

                    if (destination_addr.priv == null)
                        desintation_desc += '<font color="red">(Watch Only!)</font>';
                    else if (destination_addr.tag == 2)
                        desintation_desc += '<font color="red">(Archived)</font>';

                    if (forward.expires < 0)
                        var expires = '<font color="red">Removing After Tx Confirms</font>';
                    else
                        var expires = milliToStr(time_left);

                    forward_tbody.append('<tr><td><a class="short-addr" href="'+root+'address/'+forward.input_address+'" target="new">'+forward.input_address+'</a></td><td class="hidden-phone">'+desintation_desc+'</td><td>'+ expires +' <a class="pull-right hidden-phone" onclick="extendForwarding(\''+forward.input_address+'\')">(extend)</a></td></tr>');
                }
            }
        } else {
            forward_tbody.append('<tr><td colspan="3">No Anonymous Addresses</td></tr>')
        }

    }).error(function(data) {
            makeNotice('error', 'misc-error', data.responseText);

            forward_tbody.empty().append('<tr><td colspan="3">No Anonymous Addresses</td></tr>')
        });


    $('#anonymous-address').unbind().click(function() {
        var destination = getPreferredAddress().addr;

        setLoadingText('Creating Forwarding Address');

        //Default expires is 4 days
        $.post("/forwarder", { action : "create-mix", address : destination, guid : guid, sharedKey : sharedKey, expires : new Date().getTime()+(345600000), format : 'plain' }, function(obj) {
            if (obj.destination != destination) {
                throw 'Mismatch between requested and returned destination address';
            }

            buildAnonymousTable($('#anonymous-addresses'));
        }).error(function(data) {
                makeNotice('error', 'misc-error', data.responseText);
            });
    });
}