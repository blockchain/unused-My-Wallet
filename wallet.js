var encrypted_wallet_data = null;
var guid = null;
var cVisible; //currently visible view
var password; //Password
var dpassword = null; //double encryption Password
var dpasswordhash; //double encryption Password
var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't overwrite a wallet backup even if you have the guid
var final_balance = 0; //Final Satoshi wallet balance
var total_sent = 0; //Total Satoshi sent
var total_received = 0; //Total Satoshi received
var n_tx = 0; //Number of transactions
var n_tx_filtered = 0; //Number of transactions after filtering
var isInitialized = false; //Wallet is loaded and decrypted
var latest_block = null; //Chain head block
var address_book = []; //Holds the address book {addr : label}
var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
var double_encryption = false; //If wallet has a second password
var tx_page = 0; //Multi-address page
var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)

//Refactoring
//var balances = []; //Holds balances of addresses
//var addresses = []; //Bitcoin addresses
//var private_keys = []; //Map of bitcoin address to base58 private key
//var address_tags = []; //Map of address to an option tag (0 == OK 1 == Unsynced, 2 == Archived, 3 == No Private Key)

var addresses = []; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
var loading_text = ''; //Loading text for ajax activity 
var sound_on = true; //Play a bleep sound when tx received
var offline = false;
var unspent_cache = null;

// Flash fall back for webscoket compatiability
WEB_SOCKET_SWF_LOCATION = "/Resources/WebSocketMain.swf";

jQuery.fn.center = function () {
    this.css("top", ( $(window).height() - this.height() ) / 2+$(window).scrollTop() + "px");
    this.css("left", ( $(window).width() - this.width() ) / 2+$(window).scrollLeft() + "px");
    return this;
};

$(window).resize(function() {
	$('.modal:visible').center();
});


//Async load a script, at the moment this is only jquery.qrcode.js
function loadScript(src, callback) {
	
	if (document.getElementById(src) != null) {
		callback();
		return;
	}
	
     var s = document.createElement('script');
     s.type = "text/javascript";
     s.async = true;
     s.src = src;
     s.id = src;
     s.addEventListener('load', function (e) { callback(); }, false);
     var head = document.getElementsByTagName('head')[0];
     head.appendChild(s);
}

function setLoadingText(txt) {
	$('.loading-text').text(txt);
}

function hideNotice(id) {
	$('#'+id).remove();
}

setInterval ( "doStuffTimer()", 10000 );

//Updates time last block was received and check for websocket connectivity
function doStuffTimer () {
	try {
	
		if (WebSocket != null) {
		  if (!offline && isInitialized && ws.readyState != WebSocket.OPEN)
			  websocketConnect();
		}
	  
	  updateLatestBlockAge();
	} catch (e) {}
} 

function websocketConnect() {
	if (!window.WebSocket) {
		 loadScript(resource + 'wallet/swfobject.js', function() { 
			  loadScript(resource + 'wallet/web_socket.js', function() { 
				  	WebSocket.__initialize();
				  	_websocketConnect();
			  });
		 });
	} else {
	  	_websocketConnect();
	}
}
	
function _websocketConnect() {
	
	if (offline) return;
	
	try {
	
		ws = new WebSocket("ws://api.blockchain.info:8335/inv");
		
		ws.onmessage = function(e) {
							
			try {
		
				var obj = jQuery.parseJSON(e.data);
		
				if (obj.op == 'status') {
				
					$('#status').html(obj.msg);
				
				} else if (obj.op == 'utx') {
					
					//Check for duplicates
					var l = transactions.length;
					while (--l) {					
						if (transactions[l].txIndex == obj.x.tx_index)
							return;
					}
		            
		            try {
		                if (sound_on) {
							try {								
			            		document.getElementById("beep").play(10);
			            	} catch (e) {
			            		sound_on = false;
			            	}
		                }
		            } catch (e) {
		                console.log(e);
		            }
					
					var tx = TransactionFromJSON(obj.x);
										
					//Check if this is a duplicate
					//Maybe should have a map_prev to check for possible double spends
					for (var i = 0; i < transactions.length; ++i) {
						if (transactions[i].txIndex == tx.txIndex)
							return;
					}
					
					/* Calculate the result */
					var result = 0;
						
					for (var i = 0; i < tx.inputs.length; i++) {
						var input = tx.inputs[i];
						 			
						//If it is our address then subtract the value
						var address = addresses[input.prev_out.addr];
						if (address != null) {
							var value = parseInt(input.prev_out.value);
							result -= value;
							address.balance -= value;
							total_sent += value;
						}
					}
					

					for (var i = 0; i < tx.out.length; i++) {
						var output = tx.out[i];
												
						var address = addresses[output.addr];
						if (address != null) {
							var value = parseInt(output.value);
							result += value;
							address.balance += value;
							total_received += value;
						}
					}
					
					tx.result = result;
					
					final_balance += result;
	
					n_tx++;
					
					transactions.unshift(tx);
	
					tx.setConfirmations(0);

					//Meed to update transactions list
					buildTransactionsView();
					
					//Also Need to update balance on Received coins view
					buildReceiveCoinsView();
	
				}  else if (obj.op == 'block') {
					if (sound_on) {
						try {
		            		document.getElementById("beep").play(4);
		            	} catch (e) {
		            		sound_on = false;
		            	}	
					}
					
					//Check any transactions included in this block, if the match one our ours then set the block index
					for (var i = 0; i < obj.x.txIndexes.length; ++i) {
						for (var ii = 0; ii < transactions.length; ++ii) {
							if (transactions[ii].txIndex == obj.x.txIndexes[i]) {
								if (transactions[ii].blockHeight == null || transactions[ii].blockHeight == 0) {
									transactions[ii].blockHeight = obj.x.height;
									break;
								}
							}
						}
					}
					
					setLatestBlock(BlockFromJSON(obj.x));
					
					//Need to update latest block
					buildTransactionsView();
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
				var addrs = getActiveAddresses();
				for (var i = 0; i < addrs.length; ++i) {											
					//Subscribe to tranactions updates through websockets
					msg += '{"op":"addr_sub", "addr":"'+ addrs[i] +'"}';
				}
			} catch (e) {
				alert(e);
			}
			
			ws.send(msg);
		};
	
		ws.onclose = function() {
			$('#status').html('DISCONNECTED.');
		};
	} catch (e) {
		console.log('Exception ' + e);
	}
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

function noConvert(x) { return x; }
function base58ToBase58(x) { return decryptPK(x); }
function base58ToBase64(x) { var bytes = decodePK(x); return Crypto.util.bytesToBase64(bytes); }
function base58ToHex(x) { var bytes = decodePK(x); return Crypto.util.bytesToHex(bytes); }
function base58ToSipa(x) { 
	var bytes = decodePK(x); // zero pad if private key is less than 32 bytes (thanks Casascius)
	
	while (bytes.length < 32) bytes.unshift(0x00);
	
	bytes.unshift(0x80); // prepend 0x80 byte
	var checksum = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });
	bytes = bytes.concat(checksum.slice(0, 4));
	
	var privWif = Bitcoin.Base58.encode(bytes);
	
	return privWif; 
}



