var satoshi = parseInt(100000000); //One satoshi
var showInvBtn = false;
var show_adv = false;
var adv_rule;
var our_address = '1A8JiWcwvpY7tAopUkSnGuEYHmzGYfZPiq'; //Address for fees and what not
var open_pk;

function Transaction () { };
function Block () { };

function BlockFromJSON(json) {
	var block = new Block();

	block.hash = json.hash;
	block.time = json.time;
	block.nTx = json.n_tx;
	block.blockIndex = json.block_index;
	block.height = json.height;
	block.txIndex = json.txIndexes;
	
	return block;
}

function toFixed(x, n) {
 if(!parseInt(n))
	 var n=0;
 
 if(!parseFloat(x))
	 return 0;
 
  return Math.round(x*Math.pow(10,n))/Math.pow(10,n);
}

function TransactionFromJSON(json) {
	
	var tx = new Transaction();
	
	tx.hash = json.hash;
	tx.size = json.size;
	tx.txIndex = json.tx_index;
	tx.time = json.time;
	tx.inputs = json.inputs;
	tx.out = json.out;
	tx.blockIndex = json.block_index;
	tx.result = json.result;
	tx.blockHeight = json.block_height;
	tx.balance = json.balance;

	return tx;
}

Transaction.prototype.setConfirmations = function(n_confirmations) {   
	this.confirmations = n_confirmations;
};

function padStr(i) {
    return (i < 10) ? "0" + i : "" + i;
};

function dateToString(d) {
	  return padStr(d.getFullYear()) + '-' + padStr(1 + d.getMonth()) + '-' + padStr(d.getDate()) + ' ' + padStr(d.getHours()) + ':' + padStr(d.getMinutes()) + ':' + padStr(d.getSeconds());
};

function formatBTC(value) {
		
	if (value == null)
		return '';
	
	var neg = '';
	if (value < 0) {
		value = -value;
		neg = '-';
	}
	
	value = ''+value;
	
	var integerPart = value.length > 8 ? value.substr(0, value.length-8) : '0';
	var decimalPart = value.length > 8 ? value.substr(value.length-8) : value;
	
	if (decimalPart != null) {
		while (decimalPart.length < 8) decimalPart = "0"+decimalPart;
		decimalPart = decimalPart.replace(/0*$/, '');
		while (decimalPart.length < 2) decimalPart += "0";
	}
	
	return neg + integerPart+"."+decimalPart;
}

function formatMoney(x, span) {
	var str;
	
	if (symbol.code != 'BTC') {
		str = symbol.symbol + ' ' + toFixed(x / symbol.conversion, 2);
	} else {
		str = formatBTC(''+x) + ' ' + symbol.symbol;
	}
	
	if (span) {
		str = '<span data-c="'+x+'">'+str+'</span>';
	}
	
	return str;
}

function formatAddr(addr, myAddresses, addresses_book) {
	var myAddr = null;
	if (myAddresses != null)
		myAddr = myAddresses[addr];
	
	if (myAddr != null) {
		if (myAddr.label != null)
			return myAddr.label;
		else
			return addr;
	} else {
		 if (addr == our_address)
			 return 'Blockchain.info';
		 else if (addresses_book != null && addresses_book[addr] != null)
			return '<a target="new" href="'+root+'address/'+addr+'">'+addresses_book[addr]+'</a>';
		 else
			return '<a target="new" href="'+root+'address/'+addr+'">'+addr+'</a>';
	}
}

function formatOutput(output, myAddresses, addresses_book) {
	
	//total_fees -= output.value;
	var str;
	
	if (output.type == 0) {
		str = '<li>';
	} else if (output.type == 1 || output.type == 2 || output.type == 3) {
		str = '<li>(<font color="red">Escrow</font> ' + output.type + ' of ';
	} else {
		str = '<font color="red">Strange</font>';
	}
	
	if (output.addr != null)
		str += formatAddr(output.addr, myAddresses, addresses_book);
	
	if (output.addr2 != null)
		str += ', ' + formatAddr(output.addr2, myAddresses, addresses_book);
	
	if (output.addr3 != null)
		str += ', ' + formatAddr(output.addr3, myAddresses, addresses_book);

	if (output.type == 1 || output.type == 2 || output.type == 3) {
		str += ')';
	}

	str += '</li>';

	return str;
}

