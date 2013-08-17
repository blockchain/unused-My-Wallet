var satoshi = 100000000; //One satoshi
var show_adv = false;
var adv_rule;
var symbol_btc = {code : "BTC", symbol : "BTC", name : "Bitcoin",  conversion : satoshi, symbolAppearsAfter : true, local : false}; //Default BTC Currency Symbol object
var symbol_local; //Users local currency object
var symbol = symbol_btc; //Active currency object
var root = '/';
var resource = '/Resources/';
var war_checksum;
var min = true; //whether to load minified scripts
var isExtension = false;
var APP_VERSION = '1.0'; //Need some way to set this dynamically
var APP_NAME = 'javascript_web';
var IMPORTED_APP_NAME = 'external'; //Need some way to set this dynamically
var IMPORTED_APP_VERSION = '0';

function stripHTML(input) {
    return $.trim($('<div>' + input.replace(/(<([^>]+)>)/ig, "") + '</div>').text());
}

function setLocalSymbol(new_symbol) {
    if (!new_symbol) return;

    if (symbol === symbol_local) {
        symbol_local = new_symbol;
        symbol = symbol_local;
        calcMoney();
    } else {
        symbol_local = new_symbol;
    }
}

function setBTCSymbol(new_symbol) {
    if (!new_symbol) return;

    if (symbol === symbol_btc) {
        symbol_btc = new_symbol;
        symbol = symbol_btc;
        calcMoney();
    } else {
        symbol_btc = new_symbol;
    }
}

//Assumes 10px margin (modals)
$.fn.center = function () {
    scrollTo(0, 0);
    this.css("top", Math.max(($(window).height() / 2) - (this.height() / 2), 0) + "px");
    this.css("left", Math.max(($(window).width() / 2) - (this.width() / 2), 0) + "px");
    return this;
};

//Ignore Console
if (!window.console) {
    var names = ["log", "debug", "info", "warn", "error", "assert", "dir", "dirxml",
        "group", "groupEnd", "time", "timeEnd", "count", "trace", "profile", "profileEnd"];

    window.console = {};
    for (var i = 0; i < names.length; ++i) {
        window.console[names[i]] = function() {};
    }
}

var ws;
function webSocketConnect(success) {
    try {
        var ii = 0;
        function reallyConnect(url) {
            try {
                if (ii % 2 == 0)
                    var url = "wss://ws.blockchain.info/inv";
                else
                    var url = "ws://ws.blockchain.info:8335/inv";

                ++ii;

                console.log('Connect ' + url);

                ws = new WebSocket(url);

                if (!ws) {
                    return;
                }

                if (success)
                    success(ws);
            } catch (e) {
                console.log(e);
            }
        }

        //Updates time last block was received and check for websocket connectivity
        function reconnectTimer () {
            if (!ws || ws.readyState == WebSocket.CLOSED) {
                reallyConnect();
            }
        }

        if (window.WebSocket) {
            reallyConnect();

            setInterval(reconnectTimer, 10000);
        }
    } catch (e) {
        console.log(e);
    }
}

function BlockFromJSON(json) {
    return {
        hash : json.hash,
        time : json.time,
        blockIndex : json.blockIndex,
        height : json.height,
        txIndex : json.txIndexes,
        totalBTCSent : json.totalBTCSent,
        foundBy : json.foundBy,
        size : json.size
    };
}