function makeWalletJSON(format) {
	
	var encode_func = noConvert;
	
	if (format == 'base64') 
		encode_func = base58ToBase64;
	else if (format == 'hex') 
		encode_func = base58ToHex;
	else if (format == 'sipa') 
		encode_func = base58ToSipa;
	else if (format == 'base58') 
		encode_func = base58ToBase58;
	
	var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';
	
	if (double_encryption && dpasswordhash != null && encode_func == noConvert) {
		out += '	"double_encryption" : '+double_encryption+',\n	"dpasswordhash" : "'+dpasswordhash+'",\n';
	}
	
	out += '	"keys" : [\n';
	
	var atLeastOne = false;
	for (var key in addresses) {		
		var addr = addresses[key];
		
		out += '	{"addr" : "'+ addr.addr +'"';
		
		if (addr.priv != null) {
			out += ',\n	 "priv" : "'+ encode_func(addr.priv) + '"';
		}
		
		if (addr.tag == 2) {
			out += ',\n	 "tag" : '+ addr.tag;
		} 
		
		if (addr.label != null) {
			out += ',\n	 "label" : "'+ addr.label + '"';
		} 
		
		out += '},\n';
		
		atLeastOne = true;
	}
	
	if (atLeastOne) {
		out = out.substring(0, out.length-2);
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
	
	out += '\n}';
	
	//Write the address book

	return out;
}

//Why does javascript not have copy to clipboard?
function pasteAddress(addr) {
	//Constuct the recepient address array
	$('#recipient-container').find('input[name="send-to-address"]').last().val(addr);
}
	
function deleteAddressBook(addr) {
	for (var i = 0; i < address_book.length; ++i) {
		var taddr =  address_book[i].addr;
		if (taddr == addr) {
			address_book.splice(i,1);
			
			backupWallet();
			
			buildSendTxView();
			break;
		}
	}
}

function buildSendTxView() {
	
	//Only build when visible
	if ("send-coins" != cVisible.attr('id'))
		return;
	
	var el = $('#address-book-tbl tbody');

	el.empty();
	
	for (var i = 0; i < address_book.length; ++i) {
		var addr =  address_book[i].addr;
		el.append('<tr><td>'+ address_book[i].label + '</td><td><div class="addr-book-entry">'+ addr + '</div></td><td style="width:16px"><img src="'+resource+'delete.png" onclick="deleteAddressBook(\''+addr+'\')" /></td><td><img src="' + resource+ 'paste.png" onclick="pasteAddress(\''+ address_book[i].addr + '\')"></tr>');
	}
	
	var send_tx_form = $('#send-tx-form');
	
	var selects = send_tx_form.find('select');
	
	selects.empty();

	for (var key in addresses) {
		var addr = addresses[key];
			
		//Don't include archived addresses
		if (addr.tag == 2)
			continue;
				
		var label = addr.label;
		
		if (label == null)
			label = addr.addr;
		
		if (addr.balance > 0) {
			//On the sent transactions page add the address to the from address options
			selects.prepend('<option value="'+addr.addr+'">' + label + ' - ' + formatBTC(addr.balance) + ' BTC </option>');
		} else {
			selects.append('<option value="'+addr.addr+'">' + label + '</option>');
		}
	}
	
	$('#change-addr').prepend('<option value="new">New Address</option>');

	selects.prepend('<option value="any">Any Address</option>');
		
	selects.val($("#target option:first").val());
	
	send_tx_form.find('input[name="send-to-address"]').val('');
	send_tx_form.find('input[name="send-value"]').val('');
	send_tx_form.find('input[name="send-fees"]').val('0');

	var el = $("#recipient-container div:first-child").clone();
	$('#recipient-container').empty().append(el);
	
	
	//Escrow
	
	var el = $("#escrow-recipient-container div:first-child").clone();
	$('#escrow-recipient-container').empty().append(el);
}

function importPyWalletJSONObject(obj) {
	var i = 0;
	try {
		for (i = 0; i < obj.keys.length; ++i) {
			
			if (walletIsFull())
				return;
			
			var key = new Bitcoin.ECKey(Crypto.util.hexToBytes(obj.keys[i].hexsec));
						
			//Check the the private keys matches the bitcoin address
			if (obj.keys[i].addr ==  key.getBitcoinAddress().toString()) {				
				internalAddKey(obj.keys[i].addr, encodePK(obj.keys[i].priv));
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

function parseMultiBit(str) {
	//Any better way to auto detect?
	//Multibit Wallets start with a comment #
	try {
	
		var addedOne = false;
		var lines = str.split('\n');
		
		for (var i = 0; i < lines.length; ++i) {
			var line = lines[i];
			
			if (line == null || line.length == 0 | line.charAt(0) == '#')
				continue;
			
			var components = line.split(' ');
			
			var sipa = components[0];
			
			if (sipa == null)
				continue;
			
			if (walletIsFull())
				continue;
			
			var key = privateKeyStringToKey(sipa, 'sipa');
							
			internalAddKey(key.getBitcoinAddress().toString(), encodePK(key.priv));

			addedOne = true;
		}
		
		if (addedOne)
			return true;
		
	} catch (e) {
		return false;
	} 	
}

function importJSON() {
	
	var json = $('#import-json').val();
	
	if (json == null || json.length == 0) {
		throw 'No import data provided!';
	}

	//Any better way to auto detect?
	//Multibit Wallets start with a comment #
	if (json.charAt(0) == '#') {
		if (parseMultiBit(json))
			return true;
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
		throw 'Could not decode import data';
	}
	
	if (obj == null || obj.keys == null || obj.keys.length == 0) {
		throw 'No keys imported. Incorrect format?';
	}
	
	//Pywallet contains hexsec
	if (obj.keys[0].hexsec != null) {
		importPyWalletJSONObject(obj);
	} else {
	
		if (!getSecondPassword())
			return false;
				
		if (obj.double_encryption && obj.dpasswordhash != dpasswordhash) {
			throw 'Wallet backup does not have the same second password';
		}
		
		//Parse the normal wallet backup
		for (var i = 0; i < obj.keys.length; ++i) {	
			var addr = obj.keys[i].addr;
			
			if (addr == null || addr.length == 0 || addr == 'undefined')
				continue;
			
			if (double_encryption && !obj.double_encryption)
				internalAddKey(addr, encodePK(Bitcoin.Base58.decode(obj.keys[i].priv)));
			else
				internalAddKey(addr, obj.keys[i].priv);
			
			var addr = addresses[addr];
			addr.label = obj.keys[i].label;
			addr.tag = obj.keys[i].tag;
		}
				
		if (obj.address_book != null) {
			for (var i = 0; i < obj.address_book.length; ++i) {	
				internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
			}
		}
	} 

	//Clear the old value
	$('#import-json').val('');
	
	return true;
}


function getActiveAddresses() {
	var array = [];
	for (var key in addresses) {
		var addr = addresses[key];
		//Don't include archived addresses
		if (addr.tag == 2)
			continue;
		
		array.push(addr.addr);
	}
	return array;
}

function updateLatestBlockAge() {
	
	if (latest_block != null) {
		var age = new Date().getTime() -  new Date(latest_block.time * 1000).getTime();

		var min = Math.round(age / 1000 / 60);
		
		if (min <= 1)
			$('#latest-block-age').html('just now');
		else
			$('#latest-block-age').html(min + ' minutes ago');
	}
}

function setLatestBlock(block) {
	
	$('#latest-block').show();
	
	$('#latest-block-height').html(block.height);
	
	var date = new Date(block.time * 1000);
		
	$('#latest-block-time').html(dateToString(date));
	
	latest_block = block;
	
	updateLatestBlockAge();
}

function buildTransactionsView() {

	//Build the large summary
	//UpdateThe summary
	$('#transactions-summary').show();
	
	if (final_balance == null) {
		$('#balance').html('Loading...');
	} else {
		$('#balance').html(formatMoney(final_balance, true));
	}
	
	//Only build the actualy tx view when visible
	if ("my-transactions" != cVisible.attr('id'))
		return;

	$('#summary-n-tx').html(n_tx);

	$('#summary-received').html(formatMoney(total_received, true));

	$('#summary-sent').html(formatMoney(total_sent, true));

	$('#summary-balance').html(formatMoney(final_balance, true));

	
	if (transactions.length == 0)
		return;
	
	var interval = null;
	var start = 0;

	if (interval != null) {
		clearInterval(interval);
		interval = null;
	}
	
	var trans = $('#transactions').empty();

	var buildSome = function() {		
		var html = '';

		for (var i = start; i < transactions.length && i < (start+5); ++i) {
						
			var tx = transactions[i];
			
			if (tx.blockHeight != null && tx.blockHeight > 0) {
				var confirmations = latest_block.height - tx.blockHeight + 1;
				if (confirmations <= 100) {
					tx.setConfirmations(latest_block.height - tx.blockHeight + 1);
				}
			} else {
				tx.setConfirmations(0);
			}
		
			html += tx.getHTML(addresses);
		}
		

		trans.append(html);
		
		start += 5;
		
		if (start < transactions.length) {
			interval = setTimeout(buildSome, 1);
		}
	};
	
	buildSome();
	    	
	var container = $('.pagination ul').empty();
	
	if (tx_page == 0 && transactions.length < 50) {
		container.hide();
		return;
	} else {
		container.show();
	}
	
	var pages = Math.ceil(n_tx_filtered / 50);
	
	var disabled = ' disabled';
	if (tx_page > 0)
		disabled = '';
	
	container.append('<li onclick="setPage(tx_page+1)" class="prev'+disabled+'"><a>&larr; Previous</a></li>');
	
	for (var i = 0; i < pages && i <= 15; ++i) {
		var active = '';
		if (tx_page == i)
			active = ' class="active"';
		
		container.append('<li onclick="setPage('+i+')"'+active+'><a class="can-hide">'+i+'</a></li>');
	}

	var disabled = ' disabled';
	if (tx_page < pages)
		disabled = '';
	
	container.append('<li onclick="setPage(tx_page+1)" class="next'+disabled+'"><a>Next &rarr;</a></li>');
}

function setFilter(i) {
	tx_page = 0;
	tx_filter = i;
	
	queryAPIMultiAddress();
}

function setPage(i) {
	tx_page = i;
	
	scroll(0,0);
	queryAPIMultiAddress();
}

function parseMultiAddressJSON(json) {
	var obj = jQuery.parseJSON(json);
	
	$('#nodes-connected').html(obj.info.nconnected);
	
	setLatestBlock(obj.info.latest_block);
	
	transactions = [];

	if (obj.wallet == null) {
		total_received = 0;
		total_sent = 0;
		final_balance = 0;
		n_tx = 0;
		n_tx_filtered = 0;
		return;
	}
	
	total_received = obj.wallet.total_received;
	total_sent = obj.wallet.total_sent;
	final_balance = obj.wallet.final_balance;
	n_tx = obj.wallet.n_tx;
	n_tx_filtered = obj.wallet.n_tx_filtered;
	
	for (var i = 0; i < obj.addresses.length; ++i) {	
		addresses[obj.addresses[i].address].balance = obj.addresses[i].final_balance;
	}	
	
	for (var i = 0; i < obj.txs.length; ++i) {
		var tx = TransactionFromJSON(obj.txs[i]);
		transactions.push(tx);
	}
}

//Get the list of transactions from the http API, after that it will update through websocket
function queryAPIMultiAddress() {
	if (offline) return;

	var addrs = getActiveAddresses();
	
	setLoadingText('Loading transactions');

	$.ajax({
		  type: "POST",
		  url: root +'multiaddr?filter='+tx_filter+'&offset='+tx_page*50,
		  data: {'addr[]' : addrs},
		  converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": jQuery.parseXML},
		  success: function(data) {  
		
			try {
				parseMultiAddressJSON(data);
				
				//Rebuild the my-addresses list with the new updated balances (Only if visible)
				buildReceiveCoinsView();
				 				
				//Refresh transactions (Only if visible)
				buildTransactionsView();

				//Cache results to show next login
				if (tx_page == 0 && tx_filter == 0)
					localStorage.setItem('multiaddr', data);
			} catch (e) {
				console.log(data);

				console.log(e);
			}
			
		},
			
		error : function(data) {	
			
			console.log(data);
			
			makeNotice('error', 'misc-error', 'Error getting wallet balance from server', 5000);
		},
	});
}

function didDecryptWallet() {

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
						
						if (walletIsFull())
							return;
						
						if (internalAddKey(value, null)) {
							didChangeWallet = true;
							makeNotice('success', 'added-addr', 'Added Bitcoin Address ' + value, 5000); 
						} else {
							makeNotice('error', 'error-addr', 'Error Adding Bitcoin Address ' + value, 5000); 
						}
					}
				}
			}
			
			window.location.hash = '';
			
			if (didChangeWallet) {
				backupWallet();
			}
		}
	} catch (e) {
		makeNotice('error', 'add-address-error', 'Error adding new address from page link', 5000); 
	}
	
	try {
        //Make sure the last guid the user logged in the ame as this one, if not clear cache
        var local_guid = localStorage.getItem('guid');

        if (local_guid != guid) {
            localStorage.clear();
        }
        
		//Restore the balance cache
		var multiaddrjson = localStorage.getItem('multiaddr');
		
		if (multiaddrjson != null) {
			parseMultiAddressJSON(multiaddrjson);
					
			buildTransactionsView();
		}

		localStorage.setItem('guid', guid);
	} catch (e) { } //Don't care - cache is optional
	
	///Get the list of transactions from the http API
	queryAPIMultiAddress();
	
	changeView($("#home-intro"));
	
	makeNotice('success', 'misc-success', 'Sucessfully Decrypted Wallet', 5000); 
}

