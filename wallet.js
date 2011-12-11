var encrypted_wallet_data = null;
var guid = null;
var transactions = []; //List of all transactions
var addresses = []; //Bitcoin addresses
var private_keys = []; //Previate keys in base58
var cVisible; //currently visible view
var password; //Password
var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't ovwerwrite a wallet backup even if you have the guid
var final_balance = 0; //Amount available to withdraw
var total_sent = 0; //Amount available to withdraw
var total_received = 0; //Amount available to withdraw
var n_tx = 0; //Amount available to withdraw
var satoshi = parseInt(100000000); //One satoshi
var isInitialized = false; //Wallet is loaded and decrypted
var latest_block = null; //Chain head block
var balances = []; //Holds balances of addresses
var address_book = []; //Holds the address book {addr : label}
var loading_text = '';
var block_heights = []; //BlockIndex to height
var our_address = '1A8JiWcwvpY7tAopUkSnGuEYHmzGYfZPiq';

function setLoadingText(txt) {
	$('.loading-text').text(txt);
}

function hideNotice(id) {
	$('#'+id).remove();
}

// Flash fall back for webscoket compatiability
WEB_SOCKET_SWF_LOCATION = "/Resources/WebSocketMain.swf";

setInterval ( "doStuffTimer()", 10000 );

function doStuffTimer () {
  if (isInitialized && ws.readyState != WebSocket.OPEN)
	  websocketConnect();
  
  updateLatestBlockAge();
}

var sound_on = true;

function websocketConnect() {
	ws = new WebSocket("ws://api.blockchain.info:8335/inv");
	
	ws.onmessage = function(e) {
						
		try {
	
			var obj = jQuery.parseJSON(e.data);
	
			if (obj.op == 'status') {
			
				$('#status').html(obj.msg);
			
			} else if (obj.op == 'utx') {
				
				//Check for duplicates
				for (var i = 0; i < transactions.length; ++i) {					
					if (transactions[i].txIndex == obj.x.tx_index)
						return;
				}
	            
	            try {
	                if (sound_on) {
	                    document.getElementById("beep").play(10);
	                }
	            } catch (e) {
	                console.log(e);
	            }
				
				var tx = TransactionFromJSON(obj.x);
				
				tx.setMyHashes(getMyHash160s());
				
				tx.setConfirmations(0);
	
				var result = tx.getResult();
				
				if (result > 0) {
					final_balance += result;
					total_received += result;
				} else if (result < 0) {
					total_sent -= result;
				}
				
				n_tx++;
	
				transactions.push(tx);
	
				$('#transactions').prepend(tx.getHTML()).hide().fadeIn("slow").slideDown('slow');
	
			}  else if (obj.op == 'block') {
				setLatestBlock(BlockFromJSON(obj.x));
			}
		
		} catch(e) {
			console.log(e);
			
			console.log(e.data);
		}
	};
	
	ws.onopen = function() {
					
		$('#status').html('CONNECTED.');
				
		var msg = '{"op":"blocks_sub"}';
		
		try {
			
			var hashes = getMyHash160s();
				
			for (var i = 0; i < hashes.length; ++i) {
														
				//Subscribe to tranactions updates through websockets
				msg += '{"op":"addr_sub", "hash":"'+ hashes[i] +'"}';
			}
		} catch (e) {
			alert(e);
		}
		
		ws.send(msg);
	};

	ws.onclose = function() {
		$('#status').html('DISCONNECTED.');
	};
}

function makeNotice(type, id, msg, timeout) {
	
	if (msg == null || msg.length == 0)
		return;
	
	var contents = '<div class="alert-message '+type+'" data-alert="alert"><a class="close">×</a><p>'+msg+'</p></div>';
	
	if ($('#'+id).length > 0) {
		$('#'+id).html(contents);
		return;
	}
	
	var el = $('<div id='+id+'>' + contents + '</div>');
	
	$("#notices").append(el).hide().fadeIn(200);
	
	if (timeout != null && timeout > 0) {
		(function() {
	
			var tel = el;
			
		    setTimeout(function() {
		    	tel.fadeOut(200, function() {
		            $(this).remove();
		        });
			}, timeout);  
	    })();
	}
}


function makeWalletJSON() {
	var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';
	
	out += '	"keys" : [\n';
	
	for (var i = 0; i < addresses.length; ++i) {
		out += '	{"addr" : "'+ addresses[i] +'"';
		
		if (private_keys[i] != null) {
			out += ',\n	 "priv" : "'+private_keys[i]+ '"';
		}
		
		out += '}';
		
		if (i < addresses.length-1) out += ',\n';
	}
	
	out += "\n	]";
	
	if (address_book.length > 0) {
		out += ',\n';
		
		out += '	"address_book" : [\n';
		
		for (var i = 0; i < address_book.length; ++i) {
			out += '	{"addr" : "'+ address_book[i].addr +'",\n';
			out += '	 "label" : "'+ address_book[i].label+ '"}';
			
			if (i < address_book.length-1) out += ',\n';
		}
		
		out += "\n	]";
	}
	
	out += '}';
	
	//Write the address book

	return out;
}

function parseWalletJSONObject(obj) {				
	for (var i = 0; i < obj.keys.length; ++i) {	
		internalAddKey(obj.keys[i].addr, obj.keys[i].priv);
	}
	
	if (obj.address_book != null) {
		for (var i = 0; i < obj.address_book.length; ++i) {	
			internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
		}
	}
}

function buildAddressBook() {
	
	if (address_book.length == 0)
		return;
	
	var el = $('#address-book-tbl tbody');

	el.empty();
	
	for (var i = 0; i < address_book.length; ++i) {
		el.append('<tr><td>'+ address_book[i].label + '</td><td>'+ address_book[i].addr + '</td></tr>');
	}
}

function buildFromAddressOptionList() {
	
	var el = $('#send-from-address');
	
	el.empty();

	for (var i = 0; i < addresses.length; ++i) {
		var balance = balances[addresses[i]];
		
		if (balance > 0) {
			//On the sent transactions page add the address to the from address options
			el.prepend('<option>' + addresses[i] + ' - ' + balance / satoshi + ' BTC</option>');
		} else {
			el.append('<option>' + addresses[i] + '</option>');
		}
	}
	
	el.prepend('<option>Any Address</option>');
	
	el.val($("#target option:first").val());
}

function importPyWalletJSONObject(obj) {
	var i = 0;
	try {
		for (i = 0; i < obj.keys.length; ++i) {
			var key = new Bitcoin.ECKey(Crypto.util.hexToBytes(obj.keys[i].hexsec));
						
			//Check the the private keys matches the bitcoin address
			if (obj.keys[i].addr ==  key.getBitcoinAddress().toString()) {				
				internalAddKey(obj.keys[i].addr, Bitcoin.Base58.encode(obj.keys[i].priv));
			} else {
				makeNotice('error', 'misc-error', 'Private key doesn\'t seem to match the address. Possible corruption', 1000);
				return false;
			}
		}
	} catch (e) {
		makeNotice('error', 'misc-error', 'Exception caught parsing importing JSON. Incorrect format?', 5000);
		return false;	
	}
	
	makeNotice('success', 'misc-success', 'Imported ' + i + ' private keys', 5000);
}

