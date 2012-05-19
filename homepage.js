
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
	    ws = new WebSocket("ws://api.blockchain.info:8335/inv");

		ws.onmessage = function(e) {
						
			var obj = $.parseJSON(e.data);
			
			if (obj.op == 'minitx') {									
				var tx = obj.x;
										
				$('<tr><td><div><a href="${root}tx-index/'+tx.txIndex+'/'+tx.hash+'">'+tx.hash.substring(0, 25)+'...</a></div></td><td data-time="'+tx.time+'"><div>< 1 minute</div></td><td><div><button class="btn success" onclick="toggleSymbol()">'+ formatMoney(tx.value, true) +'</button></div></td></tr>').insertAfter($('#txs tr:first')).find('div').hide().slideDown('slow');
				
			    $('#txs tr:last-child').remove();
			} else if (obj.op == 'block') {					
				console.log('on block');
				
				var block = BlockFromJSON(obj.x);
				
				var foundByTxt = 'Unknown'; 
				if (block.foundBy) {
					foundByTxt = '<a href="'+block.foundBy.link+'">'+block.foundBy.description+'</a>';
				}
				
				$('<tr><td><div><a href="${root}/block-index/'+block.blockIndex+'/'+block.hash+'">'+block.height+'</a></div></td><td data-time="'+block.time+'"><div>< 1 minute</div></td><td><div>'+block.txIndex.length+'</div></td><td><div>'+formatMoney(block.totalBTCSent, true)+'</div></td><td><div>'+foundByTxt+'</div></td><td><div>'+parseInt(block.size / 1024)+'</div></td></tr>').insertAfter($('#blocks tr:first')).find('div').hide().slideDown('slow');

			    $('#blocks tr:last-child').remove();
			}
		};

		ws.onopen = function() {
			retry = 0;
			
			ws.send('{"op":"set_tx_mini"}{"op":"unconfirmed_sub"}{"op":"blocks_sub"}');
			
			setTimeout(function() {
				ws.send('{"op":"ping_block"}');
			}, 1000);
		};
		
		ws.onclose = function() {
			console.log('On close');
			
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