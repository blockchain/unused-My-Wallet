MyWallet
===========

Javascript Model for blockchain wallet.

Documentation
===========

    /*
     * @param {string} encrypted wallet payload
     */
    MyWallet.setEncryptedWalletData(data);

    /*
     * @param {string} bitcoin address
     * @param {string} label name
     */
    MyWallet.setLabel(address, label);

    /*
     * @param {Bitcoin.ECKey} spendKey Spend Private Key
     * @param {Object} url parameters
     * @param {function} success callback function
     * @param {function} error callback function 
     */
    MyWallet.securePost(data);

    /*
     * @param {string} inputed password
     * @returns {boolean} 
     */
    MyWallet.isCorrectMainPassword(_password);

    /*
     * @param {number} number of iterations for pbkdf2 encryption
     * @param {function} success callback function
     */
    MyWallet.setPbkdf2Iterations(pbkdf2_iterations, success);

    /*
     * @param {boolean} enable or not 
     * @param {string} password
     * @param {function} success callback function
     */
    MyWallet.setDoubleEncryption(value, tpassword, success);

    /*
     * @param {string} bitcoin address
     */
    MyWallet.unArchiveAddr(addr);

    /*
     * @param {string} bitcoin address
     */
    MyWallet.archiveAddr(addr);

    /*
     * @param {Bitcoin.ECKey} Bitcoin ECKey
     * @param {Object} dictionary of options the following possible keys {compressed, app_name, app_version, created_time}
     * @returns {Boolean} success or not
     */
    MyWallet.addPrivateKey(key, opts);

    /*
     * @returns {Bitcoin.ECKey}
     * @returns {Bitcoin.ECKey}
     */
    MyWallet.generateNewKey();

    /*
     * @param {function} success callback function
     * @param {function} error callback function
     */
    MyWallet.get_history(success, error);

    /*
     * @param {string} bitcoin address
     */
    MyWallet.deleteAddressBook(addr);

    /*
     * @returns {Array}
     */
    MyWallet.getAllAddresses();


    /*
     * @returns {string}
     */
    MyWallet.getPreferredAddress();

    /*
     * @param {function} success callback function with scanned data
     * @param {function} error callback function
     */
    MyWallet.scanQRCode(success, error);

    /*
     * @returns {Array}
     */
    MyWallet.getAllAddresses();

    /*
     * @returns {Array}
     */
    MyWallet.getArchivedAddresses();

    /*
     * @returns {Object}
     */
    MyWallet.getLatestBlock();

    /*
     * Delete note associate with given transaction and backs up wallet with server
     * @param {string} tx hash
     */
    MyWallet.deleteNote(tx_hash);

    /*
     * @param {string} bitcoin address to send to 
     * @param {string} bitcoin amount
     */
    MyWallet.quickSendNoUI(to, value);

    /*
     * @param {string} api method to use, use 'update'
     * @param {function} success callback function
     * @param {function} error callback function
     */
    MyWallet.backupWallet(method, successcallback, errorcallback);

    /*
     * @param {string} json string
     * @param {string} password use to encrypt
     */
    MyWallet.encryptWallet(data, password);

    /*
     * @param {string} json string
     * @param {string} password use to encrypt
     * @param {function} success callback function
     * @param {function} error callback function
     */

    MyWallet.decryptWallet(data, password, success, error);

    /*
     * @returns {string}
     */
    MyWallet.getWebWorkerLoadPrefix();

    /*
     * @param {string} json string
     * @param {string} password use to encrypt
     * @param {number} number of iterations for pbkdf2 encryption
     * @param {function} success callback function
     * @param {function} error callback function
     */
    MyWallet.decryptWebWorker(data, password, pbkdf2_iterations, success, _error);

    /*
     * @param {string} json string
     * @param {string} password use to encrypt
     * @param {number} number of iterations for pbkdf2 encryption
     * @param {function} success callback function
     * @param {function} error callback function
     */
    MyWallet.decrypt(data, password, pbkdf2_iterations, success, error);

    /*
     * @param {string} guid
     * @param {boolean} resend_code
     */
    MyWallet.setGUID(guid, resend_code);

    /*
     * @param {string} encrypted Private Key
     * @returns {string} decrypted Private Key
     */
    MyWallet.decryptPK(priv);

    /*
     * @param {string} Private Key
     * @returns {Bitcoin.Buffer} decoded Private Key
     */
    MyWallet.decodePK(priv);

    /*
     * @param {string} bitcoin address
     * @param {string} message
     * @returns {string} message signature
     */
    MyWallet.signmessage(address, message);

    /*
     * @param {string} bitcoin address
     * @returns {boolean} whethere input matches second password
     */
    MyWallet.validateSecondPassword(input);

    /*
     * @param {string} new password
     */
    MyWallet.setMainPassword(new_password);

    /*
     * @param {string} key with format of second parameter
     * @param {string} either 'base58', 'base64', 'hex', 'mini', 'sipa', 'compsipa' 
     * @returns {Bitcoin.ECKey}
     */
    MyWallet.privateKeyStringToKey(value, format);
