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
import piuk.website.PopularAdressesServlet;
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
import java.util.concurrent.ConcurrentHashMap;

import static piuk.website.TaintServlet.Taint;

public class ProcessForwardsOperation extends Operation<List<Forwarding>> {
    public static boolean isScheduled = false; //Whether the operation is scheduled to run again
    public static final int RequiredRemovalConfirmations = 6; //Number of confirmations before all logs are removed
    public static final Map<BitcoinAddress, Map<BitcoinAddress, TaintServlet.Taint>> taints = new ConcurrentHashMap<>();
    public static final BigInteger DefaultTxFee = BigInteger.valueOf((long) (BitcoinTx.COIN * 0.0001)); //0.0001 BTC
    public static final long SendPartialThreshold = BitcoinTx.COIN * 10; //10 BTC
    public static final long TwoConfirmationMaxValue = BitcoinTx.COIN * 250; //100 BTC
    public static final long OneConfirmationMaxValue = BitcoinTx.COIN * 25; //25 BTC
    public static final long ZeroConfirmationMaxValue = BitcoinTx.COIN * 10; //10 BTC
    public static final long ZeroConfirmationRequiredFees =  (long)(BitcoinTx.COIN * 0.0005); //0.0005 BTC
    public static final long SplitTxRuleThreshold =  BitcoinTx.COIN * 4; //Transactions larger than 2.5 BTC get split into at least two transactions
    public static final long Split100TaintTxRuleThreshold =  BitcoinTx.COIN * 50; //Split Threshold for transactions 100% taint transaction which have a < 100% taint parent
    public static final long SplitSecondTimeTxRuleThreshold =  BitcoinTx.COIN * 150; //Split Threshold for transactions 100% taint transaction which have a < 100% taint parent
    public static final long MaximumChangeSize = DBBitcoinTx.COIN * 200; //200 BTC
    public static final long MaximumSecondChangeSize = DBBitcoinTx.COIN * 100; //100 BTC
    public static final double RelatedTaintThreshold =  5; //The threshold % taint of a connected taint address. A related address is an address which is not directly tainted by either address but is a tainted in-directly by other addresses
    public static final long TimeBetweenRuns = 5000; // 5 seconds
    public static final long MinTimeBetweenPushed = 30000; //Never push another transaction out from the same address between this time (to give hte transaction a chance to propagate)
    public static final long DefaultExpiryTime = 86400000; //24 hours (Default expiry time of forwardings)
    public static long FailuresInARow = 0; //How many exceptions in a row to catch before giving up

    public static boolean isRunning = false;
    public static long lastRun;

    public final static String CoinsAreNeededKey = "MixCoinsAreNeeded";
    public final static String PayBonusKey = "MixPayBonusKey";

    public static long txFee() {
        return DefaultTxFee.longValue();
    }

    public ProcessForwardsOperation() {
        super(1);
        setStopOnException(true);
    }

    @Override
    public String getName() {
        return "Process Forwarding";
    }

    public static boolean getIsPayingBonus() {
        Boolean coins_needed = (Boolean) Cache.get(PayBonusKey);

        return (coins_needed != null && coins_needed);
    }

    public static boolean getCoinsAreNeeded() {
        Boolean coins_needed = (Boolean) Cache.get(CoinsAreNeededKey);

        return (coins_needed != null && coins_needed);
    }

    public static long getMaxBonus() {
        return DBBitcoinTx.COIN * 1; //1 BTC
    }

    public static double getDefaultFee() {
        return 1.5d;
    }

    public static double getCurrentFee() {
        if (getIsPayingBonus()) {
            return -0.5;
        } else if (getCoinsAreNeeded()) {
            return 0;
        } else {
            return getDefaultFee();
        }
    }

    public static class Forwarding {
        private static Map<DBBitcoinAddress, Forwarding> _cache = new HashMap<>();;
        public String input_address;
        public String input_priv;
        public String output_address;
        public double taint;
        public double fee_percent;
        public int confirmations;
        public long time;
        public long last_tx_pushed;
        public long expires = System.currentTimeMillis()+DefaultExpiryTime;
        public String guid;
        public int bonus_status = 0;

        private static final int BonusStatusNotProcessed = 0;
        private static final int BonusStatusPaid = 1;
        private static final int BonusStatusShouldPay = 2;

        public long getTime() {
            return time;
        }

        public String getGuid() {
            return guid;
        }

