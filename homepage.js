
var noFocus = 0;
var ws;
var retry = 0;
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
										
				$('#txs tr:first').after('<tr><td><a href="${root}tx-index/'+tx.txIndex+'/'+tx.hash+'">'+tx.hash.substring(0, 25)+'...</a></td><td data-time="'+tx.time+'">< 1 minute</td><td><button class="btn success cb" onclick="toggleSymbol()">'+ formatMoney(tx.value) +'</button></td></tr>');
			
			    $('#txs tr:last-child').remove();
			} else if (obj.op == 'block') {					
				console.log('on block');
				
				var block = BlockFromJSON(obj.x);
				
				$('#blocks tr:first').after('<tr><td><a href="${root}/block-index/'+block.blockIndex+'/'+block.hash+'">'+block.height+'</a></td><td data-time="'+block.time+'">< 1 minute</td><td>'+block.txIndex.length+'</td><td>'+formatMoney(block.outputValue)+'<td><a href="'+block.foundByLink+'">'+block.foundByDescription+'</a></td><td>'+block.size+'</td></tr>');
				
			    $('#blocks tr:last-child').remove();
			}
		};

		ws.onopen = function() {
			retry = 0;
			
			ws.send('{"op":"set_tx_mini"}{"op":"unconfirmed_sub"}{"op":"blocks_sub"}');
		};
		
		ws.onclose = function() {
			console.log('On close');
			
			if(document.hasFocus && retry < 3) {
				connect();
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