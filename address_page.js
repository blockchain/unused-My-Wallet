$(document).ready(function() {	

	$('#add-to-wallet').click(function() {
		goToWallet('${address}');	
	});
	
	$('#deposit').click(function() {
		loadScript('${wallet_resource}deposit/deposit.js', function() {
			showDepositModal('${address}', 'sms', 'Instant Deposit By Phone / SMS');
		});
	});
	
	$('#payment-request').click(function() {
		loadScript('${wallet_resource}payment-request.js', function() {
			showPaymentRequestModal('${address}', 'Payment Request');
		});
	});
	var canvas = makeQRCode(255,250, 1,'${address}');
	
	$('#qr-code').append(canvas);
	
	$('#filter').change(function(){
		$(this).parent().submit();
	});
	
	try {
		var ws = new WebSocket("ws://api.blockchain.info:8335/inv");

		ws.onmessage = function(e) {
			var obj = $.parseJSON(e.data);
					
			if (obj.op == 'status') {
				$('#status').html(obj.msg);
			} else if (obj.op == 'utx') {
				
				op = obj.x;
				
				try {
		        	playSound('beep');
				} catch(e) { console.log(e); }
									
				var tx = TransactionFromJSON(op);
								
				tx.setConfirmations(0);
				
				/* Calculate the result */
				var result = 0;
					
				for (var i = 0; i < tx.inputs.length; i++) {
					var input = tx.inputs[i];
					 			
					console.log(input.prev_out.addr);
					
					//If it is our address then subtract the value
					if (input.prev_out.addr == '${address}') {
						result -= parseInt(input.prev_out.value);
					}
				}
				
				console.log('result ' + result);

				var total_received = 0;
				for (var i = 0; i < tx.out.length; i++) {
					var output = tx.out[i];
											
					if (output.addr == '${address}') {
						total_received += parseInt(output.value);
					}
				}
				
				$('#total_received span').attr('data-c', parseInt($('#total_received span').attr('data-c')) + total_received);
				
				result += total_received;
				
				$('#final_balance span').attr('data-c', parseInt($('#final_balance span').attr('data-c')) + result);

				flashTitle('New Transaction');
				
				tx.result = result;
				
				$('#tx_container').prepend(tx.getHTML());

				$('#tx-'+op.txIndex).fadeIn("slow").slideDown('slow');
				
				console.log($('#n_transactions').val());
				
				$('#n_transactions').text(parseInt($('#n_transactions').text())+1);
			
				calcMoney();
			} 
		};

		ws.onopen = function() {
			$('#status').html('Connected. ');

			ws.send('{"op":"addr_sub", "addr":"${address}"}');
		};

		ws.onclose = function() {
			$('#status').html('Disconnected');
		};
	} catch (e) {
		console.log(e);
	}
});