function importJSON() {
	
	var json = $('#import-json').val();
	
	if (json == null || json.length == 0) {
		makeNotice('error', 'misc-error', 'No import data provided!');
		return false;
	}

	var obj;

	try {
		try {
			//First try a simple decode
			obj = jQuery.parseJSON(json);
			
			if (obj == null) throw 'null json';
		} catch(e) {
			//Maybe it's encrypted?
			var decrypted = Crypto.AES.decrypt(json, password);
				
			obj = jQuery.parseJSON(decrypted);
	
			if (obj == null) throw 'null json';
		}
	} catch(e) {		
		makeNotice('error', 'misc-error', 'Could not decode import data', 5000);
		return;
	}
	
	if (obj == null || obj.keys == null || obj.keys.length == 0) {
		makeNotice('error', 'misc-error', 'No keys imported. Incorrect format?', 5000);
		return false;	
	}
	
	try {
		//Pywallet contains hexsec
		if (obj.keys[0].hexsec != null) {
			importPyWalletJSONObject(obj);
		} else {
			parseWalletJSONObject(obj);
		}
	} catch (e) {
		makeNotice('error', 'misc-error', 'Exception caught parsing JSON ' + e, 5000);
		return;
	}

	//Clear the old value
	$('#import-json').val('');
	
	return true;
}

function getMyHash160s() {
	var array = [];
	for (var i = 0; i < addresses.length; ++i) {
		array.push(Crypto.util.bytesToHex(new Bitcoin.Address(addresses[i]).hash));
	}
	return array;
}

function toFixed(value, precision) {
    var precision = precision || 0,
    neg = value < 0,
    power = Math.pow(10, precision),
    value = Math.round(value * power),
    integral = String((neg ? Math.ceil : Math.floor)(value / power)),
    fraction = String((neg ? -value : value) % power),
    padding = new Array(Math.max(precision - fraction.length, 0) + 1).join('0');

    return precision ? integral + '.' +  padding + fraction : integral;
}

function updateTransactionsSummary() {
	$('#transactions-summary').show();
	
	if (final_balance <= 0) {

		$('#balance-btc').html('0');
		
		$('#balance-usd').html('0');
	} else {
		
		$('#balance-btc').html(toFixed(final_balance / satoshi, 4));
	
		$('#balance-usd').html(toFixed(final_balance / satoshi * market_price, 2));
	}

	$('#summary-n-tx').html(n_tx);

	$('#summary-received-usd').html(toFixed(total_received / satoshi  * market_price, 2));

	$('#summary-received-btc').html(toFixed(total_received / satoshi, 4));

	$('#summary-sent-usd').html(toFixed(total_sent / satoshi  * market_price, 2));

	$('#summary-sent-btc').html(toFixed(total_sent / satoshi, 4));

	$('#summary-balance-usd').html(toFixed(final_balance / satoshi  * market_price, 2));

	$('#summary-balance-btc').html(toFixed(final_balance / satoshi, 4));
}

function updateTransactionConfirmations() {
	
	if (block_heights == null || block_heights.length == 0)
		return;
	
	for (var i=0;i<transactions.length;++i) {
	
		if (transactions[i].blockIndex == null || transactions[i].blockIndex == 0) {
			transactions[i].setConfirmations(0);
		} else {
			var height = block_heights[transactions[i].blockIndex];
			
			if (height != null) {
				var nconfirmations = latest_block.height - height + 1;
				
				transactions[i].setConfirmations(nconfirmations);
			} else {
				break;
			}
		}
	}
}

function updateLatestBlockAge() {
	
	if (latest_block != null) {
		var age = new Date().getTime() -  new Date(latest_block.time * 1000).getTime();

		$('#latest-block-age').html(Math.round(age / 1000 / 60));
	}
}

function setLatestBlock(block) {
	
	$('#latest-block').show();
	
	$('#latest-block-height').html(block.height);
	
	var date = new Date(block.time * 1000);
		
	$('#latest-block-time').html($.format.date(date, "HH:mm:ss"));
	
	$('#nodes-connected').html(nconnected);
	
	$('#market-price').html(market_price);
		
	latest_block = block;
	
	updateLatestBlockAge();
	
	updateTransactionConfirmations();
}

function parseLatestBlockJSON(json) {
	var obj = jQuery.parseJSON(json);

	setLatestBlock(BlockFromJSON(obj));

	if (obj.past_blocks != null) {
		for (var i=0; i< obj.past_blocks.length; ++i) {
			block_heights[obj.past_blocks[i].blockIndex] = obj.past_blocks[i].height;
		}
	}
}

function queryAPILatestBlock() {

	setLoadingText('Getting latest Block');

	$.ajax({
		  type: "GET",
		  url: root + 'latestblock',
		  converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": jQuery.parseXML},
		  success: function(json) {  
		
			parseLatestBlockJSON(json);
			
			if (localStorage) {
				localStorage.setItem('latestblock', json);
			}
		},
			
		error : function(data) {			
			makeNotice('error', 'misc-error', 'Error getting chain head.');
		},
	});
}

function parseMultiAddressJSON(json) {
	var obj = jQuery.parseJSON(json);

	var hashes = getMyHash160s();
	
	//Clear all transactions
	$('#transactions').html('');
	
	total_received = 0;
	total_sent = 0;
	final_balance = 0;
	n_tx = 0;
	
	for (var i = 0; i < obj.addresses.length; ++i) {
		
		final_balance += obj.addresses[i].final_balance;
		
		total_sent += obj.addresses[i].total_sent;
	
		total_received += obj.addresses[i].total_received;
	
		n_tx += obj.addresses[i].n_tx;
		
		balances[obj.addresses[i].address] = obj.addresses[i].final_balance;
	}	
	
	for (var i = 0; i < obj.txs.length; ++i) {
		
		var tx = TransactionFromJSON(obj.txs[i]);
		
		tx.setMyHashes(hashes);
		
		transactions.push(tx);
	
		html = tx.getHTML(root, resource);
	
		$('#transactions').append(html);
	}
}

//Get the list of transactions from the http API, after that it will update through websocket
function queryAPIMultiAddress() {
					
	var hashes = getMyHash160s();
	
	setLoadingText('Loading transactions');

	$.ajax({
		  type: "POST",
		  url: root +'multiaddr',
		  data: {'address[]' : hashes},
		  converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": jQuery.parseXML},
		  success: function(data) {  
		
			parseMultiAddressJSON(data);
			
			//Rebuild the my-addresse s list with the new updated balances
			buildReceivingAddressList();
			 
			updateTransactionConfirmations();
			
			updateTransactionsSummary();
			
			if (localStorage) {
				localStorage.setItem('multiaddr', data);
			}
		},
			
		error : function(data) {			
			makeNotice('error', 'misc-error', 'Error getting wallet balance from server', 5000);
		},
	});
}