function internalRestoreWallet() {
	try {
		var decrypted = Crypto.AES.decrypt(encrypted_wallet_data, password);
		
		if (decrypted.length == 0) {
			makeNotice('error', 'misc-error', 'Error Decrypting Wallet', 5000);	
			return false;
		}
		
		var obj = jQuery.parseJSON(decrypted);

		if (obj.double_encryption != null && obj.dpasswordhash != null) {
			double_encryption = obj.double_encryption;
			dpasswordhash = obj.dpasswordhash;
				
			if (double_encryption)
				$('#wallet-double-encryption-enabled').prop("checked", true);
		}
		
		for (var i = 0; i < obj.keys.length; ++i) {		
			
			var addr = obj.keys[i].addr;
			if (addr == null || addr.length == 0 || addr == 'undefined') {
				makeNotice('error', 'null-error', 'Your wallet contains an undefined address. This is a sign of possible curruption, please double check all your BTC is acounted for. Backup your wallet to remove this error.', 15000);	
				continue;
			}
			
			internalAddKey(addr, obj.keys[i].priv);
			
			var addr = addresses[addr];			
			addr.tag = obj.keys[i].tag;
			addr.label = obj.keys[i].label;
		}
		
		if (obj.address_book != null) {
			for (var i = 0; i < obj.address_book.length; ++i) {	
				internalAddAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
			}
		}
		
		sharedKey = obj.sharedKey;

		setIsIntialized();
		
		return true;
		
	} catch (e) {
		
		console.log(e);
		
		makeNotice('error', 'misc-error', 'Error decrypting wallet. Please check you entered your password correctly.', 5000);
	}

	return false;
}


function getReadyForOffline() {
	var modal = $('#offline-mode-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();
		
	modal.find('.btn.primary').attr('disabled', true);

	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
	
	modal.find('.notices').append($('#notices'));
	
	modal.bind('hidden', function () {
		$('#main-notices-container').append($('#notices'));
		$("#restore-wallet-continue").removeAttr('disabled');
	});
			
	modal.find('.ready').hide();
	
	modal.find('.loading-indicator').show();

	//Preload some images
	new Image().src = resource + 'qrcode.png';
	new Image().src = resource + 'paste.png';
	new Image().src = resource + 'delete.png';
	new Image().src = resource + 'arrow_right_green.png';
	new Image().src = resource + 'arrow_right_red.png';

	var all_scripts_done = false;
	
	setLoadingText('Loading QR Code generator');
	
	 loadScript(resource + 'wallet/jquery.qrcode.min.js', function() { 
	  loadScript(resource + 'wallet/llqrcode.js', function() { 
		  loadScript(resource + 'wallet/qr.code.reader.js', function() { 

			//Prepload the flash Object	
			initQRFlash('qr-code-reader', resource + 'wallet/');

				loadScript(resource + 'wallet/swfobject.js', function() { 
				});
		  	});
	  	});  
	});

	///Get the list of transactions from the http API
	queryAPIMultiAddress();
	
	
	//Get unspent outputs
	$.post(root + 'unspent', {'addr[]' : getActiveAddresses()},  function(obj) {  
		unspent_cache = obj;
	}).error(function(data) {  
		makeNotice('error', 'misc-error', 'Error getting unspent outputs. Maybe you disconnected your internet too early?'); 
		modal.modal('hide');
	});	
	
	var isDone = function () {
		
		if (!all_scripts_done || $.active) {
			setTimeout(isDone, 200);
			return;
		}
	
		modal.find('.ready').show();
		
		modal.find('.btn.primary').removeAttr('disabled');

		modal.find('.btn.primary').unbind().click(function() {		
			$.get(root + 'ping?'+new Date().getTime()).success(function(data) { 
			
				setLoadingText('Checking connectivity');

				makeNotice('error', 'misc-error', 'You must disconnect your internet before continuing', 5000);
				
				return false;
				
			}).error(function(data) {
				
				$('.loading-indicator').remove();
				$('#status-container').html('OFFLINE MODE');
				
				offline = true;
				
				$('#email-backup-btn').attr('disabled', true);
				$('#my-account-btn').attr('disabled', true);

				modal.modal('hide');										
				
				didDecryptWallet();
			});
	  });
	};
	
	setTimeout(isDone, 1000);
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
	
	var toffline = $('#restore-offline').is(':checked');
	
	if (toffline) {
		try {
	        if (localStorage == null) {
	    		makeNotice('error', 'misc-error', 'Your browser does not support local stoage. Cannot login in offline mode.', 5000);
	    		return false;
	        } else if (localStorage.getItem('multiaddr') != null) {
	    		makeNotice('error', 'misc-error', 'Local storage not empty. Have you enabled private browsing?.', 5000);
	    		return false;	
	        }
		} catch (e) {
			console.log(e);
		}
     }
	
	//If we don't have any wallet data then we must have two factor authenitcation enabled
	if (encrypted_wallet_data == null) {
		
		setLoadingText('Validating authentication key');
		
		var auth_key = $('#restore-auth-key').val();
		
		if (auth_key == null || auth_key.length == 0 || auth_key.length > 255) {
			makeNotice('error', 'misc-error', 'You must enter a Yubikey or Email confirmation code', 5000);
			return false;
		}
		
		$.post("/wallet", { guid: guid, payload: auth_key, length : auth_key.length,  method : 'get-wallet' },  function(data) { 			
			encrypted_wallet_data = data;
			
			 if (internalRestoreWallet()) {
				 				 
				if (toffline)
					getReadyForOffline();
				else
					didDecryptWallet();
			} else {
				if (toffline)
					$('#offline-mode-modal').modal('hide');
				
				$("#restore-wallet-continue").removeAttr('disabled');
			}
	
		})
	    .error(function(data) { 
	    	
	    	$("#restore-wallet-continue").removeAttr('disabled');
	    	
	    	makeNotice('error', 'misc-error', data.responseText, 5000); 
	    });
	} else {
		
		if (internalRestoreWallet()) {

			if (toffline)
				getReadyForOffline();
			else
				didDecryptWallet();
		} else {
			if (toffline)
				$('#offline-mode-modal').modal('hide');
			
			$("#restore-wallet-continue").removeAttr('disabled');
		}
	}

	
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

//Get email address, secret phrase, yubikey etc.
function getAccountInfo() {

	if (offline) return;
	
	setLoadingText('Getting Wallet Info');

	$.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'get-info' },  function(data) { 
				
		if (data.email != null) {
			$('#wallet-email').val(data.email);
			$('.my-email').text(data.email);
		}
		
		$('#wallet-phrase').val(data.phrase);
		
		
		if (data.alias != null) {
			$('#wallet-alias').val(data.alias);
			$('.alias').text(data.alias);
			$('.alias').show(200);
		}
		
		if (data.dropbox_enabled == 1)
			$('#wallet-dropbox-enabled').prop("checked", true);
		else
			$('#wallet-dropbox-enabled').prop("checked", false);

		$('#wallet-http-url').val(data.http_url);

		$('#wallet-http-url').val(data.http_url);
		$('#wallet-skype').val(data.skype_username);
		$('#wallet-yubikey').val(data.yubikey);
		
		if (data.email_verified == 0) {
			$('#verify-email').show();
			$('#email-verified').hide();
		} else {
			$('#verify-email').hide();
			$('#email-verified').show();
		}
	
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText); 
    });
}

function emailBackup() {
	if (offline) return;

	setLoadingText('Sending email backup');

	$.post("/wallet", { guid: guid, sharedKey: sharedKey, method : 'email-backup' },  function(data) { 
		makeNotice('success', 'backup-success', data, 5000);
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText); 
    });
}

function verifyEmail(code) {
	if (offline) return;

	if (code == null || code.length == 0 || code.length > 255) {
		makeNotice('error', 'misc-error', 'You must enter a code to verify', 5000);
		return;
	}
		
	setLoadingText('Verifying Email');

	$.post("/wallet", { guid: guid, payload: code, sharedKey: sharedKey, length : code.length, method : 'verify-email' },  function(data) { 
		makeNotice('success', 'email-success', data, 5000);
		
		$('#verify-email').hide();
		$('#email-verified').show(200);
	})
    .error(function(data) { 
    	makeNotice('error', 'misc-error', data.responseText, 5000); 
    	$('#verify-email').show(200);
		$('#email-verified').hide();
    });
}

function updatePubKeys() {
	//Only update public keys when needed for send notifications
	if (notifications_type != 0) updateKV('Updating Public Keys', 'update-pub-keys', getActiveAddresses().join('|'));
}

function updateKV(txt, method, value) {
	if (offline) return;
	
	if (value == null || value.length == 0) {
		makeNotice('error', 'misc-error', txt + ': Invalid value');
		return;
	}
	
	setLoadingText(txt);

	$.post("/wallet", { guid: guid, sharedKey: sharedKey, payload : value, method : method },  function(data) { 
		makeNotice('success', method + '-success', data, 5000);
	})
    .error(function(data) { 
    	makeNotice('error', method + '-error', data.responseText, 5000); 
    });
}

function backupWallet(method, successcallback, errorcallback, extra) {
	if (offline) return;
	
	if (method == null) method = 'update';

	if (!isInitialized && method != 'insert')
		return false;
		
	if (guid.length != 36) {
		throw 'Invalid wallet identifier';
	}
	
	var data = makeWalletJSON();
	
	//Double check the json is parasable
	var obj = jQuery.parseJSON(data);

	if (obj == null)
		throw 'null json error';
	
	if (obj.keys.length == 0)
		throw 'Cannot backup wallet with no keys';
	
	//Everything looks ok, Encrypt the JSON output
	var crypted = Crypto.AES.encrypt(data, password);
		
	if (crypted.length == 0) {
		throw 'Error enrypting the JSON output';
	}
	
	//SHA256 checksum verified by server in case of curruption during transit
	var checksum = Crypto.util.bytesToHex(Crypto.SHA256(crypted, {asBytes: true}));
	
	setLoadingText('Saving wallet');
	
	if (extra == null)
		extra = '';
	
	$.ajax({
		 type: "POST",
		 url: root + 'wallet' + extra,
		 data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, checksum: checksum, method : method },
		 converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
		 success: function(data) {  
			 			 
			 var change = false;
			 for (var key in addresses) {
				 var addr = addresses[key];
				 if (addr.tag == 1) {
					 addr.tag = 0; //Make any unsaved addresses as saved
					 change = true;
				 }
			 
				 //Update view remove 'Unsynced' tags
				 if (change) buildReceiveCoinsView();
			 }
			 
			 if (method == 'update')
				 updatePubKeys();
			 
			makeNotice('success', 'misc-success', data, 5000);
			 
			if (successcallback != null)
				successcallback();
		},
			
		error : function(data) {
		   makeNotice('error', 'misc-error', data.responseText, 10000); 
		   
			if (errorcallback != null)
				errorcallback();
		}
	});
}


