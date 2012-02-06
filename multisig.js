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
		// Transfer to M-OF-N
		return 'Multisig';
	} else if (this.chunks.length == 5 &&
		this.chunks[0] == Bitcoin.Opcode.map.OP_DUP &&
		this.chunks[1] == Bitcoin.Opcode.map.OP_HASH160 &&
		this.chunks[3] == Bitcoin.Opcode.map.OP_EQUALVERIFY &&
		this.chunks[4] == Bitcoin.Opcode.map.OP_CHECKSIG) {
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
		return this.chunks[0] - Bitcoin.Opcode.map.OP_1 + 1;
	default:
		throw new Error("Encountered non-standard scriptPubKey");
	}
};

//Create an m-of-n script
Bitcoin.Script.createMultiSigOutputScript = function (m, pubkeys)
{
	var script = new Bitcoin.Script();
	
    script.writeOp(Bitcoin.Opcode.map.OP_1 + m - 1);
	
	for (var i = 0; i < pubkeys.length; ++i) {
		var pubkey = pubkeys[i];
		script.writeBytes(pubkey);
	}
	
    script.writeOp(Bitcoin.Opcode.map.OP_1 + pubkeys.length - 1);

	script.writeOp(Bitcoin.Opcode.map.OP_CHECKMULTISIG);

	return script;
}


function readUInt32(buffer) {
	return new BigInteger(buffer.splice(0, 4).reverse()).intValue();
}

function readVarInt(buffer) {
	//Untested - Maybe need to reverse the bytes...
	var byte = buffer.splice(0, 1)[0];
	var bytes;
	
	if (byte < 0xfd) {
		bytes = [byte];
	} else if (byte == 0xfd) {
		bytes = buffer.splice(0, 2);
	} else if (byte == 0xfe) {
		bytes = buffer.splice(0, 4);
	} else {
		bytes = buffer.splice(0, 8);
	}
	
	return new BigInteger(bytes);
}

Bitcoin.Transaction.deserialize = function (buffer)
{
	var tx = new Bitcoin.Transaction();
	
	tx.version = readUInt32(buffer);
		
	var txInCount = readVarInt(buffer).intValue();

	for (var i = 0; i < txInCount; i++) {
			
		var outPointHashBytes = buffer.splice(0,32);
		var outPointHash = Crypto.util.bytesToBase64(outPointHashBytes);
									
		var outPointIndex = readUInt32(buffer);
				
		var scriptLength = readVarInt(buffer).intValue();
		var script = new Bitcoin.Script(buffer.splice(0, scriptLength));
		var sequence = readUInt32(buffer);

		var input = new Bitcoin.TransactionIn({outpoint : {hash: outPointHash, index : outPointIndex}, script: script,  sequence: sequence});

		tx.ins.push(input);
	}
		
	var txOutCount = readVarInt(buffer).intValue();
	for (var i = 0; i < txOutCount; i++) {
		
		var valueBytes = buffer.splice(0, 8);
		var scriptLength = readVarInt(buffer).intValue();
		var script = new Bitcoin.Script(buffer.splice(0, scriptLength));
						
		var out = new Bitcoin.TransactionOut({script : script, value : valueBytes})
		
		tx.outs.push(out);
	}
	
	tx.lock_time = readUInt32(buffer);

	return tx;
};