function restoreWallet() {

	guid = $("#restore-guid").val();

	if (guid == null || guid.length != 36) {
		makeNotice('error', 'misc-error', 'Invalid wallet identifier', 5000);
		return false;
	} else {
		hideNotice('guid-error');
	}

	password = $("#restore-password").val();

	if (password.length == 0 || password.length < 8 || password.length > 255) {
		makeNotice('error', 'misc-error', 'Password length must at least 10 characters', 5000);
		return false;
	} else {
		hideNotice('password-error');
	}

	try {
		var decrypted = Crypto.AES.decrypt(encrypted_wallet_data, password);
		
		if (decrypted.length == 0) {
			makeNotice('error', 'misc-error', 'Error Decrypting Wallet', 5000);
						
			return false;
		}
		
		var obj = jQuery.parseJSON(decrypted);

		parseWalletJSONObject(obj);

		sharedKey = obj.sharedKey;

		
	} catch (e) {
		
		console.log(e);
		
		makeNotice('error', 'misc-error', 'Error decrypting wallet. Please check you entered your password correctly.', 5000);

		return false;
	}
		
	setIsIntialized();
	
	return true;
}

function setIsIntialized() {

	websocketConnect();
	
	$('#tech-faq').hide();

	$('#intro-text').hide();
	
	$('#large-summary').show();
	
	$('#status-container').show();
	
	isInitialized = true;
}

function validateEmail(str) { 
   var lastAtPos = str.lastIndexOf('@');
   var lastDotPos = str.lastIndexOf('.');
   return (lastAtPos < lastDotPos && lastAtPos > 0 && str.indexOf('@@') == -1 && lastDotPos > 2 && (str.length - lastDotPos) > 2);
} 

function emailBackup() {

	setLoadingText('Sending email backup');

	$.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'email-backup' },  function(data) { 
		makeNotice('success', 'backup-success', data, 5000);
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText); 
    });
}

function updateAlias(alias) {
	
	if (alias == null || alias.length == 0) {
		makeNotice('error', 'misc-error', 'You must enter an alias');
		return;
	}
	
	setLoadingText('Updating Alias');
	
	$.post("/wallet", { guid: guid, payload : alias, sharedKey: sharedKey, length : alias.length, method : 'update-alias' },  function(data) { 
		makeNotice('success', 'alias-success', data, 5000);
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText); 
    });
}

function updateEmail(email) {
	
	if (email == null || email.length == 0) {
		makeNotice('error', 'misc-error', 'You must enter an email');
		return;
	}
	
	if (!validateEmail(email)) {
		makeNotice('error', 'misc-error', 'Email address is not valid');
		return;
	}
		
	setLoadingText('Updating Email');

	$.post("/wallet", { guid: guid, payload: email, sharedKey: sharedKey, length : email.length, method : 'update-email' },  function(data) { 
		makeNotice('success', 'email-success', data, 5000);
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText); 
    });
}

function backupWallet(method) {
	
	if (!isInitialized && method != 'insert')
		return;
		
	if (guid.length != 36) {
		makeNotice('error', 'misc-error', 'Invalid wallet identifier');
		return;
	}
	
	var data = makeWalletJSON();
	
		
	//Double check the json is parasable
	try {
		var obj = jQuery.parseJSON(data);

		if (obj == null)
			throw 'null json error';
		
	} catch (e) {
		makeNotice('error', 'misc-error', 'Exception caught parsing JSON. Not backuping up wallet');
		return;
	}
	
	var crypted = Crypto.AES.encrypt(data, password);
		
	if (crypted.length == 0) {
		makeNotice('error', 'misc-error', 'Error enrypting the JSON output');
		return;
	}
	
	setLoadingText('Saving wallet');

	$.ajax({
		 type: "POST",
		 url: root + 'wallet',
		 data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, method : method },
		 converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
		 success: function(data) {  
			makeNotice('success', 'misc-success', data, 5000);
		},
			
		error : function(data) {
		   makeNotice('error', 'misc-error', 'Error Saving Wallet'); 
		}
	});
}

function checkAndSetPassword() {
	
	var tpassword = $("#password").val();
	
	var tpassword2 = $("#password2").val();
	
	if (tpassword != tpassword2) {
		makeNotice('error', 'misc-error', 'Passwords do not match.', 5000);
		return false;
	}
	
	if (tpassword.length == 0 || tpassword.length < 10 || tpassword.length > 255) {
		makeNotice('error', 'misc-error', 'Password must be 10 characters or more in length', 5000);
		return false;
	} 
	
	password = tpassword;
	
	return true;
}

