package piuk.website.admin;


import com.google.bitcoin.core.*;
import piuk.api.ChainManager;
import piuk.api.ChainManager.BlockEventListener;
import piuk.api.ChainManager.TxEventListener;
import piuk.api.InventoryInfo;
import piuk.api.InventoryManager;
import piuk.api.NotificationsManager;
import piuk.beans.BitcoinAddress;
import piuk.beans.BitcoinTx;
import piuk.beans.Hash;
import piuk.common.Operation;
import piuk.common.OperationQueue;
import piuk.common.Pair;
import piuk.db.*;
import piuk.merchant.MyWallet;
import piuk.website.BaseServlet;
import piuk.website.TaintServlet;
import piuk.website.admin.ProcessForwardsOperation.Forwarding;

import java.io.UnsupportedEncodingException;
import java.math.BigInteger;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;

import static piuk.website.TaintServlet.*;

public class ProcessForwardsOperation extends Operation<List<Forwarding>> {
    public static final int RequiredRemovalConfirmations = 6;
    public static final Map<BitcoinAddress, Map<BitcoinAddress, TaintServlet.Taint>> taints = new HashMap<>();
    public static final BigInteger txFee =  BigInteger.valueOf((long) (BitcoinTx.COIN * 0.0001)); //0.0001 BTC
    public static final long sendPartialThreshold =  BitcoinTx.COIN * 5; //5 BTC
    public static final long TwoConfirmationMaxValue =  BitcoinTx.COIN * 20; //200 BTC
    public static final long ZeroConfirmationMaxValue =  BitcoinTx.COIN * 10; //10 BTC
    public static final long ZeroConfirmationRequiredFees =  (long)(BitcoinTx.COIN * 0.0005); //0.0005 BTC
    public static final double RelatedTaintThreshold =  5;

    public static long txFee() {
        return txFee.longValue();
    }

    public static final BlockEventListener blockListener = new BlockEventListener() {
        @Override
        public boolean onBlock(DBBitcoinBlock block) {

            //Process Forwards every 10 minutes on new confirmations
            OperationQueue.shared.addOperation(new ProcessForwardsOperation());

            return false;
        }
    };

    public static final TxEventListener txListener = new TxEventListener() {
        @Override
        public void onTx(DBBitcoinTx tx) {
            try {
                Set<DBBitcoinAddress> addresses = Forwarding.getForwardings().keySet();

                for (DBBitcoinTx.DBOutput output : tx.getDBOut()) {
                    if (output.getAddress() == null)
                        continue;;

                    if (addresses.contains(output.getAddress())) {
                        OperationQueue.shared.addOperation(new ProcessForwardsOperation());
                        break;
                    }
                }
            } catch (SQLException e) {
                e.printStackTrace();
            } catch (AddressFormatException e) {
                e.printStackTrace();
            }
        }
    };

    public ProcessForwardsOperation() {
        super(1);
        setStopOnException(true);
    }

    @Override
    public String getName() {
        return "Process Forwarding";
    }

    public static class Forwarding {
        private static Map<DBBitcoinAddress, Forwarding> _cache;
        public String input_address;
        public String input_priv;
        public String output_address;
        public double taint;
        public double fee_percent;
        public int confirmations;
        public long time;

        public long getTime() {
            return time;
        }

        public String getInput_address() {
            return input_address;
        }

        public ECKey getECKey() throws InvalidKeySpecException, NoSuchAlgorithmException, UnsupportedEncodingException, AddressFormatException {
            return MyWallet.decodeUnencryptedPK(MyWallet.decrypt(input_priv, AdminServlet.ForwardingsEncryptionPassword));
        }

        public long getPending(long totalReceived, long totalSent) {
            long blockchainFee = Math.round((totalReceived / 100d) * fee_percent);

            return totalReceived - totalSent - blockchainFee;
        }

        public String getInput_priv() {
            return input_priv;
        }

        public String getOutput_address() {
            return output_address;
        }

        public double getTaint() {
            return taint;
        }

