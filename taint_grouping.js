
function removeGrouping() {
    $('#active-addresses').trigger('show');
}

function buildTable(groups) {

    var el = $('#active-addresses');
    var table = el.find('table');

    table.find('tbody').remove();

    for (var i in groups) {
        var group = groups[i];

        if (i == 0)
            table.append('<tbody><tr><th colspan="2">Group #'+i+'</th><th colspan="2"><a onclick="removeGrouping();">Hide Grouping</a></th></tr></tbody>');
        else
            table.append('<tbody><tr><th colspan="4">Group #'+i+'</th></tr></tbody>');

        var tbody = $('<tbody></tbody>').appendTo(table);

        for (var ii in group) {
            var address = group[ii];

            var addr = addresses[address];

            if (!addr) continue;

            var noPrivateKey = '';

            if (addr.tag == 1) {
                noPrivateKey = ' <font color="red" title="Not Synced">(Not Synced)</font>';
            } else if (addr.priv == null) {
                noPrivateKey = ' <font color="red" title="Watch Only">(Watch Only)</font>';
            }

            var extra = '';
            var label = addr.addr;
            if (addr.label != null) {
                label = addr.label;
                extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
            }

            var thtml = '<tr style="background-color:#FFFFFF;"><td></td><td style="background-color:#FFFFFF;"><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td style="background-color:#FFFFFF;" colspan="2"><span style="color:green">' + formatBTC(addr.balance) + '<span class="hidden-phone"> BTC</span></span></td></tr>';

            tbody.append(thtml);
        }

        table.append(tbody);
    }
}

function loadTaintData() {
    setLoadingText('Loading Taint Data');

    $.get(root + 'taint/' + getAllAddresses().join('|') + '?format=json').success(function(obj) {
        var groups = [];
        var filteredTaints = obj.filteredTaints;

        //For each address in the wallet
        for (var address in filteredTaints) {
            var map =  filteredTaints[address];

            var found = -1;

            //Loop through the addresses which it taints
            for (var tainted_address in map) {
                var taint = map[tainted_address];

                for (var i in groups) {
                    //If any address which it taints is already grouped add it to that existing group
                    if (i != found && $.inArray(tainted_address, groups[i])) {

                        //If we already added it two a group and it is found in a new group then we need to merge them
                        if (found >= 0) {
                            var a = groups.splice (found, 1);
                            var b = groups.splice (i, 1);

                            groups.push(a.concat(b));
                        } else {
                            groups[i].push(address);
                        }

                        found = i;
                    }

                    if (found >= 0)
                        break;
                }
            }

            //If no tainted addresses are found add it to a new group
            if (found == -1)   {
                groups.push([address]);
            }
        }

        buildTable(groups);

        BlockchainAPI.get_balances(getAllAddresses(), function(obj) {
            for (var key in obj) {
                addresses[key].balance = obj[key].final_balance;
            }

            buildTable(groups);
        }, function(e) {
            makeNotice('error', 'misc-error', e);
        });
    }).error(function() {
            makeNotice('error', 'misc-error', 'Error Downloading Taint Data')
        });
}
