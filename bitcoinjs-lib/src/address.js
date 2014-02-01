Bitcoin.Address = function (bytes, version) {
  if ("string" == typeof bytes) {
    this.fromString(bytes);
    return;
  }
  this.hash = bytes;

  this.version = version || Bitcoin.Address.pubKeyHashVersion;
};

/**
 * Serialize this object as a standard Bitcoin address.
 *
 * Returns the address as a base58-encoded string in the standardized format.
 */
Bitcoin.Address.prototype.toString = function () {
  // Get a copy of the hash
  var hash = this.hash.slice(0);

  // Version
  hash.unshift(this.version);

  var checksum = Crypto.SHA256(Crypto.SHA256(hash, {asBytes: true}), {asBytes: true});

  var bytes = hash.concat(checksum.slice(0,4));

  return Bitcoin.Base58.encode(bytes);
};

Bitcoin.Address.prototype.getHashBase64 = function () {
  return Crypto.util.bytesToBase64(this.hash);
};

/**
 * Parse a Bitcoin address contained in a string.
 */
Bitcoin.Address.prototype.fromString = function (string) {
  var bytes = Bitcoin.Base58.decode(string);

  var hash = bytes.slice(0, 21);

  var checksum = Crypto.SHA256(Crypto.SHA256(hash, {asBytes: true}), {asBytes: true});

  if (checksum[0] != bytes[21] ||
      checksum[1] != bytes[22] ||
      checksum[2] != bytes[23] ||
      checksum[3] != bytes[24]) {
    throw "Checksum validation failed!";
  }

  this.version = hash.shift();
  this.hash = hash;

  if (this.version != Bitcoin.Address.pubKeyHashVersion && this.version != Bitcoin.Address.p2shVersion) {
    throw "Version "+version+" not supported!";
  }
};

Bitcoin.Address.isP2SHAddress = function () {
  return this.version == Bitcoin.Address.p2shVersion;
}

Bitcoin.Address.isPubKeyHashAddress = function () {
  return this.version == Bitcoin.Address.pubKeyHashVersion;
}

Bitcoin.Address.pubKeyHashVersion = 0;
Bitcoin.Address.p2shVersion = 5;