function TransactionFromJSON(json) {
    return {
        hash : json.hash,
        size : json.size,
        txIndex : json.tx_index,
        time : json.time,
        inputs : json.inputs,
        out : json.out,
        blockIndex : json.block_index,
        result : json.result,
        blockHeight : json.block_height,
        balance : json.balance,
        double_spend : json.double_spend,
        note : json.note,
        setConfirmations : function(n_confirmations) {
            this.confirmations = n_confirmations;
        },
        getHTML : function(myAddresses, addresses_book) {
            var result = this.result;

            var html = '<div id="tx-'+this.txIndex+'" class="txdiv" style="padding-top:10px;">';

            if (this.note) {
                html += '<div class="alert note">'+this.note+'</div>';
            }

            html += '<table class="table table-striped" cellpadding="0" cellspacing="0" style="padding:0px;float:left;margin:0px;"><tr><th colspan="4" align="left"><div class="hash-link"><a target="new" href="'+root+'tx/'+this.hash+'">'+this.hash+'</a></div> <span style="float:right"><span class="can-hide"><b>';

            if (this.time > 0) {
                var date = new Date(this.time * 1000);

                html += dateToString(date);
            }

            var tclass;
            if (result < 0)
                tclass = 'class="txtd hidden-phone"';
            else
                tclass = 'class="txtd"';

            html += '</b></span></th></tr><tr><td width="500px" '+ tclass +'>';

            if (this.inputs.length > 0) {
                for (var i = 0; i < this.inputs.length; i++) {
                    input = this.inputs[i];

                    if (input.prev_out == null || input.prev_out.addr == null) {
                        html += 'No Input (Newly Generated Coins)<br />';
                    } else {
                        html += formatOutput(input.prev_out, myAddresses, addresses_book);
                    }
                }
            } else {
                html += 'No inputs, transaction probably sent from self.<br />';
            }

            html += '</td><td width="48px" class="hidden-phone" style="padding:4px;text-align:center;vertical-align:middle;">';

            if (result == null) {
                result = 0;
                for (var i = 0; i < this.out.length; i++) {
                    result += this.out[i].value;
                }
            }

            var button_class;
            if (result == null || result > 0) {
                button_class = 'btn btn-success cb';
                html += '<img src="'+resource+'arrow_right_green.png" />';
            } else if (result < 0) {
                button_class = 'btn btn-danger cb';
                html += '<img src="'+resource+'arrow_right_red.png" />';
            } else  {
                button_class = 'btn cb';
                html += '&nbsp;';
            }

            if (result >= 0)
                tclass = 'class="txtd hidden-phone"';
            else
                tclass = 'class="txtd"';

            html += '</td><td '+tclass+'>';

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

            html += '</td><td width="140px" style="text-align:right" class="txtd">';

            for (var i = 0; i < this.out.length; i++) {
                output = this.out[i];
                html += '<span class="hidden-phone">' + formatMoney(output.value, true) +'</span><br />';
            }

            html += '</td></tr></table><span style="float:right;padding-bottom:30px;clear:both;">';

            if (this.confirmations == null) {
                html += '<button style="display:none"></button> ';
            } else if (this.confirmations == 0) {
                html += '<button class="btn btn-danger">Unconfirmed Transaction!</button> ';
            } else if (this.confirmations > 0) {
                html += '<button class="btn btn-primary">' + this.confirmations + ' Confirmations</button> ';
            }

            html += '<button class="'+button_class+'">' + formatMoney(result, true) + '</button>';

            if (this.double_spend == true) {
                html += '<button class="btn btn-danger">Double Spend</button> ';
            }

            html += '</span></div>';

            return html;
        }
    };
}

Date.prototype.sameDayAs = function(pDate){
    return ((this.getFullYear()==pDate.getFullYear())&&(this.getMonth()==pDate.getMonth())&&(this.getDate()==pDate.getDate()));
};

function padStr(i) {
    return (i < 10) ? "0" + i : "" + i;
}

function dateToString(d) {
    if (d.sameDayAs(new Date())) {
        return 'Today ' + padStr(d.getHours()) + ':' + padStr(d.getMinutes()) + ':' + padStr(d.getSeconds());
    } else {
        return padStr(d.getFullYear()) + '-' + padStr(1 + d.getMonth()) + '-' + padStr(d.getDate()) + ' ' + padStr(d.getHours()) + ':' + padStr(d.getMinutes()) + ':' + padStr(d.getSeconds());
    }
}