        public long getExpires() {
            return expires;
        }

        public String getInput_address() {
            return input_address;
        }

        public ECKey getECKey() throws InvalidKeySpecException, NoSuchAlgorithmException, UnsupportedEncodingException, AddressFormatException {
            return MyWallet.decodeUnencryptedPK(MyWallet.decrypt(input_priv, Settings.instance().getString("forwardings_encryption_password")));
        }

        public long getPending(long totalReceived, long totalSent) {
            if (fee_percent <= 0)
                return totalReceived - totalSent;

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

        public void payBonus(long totalValue) {
            Connection conn = BitcoinDatabaseManager.conn();
            try {
                MyWallet wallet = AdminServlet.getMixerWallet();

                DBBitcoinAddress address = new DBBitcoinAddress(input_address);

                address.getInputsAndOutputs(conn);

                List<DBBitcoinTx.DBOutput> outputs = address.getOutputs();

                if (outputs.size() == 0)
                    throw new Exception("Cannot Send Bonus To Address Which Hasn't Received any Payments");

                int tx_index = outputs.get(0).getTxIndex();

                DBBitcoinTx tx = DBBitcoinTx.getTxByIndex(conn, tx_index);

                if (tx == null)
                    throw new Exception("Error getting bonus transaction");

                tx.getIn(conn);

                if (tx.getIn().size() == 0)
                    throw new Exception("Error getting inputs");

                BitcoinAddress bonusAddress = tx.getDBIn().get(0).getDBPrevOut().getAddress();

                if (BaseServlet.log) System.out.println("Bonus Address " + bonusAddress);

                if (fee_percent >= 0)
                    throw new Exception("Cannot pay bonus for fee_percent " + fee_percent);

                double feePercent = -fee_percent;

                long bonusAmount = Math.min(getMaxBonus(), (long) ((totalValue / 100d) * feePercent));

                if (bonusAmount < DefaultTxFee.longValue())
                    throw new Exception("Bonus amount < " + DefaultTxFee);

                if (BaseServlet.log) System.out.println("Pay bonus " + bonusAmount);

                Pair<BitcoinAddress, BigInteger> toPair = new Pair<>(bonusAddress, BigInteger.valueOf(bonusAmount));

                setBonusStatus(conn, BonusStatusPaid);

                wallet.send(conn, Collections.singletonList(toPair), DefaultTxFee);

            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                BitcoinDatabaseManager.close(conn);
            }
        }

        public void setBonusStatus(Connection conn, int bonusStatus) throws SQLException, AddressFormatException {
            PreparedStatement stmt = conn.prepareStatement("update bitcoin_forwards set bonus_paid = ? where input_address = ? limit 1");
            try {
                stmt.setInt(1, bonusStatus);
                stmt.setString(2, input_address);

                stmt.executeUpdate();
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }
        }

        public static List<Forwarding> getForwardings( Connection conn ) throws SQLException, AddressFormatException {
            List<Forwarding> data = new ArrayList<>();

            Map<DBBitcoinAddress, Forwarding> forwardingMap = new HashMap<>();

            PreparedStatement stmt = conn.prepareStatement("select input_address, input_priv, output_address, taint, fee_percent, confirmations, time, last_tx_pushed, expires, guid, bonus_paid from bitcoin_forwards order by time asc");
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
                    forward.last_tx_pushed = results.getLong(8);
                    forward.expires = results.getLong(9);
                    forward.guid = results.getString(10);
                    forward.bonus_status = results.getInt(11);

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
                PreparedStatement stmt = conn.prepareStatement("select count(*) from bitcoin_forwards where (output_address = ? and taint < 100) or input_address = ?");
                try {
                    stmt.setString(1, output_address);
                    stmt.setString(2, output_address);

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

            PreparedStatement stmt = conn.prepareStatement("insert into bitcoin_forwards (input_address, input_priv, output_address, taint, fee_percent, confirmations, time, last_tx_pushed, expires, guid) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            try {
                stmt.setString(1, input_address);
                stmt.setString(2, input_priv);
                stmt.setString(3, output_address);
                stmt.setDouble(4, taint);
                stmt.setDouble(5, fee_percent);
                stmt.setInt(6, confirmations);
                stmt.setLong(7, time);
                stmt.setLong(8, last_tx_pushed);
                stmt.setLong(9, expires);
                stmt.setString(10, guid);

                boolean inserted =  stmt.executeUpdate() == 1;

                if (inserted)
                    _cache.put(new DBBitcoinAddress(input_address), this);

                return inserted;
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }
        }


        public boolean remove(Connection conn) throws SQLException {
            conn.setAutoCommit(false);

            try {
                {
                    PreparedStatement select_stmt = conn.prepareStatement("select count(*) from bitcoin_forwards where output_address = ? limit 1");
                    try {
                        select_stmt.setString(1, input_address);

                        ResultSet results = select_stmt.executeQuery();

                        if (results.next()) {
                            int count = results.getInt(1);

                            if (count >= 1) {
                                throw new SQLException("Cannot Delete Forwarding " + input_address + " As it has a dependant parent");
                            }
                        }
                    } finally {
                        BitcoinDatabaseManager.close(select_stmt);
                    }
                }

                if (BaseServlet.log) System.out.println("Remove forwarding " + input_address);

                PreparedStatement delete_stmt = conn.prepareStatement("delete from bitcoin_forwards where input_address = ? limit 1");
                try {
                    delete_stmt.setString(1, input_address.toString());

                    //Remove any cached Taints
                    try {
                        _cache.remove(new BitcoinAddress(input_address));
                        taints.remove(new BitcoinAddress(input_address));
                    } catch (AddressFormatException e) {
                        e.printStackTrace();
                    }

                    if (delete_stmt.executeUpdate() == 1) {
                        conn.commit();
                        return true;
                    }
                } finally {
                    BitcoinDatabaseManager.close(delete_stmt);
                }
            } catch (SQLException e) {
                conn.rollback();
                throw e;
            } finally {
                conn.setAutoCommit(true);
            }

            return false;
        }
    }

    public static Pair<BitcoinAddress, String> generateNewEncryptedPK() throws InvalidKeySpecException, NoSuchAlgorithmException, UnsupportedEncodingException, AddressFormatException {
        ECKey key = new ECKey();

        byte[] bytes = key.getPrivKeyBytes();

        if (bytes.length != 32)
            throw new InvalidKeySpecException("Invalid Key Size");

        String base58 = Base58.encode(bytes);

        String encrypted = MyWallet.encrypt(base58, Settings.instance().getString("forwardings_encryption_password"));

        if (encrypted == null || encrypted.length() == 0)
            throw new InvalidKeySpecException("Error Encrypting Generate Key");

        String checkDecrypted = MyWallet.decrypt(encrypted, Settings.instance().getString("forwardings_encryption_password"));

        byte[] checkBytes = Base58.decode(checkDecrypted);

        if (!Arrays.equals(checkBytes, bytes))
            throw new InvalidKeySpecException("Inconsistency between encrypted and decrypted addresses");

        return new Pair<>(new BitcoinAddress(key.toAddress(NetworkParameters.prodNet()).toString()), encrypted);
    }

    public static void setupListeners() {

        if (isRunning)
            return;

        isRunning = true;

        ChainManager.instance().addBlockListener(new BlockEventListener() {
            @Override
            public boolean onBlock(DBBitcoinBlock block) {

                if (!isRunning)
                    return true;

                //Process Forwards every 10 minutes on new confirmations
                OperationQueue.shared.addOperation(new ProcessForwardsOperation());

                return false;
            }
        });

        ChainManager.instance().addTxListener(new TxEventListener() {
            @Override
            public boolean onTx(DBBitcoinTx tx) {

                if (!isRunning)
                    return true;

                for (DBBitcoinTx.DBOutput output : tx.getDBOut()) {
                    if (output.getAddress() == null)
                        continue;

                    if (Forwarding._cache.containsKey(output.getAddress())) {

                        //Clear the taint cache
                        taints.remove(output.getAddress());

                        OperationQueue.shared.addOperation(new ProcessForwardsOperation());
                        break;
                    }
                }

                return false;
            }
        });
    }

    public static void removeListeners() {
        isRunning = false;
    }

    public static boolean isRunning() {
        return isRunning;
    }

    public static synchronized boolean sendForwarding(Forwarding input, List<ECKey> from, long amount, MyWallet.GetChangeAddress changeAddress) throws Exception {

        final BigInteger originalAmount = BigInteger.valueOf(amount);

        if (originalAmount.compareTo(DefaultTxFee) <= 0) {
            throw new Exception("amount Less than or equal to DefaultTxFee");
        }

        List<Pair<BitcoinAddress, BigInteger>> toAddresses = new ArrayList<>();

        BigInteger amountMinusMinersFee = originalAmount.subtract(DefaultTxFee);

        //If we can't afford the miners fee throw an error
        if (amountMinusMinersFee.compareTo(BigInteger.ZERO) <= 0) {
            throw new Exception("Cannot afford Transaction Fee");
        }

        BitcoinAddress toAddress = new BitcoinAddress(input.output_address);

        //Clear the taint cache of this address
        taints.remove(toAddress);

        toAddresses.add(new Pair<>(toAddress, amountMinusMinersFee));

        List<Pair<BitcoinAddress, ECKey>> fromList = new ArrayList<>();
        for (ECKey key : from) {
            BitcoinAddress fromAddress = new BitcoinAddress(key.toAddress(NetworkParameters.prodNet()).toString());

            //Clear the taint cache of this address
            taints.remove(fromAddress);

            fromList.add(new Pair<>(fromAddress, key));
        }

        if (BaseServlet.log) System.out.println("Send forwarding " + input + " toAddresses " + toAddresses + " fromAddresses " + fromList + " amount " + amount);

        Connection conn = BitcoinDatabaseManager.conn();
        try {

            PreparedStatement stmt = conn.prepareStatement("update bitcoin_forwards set last_tx_pushed = ? where input_address = ? and (last_tx_pushed = 0 or last_tx_pushed < ?)");
            try {
                stmt.setLong(1, System.currentTimeMillis());
                stmt.setString(2, input.input_address);
                stmt.setLong(3, System.currentTimeMillis()-MinTimeBetweenPushed);

                if (stmt.executeUpdate() != 1) {
                    throw new Exception("Error updated bitcoin_forwards last_tx_pushed");
                }
            } finally {
                BitcoinDatabaseManager.close(stmt);
            }

            Transaction tx = MyWallet.sendFrom(conn, fromList, toAddresses, DefaultTxFee, changeAddress, false);

            return (tx != null);
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

    public  piuk.website.TaintServlet.Settings getDefaultTaintSettings() {

        //More in depth search than regular taint analysis
        piuk.website.TaintServlet.Settings settings = new piuk.website.TaintServlet.Settings();

        settings.maxInitialOutputs = 5000;
        settings.maxQueryCount = 1500;
        settings.maxDepth = 500;

        return settings;
    }

    public void scheduleJobAgainSoon(final long milli) {
        if (isScheduled) {

            if (BaseServlet.log)
                System.out.println("Not running becuase it was already scheduled");

            return;
        }

        new Thread() {
            @Override
            public void run() {

                if (BaseServlet.log)
                    System.out.println("Schedule Job Again Sleep " + milli);

                isScheduled = true;

                try {
                    Thread.sleep(milli);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
                isScheduled = false;

                if (BaseServlet.log)
                    System.out.println("Schedule Done");

                OperationQueue.shared.addOperation(new ProcessForwardsOperation());
            }
        }.start();
    }

    @Override
    public void process(List<Forwarding> forwards) throws Exception {

        if (BaseServlet.log)  System.out.println("ProcessForwardsOperation()");

        synchronized (ProcessForwardsOperation.class) {
            long timeBetweenLastRun =  System.currentTimeMillis() - lastRun;
            if (timeBetweenLastRun < TimeBetweenRuns) {

                scheduleJobAgainSoon(TimeBetweenRuns + 1000);

                if (BaseServlet.log) System.out.println("CannotProceed process() forwards because it was run " + timeBetweenLastRun + " ms ago");
                return;
            }
            lastRun = System.currentTimeMillis();

            boolean shouldRunJobAgainAfterFinish = false;

            try {
                Map<DBBitcoinAddress, Forwarding> forwardingMap = Forwarding._cache;

                DBBitcoinWallet dbwallet = new DBBitcoinWallet();

                for (Forwarding forward : forwards) {
                    dbwallet.addAddress(new DBBitcoinAddress(forward.input_address));

                    if (forward.taint < 100)
                        dbwallet.addAddress(new DBBitcoinAddress(forward.output_address));
                }

                try {
                    if (BaseServlet.log)
                        System.out.println("Process Forwarding() " + dbwallet.getAddresses());

                    int currentHeight = ChainManager.instance().getLatestBlock().getHeight();

                    //Calculate the wallet balance and transactions
                    Map<Integer, Integer> txToBlockHeight = null;  {
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

                        if (forwarding.last_tx_pushed > System.currentTimeMillis()-MinTimeBetweenPushed) {
                            if (BaseServlet.log) System.out.println("Cannot process this forwarding as we pushed a transaction more than 30 seconds ago");
                            scheduleJobAgainSoon(TimeBetweenRuns);
                            continue;
                        }


                        if (forwarding.taint == 101) {
                            //If the taints is 101 then this it is a change forwarding, do nothing

                            continue;
                        } else if (forwarding.taint == 100) {   //If the taint is 100 then there is no mixing and we can simply forward directly from this address
                            if (forwarding.confirmations > 0) {
                                if (confirmationsOfNewestTx < forwarding.confirmations) {
                                    if (BaseServlet.log) System.out.println("Received Transaction Does not meet confirmation requirements " + forwarding + " txIndex " + newestTx);
                                    continue;
                                }
                            }

                            if (forwarding.fee_percent > 0) {
                                throw new Exception("Fee currently not supported for 100% taint transactions");
                            }

                            //Simply Forward Any balance
                            if (address.getFinalBalance() > 0) {

                                //We collect the very small outputs left. there is no point in sending them as they will never get confirmed
                                if (address.getFinalBalance() <= DefaultTxFee.longValue()) {
                                    if (BaseServlet.log) System.out.println(address.getFinalBalance() + " less than transaction fee " + forwarding);
                                } else {

                                    final long amountToSend = address.finalBalance;
                                    long actualAmountToSend = amountToSend;

                                    Forwarding parentForwarding = null;
                                    for (Forwarding possible_parent : forwards) {
                                        if (possible_parent.output_address.equals(forwarding.input_address)) {
                                            parentForwarding = possible_parent;
                                            break;
                                        }
                                    }

                                    if (BaseServlet.log) System.out.println("Found Parent " + parentForwarding + " of 100% Taint " + forwarding);

                                    //If this is a relay of a < 100% tainted transaction we split the transaction one final time if over a certain value
                                    if (parentForwarding != null && parentForwarding.taint < 100) {
                                        double RandomSplitAtPercent = 100d *  ((Math.random() * 0.8d) + 0.2d);  //Minimum 20% - Maximum 80%

                                        //Split only if greater than SplitTxRuleThreshold and 75% of the time
                                        if (amountToSend >= Split100TaintTxRuleThreshold && Math.random() < 0.75d) {
                                            actualAmountToSend = (long)((amountToSend / 100d) * RandomSplitAtPercent);
                                        }
                                    }

                                    if (actualAmountToSend > amountToSend)
                                        throw new Exception("actualAmountToSend > ("+actualAmountToSend+") > amountToSend " + amountToSend + " this should never happen");

                                    if (BaseServlet.log && actualAmountToSend < amountToSend) {
                                        if (BaseServlet.log) System.out.println("Split 100% Taint transaction amountToSend " + amountToSend + " actualAmountToSend " + actualAmountToSend);
                                    }

                                    ECKey key = forwarding.getECKey();

                                    used.add(address);

                                    final long finalActualAmountToSend = actualAmountToSend;
                                    if (sendForwarding(forwarding, Collections.singletonList(key), actualAmountToSend, new MyWallet.GetChangeAddress() {
                                        //Return change tot he forwarding output address
                                        //There should very rarely be any change, but it could happen if a new transactions is received between when we fetched the last balance and now
                                        @Override
                                        public BitcoinAddress getChangeAddress(Set<BitcoinAddress> addressesUsed) throws Exception {
                                            if (finalActualAmountToSend == amountToSend) {
                                                throw new Exception("There shouldn't be any change");
                                            } else {
                                                //Return the change to a new forwarding to the output address
                                                Pair<BitcoinAddress, BitcoinAddress> changeForwarding = createSimpleForwarding(new DBBitcoinAddress(forwarding.output_address), 100, 0, 0);

                                                //Send to the new input which will forward onto the original output
                                                return changeForwarding.getFirst();
                                            }
                                        }
                                    })) {
                                        if (BaseServlet.log) System.out.println("Sent 100% Taint " + forwarding);
                                    } else {
                                        if (BaseServlet.log) System.out.println("Error Sending " + forwarding);
                                    };

                                    scheduleJobAgainSoon(TimeBetweenRuns);

                                    return;
                                }
                            }
                        } else if (forwarding.taint < 100) {
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

                            final long totalSentAlready =  dbwallet.calculateSentTo(forwarding.output_address, true);

                            long amountToSend = forwarding.getPending(address.getTotalReceived(), totalSentAlready);

                            if (amountToSend < 0) {
                                throw new Exception("We have sent more than we received! " + forwarding + " => " + childForwarding);
                            }

                            if (amountToSend == 0) {
                                if (BaseServlet.log) System.out.println("Nothing to send" + forwarding);
                                continue;
                            } else {
                                if (BaseServlet.log) System.out.println(amountToSend + " outstanding for forwarding " + forwarding);
                            }

                            if (amountToSend <= DefaultTxFee.longValue()) {
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
                                            if (tx.getTime() > (System.currentTimeMillis() / 1000)-MinTimeBetweenPushed) {

                                                //Only if the fee is above a certain threshold
                                                if (!tx.isDoubleSpend(conn)) {
                                                    InventoryInfo info = InventoryManager.getInventoryInfo(tx.getHash());
                                                    if (info != null && info.getRelayedIpv4().size() > 2500) {
                                                        //If relayed by more than 2500 nodes we will accept it
                                                        meetsConfirmationRequirements = true;
                                                    } else {
                                                        if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because not enough nodes have relayed it");

                                                        //Only re-try if younger than 2 minutes
                                                        //Older than two minutes could indicate a problem
                                                        if (tx.getTime() < (System.currentTimeMillis() / 1000)-120)
                                                            shouldRunJobAgainAfterFinish = true;
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
                                } else if (confirmationsOfNewestTx >= 1 && amountToSend < OneConfirmationMaxValue) {
                                    meetsConfirmationRequirements = true; //Amounts under 25 BTC send with 1 confirmation even if it doesn't meet other requirements
                                } else if (confirmationsOfNewestTx >= 2 && amountToSend < TwoConfirmationMaxValue) {
                                    meetsConfirmationRequirements = true; //Amounts under 100 BTC send with 2 confirmations
                                } else if (confirmationsOfNewestTx >= 6) {
                                    meetsConfirmationRequirements = true;
                                } else {
                                    if (BaseServlet.log) System.out.println("Does not meet confirmation requirements because we have fallen through confirmationsOfNewestTx: " + confirmationsOfNewestTx + " amountToSend: " + amountToSend);
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

                                addressTaints = TaintServlet.getTaints(address, getDefaultTaintSettings());

                                //save it the cached global taints map
                                taints.put(address, addressTaints);
                            }

                            if (addressTaints == null || addressTaints.size() == 0) {
                                if (BaseServlet.log) System.out.println("Unable to Get Taints For Address " + address);
                                continue;
                            }

                            //Get a List Of Possible Addresses We Can Use
                            List<DBBitcoinAddress> possibleAddresses = new ArrayList<>(dbwallet.getAddresses());

                            List<ECKey> selectedKeys = new ArrayList<>();

                            long splitAmount = amountToSend;
                            if (totalSentAlready == 0 && amountToSend > SplitTxRuleThreshold || amountToSend > SplitSecondTimeTxRuleThreshold) {

                                //For the first transaction we split it into two
                                //Or if the transaction size > SplitSecondTimeTxRuleThreshold
                                double RandomSplitAtPercent = 100d *  ((Math.random() * 0.8d) + 0.2d);  //Minimum 10% - Maximum 90%

                                //Split the amount to send at the random percent
                                splitAmount = (long)((amountToSend / 100d) * RandomSplitAtPercent);

                                //Limit maximum transaction size to RandomSplitPercent of 350 BTC
                                splitAmount = Math.min(splitAmount, (long)(((BitcoinTx.COIN * 350) / 100d) * RandomSplitAtPercent));
                            }

                            Set<Forwarding> forwardsUsedThisTx = new HashSet<>();

                            long amountSelected = 0;
                            boolean selected_enough = false;
                            for (DBBitcoinAddress candidateAddress : possibleAddresses) {
                                Forwarding candidateForwarding = forwardingMap.get(candidateAddress);

                                if (candidateForwarding == null) {
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

                                //Don't include addresses which should not be mixed if the final balance is greater than the minimum send or it is newer than 24 hours old
                                if (candidateForwarding.taint == 100 && (candidateAddress.finalBalance > DefaultTxFee.longValue() || candidateForwarding.time > System.currentTimeMillis()-86400000)) {
                                    if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because the taint is 100%");
                                    continue;
                                }

                                Taint taint = addressTaints.get(candidateAddress);

                                //If the taint is null or the amount of taint is less than the minimum required forward it
                                if (taint == null || taint.getTaint() <= forwarding.taint) {

                                    //Check Related Taints
                                    //find a suitable address
                                    Map<BitcoinAddress, Taint> candidateTaints = taints.get(candidateAddress);
                                    if (candidateTaints == null || candidateTaints.size() == 0) {
                                        if (BaseServlet.log) System.out.println("Fetching candidateTaints For " + candidateAddress);

                                        candidateTaints = TaintServlet.getTaints(candidateAddress, getDefaultTaintSettings());

                                        //save it the cached global taints map
                                        taints.put(candidateAddress, candidateTaints);
                                    }

                                    if (candidateTaints == null || candidateTaints.size() == 0) {
                                        if (BaseServlet.log) System.out.println("Unable to Get Taints For Address " + candidateAddress);
                                        continue;
                                    }

                                    boolean containsRelatedAddress = false;
                                    if (candidateTaints != null) {
                                        for (Map.Entry<BitcoinAddress, Taint> pair : candidateTaints.entrySet()) {
                                            Taint connectingTaint = addressTaints.get(pair.getKey());

                                            if (connectingTaint != null && connectingTaint.getTaint() >= RelatedTaintThreshold && pair.getValue().getTaint() >= RelatedTaintThreshold && !PopularAdressesServlet.getPopularAddresses().contains(pair.getKey())) {
                                                if (BaseServlet.log) System.out.println("Cannot use candidateAddress " + candidateAddress + " because is contains a related tainted address: " + pair.getKey() + " " + pair.getValue().getTaint());
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
                                    ECKey key = candidateForwarding.getECKey();

                                    used.add(candidateAddress);

                                    forwardsUsedThisTx.add(candidateForwarding);

                                    selectedKeys.add(key);

                                    if (amountSelected >= amountToSend || amountSelected >= splitAmount) {
                                        selected_enough = true;
                                        break;
                                    }
                                }
                            }

                            if (!selected_enough) {
                                if (amountSelected >= SendPartialThreshold) {
                                    if (BaseServlet.log)
                                        System.out.println("amountSelected < amountToSend ("+amountToSend+") but amountSelected ("+amountSelected+")> SendPartialThreshold so sending partial");
                                } else {

                                    //Here is where we request new funds
                                    if (BaseServlet.log)
                                        System.out.println("Not Sending " + forwarding + " Because amountSelected < amountToSend (" + amountSelected + " < " + amountToSend+") SendPartialThreshold: " + SendPartialThreshold);

                                    continue;
                                }
                            }

                            used.add(address);

                            long realAmountToSend = Math.min(amountToSend, Math.min(splitAmount, amountSelected));

                            if (sendForwarding(forwarding, selectedKeys, realAmountToSend, new MyWallet.GetChangeAddress() {
                                //Return change to a new forwarding to the mixer global wallet
                                //If we returned change back to the original address it would mess with the total received
                                //Filtering the true total received is expensive

                                //For Large Amounts of change (Over 250 BTC) we slit the change into chunks
                                @Override
                                public List<Pair<BitcoinAddress, BigInteger>> getMultiChangeAddress(Set<BitcoinAddress> addressesUsed, BigInteger amount) throws Exception {
                                    if (BaseServlet.log) System.out.println("getMultiChangeAddress() " + forwarding + " Change " + amount);

                                    long realMaxChangeSize = (totalSentAlready == 0) ? MaximumChangeSize : MaximumSecondChangeSize;

                                    List<Pair<BitcoinAddress, BigInteger>> data = new ArrayList<>();

                                    long amountLeft = amount.longValue();
                                    while(amountLeft > 0) {

                                        //We Create Another forwarding for the change with a special 101% taint which means never to forward it
                                        BitcoinAddress address =  AdminServlet.getMixerWallet().getRandomActiveAddress();

                                        Pair<BitcoinAddress, BitcoinAddress> changeForwarding = createSimpleForwarding(address, 101, 0, 0);

                                        long changeValue = Math.min(realMaxChangeSize, amountLeft);
                                        if (changeValue >= realMaxChangeSize) {
                                            double RandomSplitAtPercent = 100d * ((Math.random() * 0.8d) + 0.2d);  //Minimum 20% - Maximum 80%

                                            changeValue = (long)((changeValue / 100d) * RandomSplitAtPercent);
                                        }

                                        if (changeValue == 0 || changeValue < 0 || changeValue > amountLeft || changeValue > realMaxChangeSize)
                                            throw new Exception("Erroneous Change Value " + changeValue);

                                        if (BaseServlet.log) System.out.println("Change to " + changeForwarding.getFirst() + " Value " + changeValue);

                                        data.add(new Pair<>(changeForwarding.getFirst(), BigInteger.valueOf(changeValue)));

                                        amountLeft -= changeValue;
                                    }

                                    return data;
                                }

                            })) {
                                if (BaseServlet.log) {
                                    System.out.println("Sent " + forwarding);
                                }

                                //If this is a free paying transaction then we pay bonuses for transactions which helped it move thorugh
                                if (forwarding.fee_percent > 0) {
                                    //Mark the bonuses of any transactions used
                                    for (Forwarding used_forward : forwardsUsedThisTx) {
                                        //If the forwarding is used within 5 minutes then we consider it clean and the bonus is paid
                                        if (used_forward.fee_percent < 0 && used_forward.bonus_status == Forwarding.BonusStatusNotProcessed) {
                                            if (BaseServlet.log) System.out.println("Marking to pay bonus For " + used_forward);

                                            {
                                                //Don't send yet though as the transaction may not confirm, just mark as due to be paid when the transaction is confirmed
                                                Connection conn = BitcoinDatabaseManager.conn();
                                                try {
                                                    used_forward.setBonusStatus(conn, Forwarding.BonusStatusShouldPay);
                                                } finally {
                                                    BitcoinDatabaseManager.close(conn);
                                                }
                                            }
                                        } else {
                                            if (BaseServlet.log) System.out.println("Marking to pay bonus For " + used_forward + " fee_percent " + used_forward.fee_percent + " bonus_status " + used_forward.bonus_status);
                                        }
                                    }
                                } else {
                                    if (BaseServlet.log) System.out.println("Not Paying bonus For " + forwarding + " as it is not a fee paying transaction");
                                }

                                //If this forwarding was marked as needing a bonus then pay it now that its processed
                                if (forwarding.bonus_status == Forwarding.BonusStatusShouldPay) {
                                    if (BaseServlet.log) System.out.println("Really Paying bonus For " + forwarding );

                                    forwarding.payBonus(amountToSend);
                                }

                                scheduleJobAgainSoon(TimeBetweenRuns);

                                return;
                            } else {
                                System.out.println("Error Sending " + forwarding);
                            }
                        }
                    }

                    for (Forwarding forwarding : forwards) {
                        DBBitcoinAddress address = dbwallet.getAddress(forwarding.input_address);

                        boolean isExpired = (forwarding.expires == 0 && forwarding.time <= System.currentTimeMillis()-DefaultExpiryTime) || (forwarding.expires <= System.currentTimeMillis());

                        //Don't delete addresses which haven't been used
                        if (address.totalReceived == 0 && !isExpired) {
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
                            if (parentForwarding.output_address.equals(forwarding.input_address)) {
                                hasDepending = true;
                                break;
                            }
                        }

                        if (hasDepending) {
                            if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because it has a dependant parent ");
                            continue;
                        }

                        if (forwarding.taint < 100) {
                            long amountToSend = forwarding.getPending(address.getTotalReceived(), dbwallet.calculateSentTo(forwarding.output_address, true));
                            if (amountToSend > DefaultTxFee.longValue()) {
                                if (BaseServlet.log) System.out.println("Cannot remove "+forwarding+" because address.totalReceived ("+address.totalReceived+") - totalForwarded ("+amountToSend+") > DefaultTxFee ");
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

                    FailuresInARow = 0;

                } catch (Exception e) {
                    //If the number of failures is less that 3 retry the job again
                    if (FailuresInARow <= 3)
                        shouldRunJobAgainAfterFinish = true;

                    ++FailuresInARow;

                    NotificationsManager.sendMail(Settings.instance().getString("admin_email"), "Exception Caught ProcessingForwards()",  e.getLocalizedMessage());

                    throw e;
                }
            } finally {
                //If we sent out a forwarding we re-run the job again after a short delay
                if (shouldRunJobAgainAfterFinish) {
                    scheduleJobAgainSoon(TimeBetweenRuns);
                }

                lastRun = System.currentTimeMillis();
            }
        }
    }
}
