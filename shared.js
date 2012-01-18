var satoshi = parseInt(100000000); //One satoshi
var showInvBtn = false;
var show_adv = false;
var adv_rule;

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


	try {
		for (var i = 0; i < tx.inputs.length; i++) {		
			tx.inputs[i].prev_out.addr = new Bitcoin.Address(Crypto.util.hexToBytes(tx.inputs[i].prev_out.hash));
		}
		
		for (var i = 0; i < tx.out.length; i++) {		
			tx.out[i].addr = new Bitcoin.Address(Crypto.util.hexToBytes(tx.out[i].hash));
		}
	} catch(e) {
		
	}
	
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

function formatMoney(x) {
	var str;
	
	if (!symbol.symbolAppearsAfter) {
		str = symbol.symbol + ' ' + toFixed(x / symbol.conversion, 2);
	} else {
		str = toFixed(x / symbol.conversion, 2) + ' ' + symbol.symbol;
	}
	
	return str;
}

Transaction.prototype.getHTML = function(myAddresses) {    

    var result = this.result;
    
	var html = '<div id="tx-'+this.txIndex+'"><table class="zebra-striped" cellpadding="0" cellspacing="0" style="padding:0px;float:left;margin:0px;margin-top:10px;"><tr><th colspan="4" style="font-weight:normal"><div class="hash-link">';
	
	if (result != null) {
		if (result > 0) {
			html += '<span class="label success">Payment Received</span>';
		} else if (result < 0) {
			html += '<span class="label important">Payment Sent</span>';
		}	else if (result == 0) {
			html += '<span class="label">Funds Moved</span>';
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
			 
			//total_fees += input.prevOutputValue;
			
			if (myAddresses != null && myAddresses[input.prev_out.addr] != null) {
				html += '<li>'+input.prev_out.addr+'</li>';
			} else if (input.prev_out.hash == null || input.prev_out.hash.length == 0) {
				html += '<li><b>No Input (Newly Generated Coins)</b></li>';
			} else {
				html += '<li><a target="new" href="'+root+'address/' + input.prev_out.hash +'">'+input.prev_out.addr+'</a></li>';
			}
		}
    } else {
		html += '<li>No inputs, transaction probably sent from self.</li>';
    }


	html += '</ul></td><td class="can-hide" style="padding:0px;width:48px;min-height:48px;vertical-align:middle;">';
	
    if (result == null) {
    	result = 0;
		for (var i = 0; i < this.out.length; i++) {
			result += this.out[i].value;
		}
    }
    
	var button_class;
	if (result >= 0) {
		button_class = 'btn success c';
		html += '<img src="'+resource+'arrow_right_green.png" />';
	} else if (result < 0) {
		button_class = 'btn error c';
		html += '<img src="'+resource+'arrow_right_red.png" />';
	} else  {
		button_class = 'btn c';
		html += '&nbsp;';
	}
	
	var tclass = '';
	if (result >= 0)
		tclass = 'class="can-hide"';
		
	html += '</td><td width="30%" '+tclass+' style="vertical-align:middle;"><ul class="txul">';
	
	for (var i = 0; i < this.out.length; i++) {
		output = this.out[i];
						
		//total_fees -= output.value;

		if (myAddresses != null && myAddresses[output.addr] != null)
			html += '<li>'+output.addr+'</li>';
		else 
			html += '<li><a target="new" href="'+root+'address/'+output.hash+'">'+output.addr+'</a></li>';
	}
				
	html += '</ul></td><td width="15%" style="vertical-align:middle;"><ul class="txul">';
	
	for (var i = 0; i < this.out.length; i++) {
		output = this.out[i];
								
		html += '<li class="can-hide c">' + formatMoney(output.value) +'</li>';
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
	
	html += '<button class="'+button_class+'" onclick="toggleSymbol()">' + formatMoney(result) + '</button>';
	
	if (showInvBtn && !offline && this.confirmations == 0) {
		html += '<button class="btn" style="padding-top:4px;padding-bottom:4px;padding-left:7px;padding-right:7px;" onclick="showInventoryModal(\''+this.hash+'\')"><img src="'+resource+'network.png" /></button> ';
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
				window.location='https://blockchain.info/wallet/'+guid+'#newaddr|${address}';
			}
			
			return;
		} 
	}
	
	if (addr == null) {
		window.location='https://blockchain.info/wallet';
	} else {
		window.location='https://blockchain.info/wallet/new#newaddr|${address}';
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

function toggleSymbol() {
	if (symbol === symbol_btc) {
		symbol = symbol_local;
		
		$('.c').each(function(index) {										
			$(this).text(formatMoney($.trim($(this).text().replace(',','').replace(symbol_btc.symbol, '')) * symbol_btc.conversion));
		});
		
		$.cookie('local', 'true');
	} else { 	
		symbol = symbol_btc;

		$('.c').each(function(index) {
			$(this).text(formatMoney($.trim($(this).text().replace(',','').replace(symbol_local.symbol, '')) * symbol_local.conversion));
		});
	
		console.log('set false');
		
		$.cookie('local', 'false');
	}
}

$(document).ready(function() {	
	
	try {
		$('#currencies').change(function() {	
			$(this).parent().submit();
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

jQuery.cookie = function (key, value, options) {

    // key and at least value given, set cookie...
    if (arguments.length > 1 && String(value) !== "[object Object]") {
        options = jQuery.extend({}, options);

        if (value === null || value === undefined) {
            options.expires = -1;
        }

        if (typeof options.expires === 'number') {
            var days = options.expires, t = options.expires = new Date();
            t.setDate(t.getDate() + days);
        }

        value = String(value);

        return (document.cookie = [
            encodeURIComponent(key), '=',
            options.raw ? value : encodeURIComponent(value),
            options.expires ? '; expires=' + options.expires.toUTCString() : '', // use expires attribute, max-age is not supported by IE
            options.path ? '; path=' + options.path : '',
            options.domain ? '; domain=' + options.domain : '',
            options.secure ? '; secure' : ''
        ].join(''));
    }

    // key and possibly options given, get cookie...
    options = value || {};
    var result, decode = options.raw ? function (s) { return s; } : decodeURIComponent;
    return (result = new RegExp('(?:^|; )' + encodeURIComponent(key) + '=([^;]*)').exec(document.cookie)) ? decode(result[1]) : null;
};