function updatePassword() {
		
	var modal = $('#update-password-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
		
	modal.find('.btn.primary').unbind().click(function() {
		modal.modal('hide');

		if (!checkAndSetPassword()) {
			return false;
		}
		
		backupWallet('update');
		
		$('body').ajaxStop(function() {
			window.location = root + 'wallet/' + guid + window.location.hash;
		});
	});

	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}

function generateNewWallet() {

	if (addresses.length > 0) {
		makeNotice('error', 'misc-error', 'You have already generated one or more keys.');
		return false;
	}

	if (guid != null) {
		makeNotice('error', 'misc-error', 'You have already have a vaild wallet identifier.');
		return false;
	}
	
	if (isInitialized) {
		return false;
	}
	
	if (!checkAndSetPassword())
		return false;
	
	if (!generateNewAddressAndKey()) {
		makeNotice('error', 'misc-error', 'Error generating new bitcoin address');

		return false;
	}
	
	sharedKey = guidGenerator();
	
	guid = guidGenerator();
	
	if (guid.length != 36) {
		makeNotice('error', 'misc-error', 'Error generating wallet identifier');
		return false;
	}
		
	backupWallet('insert');
	
	return true;
}

function changeView(id) {

	if (id == cVisible)
		return;
		
	if (cVisible != null) {		
		if ($('#' + cVisible.attr('id') + '-btn').length > 0)
			$('#' + cVisible.attr('id') + '-btn').parent().attr('class', '');
		
		 cVisible.hide(200);
	}
	
	cVisible = id;

	cVisible.show(200);
	
	if ($('#' + cVisible.attr('id') + '-btn').length > 0)
		$('#' + cVisible.attr('id') + '-btn').parent().attr('class', 'active');
	
}

function pushTx(tx) {	
	var s = tx.serialize();

	var hex = Crypto.util.bytesToHex(s);
	
	setLoadingText('Sending Transaction');

	$.post("/pushtx", { tx: hex },  function(data) {  })
	.success(function(data) { makeNotice('success', 'misc-success', data, 5000); 
	}).error(function(data) { makeNotice('error', 'misc-error', data.responseText); 
    });
		
	return true;
}

function compareArray(a, b) {
   if (a == b) {
       return true;
   }   
   if (a.length != b.length) {
       return false;
   }
   for (var i= 0; i < a.length; ++i) {     
     if (a[i] != b[i]) {
         return false;
     }
   }
   return true;
}

function signTransaction(toAddressesWithValue, fromAddress, feeValue, unspentOutputs, missingPrivateKeys) {
		
		console.log('Sign Transaction');
		
		var selectedOuts = [];
		
		var txValue = 0;
		
		if (feeValue != null)
			txValue += feeValue;
        
		for (var i = 0; i < toAddressesWithValue.length; ++i) {			
			txValue += toAddressesWithValue[i].value;
		}

        //Add blockchain.info's fees
        var ouraddr = new Bitcoin.Address(our_address);
        
        var ourFee = (txValue / 100) * 1;
        
        var opointone = 1000000;
        
        if (ourFee < opointone) {
            ourFee = opointone;
        } 
            
        txValue += ourFee;

		var availableValue = 0;
		
		for (var i = 0; i < unspentOutputs.length; ++i) {
			
				var out = unspentOutputs[i];
					
				var hexhash = Crypto.util.hexToBytes(out.tx_hash);

				var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(out.tx_hash));
				
				selectedOuts.push(new Bitcoin.TransactionIn({outpoint: {hash: b64hash, hexhash: hexhash, index: out.tx_output_n, value:BigInteger.valueOf(out.value)}, script: out.script, sequence: 4294967295}));
								
				availableValue += out.value;
				
				if (availableValue >= txValue) break;
		}

	    if (availableValue <= txValue) {
			throw 'Insufficient funds.';
	    }

		var changeValue = availableValue - txValue;

		var sendTx = new Bitcoin.Transaction();

		for (var i = 0; i < selectedOuts.length; i++) {
			sendTx.addInput(selectedOuts[i]);
		}

		for (var i =0; i < toAddressesWithValue.length; ++i) {	
			
			console.log('Added output ' + toAddressesWithValue[i].address);
			console.log('Added output ' + toAddressesWithValue[i].value);

			sendTx.addOutput(toAddressesWithValue[i].address, BigInteger.valueOf(toAddressesWithValue[i].value));
			
		}
        
       sendTx.addOutput(ouraddr, BigInteger.valueOf(ourFee));

		if (changeValue > 0) {
			
			if (fromAddress == null)
				sendTx.addOutput(new Bitcoin.Address(addresses[0]), BigInteger.valueOf(changeValue));
			else
				sendTx.addOutput(fromAddress, BigInteger.valueOf(changeValue));
		}
				
		var hashType = 1; // SIGHASH_ALL

		
		for (var i = 0; i < sendTx.ins.length; i++) {
			
			var hash = sendTx.hashTransactionForSignature(selectedOuts[i].script, i, hashType);
			var pubKeyHash = selectedOuts[i].script.simpleOutPubKeyHash();
			var inputBitcoinAddress = new Bitcoin.Address(pubKeyHash).toString();
				
			//Find the matching private key
			var privatekey = null;
			for (var ki = 0; ki < addresses.length; ++ki) {				
				if (addresses[ki] == inputBitcoinAddress) {	
					if (private_keys[ki] != null && private_keys[ki].length > 0) {
						privatekey = new Bitcoin.ECKey(Bitcoin.Base58.decode(private_keys[ki]));
					}
					break;
				}
			}

			//If it is null then it is not in our main key pool, try look in the temporary keys
			if (privatekey == null) {	
				for (var ki = 0; ki < missingPrivateKeys.length; ++ki) {				
					if (missingPrivateKeys[ki].addr == inputBitcoinAddress) {	
						privatekey = missingPrivateKeys[ki].priv;
						break;
					}
				}
			}
			 
			//If it is still null then we need to ask the user for it
			if (privatekey == null) {	
				missingPrivateKeys.push({addr : inputBitcoinAddress, priv : null});
				return null;
			}
			
			if (privatekey.getBitcoinAddress() != inputBitcoinAddress) {
				throw 'Private key does not match bitcoin address';
			}
			
			var signature = privatekey.sign(hash);
			
			if (signature == null) {
				throw 'Error signing transaction hash';
			}
				
			var pubKey = privatekey.getPub();
			if (pubKey == null) {
				throw 'Private key pub key is null';
			}

			// Append hash type
			signature.push(parseInt(hashType));

			 var script = Bitcoin.Script.createInputScript(signature, pubKey);
			 
			 if (script == null) {
				throw 'Error creating input script';
			 }
			 
			sendTx.ins[i].script = script;
		}
		
		return sendTx;
}



function parseScript(script) {
		
	var newScript = new Bitcoin.Script();
	var components = script.split(" ");
	for (var i = 0; i < components.length; ++i) {
		
		if (Bitcoin.Opcode.map.hasOwnProperty(components[i])){
			newScript.writeOp(Bitcoin.Opcode.map[components[i]]);
		} else {
			newScript.writeBytes(Crypto.util.hexToBytes(components[i]));
		}
	}
	return newScript;
}

function internalDeleteAddress(addr) {
	for (var i = 0; i < addresses.length; ++i) {
		if (addresses[i] == addr) {
			addresses.splice(i, 1);
			private_keys.splice(i, 1);
			break;
		}
	}
}

function internalAddAddressBookEntry(addr, label) {

	if (address_book.length >= 200) {
		makeNotice('error', 'misc-error', 'We currently support a maximum of 200 address book entries, please remove some unsused ones.', 5000);
		return;
	}
	
	//Check for duplicates
	for (var ii=0;ii<address_book.length;++ii) {
		if (addr == address_book[ii].addr) {
			return;
		}
	}
	
	address_book.push({ addr: addr, label : label});
}

function internalAddKey(addr, priv) {
	
	if (addresses.length >= 200) {
		makeNotice('error', 'misc-error', 'We currently support a maximum of 200 private keys, please remove some unsused ones.', 5000);
		return;
	}
	
	//Check for duplicates
	for (var ii=0;ii<addresses.length;++ii) {
		
		if (addr == addresses[ii]) {
			return;
		}
	}
	
	addresses.push(addr);
	private_keys.push(priv);
}


function addAddressBookEntry() {
	var modal = $('#add-address-book-entry-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.find('.btn.primary').unbind().click(function() {
		
		
		//Really delete address
		var modal = $('#add-address-book-entry-modal');
		
		modal.modal('hide');
		
        var label = modal.find('input[name="label"]').val();
        
        var bitcoinAddress = modal.find('input[name="address"]').val();

        if (label.length == 0) {
			makeNotice('error', 'misc-error', 'you must enter a label for the address book entry', 5000);
			return false;
        }
        
        if (bitcoinAddress.length == 0) {
			makeNotice('error', 'misc-error', 'you must enter a bitcoin address for the address book entry', 5000);
			return false;
        }
        
        var addr;
        
		try {
			addr = new Bitcoin.Address(bitcoinAddress);
			
			if (addr == null)
				throw 'Null address';
			
		} catch (e) {
			makeNotice('error', 'misc-error', 'Bitcoin address invalid, please make sure you entered it correctly', 5000);
			return false;
		}
		
		 for (var i = 0; i < address_book.length; ++i) {			 
        	if (address_book[i].addr == bitcoinAddress) {
    			makeNotice('error', 'misc-error', 'Bitcoin address already exists', 5000);
    			return false;
        	}
         }
	        
		makeNotice('success', 'misc-success', 'Added Address book entry', 5000);

		backupWallet('update');
		
		internalAddAddressBookEntry(bitcoinAddress, label);
		
		buildAddressBook();
	});
	
	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}

function deleteAddress(addr) {
	var modal = $('#delete-address-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.find('#to-delete-address').html(addr);
	
	modal.find('.btn.primary').unbind().click(function() {
		//Really delete address
		$('#delete-address-modal').modal('hide');
		
		makeNotice('warning', 'warning-deleted', 'Address Removed From Wallet', 5000);
		
		internalDeleteAddress(addr);
		
		buildReceivingAddressList();
		
	    backupWallet('update');
	});

	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});

}