function openEscrow(txIndex, escrow_n, priv) {	
	
	if (priv != null) {	
		getSecondPassword(function() {
			open_pk = new Bitcoin.ECKey(decodePK(priv));
			
			window.open(''+root+'escrow/'+txIndex+'/'+escrow_n);
		});
	} else {
		window.open(''+root+'escrow/'+txIndex+'/'+escrow_n);
	}
}

Transaction.prototype.getHTML = function(myAddresses, addresses_book) {    

    var result = this.result;
    
	var html = '<div id="tx-'+this.txIndex+'"><table class="zebra-striped" cellpadding="0" cellspacing="0" style="padding:0px;float:left;margin:0px;margin-top:10px;"><tr><th colspan="4" style="font-weight:normal"><div class="hash-link">';
	
	if (result != null) {
		if (result > 0) {
			html += '<span class="label success">Received</span>';
		} else if (result < 0) {
			html += '<span class="label important">Sent</span>';
		}	else if (result == 0) {
			html += '<span class="label">Moved</span>';
		}
	}
	
	html += ' <a target="new" href="'+root+'tx-index/'+this.txIndex+'/'+this.hash+'">'+this.hash+'</a></div> <span style="float:right"><span class="can-hide"><b>';
				
	if (this.time > 0) {
		var date = new Date(this.time * 1000);
	
		html += dateToString(date);
	}
	
	var tclass = '';
	if (result < 0)
		tclass = 'class="can-hide"';
	
	html += '</b></span></th></tr><tr><td width="55%" '+ tclass +' style="vertical-align:middle;"><ul class="txul">';
   
    if (this.inputs.length > 0) {
		for (var i = 0; i < this.inputs.length; i++) {
			input = this.inputs[i];
			 
			if (input.prev_out == null || input.prev_out.addr == null) {
				html += '<li>No Input (Newly Generated Coins)</li>';
			} else {
				html += formatOutput(input.prev_out, myAddresses, addresses_book);
			}
		}
    } else {
		html += '<li>No inputs, transaction probably sent from self.</li>';
    }

	html += '</ul></td><td class="can-hide" style="padding:4px;width:48px;text-align:center;vertical-align:middle;">';
	
    if (result == null) {
    	result = 0;
		for (var i = 0; i < this.out.length; i++) {
			result += this.out[i].value;
		}
    }
    
	var button_class;
	if (result >= 0) {
		button_class = 'btn success';
		html += '<img src="'+resource+'arrow_right_green.png" />';
	} else if (result < 0) {
		button_class = 'btn error';
		html += '<img src="'+resource+'arrow_right_red.png" />';
	} else  {
		button_class = 'btn';
		html += '&nbsp;';
	}
	
	var tclass = '';
	if (result >= 0)
		tclass = 'class="can-hide"';
		
	html += '</td><td width="30%" '+tclass+' style="vertical-align:middle;"><ul class="txul">';
	
	var escrow_n = null;
	var escrow_addr = null;
	for (var i = 0; i < this.out.length; i++) {		
		var out = this.out[i];
		if (out.type > 0 && !out.spent && escrow_n == null) {
			var myAddr = myAddresses[out.addr];
			
			if (myAddr == null)
				myAddr = myAddresses[out.addr2];

			if (myAddr == null)
				myAddr = myAddresses[out.addr3];

			if (myAddr != null && myAddr.priv != null) {
				escrow_n = i;
				escrow_addr = myAddr;
			}
		}
		
		html += formatOutput(out, myAddresses, addresses_book);
	}
				
	html += '</ul></td><td width="15%" style="vertical-align:middle;"><ul class="txul">';
	
	for (var i = 0; i < this.out.length; i++) {
		output = this.out[i];
		html += '<li class="can-hide">' + formatMoney(output.value, true) +'</li>';
	}
	
	html += '</ul></td></tr></table><span style="float:right;padding-bottom:30px;clear:both;">';
	
	if (this.ip != null && this.ip.length > 0) {
		html += '<span class="adv"><i>Received from: <a href="'+root+'ip-address/'+this.ip+'">'+this.ip+'</a> <a href="http://www.dnsstuff.com/tools/ipall/?tool_id=67&ip='+this.ip+'" target="new">(whois)</a> - </span>';	
	}	
		
	if (this.confirmations == null) {
		html += '<button class="confm" style="display:none"></button> ';
	} else if (this.confirmations == 0) {
		html += '<button class="btn error confm">Unconfirmed Transaction!</button> ';
	} else if (this.confirmations > 0) {
		html += '<button class="btn primary confm">' + this.confirmations + ' Confirmations</button> ';
	} 
	
	html += '<button class="'+button_class+'" onclick="toggleSymbol()">' + formatMoney(result, true) + '</button>';
	
	//Only show for My Wallet
	if (myAddresses != null && !offline) {
		if (escrow_n != null && this.confirmations != 0) {
			
			var priv = '';
			if (escrow_addr != null)
				priv = escrow_addr.priv;
			
			html += '<button class="btn info" onclick="openEscrow('+this.txIndex+', '+escrow_n+', \''+priv+'\')">Redeem / Release</button>';
		}
		
		if (this.confirmations == 0) {
			html += '<button class="btn" style="padding-top:4px;padding-bottom:4px;padding-left:7px;padding-right:7px;" onclick="showInventoryModal(\''+this.hash+'\')"><img src="'+resource+'network.png" /></button> ';
		}
	}
	
	html += '</span></div>';
	
	return html;
};