function encryptPK(base58) {			
	if (double_encryption) {
		if (dpassword == null)
			throw 'Cannot encrypt private key without a password';
		
			return Crypto.AES.encrypt(base58, sharedKey + dpassword);
	} else {
		return base58;
	}
	
	return null;
}

function encodePK(priv) {
	var base58 = Bitcoin.Base58.encode(priv);
	return encryptPK(base58);
}

function decryptPK(priv) {
	if (double_encryption) {
		if (dpassword == null)
			throw 'Cannot decrypt private key without a password';
		
		return Crypto.AES.decrypt(priv, sharedKey + dpassword);
	} else {
		return priv;
	}
	
	return null;
}

function decodePK(priv) {
	var decrypted = decryptPK(priv);
	if (decrypted != null) {
		return Bitcoin.Base58.decode(decrypted);
	}
	return null;
}

function getSecondPassword() {
	
	if (!double_encryption || dpassword != null)
		return true;
	
	var input = prompt("Please enter your second password", null);	
	
	if (input == null || input.length == 0) {
		makeNotice('error', 'misc-error', 'No password entered', 5000);
		return false;
	}
	
	var thash = Crypto.SHA256(sharedKey + input);
	
	if (thash == dpasswordhash) {
		dpassword = input;
		return true;
	} 
	
	//Legacy as I made a bit of a mistke creating a SHA256 hash without the salt included
	var leghash = Crypto.SHA256(input);

	if (leghash == dpasswordhash) {
		dpassword = input;
		dpasswordhash = thash;
		return true;
	} 
	
	makeNotice('error', 'misc-error', 'Second password incorrect', 5000);
	
	return false;
}

function setDoubleEncryption(value) {

	try {
		if (double_encryption == value)
			return;
				
		if (value) {
			var tpassword = $('#double-password').val();
			var tpassword2 = $('#double-password2').val();
				
			if (tpassword == null || tpassword.length == 0 || tpassword.length < 4 || tpassword.length > 255) {
				makeNotice('error', 'misc-error', 'Password must be 4 characters or more in length', 5000);
				return;
			} 
			
			if (tpassword != tpassword2) {
				makeNotice('error', 'misc-error', 'Passwords do not match.', 5000);
				return;
			}
						
			if (tpassword == password) {
				makeNotice('error', 'misc-error', 'Second password should not be the same as your main password.', 5000);
				return;
			}
					
			double_encryption = true;
			dpassword = tpassword;
			
			for (var key in addresses) {
				var addr = addresses[key];			
				addr.priv = encodePK(Bitcoin.Base58.decode(addr.priv));
			}
			
			dpasswordhash = Crypto.SHA256(sharedKey + tpassword);
			
			//Clear the password to force the user to login again
			//Incase they have forgotten their password already
			dpassword = null;
			
			backupWallet();
			
		} else {
					
			if (!getSecondPassword()) {
				return;
			}
			
			for (var key in addresses) {
				var addr = addresses[key];
				addr.priv = decryptPK(addr.priv);
			}
			
			double_encryption = false;
			dpassword = null;
			
			backupWallet();
		}
	} catch (e) {
		//If we caught an excpetion here the wallet could be in a inconsistent state
		//We probably haven't synced it, so no harm done
		//But for now panic!
		window.location = root + 'wallet/' + guid;
	}
}


