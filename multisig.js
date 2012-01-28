var OUTTYPE_STANDARD = 0; //Standard pay to pub key hash
var OUTTYPE_P2SH = 1; //Pay to Script Hash
var OUTTYPE_MULTISIG = 3; //Multi Sig

Script.createMultiSigOutputScript = function (m, pubkeys)
{
	var script = new Script();
	
	script.writeBytes(parseInt(m));
	
	for (var i = 0; i < pubkeys.length; ++i) {
		var pubkey = pubkeys[i];
		script.writeBytes(pubkey);
	}
	
	script.writeBytes(pubkeys.length);
	script.writeOp(OP_CHECKMULTISIG);

	return script;
};