function setReviewTransactionContent(modal, tx) {
		
	$('#rtc-hash').html(Crypto.util.bytesToHex(tx.getHash()));
	$('#rtc-version').html(tx.version);
	$('#rtc-from').html('');
	$('#rtc-to').html('');
	
	var total = 0;
	var total_fees = 0;
	var wallet_effect = 0;
	var basic_str = 'send ';
	var all_txs_to_self = true;
	var amount = 0;
	
	for (var i = 0; i < tx.ins.length; ++i) {
		var input = tx.ins[i];
					
		var addr = new Bitcoin.Address(input.script.simpleInPubKeyHash());			
	
		total_fees += input.outpoint.value.intValue();
		
		$('#rtc-from').append(addr + ' <font color="green">' + input.outpoint.value.intValue() / satoshi + ' BTC <br />');
	}

	
	for (var i = 0; i < tx.outs.length; ++i) {
		var out = tx.outs[i];
			
		var array = out.value.slice();
		
		array.reverse();
	
		//Seems to have problems with intvalue()
		var val =  parseInt(new BigInteger(array).toString());

		var hash = out.script.simpleOutPubKeyHash();
		var address = new Bitcoin.Address(hash).toString();

		$('#rtc-to').append(address + ' <font color="green">' + val / satoshi + ' BTC </font><br />');
	
		total += val;
		
		total_fees -= val;
				
		var found = false;
		for (var ii=0;ii < addresses.length;++ii) {
			if (address == addresses[ii]) {
				found = true;
				break;
			}
		}
		
		if (!found) {
			
			if (address != our_address) {
				if (basic_str.length > 0) {
					basic_str += ' and ';
				}
					
				basic_str += '<b>' + val / satoshi  + ' BTC</b> to bitcoin address ' + address;
				
				all_txs_to_self = false;
			}
			
			wallet_effect -= val;
		} else {
			if (address != our_address) {
				amount += val;
			}
		}
	}
	
	if (all_txs_to_self == true) {
		basic_str = 'move <b>' + amount / satoshi + ' BTC</b> between your own bitcoin addresses';
	}
	
	$('#rtc-basic-summary').html(basic_str);
	
	$('#rtc-amount').html((wallet_effect - total_fees) / satoshi + ' BTC');
	
	$('#rtc-effect').html((wallet_effect - total_fees) / satoshi + ' BTC');

	$('#rtc-fees').html(total_fees / satoshi + ' BTC');

	$('#rtc-value').html(total / satoshi + ' BTC');
}

function createSendGotUnspent(toAddressesWithValue, fromAddress, fees, unspent, missingPrivateKeys) {
	var modal = $('#new-transaction-modal');

	try {	
		var tx = signTransaction(toAddressesWithValue, fromAddress, fees, unspent, missingPrivateKeys);
		
		if (tx != null) {
			
			modal.find('.modal-header h3').html('Transaction ready to be sent.');
	
			modal.find('#missing-private-key').hide();
			
			modal.find('#review-tx').show();
	
			setReviewTransactionContent(modal, tx);
			
			(function() {
				var ttx = tx;
				//We have the transaction ready to send, check if were online or offline
				
				var btn = modal.find('.btn.primary');

				setLoadingText('Checking Connectivity');

				$.get(root + 'ping').success(function(data) { 
					
					btn.attr('disabled', false);

					btn.text('Send Transaction');
										
					btn.unbind().click(function() {
						
						btn.attr('disabled', true);

						pushTx(ttx);
						
						modal.modal('hide');
					});
					
				}).error(function(data) {
					
					modal.find('.modal-header h3').html('Created Offline Transaction.');

					btn.attr('disabled', false);
					
					btn.text('Show Offline Instructions');

					btn.unbind().click(function() {
						
						btn.attr('disabled', true);

						modal.find('#missing-private-key').hide();
						modal.find('#review-tx').hide();
						modal.find('#offline-transaction').show();
						
						var s = ttx.serialize();

						var hex = Crypto.util.bytesToHex(s);
						
						modal.find('#offline-transaction textarea[name="data"]').val(hex);
					});
				});
		    })();
	
		} else if (missingPrivateKeys.length > 0) {
		
			 //find the first missing private key and prompt the user to enter it
			 var missing = null;
			 for (var i =0; i < missingPrivateKeys.length; ++i) {
				 if (missingPrivateKeys[i].priv == null) {
					 missing = missingPrivateKeys[i];
					 break;
				 }
			 }
			 
			 //If we haven't found a missing private key, but we have a null tx then we have a problem.
			 if (missing == null) {
				 makeNotice('error', 'misc-error', 'Unknown error signing transaction', 5000);
				 modal.modal('hide');
				 return;
			 }
			
			 var form = $('#missing-private-key');
			
			 form.find('input[name="key"]').val('');
			 
			 form.show();
			 
			 //Set the modal title
			 modal.find('.modal-header h3').html('Private Key Needed.');
			 form.find('.address').html(missing.addr);
				
			(function() {
				var tmissing = missing;
				
				 form.find('button[name="add"]').unbind().click(function() {
					if (!isInitialized)
						return;
					
					var value = form.find('input[name="key"]').val();
					var format = form.find('select[name="format"]').val();
				
					if (value.length == 0) {
						makeNotice('error', 'misc-error', 'You must enter a private key to import', 5000);
						modal.modal('hide');
						return;
					}
					
					try {
						var key = privateKeyStringToKey(value, format);
									
						if (tmissing.addr != key.getBitcoinAddress()) {
							makeNotice('error', 'misc-error', 'The private key you entered does not match the bitcoin address', 5000);
							modal.modal('hide');
							return;
						}
						
						tmissing.priv = key;
						
						//Now try again
						createSendGotUnspent(toAddressesWithValue, fromAddress, fees, unspent, missingPrivateKeys);
					} catch(e) {
						makeNotice('error', 'misc-error', 'Error import private key ' + e, 5000);
						modal.modal('hide');
						return;
					}
				});		
		    })();
	
		} else {
			throw 'Unknown signing error';
		}
	} catch (e) {
		makeNotice('error', 'misc-error', e, 5000);
		modal.modal('hide');
		return;
	}
}


