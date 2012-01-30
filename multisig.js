Bitcoin.Transaction.prototype.addOutputScript = function (script, value) {
	if (arguments[0] instanceof Bitcoin.TransactionOut) {
		this.outs.push(arguments[0]);
	} else {
		if (value instanceof BigInteger) {
			value = value.toByteArrayUnsigned().reverse();
			while (value.length < 8) value.push(0);
		} else if (Bitcoin.Util.isArray(value)) {
			// Nothing to do
		}

		this.outs.push(new Bitcoin.TransactionOut({
			value: value,
			script: script
		}));
	}
}; 

Bitcoin.Script.prototype.getOutType = function () {

	if (this.chunks.length > 3 && this.chunks[this.chunks.length-1] == Bitcoin.Opcode.map.OP_CHECKMULTISIG) {
			// Transfer to Bitcoin address
			return 'Multisig';
	} else if (this.chunks.length == 5 &&
		this.chunks[0] == Bitcoin.Opcode.map.OP_DUP &&
		this.chunks[1] == Bitcoin.Opcode.map.OP_HASH160 &&
		this.chunks[3] == Bitcoin.Opcode.map.OP_EQUALVERIFY &&
		this.chunks[4] == Bitcoin.Opcode.map.OP_CHECKSIG) {
		console.log('Address');

		// Transfer to Bitcoin address
		return 'Address';
	} else if (this.chunks.length == 2 &&
			   this.chunks[1] == Bitcoin.Opcode.map.OP_CHECKSIG) {
		// Transfer to IP address
		return 'Pubkey';
	} else {
		return 'Strange';
	}   

}

//returns m
Bitcoin.Script.prototype.extractAddresses = function (addresses)
{	
	switch (this.getOutType()) {
	case 'Address':
		addresses.push(new Bitcoin.Address(this.chunks[2]));
		return 1;
	case 'Pubkey':
		addresses.push(new Bitcoin.Address(Bitcoin.Util.sha256ripe160(this.chunks[0])));
		return 1;
	case 'Multisig':
		for (var i = 1; i < this.chunks.length-2; ++i) {
			addresses.push(new Bitcoin.Address(Bitcoin.Util.sha256ripe160(this.chunks[i])));
		}
		return this.chunks[0];
	default:
		throw new Error("Encountered non-standard scriptPubKey");
	}
};

//Create an m-of-n script
Bitcoin.Script.createMultiSigOutputScript = function (m, pubkeys)
{
	var script = new Bitcoin.Script();
	
	if (m == 1) 
		script.writeOp([Bitcoin.Opcode.map.OP_1]);
	else if (m == 2) 
		script.writeOp([Bitcoin.Opcode.map.OP_2]);
	else if (m == 3) 
		script.writeOp([Bitcoin.Opcode.map.OP_3]);
	
	for (var i = 0; i < pubkeys.length; ++i) {
		var pubkey = pubkeys[i];
		script.writeBytes(pubkey);
	}
	
	if (pubkeys.length == 1) 
		script.writeOp([Bitcoin.Opcode.map.OP_1]);
	else if (pubkeys.length == 2) 
		script.writeOp([Bitcoin.Opcode.map.OP_2]);
	else if (pubkeys.length == 3) 
		script.writeOp([Bitcoin.Opcode.map.OP_3]);
	
	script.writeOp(Bitcoin.Opcode.map.OP_CHECKMULTISIG);

	return script;
}