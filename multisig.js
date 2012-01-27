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