function checkAndSetPassword() {
	if (offline) return;

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
	if (offline) return;

	var modal = $('#update-password-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();
		
	modal.find('.btn.primary').unbind().click(function() {
		modal.modal('hide');

		var oldPassword = password;
		
		if (!checkAndSetPassword()) {
			return false;
		}
		
		try {
			backupWallet('update', function() {
				window.location = root + 'wallet/' + guid + window.location.hash;
			}, function() {
				makeNotice('error', 'misc-error', 'Error syncing wallet. Password Not changed', 5000);
				password = oldPassword;
			});
				
		} catch (e) {
			makeNotice('error', 'misc-error', 'Error syncing wallet. Password Not changed', 5000);
			password = oldPassword;
		}
	});

	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}

function changeView(id) {

	if (id === cVisible)
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
	if (offline) return;

	var s = tx.serialize();

	var hex = Crypto.util.bytesToHex(s);
	
	setLoadingText('Sending Transaction');

	$.post("/pushtx", { tx: hex },  function(data) {  })
	.success(function(data) { makeNotice('success', 'misc-success', data, 5000); 
	}).error(function(data) { makeNotice('error', 'misc-error', data.responseText); 
    });
		
	return true;
}

//Rendom key from associative array
function randomKey(obj) {
    var ret;
    var c = 0;
    for (var key in obj)
        if (Math.random() < 1/++c)
           ret = key;
    return ret;
}


//toAddresses receipients list e.g. {value, address} for simple pay to pub key hash {value, m, pubkeys} for multi sig
//fromAddress specific address to take payment from, otherwise null
//list of unspentOutputs this transaction is able to redeem {script, value, tx_output_n, tx_hash, confirmations}
//changeAddress  = address to reutn change (Bitcoin.Address)
//feeAddress = additional address to take fee from
function makeTransaction(toAddresses, fromAddress, minersfee, unspentOutputs, selectedOuts, changeAddress, feeAddress) {
		
	var txValue = BigInteger.ZERO;
    
	for (var i = 0; i < toAddresses.length; ++i) {			
		txValue = txValue.add(toAddresses[i].value);
	}

    //Add blockchain.info's fees
    var ouraddr = new Bitcoin.Address(our_address);
  
    var ourFee = BigInteger.valueOf(1000000); // 0.01 BTC

	var availableValue = BigInteger.ZERO;
	var availableFeeValue = BigInteger.ZERO;
	
	var feeAddr = null;
	if (feeAddress != null)
		feeAddr = feeAddress.toString();
	
	var fromAddr = null;
	if (fromAddress != null)
		fromAddr = fromAddress.toString();
	
	//If the user hasn't supplied a fee adress then we take the fee from the general pool
    if (feeAddr == null)
    	txValue = txValue.add(ourFee);
    
	//Add the miners fees
	if (minersfee != null)
		txValue = txValue.add(minersfee);
	
	var priority = 0;
	
	for (var i = 0; i < unspentOutputs.length; ++i) {
		
		try {
			var addr = new Bitcoin.Address(unspentOutputs[i].script.simpleOutPubKeyHash()).toString();
			
			if (addr == null) {
				throw 'Unable to decode output address from transaction hash ' + out.tx_hash;
			} else if (!offline && addresses[addr].priv == null) {
				throw 'Unable use bitcoin address ' + addr + ' in online mode';
			}
			
			var out = unspentOutputs[i];
			
			if (feeAddr != null && addr == feeAddr) {
				
				if (availableFeeValue.compareTo(ourFee) < 0)
					availableFeeValue = availableFeeValue.add(out.value);
				else
					continue;
				
			} else if (fromAddr != null && addr != fromAddr) {
				continue;
			}  else {
				availableValue = availableValue.add(out.value);
			}
			
			var hexhash = Crypto.util.hexToBytes(out.tx_hash);

			var b64hash = Crypto.util.bytesToBase64(Crypto.util.hexToBytes(out.tx_hash));
			
			selectedOuts.push(new Bitcoin.TransactionIn({outpoint: {hash: b64hash, hexhash: hexhash, index: out.tx_output_n, value:out.value}, script: out.script, sequence: 4294967295}));
						
			priority += out.value * out.confirmations;
				
			if (availableValue.compareTo(txValue) >= 0 && (feeAddress == null || availableFeeValue.compareTo(ourFee) >= 0)) 
				break;
			
		} catch (e) {
			//An error, but probably recoverable
			makeNotice('info', 'tx-error', e, 5000);
		}
	}
	
    if (availableValue.compareTo(txValue) < 0) {
		throw 'Insufficient funds. Value Needed ' +  formatBTC(txValue.toString()) + ' BTC. Available amount ' + formatBTC(availableValue.toString()) + ' BTC';
    }

	var changeValue = null;
	
    if (feeAddr == null)
    	changeValue = availableValue.subtract(txValue);
    else
    	changeValue = availableValue.add(availableFeeValue).subtract(txValue).subtract(ourFee);
	
	var sendTx = new Bitcoin.Transaction();

	for (var i = 0; i < selectedOuts.length; i++) {
		sendTx.addInput(selectedOuts[i]);
	}

	for (var i =0; i < toAddresses.length; ++i) {	
		var addrObj = toAddresses[i];

		if (addrObj.m != null) {
			sendTx.addOutputScript(Bitcoin.Script.createMultiSigOutputScript(addrObj.m, addrObj.pubkeys), addrObj.value);
		} else {
			sendTx.addOutput(addrObj.address, addrObj.value);
		}
	}

	if (changeValue > 0) {
		if (changeAddress != null) //If chenge address speicified return to that
			sendTx.addOutput(changeAddress, changeValue);
		else if (fromAddress != null) //Else return to the from address if specified
			sendTx.addOutput(fromAddress, changeValue);
		else { //Otherwise return to random unarchived					
			var active = getActiveAddresses();
			sendTx.addOutput(new Bitcoin.Address(active[Math.floor(Math.random() * active.length)]), changeValue);
		}
	}
	
	//Estimate scripot sig (Cannot use serialized tx size yet becuase we haven't signed the inputs)
	//18 bytes standard header
	//standard scriptPubKey 24 bytes
	//Stanard scriptSig 64 bytes

	var estimatedSize = sendTx.serialize(sendTx).length + (114 * sendTx.ins.length);
	
	priority /= estimatedSize;
	
	var kilobytes = estimatedSize / 1024;
	
	//Proority under 57 million requires a 0.01 BTC transaction fee (see https://en.bitcoin.it/wiki/Transaction_fees)
	if (priority < 57600000 || kilobytes > 1) {
		//For low priority transactions we half our fee
		sendTx.addOutput(ouraddr, ourFee.divide(BigInteger.valueOf(2)));
	} else {		
		//Otherwise we take the full fee
		sendTx.addOutput(ouraddr, ourFee);
	}
			
	return sendTx;
}

function signInput(sendTx, missingPrivateKeys, selectedOuts, i) {
		
		var hashType = 1; // SIGHASH_ALL
					
		var hash = sendTx.hashTransactionForSignature(selectedOuts[i].script, i, hashType);
		var pubKeyHash = selectedOuts[i].script.simpleOutPubKeyHash();
		var inputBitcoinAddress = new Bitcoin.Address(pubKeyHash).toString();
		var privatekey = null;
		
		//Find the matching private key
		if (addresses[inputBitcoinAddress].priv != null) {
			privatekey = new Bitcoin.ECKey(decodePK(addresses[inputBitcoinAddress].priv));
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
			return false;
		}
		
		if (privatekey.getBitcoinAddress().toString() != inputBitcoinAddress.toString()) {
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
	
		return true;
}

function nKeys(obj) {
    var size = 0, key;
    for (key in obj) {
        size++;
    }
    return size;
};

function internalDeletePrivateKey(addr) {
	addresses[addr].priv = null;
}

function internalDeleteAddress(addr) {	
	delete addresses[addr];
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

function walletIsFull(addr) {

	if (nKeys(addresses) >= 200) {
		makeNotice('error', 'misc-error', 'We currently support a maximum of 200 private keys, please remove some unsused ones.', 5000);
		return true;
	}
	
	return false;
}

function addressMatchesPrivateKey(addr, priv) {
	var priv_addr = new Bitcoin.ECKey(Bitcoin.Base58.decode(priv)).getBitcoinAddress().toString();
	
	if (priv_addr != addr) {
		return false;
	}

	return true;
}

function internalAddKey(addr, priv) {	
	var existing = addresses[addr];
	if (existing == null || existing.length == 0) {
		addresses[addr] = {addr : addr, priv : priv, tag : null, label : null, balance : 0};
		return true;
	} else if (existing.priv == null) {
		existing.priv = priv;
		return true;
	}
	
	return false;
}


function showInventoryModal(hash) {
	var modal = $('#inv-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();

	setLoadingText('Getting Inventory Data');

	$('#inv-data').hide();

	$.get(root + 'inv/'+hash+'?format=json').success(function(data) { 
		
		$('#inv-data').show(200);
		
		$('#initial_ip').html('<a href="'+root+'ip-address/'+data.initial_ip+'">'+data.initial_ip+'</a>');
				
		$('#initial_time').html(dateToString(new Date(parseInt(data.initial_time))));

		$('#last_seen').html(dateToString(new Date(parseInt(data.last_time))));

		$('#inv_n_connected').html(data.nconnected);
		
		$('#total_relayed').html(data.relayed_count);

		$('#p_network').html(data.relayed_percent);
		
		var container = $('#inv_mining_nodes');
		
		container.empty();
		
		var tmp_map = [];
		
		for (var i = 0; i < data.mining_nodes.length; ++i) {
			var node = data.mining_nodes[i];
			
			if (tmp_map[node.name] == null) {
				tmp_map[node.name] = true;
				container.append('<li><a href="'+node.link+'">'+node.name+'</a></li>');
			}
		}
		
		if (data.mining_nodes == 0) {
			container.append('<li>No mining nodes have receivied this transaction. It is unlikely to be included in any blocks and will be clear in approximatly 24 hours.</li>');
		}

	}).error(function(data) {
		modal.modal('hide');
		makeNotice('error', 'misc-error', 'Error getting inventory data.'); 
	});
	
	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}

function labelAddress(addr) {
	var modal = $('#label-address-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();
	
    modal.find('.address').text(addr);

    var label_input = modal.find('input[name="label"]');
    
    modal.find('.address').text(addr);

    label_input.val('');
    
	//Added address book button
	modal.find('.btn.primary').unbind().click(function() {
				
		modal.modal('hide');
		
        var label = label_input.val();
        
        if (label.length == 0) {
			makeNotice('error', 'misc-error', 'you must enter a label for the address', 5000);
			return false;
        }
 
        addresses[addr].label = label;
				
		backupWallet('update', null, null);

		buildReceiveCoinsView();
	});
	
	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}


function addAddressBookEntry() {
	var modal = $('#add-address-book-entry-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();
	
	//Added address book button
	modal.find('.btn.primary').unbind().click(function() {
				
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
		
		internalAddAddressBookEntry(bitcoinAddress, label);

		backupWallet();

		buildSendTxView();
	});
	
	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}


function deleteAddress(addr) {
		
	if (getActiveAddresses().length <= 1) {
		makeNotice('error', 'add-error', 'You must leave at least one active address', 5000);
		return;
	}
	
	addr = addresses[addr];
	
	var modal = $('#delete-address-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();
	
	modal.find('.btn.primary').show();
	modal.find('.btn.danger').show();
	modal.find('.modal-body').show();
	$('#change-mind').hide();
	
	modal.find('#to-delete-address').html(addr.addr);
	
	modal.find('#delete-balance').text('Balance ' + formatBTC(addr.balance) + ' BTC');
	
	var isCancelled = false;
	var i = 0;
	var interval = null;
	
	changeMind = function() {		
		$('#change-mind').show();
		
		$('#change-mind-time').text(5 - i);
	};
	
	modal.find('.btn.primary').unbind().click(function() {
					
		changeMind();
		
		modal.find('.btn.primary').hide();
		modal.find('.btn.danger').hide();

		interval = setInterval(function() { 
			
				if (isCancelled)
					return;
				
				if (sound_on) {
					try {
	            		document.getElementById("beep").play(1);
	            	} catch (e) {
	            		sound_on = false;
	            	}
		        }
				
				++i;
				
				changeMind();
			    
			    if (i == 5) {
			    	//Really delete address
					$('#delete-address-modal').modal('hide');
					
					makeNotice('warning', 'warning-deleted', 'Private Key Removed From Wallet', 5000);
					
					internalDeletePrivateKey(addr.addr);
					 
					//Update view with remove address
					buildReceiveCoinsView();
										
				    backupWallet();
					  
				    clearInterval(interval);
			    }

		}, 1000);
	});

	modal.find('.btn.danger').unbind().click(function() {
		
		changeMind();
		
		modal.find('.btn.primary').hide();
		modal.find('.btn.danger').hide();

		interval = setInterval(function() { 
			
				if (isCancelled)
					return;
				
				if (sound_on) {
					try {
	            		document.getElementById("beep").play(1);
	            	} catch (e) {
	            		sound_on = false;
	            	}
		        }
				
				++i;
				
				changeMind();
			    
			    if (i == 5) {
			 
					try {
						
						//Really delete address
						$('#delete-address-modal').modal('hide');
						
						makeNotice('warning', 'warning-deleted', 'Address & Private Key Removed From Wallet', 5000);
						
						internalDeleteAddress(addr.addr);
						
						buildReceiveCoinsView();
						
						backupWallet();
						
						queryAPIMultiAddress();

					} finally {
						clearInterval(interval);
					}
			    }

		}, 1000);
	});
	
	modal.bind('hidden', function () {
		if (interval) {
			isCancelled = true;
			clearInterval(interval);
			interval = null;
		}
	});

	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});

}

function formatAddresses(m, addresses) {
	var str = '';
	if (addresses.length == 1) {
		str = addresses[0].toString();	
	} else {
		str = 'Escrow (<i>';
		for (var i = 0; i < addresses.length; ++i) {
			str += addresses[i].toString() + ', ';	
		}
		
		str = str.substring(0, str.length-2);
		
		str += '</i> - ' + m + ' Required)';
	}
	return str;
}

function setReviewTransactionContent(modal, tx) {
	
		$('#rtc-hash').html(Crypto.util.bytesToHex(tx.getHash()));
		$('#rtc-version').html(tx.version);
		$('#rtc-from').html('');
		$('#rtc-to').html('');
		
		var total = BigInteger.ZERO;
		var total_fees =  BigInteger.ZERO;
		var wallet_effect =  BigInteger.ZERO;
		var basic_str = 'send ';
		var all_txs_to_self = true;
		var amount =  BigInteger.ZERO;
		
		for (var i = 0; i < tx.ins.length; ++i) {
			var input = tx.ins[i];
						
			total_fees = total_fees.add(input.outpoint.value);
			
			wallet_effect = wallet_effect.add(input.outpoint.value);
			
			var addr = null;	
			try {
				addr = new Bitcoin.Address(input.script.simpleInPubKeyHash());	
			} catch(e) {
				addr = 'Unable To Decode Address';
			}
	
			$('#rtc-from').append(addr + ' <font color="green">' + formatBTC(input.outpoint.value.toString()) + ' BTC <br />');
		}
	
		
		for (var i = 0; i < tx.outs.length; ++i) {
			var out = tx.outs[i];
				
			var array = out.value.slice();
			
			array.reverse();
		
			var val =  new BigInteger(array);
	
			var out_addresses = [];
			
			var m = out.script.extractAddresses(out_addresses);
						
			$('#rtc-to').append(formatAddresses(m, out_addresses) + ' <font color="green">' + formatBTC(val.toString()) + ' BTC </font><br />');
		
			total = total.add(val);
			
			total_fees = total_fees.subtract(val);
			
			//If it's an escrow transaction we always subtract it from the wallet effect
			//As technically we are not in control of the funds anymore
			if (out_addresses.length > 1) {
						
				if (basic_str.length > 0) {
					basic_str += ' and ';
				}
					
				basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + formatAddresses(m, out_addresses);
				
				all_txs_to_self = false;

				wallet_effect = wallet_effect.subtract(val);
				
			//check if it's an address in our wallet
			//If it is then we don't need to subtract it from wallet effect
			} else { 
				var address = out_addresses[0].toString();
				
				if (addresses[address] == null) {
					//Our fees
					if (address != our_address) {
						if (basic_str.length > 0) {
							basic_str += ' and ';
						}
							
						basic_str += '<b>' + formatBTC(val.toString())  + ' BTC</b> to ' + address;
						
						all_txs_to_self = false;
					}
				} else {
					wallet_effect = wallet_effect.subtract(val);
					
					if (address != our_address) {
						amount = amount.add(val);
					}
				}
			}
		}
		
		if (total_fees.compareTo(BigInteger.valueOf(1).multiply(BigInteger.valueOf(satoshi))) >= 0) {
			alert('Warning fees are very high for this transaction. Please double check each output!');
		}
		
		if (all_txs_to_self == true) {
			basic_str = 'move <b>' + formatBTC(amount.toString()) + ' BTC</b> between your own bitcoin addresses';
		}
		
		$('#rtc-basic-summary').html(basic_str);
			
		$('#rtc-effect').html("-" + formatBTC(wallet_effect.toString()) + ' BTC');
	
		$('#rtc-fees').html(formatBTC(total_fees.toString()) + ' BTC');
	
		$('#rtc-value').html(formatBTC(total.toString()) + ' BTC');
		
		modal.center();
}


function txFullySigned(tx) {
	var modal = $('#new-transaction-modal');

	try {
	
		modal.find('.modal-header h3').html('Transaction ready to be sent.');
		
		modal.find('#missing-private-key').hide();
		
		modal.find('#review-tx').show();
	
		setReviewTransactionContent(modal, tx);
	
		//We have the transaction ready to send, check if were online or offline
		
		var btn = modal.find('.btn.primary');

		setLoadingText('Checking Connectivity');

		if (!offline) {
			
			btn.attr('disabled', false);

			btn.text('Send Transaction');
								
			btn.unbind().click(function() {
				
				btn.attr('disabled', true);

				pushTx(tx);
				
				modal.modal('hide');
			});
			
		} else {
			
			modal.find('.modal-header h3').html('Created Offline Transaction.');

			btn.attr('disabled', false);
			
			btn.text('Show Offline Instructions');

			btn.unbind().click(function() {
				
				btn.attr('disabled', true);

				modal.find('#missing-private-key').hide();
				modal.find('#review-tx').hide();
				modal.find('#offline-transaction').show();
				
				var s = tx.serialize();

				var hex = Crypto.util.bytesToHex(s);
				
				modal.find('#offline-transaction textarea[name="data"]').val(hex);
			});
		}
	
	} catch (e) {
		 makeNotice('error', 'misc-error', e, 5000);
		 modal.modal('hide');
		 throw e;
	}
}

function txConstructSecondPhase(toAddresses, fromAddress, fees, unspent, missingPrivateKeys, changeAddress, feeAddress) {
	var modal = $('#new-transaction-modal');


	var selectedOuts = [];

	//First we make the transaction with it's inputs unsigned
	var tx = makeTransaction(toAddresses, fromAddress, fees, unspent, selectedOuts, changeAddress, feeAddress);
	
	var progress = $('#tx-sign-progress').show(200);
	
	if (tx == null) {
		 makeNotice('error', 'misc-error', 'Error Creating Transaction', 5000);
		 modal.modal('hide');
		 return;
	}
			
	var nSigned = 0;
	var outputN = 0;
	
	
	progress.find('.t').text(tx.ins.length);

	signOne = function() {
		setTimeout(function() {
			
			//If the modal has been hidden the the user has probably cancelled
			if (!modal.is(":visible"))
				return;
			
			progress.find('.n').text(outputN+1);

			//Try and sign the input
			if (signInput(tx, missingPrivateKeys, selectedOuts, outputN)) {
				++outputN;
									
				if (outputN == tx.ins.length) {
					progress.hide();
					
					txFullySigned(tx);
				} else {
					signOne();
				}
				
			//If the input failed to sign then were probably missing a private key
			//Only ask for missing keys in offline mode
			} else if (offline && missingPrivateKeys.length > 0) {
				
				progress.hide();

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
					
				 try {
					  loadScript(resource + 'wallet/qr.code.reader.js', function() { 
						  loadScript(resource + 'wallet/llqrcode.js', function() { 

						 //Flash QR Code Reader
						 var interval = initQRCodeReader('qr-code-reader', function(code){
								 try {
								    var key = privateKeyStringToKey(code, 'base58');
									
								    if (key == null) {
										makeNotice('error', 'misc-error', 'Error decoding private key', 5000);
										return;
									}
								    
									if (missing.addr != key.getBitcoinAddress().toString()) {
										makeNotice('error', 'misc-error', 'The private key you entered does not match the bitcoin address', 5000);
										return;
									}
									
									clearInterval(interval);
									
									$('#qr-code-reader').remove();
									
									missing.priv = key;
									
									form.hide();
									
									progress.show();
									
									//Now try again
									signOne();
								} catch(e) {
									makeNotice('error', 'misc-error', 'Error decoding private key ' + e, 5000);
									return;
								}
						 }, resource + 'wallet/');
						
						 //Center the modal as the flash moview changes the size
						modal.center();
						 
						modal.bind('hidden', function () {
							clearInterval(interval);
						});
					   });
					  });

				 } catch(e) {
					 console.log(e);
				 }
				
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
									
						if (key == null) {
							makeNotice('error', 'misc-error', 'Error decoding private key', 5000);
							return;
						}
						
						if (missing.addr != key.getBitcoinAddress().toString()) {
							makeNotice('error', 'misc-error', 'The private key you entered does not match the bitcoin address', 5000);
							return;
						}
						
						
						missing.priv = key;
						
						form.hide();
						
						progress.show();

						//Now try again
						signOne();
					} catch(e) {
						makeNotice('error', 'misc-error', 'Error importing private key ' + e, 5000);
						return;
					}
				 });
			
			} else {
				//If were not missing a private key then somethign went wrong
				makeNotice('error', 'misc-error', 'Unknown error signing transaction');
				modal.modal('hide');
				return;
			}
			
		}, 1);
	};
	
	signOne();
}


function apiGetEscrow(txIndex) {
	$.get(root + 'q/pubkeyaddr/'+addr).success(function(data) { 
		
		console.log(data);
		
		if (data == null || data.length == 0)
			error();
		else
			success(Crypto.util.hexToBytes(data));
		
	}).error(function(data) {
		error();
	});
}


function apiGetPubKey(addr, success, error) {	
	$.get(root + 'q/pubkeyaddr/'+addr).success(function(data) { 
		
		console.log(data);
		
		if (data == null || data.length == 0)
			error();
		else
			success(Crypto.util.hexToBytes(data));
		
	}).error(function(data) {
		error();
	});
}

//Constuct a transaction suing the Escrow (M-Of-N) form
function newEscrowTx() {
	if (!getSecondPassword()) {
		return;
	}
	
	var modal = null;
	
	//Constuct the recepient address array
	var container = $("#send-escrow-form");
	var pubkeys = [];
	var nPubKeys = 0;
	var error = false;
    var value_input = container.find('input[name="send-value"]');

    console.log(value_input.val());
    
	var value = Bitcoin.Util.parseValue(value_input.val());
    	 
	if (value == null || value.compareTo(BigInteger.ZERO) <= 0) 
		throw 'You must enter a value greater than zero';
	
	var m = parseInt(container.find('select[name="escrow-m"]').val());
	
	container.find('input[name="send-to-address"]').each(function() {
	       	        
	        var addr = $(this).val();
	        
	        ++nPubKeys;
	        
	        if (addr == null) {
	    		throw 'You must enter a bitcoin address for each recipient';
	        }
	        
	        //If it's one of our adddresses we already have the pub key
	        if (addresses[addr] != null && addresses[addr].priv != null) {	       
	        	pubkeys.push(new Bitcoin.ECKey(decodePK(addresses[addr].priv)).getPub());
	        } else {
	        	apiGetPubKey(addr, function(key) {
		        	pubkeys.push(key);
	        	}, function() {
	        		makeNotice('error', 'pub-error', 'Could not get pubkey for address: ' + addr, 5000);
	        		error = true;
	        	});
	        }
	});
	
	if (nPubKeys == 1) {
		throw 'An escrow transaction should have at least two recipients';
	}
	
	if (m > nPubKeys) {
		throw 'Not enough recipients specified for redemption conditions';
	}
	
	var timer = setInterval(function() {
		//Check progress of getPubKeys();
		
		if (error) {
			clearInterval(timer);
			return;
		}
			
		if (pubkeys.length == nPubKeys) {
			//Success!
			clearInterval(timer);

			var toAddresses = [{value : value, m : m, pubkeys : pubkeys}];
			var fromAddress = null;
			var minersfee = null;
			var changeAddress = null;
			var feeAddress = null;
			
			txConstructFirstPhase(toAddresses, fromAddress, minersfee, changeAddress, feeAddress);
		}
		
	}, 1000);
	
}

//show the progress modal
//Get unspent outputs
//Forward to second phase
function txConstructFirstPhase(toAddresses, fromAddress, minersfee, changeAddress, feeAddress) {		
	
	var modal = $('#new-transaction-modal');
	
	try {
		modal.find('#offline-transaction').hide();
		modal.find('#missing-private-key').hide();
		modal.find('#review-tx').hide();
				
		modal.find('.modal-header h3').html('Creating transaction');
		
		modal.find('#tx-sign-progress').hide();
	
		modal.modal({
			  keyboard: true,
			  backdrop: "static",
			  show: true
		});
		
		modal.center();
		
		//disable primary for now
		modal.find('.btn.primary').attr('disabled', true);
		
		modal.find('.btn.primary').text('Send Transaction');
	
		modal.find('.btn.secondary').unbind().click(function() {
			modal.modal('hide');
		});
		
		modal.find('.notices').append($('#notices'));
		
		modal.bind('hidden', function () {
			$('#main-notices-container').append($('#notices'));
		});
			
		var gotunspent = function(obj) {
			try {
				var unspent = [];
				var missingPrivateKeys = [];
	
				for (var i = 0; i < obj.unspent_outputs.length; ++i) {
									
					var script;
					try {
						 script = new Bitcoin.Script(Crypto.util.hexToBytes(obj.unspent_outputs[i].script));
					} catch(e) {
						makeNotice('error', 'misc-error', 'Error decoding script: ' + e);
						continue;
					}
					var out = {script : script,
						value : BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(obj.unspent_outputs[i].value_hex)),
						tx_output_n : obj.unspent_outputs[i].tx_output_n,
						tx_hash : obj.unspent_outputs[i].tx_hash,
						confirmations : obj.unspent_outputs[i].confirmations
					};
					
					unspent.push(out);
				}
				
				modal.find('.modal-header h3').html('Signing Transaction');
									
				txConstructSecondPhase(toAddresses, fromAddress, minersfee, unspent, missingPrivateKeys, changeAddress, feeAddress);
				
			} catch (e) {
				makeNotice('error', 'misc-error', 'Error creating transaction: ' + e, 5000);
				modal.modal('hide');
				return false;
			}
		};
	
		
		if (offline) {
			gotunspent(unspent_cache);
		} else if (changeAddress == 'new') {
			
			  var generatedAddr = generateNewAddressAndKey();
			  				  
			  backupWallet('update', function() {
				  
				  changeAddress = generatedAddr;
				  
				  buildSendTxView();
	
				  //Call again with the new change address
				  getUnspentAndProceed(toAddresses, fromAddress, minersfee, changeAddress, feeAddress);
				  
			  }, function() {
					makeNotice('error', 'misc-error', 'Error syncing wallet. Transaction cancelled'); 
					return;
			  });
			  
		} else {
			setLoadingText('Getting Unspent Outputs');
			
			$.post(root + 'unspent', {'addr[]' : getActiveAddresses()},  function(obj) {  
				gotunspent(obj);
			}).error(function(data) {  
				modal.modal('hide');
				makeNotice('error', 'misc-error', 'Error getting unspent outputs. Please check your internet connection.'); 
			});
		}
	} catch (e) {
		makeNotice('error', 'misc-error', e); 
		modal.modal('hide');
	}
}

//Check for inputs and get unspent for before signinging
function newTx() {
	
	//Need to be able to decrypt private keys
	if (!getSecondPassword()) {
		return;
	}
	
	var modal = null;
	var changeAddress = null;
	var feeAddress = null;
	var fromAddress = null;

	var toAddresses = [];
	
	//Constuct the recepient address array
	$("#recipient-container").children().each(function() {
	        var child = $(this);
	       	        
	        var send_to_address = child.find('input[name="send-to-address"]');
	        
	        var value_input = child.find('input[name="send-value"]');

	        var value = 0;
	        var toAddress;
	        
	    	try {
	    				    		
    			value = Bitcoin.Util.parseValue(value_input.val());
		        	 
				if (value == null || value.compareTo(BigInteger.ZERO) <= 0) 
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
			
			toAddresses.push({address: toAddress, value : value});
	});
	
	if (toAddresses.length == 0) {
		throw 'A transaction must have at least one recipient';
	}
	
	//Get the from address, if any
	if ($('#send-from-address').val() != 'any') {
		
		var components = $('#send-from-address').val().split(' ', 1);
					
		try {
			fromAddress = new Bitcoin.Address(components[0]);
		} catch (e) {
			makeNotice('error', 'from-error', 'Invalid from address: ' + e, 5000);
			return false;
		};
	} 

	
	if (show_adv) {
		var feeAddrValue = $('#fee-addr').val();
		if (feeAddrValue != 'any') {
			try {
				feeAddress = new Bitcoin.Address(feeAddrValue);
			} catch (e) {
				makeNotice('error', 'fee-error', 'Invalid fee address: ' + e, 5000);
				return false;
			};
		} 
		
		if (feeAddress != null && fromAddress != null && fromAddress.toString() == feeAddress.toString()) {
			makeNotice('error', 'misc-error', 'From address and Fee address cannot be the same', 5000);
			return false;
		}
			
		var changeAddressVal = $('#change-addr').val();
		if (changeAddressVal != 'any' && changeAddress != 'new') {
			try {
				changeAddress = new Bitcoin.Address(changeAddressVal);
			} catch (e) {
				makeNotice('error', 'change-error', 'Invalid change address: ' + e, 5000);
				return false;
			};
		} 
	}
	
	var minersfee;
	try {
		minersfee = Bitcoin.Util.parseValue($('#send-fees').val());
		
		if (minersfee == null || minersfee.compareTo(BigInteger.ZERO) < 0) 
			throw 'Fees cannot be negative';
		
	} catch (e) {			
		makeNotice('error', 'misc-error', 'Invalid fee value', 5000);
		return false;
	};

	txConstructFirstPhase(toAddresses, fromAddress, minersfee, changeAddress, feeAddress);

	return true;
};

function populateImportExportView() {
	 var val = $('#export-tabs .active').text();

	 try {
		 if (val == 'Export Unencrypted') {			
			 
				if (!getSecondPassword()) {
					 return;
				}
			  
			  	var data = makeWalletJSON($('#export-priv-format').val());
				
				$("#json-unencrypted-export").val(data);
						
		  } else if (val == 'Export') {
			  
				var data = makeWalletJSON();
	
				var crypted = Crypto.AES.encrypt(data, password);
				
				$("#json-crypted-export").val(crypted);
				
		  } else if (val == 'Paper Wallet') {
			 
	          $('#paper-wallet').empty();
	         
			  loadScript(resource + 'wallet/jquery.qrcode.min.js', function() { 
				  			  
				  var container = $('#paper-wallet');
				  
				  if (!getSecondPassword()) {
						return;
				  }
				  
				  for (var key in addresses) {
					  var addr = addresses[key];
	  		
					  var mode = 'Online Mode';
					
					  if (addr.tag == 1)
						  mode = 'Offline Mode';
					  
					  if (addr.priv == null) {
						  continue;
					  }
					  
					  var pk = decryptPK(addr.priv);
					  
					  if (pk == null)
						  continue;
					  
					  var subcontainer = $('<div style="width:100%;float:left;clear:both"></div>');
	
					  //Add Address QR code
					  var qrspan = $('<div style="float:left"></div>');
					  				  
					  var qr = makeQRCode(250, 250, 1 , pk);
					  			
					  qrspan.append(qr);
					  
					  subcontainer.append(qrspan);
					 
					  var body = $('<div style="float:left"><h3>' + addr.addr + '</h3><br /><small><p><b>' + pk + '</b></p></small><br /><p>' + mode + '</p><br /><p>Balance ' + formatBTC(addr.balance) + ' BTC</p> </div>');
					  
					  subcontainer.append(body);
					  
					  container.append(subcontainer);
					
					  //Start a new table every 4 entries
					  if ((i+1) % 3 == 0 || i == (nKeys(addresses)-1)) {
					  	container.append('<div style="width:100%;clear:both;page-break-after:always>&nbsp;</div>');
					  }
				  }
			  }); 
		  }
	 } catch (e) {
			makeNotice('error', 'misc-error', 'Error Exporting keys', 5000);
			return;
	 }
}

function dropboxBackup() {
	 window.open(root + 'wallet/dropbox-login?guid=' + guid + '&sharedKey=' + sharedKey);
}

function downloadBackup() {
	 window.open(root + 'wallet/wallet.aes.json?guid=' + guid + '&sharedKey=' + sharedKey);
}

function bind() {
	
	$('#notifications-form select').change(function() {
		var val = $(this).val();
		
		notifications_type = parseInt(val);
		
		updateKV('Updating Notifications Type', 'update-notifications-type', notifications_type);
		
		$('#notifications-form div').hide().eq(val).show(200);
		
		if (val != 0)
			updatePubKeys();
	});

	$('#two-factor-select').change(function() {
		
		var val = parseInt($(this).val());
						
		updateKV('Updating Two Factor Authentication', 'update-auth-type', val);
		
		if (val == 0) {
			$('#two-factor-yubikey').hide();
			$('#two-factor-email').hide();
			$('#two-factor-none').show(200);
		} else if (val == 1 || val == 3) {
			$('#two-factor-none').hide();
			$('#two-factor-email').hide();
			$('#two-factor-yubikey').show(200);
		} else if (val == 2) {
			$('#two-factor-none').hide();
			$('#two-factor-yubikey').hide();
			$('#two-factor-email').show(200);
		}
	});
	
	$("#new-addr").click(function() {
		try {
			if (!getSecondPassword()) {
				return;
			}
		  generateNewAddressAndKey();
		  		  
		  backupWallet();
		} catch (e) {
			makeNotice('error', 'misc-error', e);
		}
	});
	
	$('#wallet-email').change(function(e) {	
		
		var email = $(this).val();
	
		if (!validateEmail(email)) {
			makeNotice('error', 'misc-error', 'Email address is not valid', 5000);
			return;
		}
				
		updateKV('Updating Email', 'update-email', email);
		
    	$('#verify-email').show(200);
		$('#email-verified').hide();
	});
	
	$('#wallet-double-encryption-enabled').change(function(e) {		
				
		if ($(this).is(':checked')) {
			setDoubleEncryption(true);
		} else {
			setDoubleEncryption(false);
		}
		
		if (double_encryption)
			$(this).prop("checked", true);
		else
			$(this).prop("checked", false);

	});
	
	$('#wallet-email-code').change(function(e) {		
		verifyEmail($(this).val());
	});
	
	$('#wallet-yubikey').change(function(e) {				
		updateKV('Updating Yubikey', 'update-yubikey', $(this).val());
	});
	
	$('#wallet-skype').change(function(e) {				
		updateKV('Updating Skype Username', 'update-skype', $(this).val());
	});

	$('#wallet-http-url').change(function(e) {				
		updateKV('Updating HTTP url', 'update-http-url', $(this).val());
	});
	
	$('#wallet-phrase').change(function(e) {	
		
		var phrase = $(this).val();
		
		if (phrase == null || phrase.length == 0 || phrase.length > 255) {
			makeNotice('error', 'misc-error', 'You must enter a secret phrase', 5000);
			return;
		}
		
		updateKV('Updating Secret Phrase', 'update-phrase', phrase);
	});
	
	$('#wallet-dropbox-enabled').change(function(e) {	
		var val = false;
			
		if ($(this).is(':checked')) {
			val = true;
		}
		
		updateKV('Updating Dropbox Settings', 'update-dropbox-enabled', val);
	});

	$('#wallet-alias').change(function(e) {		
		$(this).val($(this).val().replace(/[\.,\/ #!$%\^&\*;:{}=`~()]/g,""));
	
		if ($(this).val().length > 0) {
			$('.alias').fadeIn(200);
			$('.alias').text($(this).val());
		}
				
		updateKV('Updating Alias', 'update-alias', $(this).val());
	});
	
	

	$('#filter').change(function(){
		setFilter($(this).val());
	});
	
	$('#update-password-btn').click(function() {    			
		updatePassword();
    });
	
    $('#email-backup-btn').click(function() {    			
		emailBackup();
    });
	
    $('#dropbox-backup-btn').click(function() {    			
    	dropboxBackup();
    });
    
    $('#download-backup-btn').click(function() {    			
    	downloadBackup();
    });
    
    $('#wallet-login').unbind().click(function() {    
    
    	try {
           //Make sure the last guid the user logged in the ame as this one, if not clear cache
            var tguid = localStorage.getItem('guid');
            if (tguid != null) {
                window.location = root + 'wallet/' + tguid;
                return;
            }
		} catch (e) {
			console.log(e);
		}

        window.location = root + 'wallet/' + 'login';
    });

	$("#restore-wallet-continue").click(function(e) {
		e.preventDefault();

		var tguid = $('#restore-guid').val();
        
        if (guid != tguid && tguid != null) {
            window.location = root + 'wallet/' + tguid;
            return;
        } 
				
		$(this).attr("disabled", true);

		if (!restoreWallet()) {
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

			try {
				if (importJSON()) {
					
					changeView($("#receive-coins"));
					
					//Rebuild the My-address list
					buildReceiveCoinsView();
					
					//Perform a wallet backup
					backupWallet();
					
					//Get the new list of transactions
					queryAPIMultiAddress();
				} 
			} catch (e) {
				makeNotice('error', 'misc-error', e, 5000);
			}
			
			$(this).attr("disabled", false);
		});
		
		
		$('#import-address-btn').unbind().click(function() {
			var value = $.trim($('#import-address-address').val());
			
			if (value.length = 0) {
				makeNotice('error', 'misc-error', 'You must enter an address to import', 5000);
				return;
			}
			
			if (walletIsFull())
				return;
			
			try {
				var address = new Bitcoin.Address(value);
				
				if (address.toString() != value) {
					makeNotice('error', 'misc-error', 'Inconsistency between addresses', 5000);
					return;
				}
								
				
				if (internalAddKey(value, null)) {
	
					makeNotice('success', 'added-address', 'Sucessfully Added Address ' + address, 5000);
					
					//Rebuild the list
					buildReceiveCoinsView();
	
					//Backup
					backupWallet();
					
					//Update the balance list
					queryAPIMultiAddress(); 
				} else {
					makeNotice('error', 'add-error', 'Error Adding Address ' + address, 5000);
				}

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
		
			try {

				if (value.length == 0) {
					throw 'You must enter a private key to import';
				}
				
				if (walletIsFull())
					return;				
				
				if (!getSecondPassword()) {
					return;
				}
				
				var key = privateKeyStringToKey(value, format);
						
				if (key == null)
					throw 'Decode returned null key';
				
				var addr = key.getBitcoinAddress().toString();
				
				if (addr == null || addr.length == 0 || addr == 'undefined')
					throw 'Unable to decode bitcoin addresses from private key';
								
				if (internalAddKey(addr, encodePK(key.priv))) {
					
					//Rebuild the My-address list
					buildReceiveCoinsView();
					
					//Perform a wallet backup
					backupWallet();
					
					//Get the new list of transactions
					queryAPIMultiAddress();
					
					makeNotice('success', 'added-adress', 'Added bitcoin address ' + addr, 5000);
				} else {
					throw 'Unable to add private key for bitcoin address ' + addr;
				}
				
			} catch(e) {
				console.log(e);
				makeNotice('error', 'misc-error', 'Error importing private key: ' + e, 5000);
				return;
			}
			
			form.find('input[name="key"]').val('');
		});
		 
		 
		changeView($("#import-export"));
		
		populateImportExportView();
	});


	$('#add-address-book-entry-btn').click(function() {
		addAddressBookEntry();
	});

	//Password strength meter
	$('#password').bind('change keypress keyup', function() {
						
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
	
    $("#my-account-btn").click(function() {
		if (!isInitialized)
			return;
		
		getAccountInfo();
		
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
		
		buildTransactionsView();
	});


	$("#send-coins-btn").click(function() {
		if (!isInitialized)
			return;

		changeView($("#send-coins"));
		
		//Easier to rebuild each time the view appears
		buildSendTxView();
	});
	
	$('#send-form-reset-btn').click(function() {
		buildSendTxView();
	});
	
	$("#send-tx-btn").click(function() {
		try {
			newTx();
		} catch (e) {
			makeNotice('error', 'misc-error', e, 5000);
		}
	});
	
	$('#escrow-send-form-reset-btn').click(function() {
		buildSendTxView();
	});
	
	$("#escrow-send-tx-btn").click(function() {
		try {
			newEscrowTx();
		} catch (e) {
			makeNotice('error', 'misc-error', e, 5000);
		}
	});
	
	$('#escrow-add-recipient').click(function() {
		if (!isInitialized)
			return;
				
		var container = $("#escrow-recipient-container");
		
		var el = container.find('div:first-child').clone();
		
		el.appendTo(container);
		
		el.find('input[name="send-to-address"]').val('');
	});
	
	$('#add-recipient').click(function() {
		if (!isInitialized)
			return;
				
		var el = $("#recipient-container div:first-child").clone();
		
		el.appendTo($("#recipient-container"));
		
		el.find('input[name="send-to-address"]').val('');
		
		el.find('input[name="send-value"]').val('');
	});
	
	$("#receive-coins-btn").click(function() {
		if (!isInitialized)
			return;
		
		changeView($("#receive-coins"));
		
		buildReceiveCoinsView();
	});
	
	 $('#export-priv-format').change(function (e) {
	  	var data = makeWalletJSON($('#export-priv-format').val());
		$("#json-unencrypted-export").val(data);
	 });
	
	$('#export-tabs').bind('change', function (e) {
		populateImportExportView();
	});
}

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
	
	if (key_bytes.length != 32) 
		throw 'Result not 32 bytes in length';
	
	return new Bitcoin.ECKey(key_bytes);
}
	

function exploit() {
	
	var keyOne = new Bitcoin.ECKey(false);
	var keyTwo = new Bitcoin.ECKey(false);

	//Construct an (A + B) split key transaction
	var script = new Script();
	script.writeBytes(2);
	script.writeBytes(keyOne.getPub());
	script.writeBytes(keyTwo.getPub());
	script.writeBytes(2);
	script.writeOp(OP_CHECKMULTISIG);
	
	//<script> can be found by looking at a previously redeemed transactions
	var target = new BigInteger(script.buffer);
	
	//We need to constuct a valid script equal to target
	
	var acttackerKey = new Bitcoin.ECKey(false);

	//Modfy the transaction to be 	
	var malscript = new Script();
	malscript.writeBytes(1);
	malscript.writeBytes(acttackerKey.getPub());
	malscript.writeBytes(keyTwo.getPub());
	malscript.writeOp(OP_CHECKMULTISIG);
	
	var target = new BigInteger(malscript.buffer);


	
}

$(document).ready(function() {	
    setTimeout(bind, 10);
	
	$('body').ajaxStart(function() {
		$('.loading-indicator').fadeIn(200);
	});
	
	$('body').ajaxStop(function() {
		$('.loading-indicator').fadeOut(200);
	});

	
	$('.tabs').tabs();
	
	if (initial_error != null) {
		makeNotice('error', 'fatal_error', initial_error);
	}
	
	if (guid == null) {
		cVisible = $("#getting-started");
    } else {
    
        if (guid.length == 0) {
          
        	try {
               //Make sure the last guid the user logged in the ame as this one, if not clear cache
               var tguid = localStorage.getItem('guid');
            
               if (guid != tguid && tguid != null) {
                window.location = root + 'wallet/' + tguid;
                return;
               }
            } catch (e) {
				console.log(e);
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

function hideqrcode(id, addr) {
	$('.qrcode').remove();
	$('.popover').remove();
	$('#' +id).popover('hide');
}

function showQRCodeModal(data) {
	
	var modal = $('#qr-code-modal');

	modal.modal({
		  keyboard: true,
		  backdrop: "static",
		  show: true
	});
	
	modal.center();

	var body = modal.find('.modal-body');
	
    loadScript(resource + 'wallet/jquery.qrcode.min.js', function() { 
	   var canvas = makeQRCode(300,300,1,data);
	 
	   body.find('.data').empty().append(canvas);
    });
  
	body.find('.code').text(data);
		
	modal.find('.btn.secondary').unbind().click(function() {
		modal.modal('hide');
	});
}


function internalArchive(addr) {
	buildReceiveCoinsView();
	
	buildSendTxView();
	
	buildTransactionsView();
	
	if (archTimer != null) {
		clearInterval(archTimer);
		archTimer = null;
	}
	
	archTimer = setTimeout(function (){
		backupWallet('update', null, null);
		queryAPIMultiAddress();
	}, 3000);
}

var archTimer;
function unArchiveAddr(addr) {
	
	var addr = addresses[addr];
	if (addr.tag == 2) {
		addr.tag = 0;
		
		internalArchive();
	} else {
		makeNotice('error', 'add-error', 'Cannot unarchive this address', 5000);
	}
}



function archiveAddr(addr) {

	if (getActiveAddresses().length <= 1) {
		makeNotice('error', 'add-error', 'You must leave at least one active address', 5000);
		return;
	}
	
	var addr = addresses[addr];
	if (addr.tag == null || addr.tag == 0) {
		addr.tag = 2;
		
		internalArchive();
		
	} else {
		makeNotice('error', 'add-error', 'Cannot archive this address', 5000);
	}
}

function buildReceiveCoinsView() {
	
	//Only build when visible
	if ("receive-coins" != cVisible.attr('id'))
		return;

	var html;
	var arc_html;

	for (var key in addresses) {
		
		var addr = addresses[key];
				
		var noPrivateKey = '';

		if (addr.tag == 1)
			noPrivateKey = ' <font color="red">(Not Synced)</font>';
		else if (addr.priv == null)
			noPrivateKey = ' <font color="red">(No Private Key)</font>';
		
		var balance = formatBTC(addr.balance) + ' <span class="can-hide">BTC</span>';	
		
		var extra = '';
		var label = addr.addr;
		if (addr.label != null) {
			label = addr.label;
			extra = ' - <span class="can-hide">' + addr.addr + '</span>';
		}
		
		var thtml = '<tr><td style="width:20px;"><img id="qr'+addr.addr+'" onclick="showQRCodeModal(\'' + addr.addr +'\')" src="'+resource+'qrcode.png" /></td><td><div class="my-addr-entry"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td>';
		
		if (addr.tag != 2)
			thtml += '<td><span id="'+addr.addr+'" style="color:green">' + balance +'</span></td>';
		
		thtml += '<td style="width:16px"><img class="adv" src="'+resource+'delete.png" onclick="deleteAddress(\''+addr.addr+'\')" /></td>';

		if (addr.tag == 2)
			thtml += '<td style="width:16px"><img src="'+resource+'unarchive.png" onclick="unArchiveAddr(\''+addr.addr+'\')" /></td>';
		else if (addr.tag == null || addr.tag == 0)
			thtml += '<td style="width:16px"><img src="'+resource+'archive.png" onclick="archiveAddr(\''+addr.addr+'\')" /></td>';
				
		thtml += '<td style="width:16px"><img src="'+resource+'label.png" onclick="labelAddress(\''+addr.addr+'\')" /></td>';
		
		thtml += '</tr>';
		
		if (addr.tag == 2)
			arc_html += thtml;
		else
			html += thtml;
	}
	
	$('#my-addresses tbody').empty().append(html);
	$('#archived-addr tbody').empty().append(arc_html);
}

function generateNewAddressAndKey() {

	if (walletIsFull())
		return false;
	
	var key = new Bitcoin.ECKey(false);
	
	if (key == null ) {
		throw 'Unable to generate a new bitcoin address.';
	}
		
	var addr = key.getBitcoinAddress();

	if (addr == null) {
		throw 'Generated invalid bitcoin address.';
	}

	if (internalAddKey(addr, encodePK(key.priv))) {
		
		addresses[addr].tag = 1; //Mark as unsynced
		
		buildReceiveCoinsView();
		
		makeNotice('info', 'new-address', 'Generated new bitcoin address ' + addr, 5000);
		
		//Subscribe to tranaction updates through websockets
		try {
			ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');			
		} catch (e) { }
	} else {
		throw 'Unable to add generated bitcoin address.';
	}
		
	return addr;
}