function formatSatoshi(value, shift, no_comma) {
    if (!value)
        return '0.00';

    var neg = '';
    if (value < 0) {
        value = -value;
        neg = '-';
    }

    if (!shift) shift = 0;

    value = ''+parseInt(value);

    //TODO Clean this up
    var integerPart = (value.length > (8-shift) ? value.substr(0, value.length-(8-shift)) : '0')

    if (!no_comma) integerPart = integerPart.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");

    var decimalPart = value.length > (8-shift) ? value.substr(value.length-(8-shift)) : value;

    if (decimalPart && decimalPart != 0) {
        while (decimalPart.length < (8-shift)) decimalPart = "0"+decimalPart;
        decimalPart = decimalPart.replace(/0*$/, '');
        while (decimalPart.length < 2) decimalPart += "0";

        return neg + integerPart+"."+decimalPart;
    }

    return neg + integerPart;
}

function convert(x, conversion) {
    return (x / conversion).toFixed(2).toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
}

//Convenience format satoshi as BTC value string
function formatBTC(x) {
    return formatSymbol(x, symbol_btc);
}

//The current 'shift' value - BTC = 1, mBTC = 3, uBTC = 6
function sShift(symbol) {
    return (satoshi / symbol.conversion).toString().length-1;
}

function formatSymbol(x, symbol, html) {
    var str;

    if (symbol !== symbol_btc) {
        str = convert(x, symbol.conversion);
    } else {
        str = formatSatoshi(x, sShift(symbol))
    }

    if (html) str = str.replace(/([1-9]\d*\.\d{2}?)(.*)/, "$1<span style=\"font-size:85%;\">$2</span>");

    if (symbol.symbolAppearsAfter)
        str += ' ' +symbol.symbol;
    else
        str = symbol.symbol + ' ' + str;

    return str;
}

function formatMoney(x, span) {
    var str = formatSymbol(x, symbol);

    if (span) {
        str = '<span data-c="'+x+'">'+str+'</span>';
    }

    return str;
}