        public double getFee_percent() {
            return fee_percent;
        }

        public int getConfirmations() {
            return confirmations;
        }

        public Forwarding() {
            this.time = System.currentTimeMillis();
        }

        public static Map<DBBitcoinAddress, Forwarding> getForwardings() throws SQLException, AddressFormatException {
            if (_cache == null) {
                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    getForwardings(conn);
                } finally {
                    BitcoinDatabaseManager.close(conn);
                }
            }

            return _cache;
        }

        public static List<Forwarding> getForwardings( Connection conn ) throws SQLException, AddressFormatException {
            List<Forwarding> data = new ArrayList<>();

            Map<DBBitcoinAddress, Forwarding> forwardingMap = new HashMap<>();

            PreparedStatement stmt = conn.prepareStatement("select input_address, input_priv, output_address, taint, fee_percent, confirmations, time from bitcoin_forwards order by time asc");
            try {
                ResultSet results = stmt.executeQuery();

                while (results.next()) {
                    Forwarding forward = new Forwarding();

                    forward.input_address = results.getString(1);
                    forward.input_priv = results.getString(2);
                    forward.output_address = results.getString(3);
                    forward.taint = results.getDouble(4);
                    forward.fee_percent = results.getDouble(5);
                    forward.confirmations = results.getInt(6);
                    forward.time = results.getLong(7);

                    data.add(forward);
                    forwardingMap.put(new DBBitcoinAddress(forward.input_address), forward);
                }
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }

            _cache = forwardingMap;

            return data;
        }

        @Override
        public String toString() {
            return "Forwarding[" + input_address + " => " + output_address + "]" +
                    ", taint=" + taint +
                    '}';
        }

        public boolean insert(Connection conn) throws SQLException, AddressFormatException {
            {
                PreparedStatement stmt = conn.prepareStatement("select count(*) from bitcoin_forwards where output_address = ? and taint != 100");
                try {
                    stmt.setString(1, output_address);

                    ResultSet results = stmt.executeQuery();

                    if (results.next()) {
                        if (results.getInt(1) >= 1) {
                            throw new SQLException("Tried To Insert (Mixing) Forwarding to an output_address which is already to target of an existing forwarding");
                        }
                    }
                } finally {
                    BitcoinDatabaseManager.close(stmt);
                }
            }

            PreparedStatement stmt = conn.prepareStatement("insert into bitcoin_forwards (input_address, input_priv, output_address, taint, fee_percent, confirmations, time) values (?, ?, ?, ?, ?, ?, ?)");
            try {
                stmt.setString(1, input_address);
                stmt.setString(2, input_priv);
                stmt.setString(3, output_address);
                stmt.setDouble(4, taint);
                stmt.setDouble(5, fee_percent);
                stmt.setInt(6, confirmations);
                stmt.setLong(7, time);

                boolean inserted =  stmt.executeUpdate() == 1;

                if (inserted && _cache != null)
                    _cache.put(new DBBitcoinAddress(input_address), this);

                return inserted;
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }
        }

