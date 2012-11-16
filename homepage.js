
var noFocus = 0;
var ws;
var retry = 0;
decimals = 2;
function updateTimes() {
	document.hasFocus ? noFocus = 0 : ++noFocus;
		
	if (noFocus > 120 && ws) {
		ws.close();
		ws = null;
	}

	var now = new Date().getTime() / 1000;
	$('td[data-time]').each(function(index) {
		var diff = now - $(this).attr('data-time');
		
		if (diff < 60) {
			$(this).text('< 1 minute');
		} else if (diff < 3600) {
			var p = (parseInt(diff / 60) > 1) ? 's' : '';
			$(this).text(parseInt(diff / 60) + ' minute'+p);
		} else {
			var p = (parseInt(diff / 3600) > 1) ? 's' : '';
			$(this).text(parseInt(diff / 3600) + ' hour'+p+' ' + parseInt((diff % 3600) / 60) + ' minutes');
		}
	});
}

function connect() {
	try {
	    ws = new WebSocket(getWebSocketURL());

		ws.onmessage = function(e) {
						
			var obj = $.parseJSON(e.data);
			
			if (obj.op == 'minitx') {									
				var tx = obj.x;

                var label;
                if (tx.tag) {
                    label = '<a href="'+root+'tx/'+tx.hash+'">'+tx.hash.substring(0, 10)+'...</a> <span class="tag">('+tx.tag;

                    if (tx.tag_link) {
                      label += ' <a class="external" rel="nofollow" href="'+tx.tag_link+'" target="new"></a>';
                    }

                    label +=')</span>';
                } else {
                    label = '<a href="'+root+'tx/'+tx.hash+'">'+tx.hash.substring(0, 25)+'...</a>';
                }

				$('<tr><td><div>'+label+'</div></td><td class="hidden-phone" data-time="'+tx.time+'"><div>< 1 minute</div></td><td><div><button class="btn btn-success" onclick="toggleSymbol()">'+ formatMoney(tx.value, true) +'</button></div></td></tr>').insertAfter($('#txs tr:first')).find('div').hide().slideDown('slow');

			    $('#txs tr:last-child').remove();
			} else if (obj.op == 'block') {
				var block = BlockFromJSON(obj.x);
				
				var foundByTxt = 'Unknown'; 
				if (block.foundBy != null) {
					foundByTxt = '<a href="'+block.foundBy.link+'">'+block.foundBy.description+'</a>';
				}

                if (block.txIndex)
                    var n_tx = block.txIndex.length;
                else
                    var n_tx = 0;

				$('<tr><td><div><a href="'+root+'block-index/'+block.blockIndex+'/'+block.hash+'">'+block.height+'</a></div></td><td data-time="'+block.time+'"><div>< 1 minute</div></td><td class="hidden-phone"><div>'+block.txIndex.length+'</div></td><td class="hidden-phone"><div>'+formatMoney(block.totalBTCSent, true)+'</div></td><td><div>'+foundByTxt+'</div></td><td class="hidden-phone"><div>'+parseInt(block.size / 1024)+'</div></td></tr>').insertAfter($('#blocks tr:first')).find('div').hide().slideDown('slow');

			    $('#blocks tr:last-child').remove();
			}
		};

		ws.onopen = function() {
            retry = 0;

			ws.send('{"op":"set_tx_mini"}{"op":"unconfirmed_sub"}{"op":"blocks_sub"}');
        };
		
		ws.onclose = function() {
			if(document.hasFocus && retry < 3) {
				setTimeout(connect, 1000*retry);
				++retry;
			}
		};
	} catch (e) {
		console.log(e);
	}
}

$(document).ready(function() {	
	setInterval(updateTimes, 1000);
	
	connect();
});