//Adapted from bitcoin-js wallet.js Wallet.createSend
function newTxValidateFormAndGetUnspent() {
	
	var modal = null;
	
	try {
		var toAddressesWithValue = [];
		
		//Constuct the recepient address array
		$("#recipient-container").children().each(function() {
		        var child = $(this);
		       	        
		        var send_to_address = child.find('input[name="send-to-address"]');
		        
		        var value_input = child.find('input[name="send-value"]');
	
		        var value = 0;
		        var toAddress;
		        
		    	try {
	    			value = parseFloat(value_input.val()) * satoshi;
			        	    			
					if (value == null || value <= 0) 
						throw 'You must enter a value greater than zero';
				} catch (e) {
					throw 'Invalid send amount';
				};
				
		        if (send_to_address.val().length == 0) {
		    		throw 'You must enter a bitcoin address for each recipient';
		        }
		        
				try {
					toAddress = new Bitcoin.Address(send_to_address.val());
				} catch (e) {
					throw 'Invalid to address: ' + e;
				};
				
				toAddressesWithValue.push({address: toAddress, value : value});
		});
		
		if (toAddressesWithValue.length == 0) {
			throw 'A transaction must have at least one recipient';
		}
		
		//Get the from address, if any
		var fromAddress = null;
		if ($('#send-from-address').val() != 'Any Address') {
			
			var components = $('#send-from-address').val().split(' ', 1);
						
			try {
				fromAddress = new Bitcoin.Address(components[0]);
			} catch (e) {
				makeNotice('error', 'misc-error', 'Invalid from address: ' + e, 5000);
				return false;
			};
		} 
		
		var fees;
		try {
			 fees = parseFloat($('#send-fees').val() * satoshi);
			
			if (fees == null || fees < 0) 
				throw 'Fees cannot be negative';
			
		} catch (e) {
			makeNotice('error', 'misc-error', 'Invalid fee value', 5000);
			return false;
		};
	
		
		var fromAddresses = null;
		if (fromAddress == null) {
			fromAddresses = getMyHash160s();
		} else {
			fromAddresses = [];
			fromAddresses.push(Crypto.util.bytesToHex(fromAddress.hash));
		}	
		
		
		//Show the modal loading unspent dialog
		modal = $('#new-transaction-modal');

		modal.find('#offline-transaction').hide();
		modal.find('#missing-private-key').hide();
		modal.find('#review-tx').hide();
				
		modal.find('.modal-header h3').html('Creating transaction');
		
		modal.modal({
			  keyboard: true,
			  backdrop: "static",
			  show: true
		});
		
		//disable primary for now
		modal.find('.btn.primary').attr('disabled', true);
		
		modal.find('.btn.primary').text('Send Transaction');

		modal.find('.btn.secondary').unbind().click(function() {
			modal.modal('hide');
		});
		
		(function() {
				
			setLoadingText('Getting Unspent Outputs');

			$.post(root + 'unspent', {'address[]' : fromAddresses},  function(obj) {  
						
				try {
					var unspent = [];
							
					for (var i = 0; i < obj.unspent_outputs.length; ++i) {
										
						var script;
						try {
							 script = parseScript(obj.unspent_outputs[i].script);
						} catch(e) {
							makeNotice('error', 'misc-error', 'Error decoding script: ' + e);
							continue;
						}
									
						var out = {script : script,
							value : parseInt(obj.unspent_outputs[i].value),
							tx_output_n : obj.unspent_outputs[i].tx_output_n,
							tx_hash : obj.unspent_outputs[i].tx_hash
						};
						
						unspent.push(out);
					}
					
					modal.find('.modal-header h3').html('Signing Transaction');
							
					var missingPrivateKeys = [];
					
					createSendGotUnspent(toAddressesWithValue, fromAddress, fees, unspent, missingPrivateKeys);
					
				} catch (e) {
					makeNotice('error', 'misc-error', 'Error creating transaction: ' + e, 5000);
					$('#new-transaction-modal').modal('hide');
					return false;
				}
				
			}).error(function(data) {  
				$('#new-transaction-modal').modal('hide');
				makeNotice('error', 'misc-error', 'Error getting unspent outputs. Please check your internet connection.'); 
			});
		
	    })();
		
	} catch (e) {
		if (modal != null) modal.modal('hide');

		throw e;
	};
	
	return true;
};

function privateKeyStringToKey(value, format) {
	
	var key_bytes = null;
	
	if (format == 'base58') {
		key_bytes = Bitcoin.Base58.decode(value);
	} else if (format == 'base64') {
		key_bytes = Crypto.util.base64ToBytes(value);
	} else if (format == 'hex') {
		key_bytes = Crypto.util.hexToBytes(value);			
	} else if (format == 'mini') {
		key_bytes = parseMiniKey(value);			
	} else if (format == 'sipa') {
		var tbytes = Bitcoin.Base58.decode(value);
		tbytes.shift();
		key_bytes = tbytes.slice(0, tbytes.length - 4);
	} else {
		throw 'Unsupported key format';
	}	

	return new Bitcoin.ECKey(key_bytes);
}
	