        public boolean remove(Connection conn) throws SQLException {
           if (BaseServlet.log) System.out.println("Remove forwarding " + input_address);

            PreparedStatement stmt = conn.prepareStatement("insert into bitcoin_forwards_copy (input_address, input_priv, output_address, taint, fee_percent, confirmations, time) values (?, ?, ?, ?, ?, ?, ?)");
            try {
                stmt.setString(1, input_address);
                stmt.setString(2, input_priv);
                stmt.setString(3, output_address);
                stmt.setDouble(4, taint);
                stmt.setDouble(5, fee_percent);
                stmt.setInt(6, confirmations);
                stmt.setLong(7, time);

                if (stmt.executeUpdate() != 1) {
                    return false;
                }
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }

            PreparedStatement delete_stmt = conn.prepareStatement("delete from bitcoin_forwards where input_address = ?");
            try {
                delete_stmt.setString(1, input_address.toString());

                //Remove any cached Taints
                try {
                    if (_cache != null) _cache.remove(new BitcoinAddress(input_address));
                    if (taints != null) taints.remove(new BitcoinAddress(input_address));
                } catch (AddressFormatException e) {
                    e.printStackTrace();
                }

                return delete_stmt.executeUpdate() == 1;
            } finally {
                BitcoinDatabaseManager.close(delete_stmt);
            }
        }
    }

    public static Pair<BitcoinAddress, String> generateNewEncryptedPK() throws InvalidKeySpecException, NoSuchAlgorithmException, UnsupportedEncodingException, AddressFormatException {
        ECKey key = new ECKey();

        byte[] bytes = key.getPrivKeyBytes();

        if (bytes.length != 32)
            throw new InvalidKeySpecException("Invalid Key Size");

        String base58 = Base58.encode(bytes);

        String encrypted = MyWallet.encrypt(base58, AdminServlet.ForwardingsEncryptionPassword);

        if (encrypted == null || encrypted.length() == 0)
            throw new InvalidKeySpecException("Error Encrypting Generate Key");

        String checkDecrypted = MyWallet.decrypt(encrypted, AdminServlet.ForwardingsEncryptionPassword);

        byte[] checkBytes = Base58.decode(checkDecrypted);

        if (!Arrays.equals(checkBytes, bytes))
            throw new InvalidKeySpecException("Inconsistency between encrypted and decrypted addresses");

        return new Pair<>(new BitcoinAddress(key.toAddress(NetworkParameters.prodNet()).toString()), encrypted);
    }

    public static void setupListeners() {
        ChainManager.instance().addBlockListener(blockListener);
        ChainManager.instance().addTxListener(txListener);
    }

    public static void removeListeners() {
        ChainManager.instance().removeBlockListener(blockListener);
        ChainManager.instance().removeTxListener(txListener);
    }

    public static boolean isRunning() {
        return ChainManager.instance().getBlockListeners().contains(blockListener) && ChainManager.instance().getTxListeners().contains(txListener);
    }

    public boolean sendForwarding(Forwarding input, List<ECKey> from, long amount, MyWallet.GetChangeAddress changeAddress) throws Exception {

        final BigInteger originalAmount = BigInteger.valueOf(amount);

        if (originalAmount.compareTo(txFee) <= 0) {
            throw new Exception("amount Less than or equal to txFee");
        }

        List<Pair<BitcoinAddress, BigInteger>> toAddresses = new ArrayList<>();

        BigInteger amountMinusMinersFee = originalAmount.subtract(txFee);

        //If we can't afford the miners fee throw an error
        if (amountMinusMinersFee.compareTo(BigInteger.ZERO) <= 0) {
            throw new Exception("Cannot afford Transaction Fee");
        }

        toAddresses.add(new Pair<>(new BitcoinAddress(input.output_address), amountMinusMinersFee));

        List<Pair<BitcoinAddress, ECKey>> fromList = new ArrayList<>();
        for (ECKey key : from) {
            BitcoinAddress fromAddress = new BitcoinAddress(key.toAddress(NetworkParameters.prodNet()).toString());

            fromList.add(new Pair<>(fromAddress, key));
        }

        if (BaseServlet.log) System.out.println("Send forwarding " + input + " toAddresses " + toAddresses + " fromAddresses " + fromList + " amount " + amount);

        Connection conn = BitcoinDatabaseManager.conn();
        try {
            Transaction tx = MyWallet.sendFrom(conn, fromList, toAddresses, txFee, changeAddress, false);

            return  (tx != null);
        } finally {
            BitcoinDatabaseManager.close(conn);
        }
    }



    //Create A Forwarder to a specific address
    public Pair<BitcoinAddress, BitcoinAddress> createSimpleForwarding(BitcoinAddress toAddress, double taint, int confirmations, double fee_percent) throws Exception {
        Pair<BitcoinAddress, String> input_generated = ProcessForwardsOperation.generateNewEncryptedPK();

        //Create one forwarding which the user needs to fund
        ProcessForwardsOperation.Forwarding first = new ProcessForwardsOperation.Forwarding();

        first.input_address = input_generated.getFirst().toString();
        first.input_priv = input_generated.getSecond();
        first.output_address = toAddress.toString();
        first.taint = taint;
        first.fee_percent = fee_percent;
        first.confirmations = confirmations;

        Connection conn = BitcoinDatabaseManager.conn();
        try {
            if (!first.insert(conn)) {
                throw new SQLException(("Error inserting input_generated forwarding pair"));
            }
        } finally {
            BitcoinDatabaseManager.close(conn);
        }

        return new Pair<>(input_generated.getFirst(), toAddress);
    }

    @Override
    public List<List<Forwarding>> input() throws Exception {

        ArrayList<List<Forwarding> > input = new ArrayList<>();

        Connection conn = BitcoinDatabaseManager.conn();
        try {
            List<Forwarding> forwards = Forwarding.getForwardings(conn);

            input.add(forwards);

            return input;
        } finally {
            BitcoinDatabaseManager.close(conn);
        }
    }

    @Override
    public void process(List<Forwarding> forwards) throws Exception {

        Map<DBBitcoinAddress, Forwarding> forwardingMap = Forwarding.getForwardings();

        DBBitcoinWallet dbwallet = new DBBitcoinWallet();

        for (Forwarding forward : forwards) {
            dbwallet.addAddress(new DBBitcoinAddress(forward.input_address));

            if (forward.taint < 100)
                dbwallet.addAddress(new DBBitcoinAddress(forward.output_address));
        }

        boolean shouldRunJobAgainAfterFinish = false;
        try {
            if (BaseServlet.log)
                System.out.println("Process Forwarding() " + dbwallet.getAddresses());

            int currentHeight = ChainManager.instance().getLatestBlock().getHeight();

            Map<Integer, Integer> txToBlockHeight = null;
            {
                //Get the inputs & outputs at 2 confirmations
                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    dbwallet.getInputsAndOutputs(conn);

                    Set<Integer> txIndexes = dbwallet.getTxIndexes();

                    txToBlockHeight = ChainManager.instance().filterConfirmedIndexes(dbwallet.getConfirmedBlockIndexes(conn, txIndexes), 0, null);

                    dbwallet.calculateTxResults();

                } finally {
                    BitcoinDatabaseManager.close(conn);
                }
            }

            for (final Forwarding forwarding : forwards) {
                DBBitcoinAddress address = dbwallet.getAddress(forwarding.input_address);

                if (BaseServlet.log) System.out.println("\n\n--------------- Process Address " + address.toString() + " ---------------");

                if (address.getTotalReceived() == 0) {
                    if (BaseServlet.log) System.out.println("Forwarding address totalReceived == 0 " + forwarding);
                    continue;
                }

                if (BaseServlet.log) System.out.println("Process Forwarding " + forwarding);

                //Keep track of the addresses we have used as using them again could result in double spends
                HashSet<DBBitcoinAddress> used = new HashSet<>();

                int newestTx = 0;
                int confirmationsOfNewestTx = -1;
                Collection<Integer> txIndexes =  address.getReceivedTxIndexes();
                for (Integer txIndex : txIndexes)  {
                    Integer blockHeight = txToBlockHeight.get(txIndex);

                    if (BaseServlet.log) System.out.println("Block height of " + txIndex + " " + blockHeight);

                    if (blockHeight == null) {
                        newestTx = txIndex;
                        confirmationsOfNewestTx = 0;
                        break;
                    }

                    int confirmations =  currentHeight - blockHeight + 1;
                    if (confirmationsOfNewestTx == -1 || confirmations < confirmationsOfNewestTx) {
                        confirmationsOfNewestTx = confirmations;
                        newestTx = txIndex;
                    }
                }

                //If the taint is 100 then there is no mixing and we can simply forward directly from this address
                if (forwarding.taint == 100) {
                    if (forwarding.confirmations > 0) {
                        if (confirmationsOfNewestTx < forwarding.confirmations) {
                            if (BaseServlet.log) System.out.println("Received Transaction Does not meet confirmation requirements " + forwarding + " txIndex " + newestTx);
                            continue;
                        }
                    }

                    //Simply Forward Any balance
                    if (address.getFinalBalance() > 0) {

                        //We collect the very small outputs left. there is no point in sending them as they will never get confirmed
                        if (address.getFinalBalance() <= txFee.longValue()) {
                            if (BaseServlet.log) System.out.println(address.getFinalBalance() + " less than transaction fee " + forwarding);
                        } else {
                            ECKey key = forwarding.getECKey();

                            used.add(address);

                            boolean sent = sendForwarding(forwarding, Collections.singletonList(key), address.finalBalance, new MyWallet.GetChangeAddress() {
                                //Return change tot he forwarding output address
                                //There should very rarely be any change, but it could happen if a new transactions is received between when we fetched the last balance and now
                                @Override
                                public BitcoinAddress getChangeAddress(Set<BitcoinAddress> addressesUsed) throws Exception {
                                    if (forwarding.fee_percent == 0) {
                                        return new BitcoinAddress(forwarding.output_address);
                                    } else {
                                        //We Create Another forwarding for the change
                                        Pair<BitcoinAddress, BitcoinAddress> changeForwarding = AdminServlet.getMixerWallet().createForwardingAddress(100, 0, 0);

                                        return changeForwarding.getFirst();
                                    }
                                }
                            });

                            if (sent) shouldRunJobAgainAfterFinish = true;

                            if (BaseServlet.log) {
                                if (sent)
                                    System.out.println("Sent " + forwarding);
                                else
                                    System.out.println("Error Sending " + forwarding);
                            }
                        }
                    }
                } else {

                    //If the Taint is 100% then there should be another forwarding pair in the database
                    //Used for the purpose of tracking how much we have forwarded and for increased anonymity
                    Forwarding childForwarding =  forwardingMap.get(new BitcoinAddress(forwarding.output_address));

                    if (childForwarding == null) {
                        if (BaseServlet.log) System.out.println("Missing childForwarding " + forwarding + ". This shouldn't Happen!");
                    }

                    DBBitcoinAddress secondAddress = dbwallet.getAddress(forwarding.output_address);

                    if (secondAddress == null) {
                        if (BaseServlet.log) System.out.println("Second Address Null [" + forwarding + " => " + childForwarding + "]. This shouldn't Happen!");
                        continue;
                    }

                    long amountToSend = forwarding.getPending(address.getTotalReceived(), dbwallet.calculateSentTo(forwarding.output_address, true));

                    if (amountToSend < 0) {
                        throw new Exception("We have sent more than we received! " + forwarding + " => " + childForwarding);
                    }

                    if (amountToSend == 0) {
                        if (BaseServlet.log) System.out.println("Nothing to send" + forwarding);
                        continue;
                    } else {
                        if (BaseServlet.log) System.out.println(amountToSend + " outstanding for forwarding " + forwarding);
                    }

                    if (amountToSend <= txFee.longValue()) {
                        if (BaseServlet.log) System.out.println(amountToSend + " less than transaction fee, add to sweep list " + forwarding);
                        continue;
                    }

                    boolean meetsConfirmationRequirements = false;


                    if (BaseServlet.log)  System.out.println("confirmationsOfNewestTx " + confirmationsOfNewestTx);

                    //Auto decide confirmation requirements
                    if (forwarding.confirmations == 0) {
                        //If the transaction is low value we will consider sending it with zero confirmations
                        if (confirmationsOfNewestTx == 0 && amountToSend < ZeroConfirmationMaxValue) {
                            Connection conn = BitcoinDatabaseManager.conn();
                            try {
                                DBBitcoinTx tx = DBBitcoinTx.getTxByIndex(conn, newestTx);

                                tx.getIn(conn);
                                tx.getOut(conn);

                                if (tx != null && tx.getFees() >= ZeroConfirmationRequiredFees) {

                                    //Wait until the transaction is at least 30 seconds old
                                    if (tx.getTime() > (System.currentTimeMillis() / 1000)-30000) {

                                        //Only if the fee is above a certain threshold
                                        if (!tx.isDoubleSpend(conn)) {
                                            InventoryInfo info = InventoryManager.getInventoryInfo(tx.getHash());
                                            if (info != null && info.getRelayedIpv4().size() > 2500) {
                                                //If relayed by more than 2500 nodes we will accept it
                                                meetsConfirmationRequirements = true;
                                            } else {
                                                if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because not enough nodes have relayed it");
                                            }
                                        } else {
                                            if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because it is a double spend");
                                        }
                                    }  else {
                                        if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because it is too new " + newestTx + " time " + tx.getTime());

                                        shouldRunJobAgainAfterFinish = true;
                                    }
                                } else {
                                    if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because it does not include the correct fees " + newestTx);
                                }
                            } finally {
                                BitcoinDatabaseManager.close(conn);
                            }
                        } else if (confirmationsOfNewestTx >= 2 && amountToSend < TwoConfirmationMaxValue) {
                            meetsConfirmationRequirements = true; //Amounts under 200 BTC send with 2 confirmations
                        } else if (confirmationsOfNewestTx >= 6) {
                            meetsConfirmationRequirements = true;
                        }
                    } else if (confirmationsOfNewestTx >= forwarding.confirmations) {
                        meetsConfirmationRequirements = true;
                    }

                    if (!meetsConfirmationRequirements) {
                        if (BaseServlet.log) System.out.println("Received Transaction Does not meet confirmation requirements " + forwarding + " txIndex " + newestTx);
                        continue;
                    }

                    //find a suitable address
                    Map<BitcoinAddress, Taint> addressTaints = taints.get(address);
                    if (addressTaints == null || addressTaints.size() == 0) {

                        if (BaseServlet.log) System.out.println("Fetching Taints For " + address);

                        addressTaints = TaintServlet.getTaints(address, new Settings());

                        //save it the cached global taints map
                        taints.put(address, addressTaints);
                    }

                    if (addressTaints == null)
                        throw new Exception("Unable to Get Taints For Address " + address);

                    //Get a List Of Possible Addresses We Can Use
                    List<DBBitcoinAddress> possibleAddresses = new ArrayList<>(dbwallet.getAddresses());

                    List<ECKey> selectedKeys = new ArrayList<>();

                    long amountSelected = 0;
                    for (DBBitcoinAddress candidateAddress : possibleAddresses) {
                        Forwarding candidateForwarding = forwardingMap.get(candidateAddress);

                        if (candidateForwarding == null) {
                            if (BaseServlet.log) System.out.println("candidateForwarding Null. this shouldn't happen");
                            continue;
                        }

                        //Never include self
                        if (candidateAddress.equals(address))
                            continue;

                        //Don't include addresses we have already used
                        if (used.contains(candidateAddress)) {
                            if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because we have used it previously");
                            continue;
                        }

                        //Can't send from addresses with zero balance
                        if (candidateAddress.finalBalance == 0) {
                            if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because the balance is zero");
                            continue;
                        }

                        //Don't include addresses which should not be mixed
                        if (candidateForwarding.taint == 100) {
                            if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because the taint is 100%");
                            continue;
                        }

                        Taint taint = addressTaints.get(candidateAddress);

                        //If the taint is null or the amount of taint is less than the minimum required forward it
                        if (taint == null || taint.getTaint() <= forwarding.taint) {

                            if (BaseServlet.log) System.out.println("Suitable Untainted address " + candidateAddress);

                            amountSelected += candidateAddress.finalBalance;

                            //Use the untainted address as the from address
                            ECKey key = candidateForwarding.getECKey();

                            used.add(address);

                            selectedKeys.add(key);

                            if (amountSelected >= amountToSend)
                                break;
                        }
                    }

                    if (amountSelected < amountToSend) {
                        if (BaseServlet.log) System.out.println("Checking Blockchain.info wallet for " + forwarding + " amountSelected < amountToSend (" + amountSelected + " < " + amountToSend+")");

                        //If we don't have enough fund in the shared wallet look in blockchain.info's personal wallet for suitable untainted addresses

                        MyWallet blockchainWallet = AdminServlet.getMixerWallet();

                        DBBitcoinWallet blockchainDBWallet = new DBBitcoinWallet();

                        for (BitcoinAddress taddress : blockchainWallet.getActiveAddresses()) {
                            blockchainDBWallet.addAddress(new DBBitcoinAddress(taddress));
                        }
                        {
                            Connection conn = BitcoinDatabaseManager.conn();
                            try {
                                blockchainDBWallet.getInputsAndOutputs(conn);
                            } finally {
                                BitcoinDatabaseManager.close(conn);
                            }
                        }
                        blockchainDBWallet.calculateTxResults();

                        for (DBBitcoinAddress candidateAddress : blockchainDBWallet.getAddresses()) {
                            //Never include self
                            if (candidateAddress.equals(address))
                                continue;

                            //Don't include addresses we have already used
                            if (used.equals(candidateAddress)) {
                                if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because we have used it previously");
                                continue;
                            }

                            //Can't send from addresses with zero balance
                            if (candidateAddress.finalBalance == 0) {
                                if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because the balance is zero");
                                continue;
                            }

                            //Don't include addresses we have already used
                            if (used.contains(candidateAddress)) {
                                if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because we have used it previously");
                                continue;
                            }

                            Taint taint = addressTaints.get(candidateAddress);

                            //If the taint is null or the amount of taint is less than the minimum required forward it
                            if (taint == null || taint.getTaint() <= forwarding.taint) {

                                //find a suitable address
                                Map<BitcoinAddress, Taint> candidateTaints = taints.get(candidateAddress);
                                if (candidateTaints == null || candidateTaints.size() == 0) {
                                    if (BaseServlet.log) System.out.println("Fetching Taints For " + candidateAddress);

                                    candidateTaints = TaintServlet.getTaints(address, new Settings());

                                    //save it the cached global taints map
                                    taints.put(candidateAddress, candidateTaints);
                                } else {
                                    if (BaseServlet.log) System.out.println("Candidate Taints Null " + candidateAddress);
                                }

                                boolean containsRelatedAddress = false;
                                if (candidateTaints != null) {
                                    for (Map.Entry<BitcoinAddress, Taint> pair : candidateTaints.entrySet()) {
                                        if (addressTaints.containsKey(pair.getKey()) && pair.getValue().getTaint() >= RelatedTaintThreshold) {
                                            if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because is contains a related tainted address: " + pair.getKey());
                                            containsRelatedAddress = true;
                                            break;
                                        }
                                    }
                                }

                                if (containsRelatedAddress) {
                                    continue;
                                }

                                if (BaseServlet.log) System.out.println("Suitable Untainted address " + candidateAddress);

                                amountSelected += candidateAddress.finalBalance;

                                //Use the untainted address as the from address
                                ECKey key = blockchainWallet.getECKey(candidateAddress.toString());

                                used.add(address);

                                selectedKeys.add(key);


                                if (amountSelected >= amountToSend)
                                    break;
                            } else {
                                if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because it is tainted " + taint.getTaint());
                            }
                        }
                    }

                    if (amountSelected < amountToSend) {
                        if (amountSelected > sendPartialThreshold) {
                            if (BaseServlet.log) System.out.println("amountSelected < amountToSend but amountSelected > sendPartialThreshold so sending partial");
                        } else {
                            if (BaseServlet.log) System.out.println("Not Sending " + forwarding + " Because amountSelected < amountToSend (" + amountSelected + " < " + amountToSend+")");

                            //Here is where we ask for untainted coins
                            /* Map<BitcoinAddress, String> bitcoinAddressGUIDMap = new HashMap<>();
                            {
                                Connection conn = BitcoinDatabaseManager.conn();
                                PreparedStatement stmt = null;
                                try {
                                    stmt = conn.prepareStatement("select hash, guid from bitcoin_wallet_keys");

                                    ResultSet results = stmt.executeQuery();
                                    while (results.next()) {
                                        bitcoinAddressGUIDMap.put(new BitcoinAddress(new Hash(results.getBytes(1)), (short)1), results.getString(2));
                                    }
                                } finally {
                                    BitcoinDatabaseManager.close(conn);
                                }
                            }

                            //Remove All the tained addresses
                            bitcoinAddressGUIDMap.keySet().removeAll(addressTaints.keySet());

                            System.out.println("bitcoinAddressGUIDMap size " + bitcoinAddressGUIDMap.size());
                            */

                            continue;
                        }
                    }

                    if (sendForwarding(forwarding, selectedKeys, amountToSend, new MyWallet.GetChangeAddress() {
                        //Return change to a new forwarding to the mixer global wallet
                        //If we returned change back to the original address it would mess with the total received
                        //Filtering the true total received is expensive
                        @Override
                        public BitcoinAddress getChangeAddress(Set<BitcoinAddress> addressesUsed) throws Exception {
                            //We Create Another forwarding for the change
                            Pair<BitcoinAddress, BitcoinAddress> changeForwarding = AdminServlet.getMixerWallet().createForwardingAddress(100, 0, 0);

                            return changeForwarding.getFirst();
                        }
                    })) {
                        shouldRunJobAgainAfterFinish = true;

                        if (BaseServlet.log) {
                            System.out.println("Sent " + forwarding);
                        }
                    } else {
                        System.out.println("Error Sending " + forwarding);
                    }
                }
            }

            for (Forwarding forwarding : forwards) {
                DBBitcoinAddress address = dbwallet.getAddress(forwarding.input_address);


                //Don't delete addresses which haven't been used
                if (address.totalReceived == 0 && forwarding.time > System.currentTimeMillis()-86400000) {
                    if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because totalReceived == 0 ");
                    continue;
                }

                //Don't delete addresses with a final balance
                if (address.finalBalance > 0) {
                    if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because final balance > 0 ");
                    continue;
                }

                boolean allFullyConfirmed = true;
                for (Integer txIndex : address.getTxIndexes())  {

                    Integer blockHeight = txToBlockHeight.get(txIndex);

                    if (blockHeight == null)  {
                        allFullyConfirmed = false;
                        break;
                    }

                    int confirmations =  currentHeight - blockHeight + 1;
                    if (confirmations <= RequiredRemovalConfirmations) {
                        allFullyConfirmed = false;
                        break;
                    }
                }

                if (!allFullyConfirmed) {
                    if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because allFullyConfirmed is not true ");
                    continue;
                }

                boolean hasDepending = false;
                for (Forwarding parentForwarding : forwards) {
                    if (parentForwarding.input_address.equals(forwarding.output_address)) {
                        hasDepending = true;
                        break;
                    }
                }

                if (hasDepending) {
                    if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because it has a dependant forwarding ");
                    continue;
                }

                if (forwarding.taint < 100) {

                    long amountToSend = forwarding.getPending(address.getTotalReceived(), dbwallet.calculateSentTo(forwarding.output_address, true));
                    if (amountToSend > txFee.longValue()) {
                        if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because address.totalReceived ("+address.totalReceived+") - totalForwarded ("+amountToSend+") > txFee ");
                        continue;
                    }
                }

                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    if (!forwarding.remove(conn)) {
                        System.out.println("Error Removing " + forwarding);
                    }
                } finally {
                    BitcoinDatabaseManager.close(conn);
                }

            }
        } catch (Exception e) {
            e.printStackTrace();

            NotificationsManager.sendMail(AdminServlet.ADMIN_EMAIL, "Exception Caught ProcessingForwards()",  e.getLocalizedMessage());

            throw e;
        }

        //If we sent out a forwarding we re-run the job again after a short delay
        if (shouldRunJobAgainAfterFinish) {
            new Thread() {
                @Override
                public void run() {
                    try {
                        Thread.sleep(10000);
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }

                    OperationQueue.shared.addOperation(new ProcessForwardsOperation());
                }
            }.start();
        }
    }
}