function formatOutput(output, myAddresses, addresses_book) {
    function formatOut(addr, out) {
        var myAddr = null;
        if (myAddresses != null)
            myAddr = myAddresses[addr];

        if (myAddr != null) {
            if (myAddr.label != null)
                return myAddr.label;
            else
                return addr;
        } else {
            if (addresses_book && addresses_book[addr])
                return '<a target="new" href="'+root+'address/'+addr+'">'+addresses_book[addr]+'</a>';
            else if (out.addr_tag) {
                var link = '';
                if (out.addr_tag_link)
                    link = ' <a class="external" rel="nofollow" href="'+root + 'r?url='+out.addr_tag_link+'" target="new"></a>';

                return '<a target="new" href="'+root+'address/'+addr+'" class="tag-address">'+addr+'</a> <span class="tag">('+out.addr_tag+link+')</span>';
            } else {
                return '<a target="new" href="'+root+'address/'+addr+'">'+addr+'</a>';
            }
        }
    }

    //total_fees -= output.value;
    var str = '';

    if (output.type == 0) {
    } else if (output.type == 1 || output.type == 2 || output.type == 3) {
        str = '(<font color="red">Escrow</font> ' + output.type + ' of ';
    } else {
        str = '<font color="red">Strange</font> ';
    }

    if (output.addr != null)
        str += formatOut(output.addr, output);

    if (output.addr2 != null)
        str += ', ' + formatOut(output.addr2, output);

    if (output.addr3 != null)
        str += ', ' + formatOut(output.addr3, output);

    if (output.type == 1 || output.type == 2 || output.type == 3) {
        str += ')';
    }

    str += '<br />';

    return str;
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

function calcMoney() {
    $('span[data-c]').each(function(index) {
        $(this).text(formatMoney($(this).data('c')));
    });
}

function toggleSymbol() {

    if (symbol_local && symbol === symbol_btc) {
        symbol = symbol_local;
        SetCookie('local', 'true');
    } else {
        symbol = symbol_btc;
        SetCookie('local', 'false');
    }

    $('#currencies').val(symbol.code);

    calcMoney();
}

var _sounds = {};
function playSound(id) {
    try {
        if (!_sounds[id])
            _sounds[id] = new Audio(resource+id+'.wav');

        _sounds[id].play();
    } catch (e) { }
};

function setupSymbolToggle() {
    $('.cb').unbind().click(function() {
        toggleSymbol();
    });
}

function setupToggle() {
    $('[class=show_adv]').unbind().click(function() {
        toggleAdv();
    });
}

function updateQueryString(key, value, url) {
    if (!url) url = window.location.href;
    var re = new RegExp("([?|&])" + key + "=.*?(&|#|$)(.*)", "gi");

    if (re.test(url)) {
        if (typeof value !== 'undefined' && value !== null)
            return url.replace(re, '$1' + key + "=" + value + '$2$3');
        else {
            return url.replace(re, '$1$3').replace(/(&|\?)$/, '');
        }
    }
    else {
        if (typeof value !== 'undefined' && value !== null) {
            var separator = url.indexOf('?') !== -1 ? '&' : '?',
                hash = url.split('#');
            url = hash[0] + separator + key + '=' + value;
            if (hash[1]) url += '#' + hash[1];
            return url;
        }
        else
            return url;
    }
}

$(document).ready(function() {

    var footer = $('.footer');
    var obj1 = footer.data('symbol-local');
    if (obj1) {
        symbol_local = obj1;
    }

    var obj2 = footer.data('symbol-btc');
    if (obj2) {
        symbol_btc = obj2;
    }

    if (symbol_local && getCookie('local') == 'true') {
        symbol = symbol_local;
    } else {
        symbol = symbol_btc;
    }

    war_checksum = $(document.body).data('war-checksum');

    show_adv = getCookie('show_adv');

    try {
        $('#currencies').change(function() {
            var val = $(this).val();

            if (symbol == null || val != symbol.symbol) {
                if (symbol_local != null && val == symbol_local.code) {
                    toggleSymbol();
                } else if (symbol_btc != null && val == symbol_btc.code) {
                    toggleSymbol();
                } else {
                    document.location.href = updateQueryString('currency', val, document.location.href);
                }
            }
        });

        setupSymbolToggle();

        setupToggle();

        setAdv(show_adv);
    } catch (e) {}
});


/*
 function registerURIHandler() {
 if (navigator && getCookie('protoreg') == null) {
 try {
 navigator.registerProtocolHandler("bitcoin",
 window.location.protocol + '//' + window.location.hostname + "/uri?uri=%s",
 "Blockchain.info");

 SetCookie('protoreg', true);
 } catch(e) {
 console.log(e);
 }
 }
 }*/

function loadScript(src, success, error) {
    src = resource + src + (min ? '.min.js' : '.js') + '?'+war_checksum;

    console.log('Load ' + src);

    if ($('script[src="'+src+'"]').length > 0) {
        success();
        return;
    }

    var error_fired = false;
    var s = document.createElement('script');
    s.type = "text/javascript";
    s.async = true;
    s.src = src;
    try {
        s.addEventListener('error', function(e){ error_fired = true;  if (error) error('Error Loading Script. Are You Offline?'); }, false);
        s.addEventListener('load', function (e) { if (!error_fired) success(); }, false);
    } catch (e) {
        //IE 7 & 8 Will throw an exception here
        setTimeout(function() {
            if (!error_fired) success();
        }, 2000);
    }

    var head = document.getElementsByTagName('head')[0];
    head.appendChild(s);
}

function SetCookie(key, value) {
    document.cookie = key + "=" + encodeURI(value.toString()) + '; path=/; domain=blockchain.info; max-age=' + (60*60*24*365);
}

function getCookie(c_name) {
    if (document.cookie.length > 0) {
        c_start = document.cookie.indexOf(c_name + "=");
        if (c_start != -1) {
            c_start = c_start + c_name.length + 1;
            c_end = document.cookie.indexOf(";", c_start);
            if (c_end == -1) c_end = document.cookie.length;
            return decodeURI(document.cookie.substring(c_start, c_end));
        }
    }
    return "";
}

var MyStore = new function() {
    this.put = function(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch(e) {
            console.log(e);
        }
    }

    this.get = function(key, callback) {
        try {
            callback(localStorage.getItem(key));
        } catch(e) {
            console.log(e);

            callback();
        }
    }

    this.remove = function(key) {
        try {
            localStorage.removeItem(key);
        } catch(e) {
            console.log(e);
        }
    }

    this.clear = function() {
        try {
            localStorage.clear();
        } catch(e) {
            console.log(e);
        }
    }
}