function goToWallet(addr) {
	
	if (localStorage) {
		var guid = localStorage.getItem('guid');
			
		if (guid != null) {
			if (addr == null) {
				window.location='https://blockchain.info/wallet/'+guid;
			} else {
				window.location='https://blockchain.info/wallet/'+guid+'#newaddr|'+addr;
			}
			
			return;
		} 
	}
	
	if (addr == null) {
		window.location='https://blockchain.info/wallet';
	} else {
		window.location='https://blockchain.info/wallet/new#newaddr|'+addr;
	}
}

function toggleAdv() {
	setAdv(!show_adv);
}

function setAdv(isOn) {
	show_adv = isOn;

	if (adv_rule != null) {
		adv_rule.remove();
	}
	
	if (show_adv) {	
		adv_rule = $("<style type='text/css'> .adv{display: inherit;} .basic{display: none;} </style>").appendTo("head");
		
		$('a[class=show_adv]').text('Show Basic');
	} else {
		adv_rule = $("<style type='text/css'> .adv{display: none;} .basic{display: inherit;} </style>").appendTo("head");
		
		$('a[class=show_adv]').text('Show Advanced');
	}
}

function selectOption(select_id, option_val) {
    $('#'+select_id+' option:selected').removeAttr('selected');
    $('#'+select_id+' option[value='+option_val+']').attr('selected','selected');       
}

function toggleSymbol() {
	if (symbol === symbol_btc) {
		symbol = symbol_local;
		SetCookie('local', 'true');
	} else { 	
		symbol = symbol_btc;
		SetCookie('local', 'false');
	}
	
	selectOption('currencies', symbol.code);
	    
	$('span[data-c]').each(function(index) {
		$(this).text(formatMoney($(this).attr('data-c')));
	});
}

$(document).ready(function() {	
	
	try {
		$('#currencies').change(function() {
			var val = $(this).val();
						
			if (val != symbol.symbol) {
				
				if (val == symbol_local.code) {
					toggleSymbol();
				} else if (val == symbol_btc.code) {
					toggleSymbol();
				} else {
					$(this).parent().submit();
				}
			}
		});
		
		$('.cb').click(function() {	
			toggleSymbol();
		});

		$('a[class=show_adv]').click(function() {	
			toggleAdv();
		});

		setAdv(show_adv);
	} catch (e) {}
});


function SetCookie() {
if(arguments.length < 2) { return; }
var n = arguments[0];
var v = arguments[1];
var d = 0;
if(arguments.length > 2) { d = parseInt(arguments[2]); }
var exp = '';
if(d > 0) {
	var now = new Date();
	then = now.getTime() + (d * 24 * 60 * 60 * 1000);
	now.setTime(then);
	exp = '; expires=' + now.toGMTString();
	}
document.cookie = n + "=" + escape(String(v)) + '; path=/' + exp;
}