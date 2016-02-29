var transactions = [];

var count;
var total_fees;
var total_size;
var _header;
var _connected;
var _disconnected;
var _txIndexes;
var sound_on = true;
var lasttx = null;

function toggleSound() {
    sound_on = !sound_on;

    if (sound_on) {
        $('#sound_on').attr("src",resource + "sound_on.png");
    } else {
        $('#sound_on').attr("src",resource + "sound_off.png");
    }
}

function SetStatus() {
    var header = _header.replace('{0}', count);

    document.title = header;

    $('#header').html(header);

    $('#total_fees').html(formatMoney(total_fees));

    $('#total_size').html(total_size / 1000 + ' (KB)');
}

function ws_connect() {
    webSocketConnect(function(ws) {
        ws.onmessage = function(e) {
            console.log(e);

            var obj = $.parseJSON(e.data);

            if (obj.op == 'status') {
                $('#status').html(obj.msg);
            } else if (obj.op == 'utx') {
                op = obj.x;

                if (sound_on) {
                    playSound('beep');
                }

                count++;

                var tx = TransactionFromJSON(op);

                _txIndexes.push(tx.txIndex);

                var tx_html = tx.getHTML();

                $('#tx_container').prepend(tx_html);

                setupSymbolToggle();

                tx_html.hide().slideDown('slow');

                $('#tx_container .txdiv:last-child').remove();

                SetStatus();

                lasttx = tx;
            } else if (obj.op == 'block') {
                for (var i = 0; i < obj.x.txIndexes.length; ++i) {
                    var txIndex = obj.x.txIndexes[i];

                    var el = $('#tx-' + txIndex);
                    if (el.length > 0) {
                        el.remove();
                    }

                    var index = _txIndexes.indexOf(txIndex);
                    if (index > -1) {
                        _txIndexes.splice(index, 1);
                        count--;
                    }
                }

                SetStatus();

                if (sound_on) {
                    playSound('ding');
                }
            } else if (obj.op == 'marker') {
                marker = new google.maps.Marker({
                    map:map,
                    draggable:false,
                    icon: resource + 'flags/' + obj.x.cc.toLowerCase() + '.png',
                    animation: google.maps.Animation.DROP,
                    position: new google.maps.LatLng(obj.x.lat, obj.x.lon)
                });

                if (lasttx) {
                    google.maps.event.addListener(marker, 'click', function(){ window.location.href = root + 'tx-index/' + lasttx.txIndex });
                }
            }
        };

        ws.onopen = function() {
            $('#status').html(_connected);

            ws.send('{"op":"unconfirmed_sub"}{"op":"blocks_sub"}{"op":"marker_sub"}');
        };

        ws.onclose = function() {
            $('#status').html(_disconnected);
        };
    });
}

var map;

$(document).ready(function() {

    $('#sound_on').click(function() {
        toggleSound();
    });

    var mapOptions = {
        zoom: 2,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        center: new google.maps.LatLng(40, -1)
    };

    var data_obj = $(document.body).data('json');

    count = data_obj.count;
    total_fees = data_obj.total_fees;
    total_size = data_obj.total_size;
    _header = data_obj.header;
    _connected = data_obj.connected;
    _disconnected = data_obj.disconnected;
    _txIndexes = data_obj.txIndexes;

    if (data_obj.enable_websocket) {
        ws_connect();
    }

    map = new google.maps.Map(document.getElementById("map_canvas"), mapOptions);

    for (var i in data_obj.locations)  {
        var location = data_obj.locations[i];

        if (location.cc) {
            var marker = new google.maps.Marker({
                map:map,
                draggable:false,
                icon: resource + 'flags/'+location.cc.toLowerCase() + '.png',
                position: new google.maps.LatLng(location.lat, location.lon)
            });

            google.maps.event.addListener(marker, 'click', function() {
                window.location.href = root + 'tx-index/'+location.txIndex;
            });
        }
    }
});