$(document).ready(function() {	
    
    //Popovers! 
    $(function () {
     $("a[rel=popover]")
       .popover({
         offset: 10
       })
       .click(function(e) {
         e.preventDefault()
       })
   })
	
	$('body').ajaxStart(function() {
		$('.loading-indicator').fadeIn(200);
	});
	
	$('body').ajaxStop(function() {
		$('.loading-indicator').fadeOut(200);
	});
	
	$("#new-addr").click(function() {
		  generateNewAddressAndKey();
		  
		  backupWallet('update');
	});
	
    $('#update-email-btn').unbind().click(function() {    
		var email = $('#wallet-email').val();
				
		updateEmail(email);
    });
    
	$('#update-password-btn').unbind().click(function() {    			
		updatePassword();
    });
	
    $('#email-backup-btn').unbind().click(function() {    			
		emailBackup();
    });
	
    $('#update-alias-btn').unbind().click(function() {    
		var alias = $('#wallet-alias').val();
			
		updateAlias(alias);
    });
	
    $('#wallet-login').unbind().click(function() {    
    
        if (localStorage) {
           //Make sure the last guid the user logged in the ame as this one, if not clear cache
            var tguid = localStorage.getItem('guid');
            if (tguid != null) {
                window.location = root + 'wallet/' + tguid;
                return;
            }
        }

        window.location = root + 'wallet/' + 'login';
    });

	$("#restore-wallet-continue").click(function() {

		var tguid = $('#restore-guid').val();
        
        if (guid != tguid && tguid != null) {
            window.location = root + 'wallet/' + tguid;
            return;
        } 
				
		$(this).attr("disabled", true);

		if (restoreWallet()) {
			
			try {
				 //Check if we have any addresses to add
				var hash = decodeURI(window.location.hash.replace("#", ""));
	
				if (hash != null && hash.length > 0) {
				
					var didChangeWallet = false;
					var components = hash.split("|");
					for (var i = 0; i < components.length; i += 2) {
						var key = components[i];
						var value = components[i+1];
												
						if (key == 'newaddr') {
							var address = new Bitcoin.Address(value);
							
							if (address != null && address.toString() == value) {
								internalAddKey(value, null);
								didChangeWallet = true;
								makeNotice('success', 'added-addr', 'Added Bitcoin Address ' + value, 5000); 
							}
						}
					}
					
					window.location.hash = '';
					
					if (didChangeWallet) {
						backupWallet('update');
					}
				}
			} catch (e) {
				makeNotice('error', 'add-address-error', 'Error adding new address from page link', 5000); 
			}
			
			
			try {
				if (localStorage) {
                            
                    //Make sure the last guid the user logged in the ame as this one, if not clear cache
                    var local_guid = localStorage.getItem('guid');

                    if (local_guid != guid) {
                        localStorage.clear();
                    }
					
                    
					//Restore the balance cache
					var multiaddrjson = localStorage.getItem('multiaddr');
					
					if (multiaddrjson != null) {
						parseMultiAddressJSON(multiaddrjson);
								
						updateTransactionsSummary();
					}
					
					//Restor the cached latest block
					var latestblockjson = localStorage.getItem('latestblock');
	
					if (latestblockjson != null) {					
						parseLatestBlockJSON(latestblockjson);
					}
					
					localStorage.setItem('guid', guid);
				}
			} catch (e) {
				makeNotice('error', 'local-storeage-error', 'Error parsing local storage cache', 5000); 
			}
			

			//Build the My-Address list again
			buildReceivingAddressList();
			
			///Get the list of transactions from the http API
			queryAPIMultiAddress();
			
			//Get data on the latest block
			queryAPILatestBlock();

			makeNotice('success', 'misc-success', 'Sucessfully Decrypted Wallet', 5000); 
			
			changeView($("#receive-coins"));
			
			$(this).attr("disabled", true);
		} else {
			$(this).attr("disabled", false);
		}

	});

	$("#import-export-btn").click(function() {
		if (!isInitialized)
			return;
		
		$("#import-json-btn").unbind().click(function() {
			if (!isInitialized)
				return;
			
			$(this).attr("disabled", true);

			if (importJSON()) {
				
				changeView($("#receive-coins"));
				
				//Rebuild the My-address list
				buildReceivingAddressList();
				
				//Perform a wallet backup
				backupWallet('update');
				
				//Get the new list of transactions
				queryAPIMultiAddress();
				
				//Get data on the latest block
				queryAPILatestBlock();
			}
			
			$(this).attr("disabled", false);
		});
		
		
		$('#import-address-btn').unbind().click(function() {
			var value = $.trim($('#import-address-address').val());
			
			if (value.length = 0) {
				makeNotice('error', 'misc-error', 'You must enter an address to import', 5000);
				return;
			}
			
			try {
				var address = new Bitcoin.Address(value);
				
				if (address.toString() != value) {
					makeNotice('error', 'misc-error', 'Inconsistency between addresses', 5000);
					return;
				}
				
				internalAddKey(value, null);

				makeNotice('success', 'added-address', 'Sucessfully Added Address ' + address, 5000);
				
				//Rebuild the list
				buildReceivingAddressList();

				//Backup
				backupWallet('update');
				
				//Update the balance list
				queryAPIMultiAddress(); 

			} catch (e) {
				makeNotice('error', 'misc-error', 'Error importing address: ' + e, 5000);
				return;
			}
			
		});
		
		 var form = $('#import-private-key');
			
		 form.find('button[name="add"]').unbind().click(function() {
			if (!isInitialized)
				return;
			
			var value = form.find('input[name="key"]').val();
			var format = form.find('select[name="format"]').val();
		
			if (value.length == 0) {
				makeNotice('error', 'misc-error', 'You must enter a private key to import', 5000);
				return;
			}
			
			try {
				var key = privateKeyStringToKey(value, format);
						
				if (key == null)
					throw 'Decode returned null key';
				
				var addr = key.getBitcoinAddress().toString();
									
				internalAddKey(addr, Bitcoin.Base58.encode(key.priv));
				
				//Rebuild the My-address list
				buildReceivingAddressList();
				
				//Perform a wallet backup
				backupWallet('update');
				
				//Get the new list of transactions
				queryAPIMultiAddress();
				
				makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr, 5000);
				
			} catch(e) {
				console.log(e);
				makeNotice('error', 'misc-error', 'Error importing private key: ' + e, 5000);
				return;
			}
		});
		 
		changeView($("#import-export"));
	});


	$('#add-address-book-entry-btn').click(function() {
		addAddressBookEntry();
	});
	
	//Password strength meter
	$('#passwords').unbind().bind('change keypress keyup', function() {
				
	    var warnings = document.getElementById('password-warnings');
	    var result = document.getElementById('password-result');
	    var password = $(this).val();
	    
	        var cps = HSIMP.convertToNumber('250000000'),
	            time, i, checks;
	            
	        warnings.innerHTML = '';
	        if(password) {   
	            time = HSIMP.time(password, cps.numeric);
	            time = HSIMP.timeInPeriods(time);
	            
	           	$('#password-result').fadeIn(200);
	
	            if (time.period === 'seconds') {
	                if (time.time < 0.000001) {
	                    result.innerHTML = 'Your password would be hacked <span>Instantly</span>';
	                } else if (time.time < 1) {
	                    result.innerHTML = 'It would take a desktop PC <span>' + time.time+' '+time.period+ '</span> to hack your password';
	                } else {
	                    result.innerHTML = 'It would take a desktop PC <span>About ' + time.time+' '+time.period+ '</span> to hack your password';
	                }
	            } else {
	            
	                result.innerHTML = 'It would take a desktop PC <span>About ' + time.time+' '+time.period+ '</span> to hack your password';
	            }
	            
	            checks = HSIMP.check(password);
	            HSIMP.formatChecks(checks.results, warnings);
	            
	            if (checks.insecure) {
	                result.innerHTML = '';
	               	$('#password-result').fadeOut(200);
	            }
	            
	        } else {
	            result.innerHTML = '';
	           	$('#password-result').fadeOut(200);
	        }
	});
	
	$('#wallet-alias').unbind().bind('change keyup', function() {
		$(this).val($(this).val().replace(/[\.,\/ #!$%\^&\*;:{}=`~()]/g,""));
	
		if ($(this).val().length > 0) {
			$('.alias').fadeIn(200);
	
			$('.alias span').text($(this).val());
		}
	});
	
    $("#my-account-btn").click(function() {
		if (!isInitialized)
			return;
		
		changeView($("#my-account"));
	});

    $("#home-intro-btn").click(function() {
		if (!isInitialized)
			return;
		
		changeView($("#home-intro"));
	});


	$("#my-transactions-btn").click(function() {
		if (!isInitialized)
			return;
		
		changeView($("#my-transactions"));
	});


	$("#send-coins-btn").click(function() {
		if (!isInitialized)
			return;
		
		//Easie to rebuild each time the view appears
		buildFromAddressOptionList();
		
		buildAddressBook();
		
		changeView($("#send-coins"));
	});
	
	$('#edit-addresses-checkbox').change(function() {		  		
		  if ($(this).is(":checked"))
			  $('.address-delete-btn').show();
		  else
			  $('.address-delete-btn').hide();

	});

	
	$('#send-form-reset-btn').click(function() {
		
		$('input[name="send-to-address"]').val('');
		        
		$('input[name="send-value"]').val('');
		        
		var el = $("#recipient-container div:first-child").clone();
		
		$('#recipient-container').empty();
		
		$('#recipient-container').append(el);
		
		$("#send-from-address").val($("#send-from-addres option:first").val());
	
		$("#send-fees").val('0');
	});
	
	$("#send-tx-btn").click(function() {
		if (!isInitialized)
			return;
		
		try {
			if (!newTxValidateFormAndGetUnspent()) {
				throw 'Unknown Error creating Transaction';
			}
		} catch (e) {
			makeNotice('error', 'misc-error', e, 5000);
		}
	});
	
	$('#add-recipient').click(function() {
		if (!isInitialized)
			return;
				
		var el = $("#recipient-container div:first-child").clone()
		
		el.appendTo($("#recipient-container"));
		
		el.find('input[name="send-to-address"]').val('');
		
		el.find('input[name="send-value"]').val('');
	});
	
	$("#receive-coins-btn").click(function() {
		if (!isInitialized)
			return;
		
		changeView($("#receive-coins"));
	});
	
	$('.tabs').tabs();
	
	$('.tabs').bind('change', function (e) {
		 // e.target // activated tab
		  //e.relatedTarget // previous tab
		  
		  var el = $(e.target);
		 
		 if (el.text() == 'Export Unencrypted') {
			  	var data = makeWalletJSON();
				
				$("#json-unencrypted-export").val(data);
				
				Downloadify.create('download_unencrypted',{
					  filename: function(){
					    return 'wallet.json';
					  },
					  data: function(){ 
					    return $("#json-unencrypted-export").val();
					  },
					  onComplete: function(){ 
						makeNotice('success', 'misc-success', 'Wallet successfully downloaded', 5000);
					  },
					  onCancel: function(){ 
						makeNotice('error', 'misc-error', 'Wallet download cancelled', 2000);
					  },
					  onError: function(){ 
						makeNotice('error', 'misc-error', 'Error downloading wallet file', 2000);
					  },
					  transparent: false,
					  swf: resource + 'downloadify.swf',
					  downloadImage: resource + 'downloadify_button.png',
					  width: 95,
					  height: 32,
					  transparent: true,
					  append: false
				});
		  } else if (el.text() == 'Export') {
			  
				var data = makeWalletJSON();

				var crypted = Crypto.AES.encrypt(data, password);
				
				$("#json-crypted-export").val(crypted);
				
				Downloadify.create('download_crypted',{
					  filename: function(){
					    return 'wallet.json.aes';
					  },
					  data: function(){ 
					    return $("#json-crypted-export").val();
					  },
					  onComplete: function(){ 
						makeNotice('success', 'misc-success', 'Wallet successfully downloaded', 5000);
					  },
					  onCancel: function(){ 
						makeNotice('error', 'misc-error', 'Wallet download cancelled', 2000);
					  },
					  onError: function(){ 
						makeNotice('error', 'misc-error', 'Error downloading wallet file', 2000);
					  },
					  transparent: false,
					  swf: resource + 'downloadify.swf',
					  downloadImage: resource + 'downloadify_button.png',
					  width: 95,
					  height: 32,
					  transparent: true,
					  append: false
				});
		  } else if (el.text() == 'Export PDF') {
			 
			  Downloadify.create('download_pdf',{
				  filename: function(){
				    return 'wallet.pdf';
				  },
				  data: function(){ 				    
				    var doc = new jsPDF();
				    
				    doc.setFontSize(22);
					doc.text(20, 10, 'Bitcoin Paper Wallet');
					
				    doc.setFontSize(10);

					doc.text(20, 20, 'http://www.blockchain.info/wallet/' + guid);

				    doc.setFontSize(12);
				    				    
					var y = 40;
					for (var i = 0; i < addresses.length; ++i) {
						
						if (y >= 250) {
							y = 20;
							doc.addPage();
						}

						var balance = 0;
						
						if (balances[addresses[i]] != null)
							balance = balances[addresses[i]] / satoshi;
						
						doc.text(20, y, 'Address ' +addresses[i] + '	Balance ' + balance + ' BTC');
						doc.text(20, y+5, 'Private Key (Base58) ' + private_keys[i]);

						y += 15;
				  	}
				  
					return doc.output();
				  },
				  onComplete: function(){ 
					makeNotice('success', 'misc-success', 'Wallet successfully downloaded', 5000);
				  },
				  onCancel: function(){ 
					makeNotice('error', 'misc-error', 'Wallet download cancelled', 2000);
				  },
				  onError: function(){ 
					makeNotice('error', 'misc-error', 'Error downloading wallet file', 2000);
				  },
				  transparent: false,
				  swf: resource + 'downloadify.swf',
				  downloadImage: resource + 'downloadify_button.png',
				  width: 95,
				  height: 32,
				  transparent: true,
				  append: false
			});
		  }
	});
		
	if (initial_error != null) {
		makeNotice('error', 'fatal_error', initial_error);
	}
	
	if (guid == null) {
		cVisible = $("#getting-started");
    } else {
    
        if (guid.length == 0) {
            if (localStorage) {
               //Make sure the last guid the user logged in the ame as this one, if not clear cache
               var tguid = localStorage.getItem('guid');
            
               if (guid != tguid && tguid != null) {
                window.location = root + 'wallet/' + tguid;
                return;
               }
            }
        }
        
        cVisible = $("#restore-wallet");
	}
	
	cVisible.show();
});


function parseMiniKey(miniKey) {
  var check = Crypto.SHA256(miniKey + '?');
  
  switch(check.slice(0,2)) {
    case '00':
      var decodedKey = Crypto.SHA256(miniKey); 
      return decodedKey;
      break;
    case '01':
      var x          = Crypto.util.hexToBytes(check.slice(2,4))[0];
      var count      = Math.round(Math.pow(2, (x / 4)));
      var decodedKey = Crypto.PBKDF2(miniKey, 'Satoshi Nakamoto', 32, { iterations: count });
      return decodedKey;
      break;
    default:
      console.log('invalid key');
   	 break;
  }    
};

function guidGenerator() {
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

function buildReceivingAddressList() {
	var tbody = $('#my-addresses tbody');
	
	tbody.empty();
	
	var img = $('<img class="address-delete-btn" src="'+resource+'delete.png" />')

	if (!$('#edit-addresses-checkbox').is(":checked")) {
		img.hide();
	}
		  
	for (var i = 0; i < addresses.length; ++i) {
		
		var addr = addresses[i];
		
		var balance = balances[addr];
		
		if (balance != null && balance > 0)
			balance = balance / satoshi + ' BTC';
		else
			balance = '0 BTC';
		
		var noPrivateKey = '';
		if (private_keys[i] == null)
			noPrivateKey = ' <font color="red">(No Private Key)</font>'
		
		tbody.append('<tr><td>' + addr + noPrivateKey+'</td><td><span id="'+addr+'" style="color:green">' + balance +'</span></td><td></td></tr>');

		var timg = img.clone();
		
		tbody.find('tr:last-child td:last-child').append(timg);

		(function() {
			var taddr = addr;

			timg.click(function() {	
				deleteAddress(taddr);
			});
	    })();
	}
}

function generateNewAddressAndKey() {

	try {
		var key = new Bitcoin.ECKey(false);
		
		if (key == null ) {
			makeNotice('error', 'misc-error', 'Unable to generate a new bitcoin address.');
			return false;
		}
			
		var addr = key.getBitcoinAddress();
	
		if (addr == null ) {
			makeNotice('error', 'misc-error', 'Generated invalid bitcoin address.');
			return false;
		}

		internalAddKey(addr, Bitcoin.Base58.encode(key.priv));
		
		buildReceivingAddressList();
		
		makeNotice('info', 'new-address', 'Generated new bitcoin address ' + addr, 5000);
		
		//Subscribe to tranaction updates through websockets
		try {
			ws.send('{"op":"addr_sub", "hash":"'+Crypto.util.bytesToHex(key.getPubKeyHash())+'"}');
		} catch (e) { 
			
		}
		
	} catch (e) {
		makeNotice('error', 'misc-error', 'Unable to generate a new bitcoin address.');
		return false;
	}
		
	return true;
}
