package piuk.website;

import java.awt.*;
import java.io.IOException;
import java.io.Serializable;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import java.util.ArrayList;
import java.util.List;

import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.google.bitcoin.core.AddressFormatException;
import piuk.beans.BitcoinAddress;
import piuk.common.Pair;
import piuk.db.BitcoinDatabaseManager;
import piuk.db.DBBitcoinAddress;
import piuk.db.DBBitcoinTx.DBOutput;
import piuk.db.DBBitcoinWallet;

@WebServlet({ HomeServlet.ROOT + "taint/*" })
public class TaintServlet extends BaseServlet {
    private static final long serialVersionUID = 1L;

    class ValueComparator implements Comparator {
        Map base;
        public ValueComparator(Map base) {
            this.base = base;
        }

        public int compare(Object a, Object b) {
            Comparable<Object> obj1 = (Comparable<Object>) base.get(a);
            Comparable<Object> obj2 = (Comparable<Object>) base.get(b);

            int result = obj1.compareTo(obj2);

            if (result == 0)
                return -1;

            return result;
        }
    }

    public static class Settings {
        public int maxInitialOutputs = 25000;
        public int maxQuerySize = 1000;
        public int maxDepth = 150;
        public double minTaint = 10d;
        public int maxQueryCount = 150;
        public int maxEntries = 500000;
        public int taskQueryCount = 0;
        public int taskMaxDepth = 0;
        public int taskCurrentDepth = 0;
        public final Set<DBOutput> done = new HashSet<>();
        public boolean log = false;
        public Set<DBBitcoinAddress> myAddresses = null;
        public Set<Integer> veryTaintedTxIndexes = new HashSet<>();
        public boolean reverseTaint;

        public DBOutput taskCurrentRoot;

        @Override
        public String toString() {
            return "Settings{" +
                    "maxInitialOutputs=" + maxInitialOutputs +
                    ", maxQuerySize=" + maxQuerySize +
                    ", maxDepth=" + maxDepth +
                    ", minTaint=" + minTaint +
                    ", maxQueryCount=" + maxQueryCount +
                    ", maxEntries=" + maxEntries +
                    ", taskQueryCount=" + taskQueryCount +
                    ", taskMaxDepth=" + taskMaxDepth +
                    ", taskCurrentDepth=" + taskCurrentDepth +
                    '}';
        }

        public boolean isReverseTaint() {
            return reverseTaint;
        }

        public int getMaxInitialOutputs() {
            return maxInitialOutputs;
        }

        public int getMaxQuerySize() {
            return maxQuerySize;
        }

        public int getMaxDepth() {
            return maxDepth;
        }

        public double getMinTaint() {
            return minTaint;
        }

        public int getMaxQueryCount() {
            return maxQueryCount;
        }

        public int getMaxEntries() {
            return maxEntries;
        }

        public int getTaskQueryCount() {
            return taskQueryCount;
        }

        public int getTaskMaxDepth() {
            return taskMaxDepth;
        }

        public int getTaskCurrentDepth() {
            return taskCurrentDepth;
        }
    }

    public static class Taint implements Comparable<Taint>, Serializable {
        protected double taint;
        protected int count;
        protected boolean seenInThisBranchBeforeThisLevel;
        protected boolean seenInThisBranch;
        protected int nBranches;
        protected int lowestDepth;

        public int getLowestDepth() {
            return lowestDepth;
        }

        protected DBOutput root;

        public Taint(double taint, int txIndex, DBOutput root) {
            if (Double.isNaN(taint))
                this.taint = 0;
            else
                this.taint = taint;

            this.count = 1;
            this.root = root;
        }

        public int getNBranches() {
            return nBranches;
        }

        public double getTaint() {
            return taint;
        }

        public int getCount() {
            return count;
        }

        public DBOutput getRoot() {
            return root;
        }

        @Override
        public String toString() {
            return "Taint="+taint;
        }

        @Override
        public int compareTo(Taint o) {
            if (getTaint() > o.getTaint())
                return -1;

            if (getTaint() < o.getTaint())
                return 1;

            if (getLowestDepth() < o.getLowestDepth())
                return -1;

            if (getLowestDepth() > o.getLowestDepth())
                return 1;

            if (getNBranches() < o.getNBranches())
                return -1;

            if (getNBranches() > o.getNBranches())
                return 1;

            else
                return 0;
        }
    }

    public static List<DBOutput> getSpendingOutputs(Connection conn, Map<Integer, Set<DBOutput>> data, List<DBOutput> outputs, Settings settings, Set<DBOutput> fromSelf) throws SQLException {

        List<DBOutput> newOutputs = new ArrayList<>();

        //Limited ot batches of maxQuerySize
        if (outputs.size() > settings.maxQuerySize) {
            List<DBOutput> trimmed = outputs.subList(settings.maxQuerySize, outputs.size());

            newOutputs.addAll(trimmed);

            outputs = outputs.subList(0, settings.maxQuerySize);
        }

        Set<Pair<Integer, Short>> outPoints = new HashSet<>();

        Set<Integer> txIndexes = new HashSet<>();
        for (DBOutput output : outputs) {
            outPoints.add(new Pair<>(output.getTxIndex(), output.getTxOutputN()));

            txIndexes.add(output.getTxIndex());
        }

        if (txIndexes.size() == 0)
            return newOutputs;

        StringBuffer or = new StringBuffer();
        for (Integer txIndex : txIndexes) {
            or.append("?,");
        }
        or.deleteCharAt(or.length()-1);

        StringBuffer orhash = new StringBuffer();
        for (BitcoinAddress hash : settings.myAddresses) {
            orhash.append("?,");
        }
        orhash.deleteCharAt(orhash.length()-1);

        settings.taskQueryCount++;

        PreparedStatement select_stmt = null;
        try {
            select_stmt = conn.prepareStatement("select bitcoin_tx_input.prev_tx_index, bitcoin_tx_input.prev_tx_output_n, bitcoin_tx_output.tx_index, bitcoin_tx_output.tx_output_n, bitcoin_tx_output.value, bitcoin_tx_output.type, bitcoin_tx_output.hash from bitcoin_tx_input, bitcoin_tx_output where bitcoin_tx_input.tx_index = bitcoin_tx_output.tx_index and prev_tx_index in ("+or+") AND bitcoin_tx_output.hash is not NULL AND hash not in ("+orhash+")");

            int ii = 1;
            for (Integer txIndex : txIndexes) {
                select_stmt.setInt(ii, txIndex);
                ++ii;
            }

            for (BitcoinAddress hash : settings.myAddresses) {
                select_stmt.setBytes(ii, hash.getBytes());
                ++ii;
            }

            ResultSet results = select_stmt.executeQuery();

            while(results.next()) {
                Integer tx_index = results.getInt(1);
                Short prev_tx_output_n = results.getShort(2);

                if (!outPoints.contains(new Pair<>(tx_index, prev_tx_output_n)))
                    continue;

                DBOutput prevOut = new DBOutput();
                prevOut.setTxIndex(results.getInt(3));
                prevOut.setTxOutputN(results.getShort(4));
                prevOut.setValue(results.getLong(5));
                prevOut.setType(results.getShort(6));

                byte[] hash = results.getBytes(7);
                if (hash != null) {
                    prevOut.setAddress(hash);
                }

                Set<DBOutput> outs = data.get(tx_index);

                //If the previousOutput Hasn't been seen before add it
                if (outs == null) {
                    outs = new HashSet<>();
                    data.put(tx_index, outs);
                }

                if (outs.add(prevOut)) {
                    newOutputs.add(prevOut);
                }
            }

            return newOutputs;
        } finally {
            select_stmt.close();
        }
    }


    public static List<DBOutput> getPreviousOutputs(Connection conn, Map<Integer, Set<DBOutput>> data, List<DBOutput> outputs, Settings settings, Set<DBOutput> fromSelf) throws SQLException {

        List<DBOutput> newOutputs = new ArrayList<>();

        //Limited ot batches of maxQuerySize
        if (outputs.size() > settings.maxQuerySize) {
            List<DBOutput> trimmed = outputs.subList(settings.maxQuerySize, outputs.size());

            newOutputs.addAll(trimmed);

            outputs = outputs.subList(0, settings.maxQuerySize);
        }

        Set<Integer> txIndexes = new HashSet<>();
        for (DBOutput output : outputs) {
            if (data.containsKey(output.getTxIndex()))
                continue;

            txIndexes.add(output.getTxIndex());
        }

        if (txIndexes.size() == 0)
            return newOutputs;

        StringBuffer or = new StringBuffer();
        for (Integer txIndex : txIndexes) {
            or.append("?,");
        }
        or.deleteCharAt(or.length()-1);

        settings.taskQueryCount++;

        PreparedStatement select_stmt = null;
        try {
            select_stmt = conn.prepareStatement("select bitcoin_tx_input.tx_index, bitcoin_tx_output.tx_index, bitcoin_tx_output.tx_output_n, bitcoin_tx_output.value, bitcoin_tx_output.type, bitcoin_tx_output.hash from bitcoin_tx_input, bitcoin_tx_output where bitcoin_tx_input.tx_index in ("+or+") AND bitcoin_tx_output.tx_index = bitcoin_tx_input.prev_tx_index AND bitcoin_tx_output.tx_output_n = bitcoin_tx_input.prev_tx_output_n AND bitcoin_tx_input.prev_tx_index > 0 AND bitcoin_tx_output.hash is not NULL");

            int ii = 1;
            for (Integer txIndex : txIndexes) {
                select_stmt.setInt(ii, txIndex);
                ++ii;
            }

            ResultSet results = select_stmt.executeQuery();

            while(results.next()) {
                Integer tx_index = results.getInt(1);

                DBOutput prevOut = new DBOutput();
                prevOut.setTxIndex(results.getInt(2));
                prevOut.setTxOutputN(results.getShort(3));
                prevOut.setValue(results.getLong(4));
                prevOut.setType(results.getShort(5));

                byte[] hash = results.getBytes(6);
                if (hash != null) {
                    prevOut.setAddress(hash);
                }

                Set<DBOutput> outs =  data.get(tx_index);

                //If the previousOutput Hasn't been seen before add it
                if (outs == null) {
                    outs = new HashSet<>();
                    data.put(tx_index, outs);
                }

                if (outs.add(prevOut)) {
                    newOutputs.add(prevOut);
                }
            }

            return newOutputs;
        } finally {
            select_stmt.close();
        }
    }

    public static void _calcTaint(Connection conn, Map<Integer, Set<DBOutput>> outsMap, Map<BitcoinAddress, Taint> unfilteredTaints, DBOutput output, double taintCap, Settings settings) throws SQLException {
        try {
            settings.taskCurrentDepth++;

            settings.taskMaxDepth = Math.max(settings.taskMaxDepth, settings.taskCurrentDepth);

            if (unfilteredTaints.size() >= settings.maxEntries) {
                return;
            }

            if (!settings.done.add(output)) {
                return;
            }

            Collection<DBOutput> prevOuts = outsMap.get(output.getTxIndex());

            if (prevOuts == null) {
                if (taintCap > settings.minTaint && settings.taskCurrentDepth < settings.maxDepth && settings.taskQueryCount < settings.maxQueryCount) {

                    if (settings.reverseTaint)
                        prevOuts = getSpendingOutputs(conn, outsMap, Collections.singletonList(output), settings, null);
                    else
                        prevOuts = getPreviousOutputs(conn, outsMap, Collections.singletonList(output), settings, null);
                }
            }

            if (prevOuts == null || prevOuts.size() == 0) {
                return;
            }

            long valueAtThisLevel = 0;
            for (DBOutput prevOut : prevOuts) {
                valueAtThisLevel += prevOut.getValue();
            }

            for (DBOutput prevOut : prevOuts) {
                double nTaint = ((double)prevOut.getValue() / valueAtThisLevel) *  taintCap;

                if (prevOut.getAddress() != null && !Double.isNaN(nTaint)) {

                    if (nTaint > 90d)
                        settings.veryTaintedTxIndexes.add(prevOut.getTxIndex());

                    Taint existing = unfilteredTaints.get(prevOut.getAddress());
                    if (existing == null) {
                        Taint newTaint = new Taint(nTaint, prevOut.getTxIndex(), settings.taskCurrentRoot);

                        unfilteredTaints.put(prevOut.getAddress(), newTaint);

                        newTaint.seenInThisBranchBeforeThisLevel = true;
                        newTaint.seenInThisBranch = true;
                        newTaint.lowestDepth = settings.taskCurrentDepth;

                        _calcTaint(conn, outsMap, unfilteredTaints, prevOut, ((double)prevOut.getValue() / valueAtThisLevel) *  taintCap, settings);

                        newTaint.seenInThisBranchBeforeThisLevel = false;
                    } else {
                        existing.count++;

                        existing.lowestDepth = Math.min(existing.lowestDepth, settings.taskCurrentDepth);

                        if (!existing.seenInThisBranch) {
                            existing.nBranches++;
                            existing.seenInThisBranch = true;
                        }

                        if (!existing.seenInThisBranchBeforeThisLevel) {
                            existing.taint += nTaint;

                            existing.seenInThisBranchBeforeThisLevel = true;

                            _calcTaint(conn, outsMap, unfilteredTaints, prevOut, nTaint, settings);

                            existing.seenInThisBranchBeforeThisLevel = false;
                        } else {
                            _calcTaint(conn, outsMap, unfilteredTaints, prevOut, nTaint, settings);
                        }
                    }
                }
            }

        } finally {
            settings.taskCurrentDepth--;

        }
    }

    private static String randomColor() {
        Random rand = new Random();

        // Java 'Color' class takes 3 floats, from 0 to 1.
        // Will produce only bright / light colours:
        float r = (rand.nextFloat() % 0.5f) + 0.5f;
        float g = (rand.nextFloat() % 0.5f) + 0.5f;
        float b = (rand.nextFloat()  % 0.5f) + 0.5f;

        return Integer.toHexString(new Color(r, g, b).getRGB() & 0x00ffffff);
    }


    public static Map<BitcoinAddress, Taint> getTaints(DBBitcoinAddress address, Settings settings) throws SQLException, AddressFormatException {
        DBBitcoinWallet wallet = new DBBitcoinWallet();

        wallet.addAddress(address);

        return TaintServlet.getTaints(wallet, settings).get(address);
    }

    public static Map<BitcoinAddress, Map<BitcoinAddress, Taint>> getTaints(DBBitcoinWallet wallet, Settings settings) throws SQLException {
        settings.myAddresses = new HashSet<>(wallet.getAddresses());

        Map<Integer, Set<DBOutput>> outsMap = new HashMap<>();
        Set<DBOutput> fromSelf = new HashSet<>();
        {
            Connection conn = BitcoinDatabaseManager.conn();
            try {
                if (wallet.getOutputs() == null || wallet.getOutputs().size() == 0)
                  wallet.getOutputs(conn, settings.maxInitialOutputs, 0, 0);

                List<DBOutput> outsToFetch = new ArrayList<>(wallet.getOutputs());

                Collections.sort(outsToFetch, Collections.reverseOrder());

                int depth = 0;
                while (outsMap.size() <= settings.maxInitialOutputs && depth < settings.maxQueryCount) {

                    List<DBOutput> newOuts = null;
                    if (settings.reverseTaint)
                        newOuts = getSpendingOutputs(conn, outsMap, outsToFetch, settings, fromSelf);
                    else
                        newOuts = getPreviousOutputs(conn, outsMap, outsToFetch, settings, fromSelf);

                    if (newOuts.size() == 0) {
                        break;
                    }

                    outsToFetch = newOuts;

                    ++depth;
                }
            } finally {
                BitcoinDatabaseManager.close(conn);
            }
        }

        Map<BitcoinAddress, Map<BitcoinAddress, Taint>> filteredTaints = new HashMap<>();

        for (DBBitcoinAddress address : settings.myAddresses) {
            Map<BitcoinAddress, Taint> addressSpecificTaints = new HashMap<>();

            List<DBOutput> outputs = wallet.getOutputs(address);

            long totalReceived = 0;
            for (DBOutput out : outputs) {
                //Don't include transactions from self
                if (fromSelf.contains(out)) {
                    continue;
                }

                totalReceived += out.getValue();
            }

            {
                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    for (DBOutput output : outputs) {
                        //Don't include transactions from self
                        if (fromSelf.contains(output)) {
                            continue;
                        }

                        double cTaint =  ((double)output.getValue() / totalReceived) *  100d;

                        if (cTaint > 100)
                            throw new SQLException("nTaint > 100 Shouldn't happen (0) " + ("cTaint " + cTaint + " Value " + output.getValue() + " valueAtThisLevel " + totalReceived + " taintCap " + 100d));

                        settings.taskCurrentRoot = output;

                        _calcTaint(conn, outsMap, addressSpecificTaints, output, cTaint, settings);

                        for (Taint taint : addressSpecificTaints.values()) {
                            taint.seenInThisBranch = false;
                        }
                    }
                } finally {
                    BitcoinDatabaseManager.close(conn);
                }

                settings.done.clear();
            }

            if (addressSpecificTaints.keySet().size() > 0) {
                filteredTaints.put(address, addressSpecificTaints);
            }
        }

        return filteredTaints;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
        try {
            super.doGet(req, res);
        } catch (ServletException e) {
            return;
        }

        try {
            DBBitcoinWallet wallet = new DBBitcoinWallet();

            String[] addrs;

            boolean json = (req.getParameter("format") != null && req.getParameter("format").equals("json"));

            if (req.getParameter("active") != null) {
                addrs = req.getParameter("active").split("\\|");
            } else {
                if (req.getPathInfo() == null) {
                    req.setAttribute("not_found", "You must provide a transaction index");
                    getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
                    return;
                }

                String pathString = req.getPathInfo().substring(1);

                if (pathString == null || pathString.length() == 0) {
                    req.setAttribute("not_found", "You must provide a transaction index");
                    getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
                    return;
                }

                String components[] = pathString.split("/", -1);

                if (components.length == 0 || components[0].length() == 0) {
                    req.setAttribute("not_found", "You must provide a transaction index");
                    getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
                    return;
                }

                addrs = components[0].split("\\|");
            }

            if (addrs == null || addrs.length == 0 || addrs.length > WalletServlet.MaxAddresses) {
                res.setStatus(500);
                res.getOutputStream().print("Number of addresses must be between 1 and " + WalletServlet.MaxAddresses);
                return;
            }

            for (String addr : addrs) {
                try {
                    wallet.addAddress(new DBBitcoinAddress(addr));
                } catch (Exception e) {
                    req.setAttribute("not_found", "A bitcoin address you provided is invalid");
                    getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
                    return;
                }
            }

            Settings settings = new Settings();

            settings.reverseTaint = (req.getParameter("reversed") != null &&  req.getParameter("reversed").equals("true"));

            req.setAttribute("settings", settings);

            Map<BitcoinAddress, Map<BitcoinAddress, Taint>> taints = getTaints(wallet, settings);

            if (addrs.length == 1) {
                DBBitcoinAddress address = wallet.getAddresses().iterator().next();

                //Generate colors for root branches
                Map<DBOutput, String> colors = new HashMap<>();
                req.setAttribute("colors", colors);
                for (DBOutput output : wallet.getOutputs()) {
                    colors.put(output, randomColor());
                }

                Map<BitcoinAddress, Taint> addressSpecificTaints = taints.get(address);

                if (addressSpecificTaints == null) {
                    req.setAttribute("not_found", "No Taints Found");
                    getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
                    return;
                }

                ValueComparator bvc =  new ValueComparator(addressSpecificTaints);

                TreeMap<BitcoinAddress, Taint> sorted_map = new TreeMap(bvc);

                sorted_map.putAll(addressSpecificTaints);

                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    //We have already fetch the outputs
                    wallet.getInputs(conn, 500);

                    wallet.calculateTxResults();

                    List<Integer> txIndexes = new ArrayList<>(wallet.getSentTxIndexes());

                    txIndexes.addAll(settings.veryTaintedTxIndexes);

                    //Sort descending
                    Collections.sort(txIndexes, Collections.reverseOrder());

                    List<DBBitcoinAddress.RelayedBean> beans = DBBitcoinAddress.getRelayedIps(conn, txIndexes);

                    req.setAttribute("relayed_beans", beans);
                } finally {
                    BitcoinDatabaseManager.close(conn);
                }

                req.setAttribute("taints", sorted_map);

                req.setAttribute("address", address);

                if (json) {
                    getServletContext().getRequestDispatcher("/WEB-INF/"+ BaseServlet.ROOT + "taint/bitcoin-taint-single-json.jsp").forward(req, res);
                } else {
                    getServletContext().getRequestDispatcher("/WEB-INF/"+ BaseServlet.ROOT + "taint/bitcoin-taint-single.jsp").forward(req, res);
                }
            } else {

                //Remove the taints we are not interested in
                for (Map<BitcoinAddress, Taint> taintMap : taints.values()) {

                    System.out.println(wallet.getAddresses());

                    taintMap.keySet().retainAll(wallet.getAddresses());
                }

                Collection<BitcoinAddress> addresses = taints.keySet();

                req.setAttribute("addresses", addresses);

                req.setAttribute("filteredTaints", taints);

                List<Pair<BitcoinAddress, List<Double>>> matrix = new ArrayList<>();

                List<BitcoinAddress> addresses_copy = new ArrayList<>(addresses);

                for (BitcoinAddress address : addresses_copy) {
                    Pair<BitcoinAddress, List<Double>> pair = new Pair<BitcoinAddress, List<Double>>(address, new ArrayList<Double>());

                    double totalTaint = 0;
                    Map<BitcoinAddress, Taint> map = taints.get(address);
                    for (Taint taint : map.values()) {
                        totalTaint += taint.getTaint();
                    }

                    int ii = 0;
                    int self = 0;
                    for (BitcoinAddress address2 : addresses_copy) {
                        Taint taint = map.get(address2);

                        if (address.equals(address2)) {
                            self = ii;
                            pair.getSecond().add(0d);
                        } else if (taint == null) {
                            pair.getSecond().add(0d);
                        } else {
                            pair.getSecond().add((taint.taint / totalTaint) * 100d);
                        }

                        ++ii;
                    }

                    double totalTaint2 = 0;
                    for (Double val : pair.getSecond()) {
                        totalTaint2 += val;
                    }

                    pair.getSecond().set(self, 100d - totalTaint2);

                    matrix.add(pair);
                }

                req.setAttribute("matrix", matrix);

                if (json) {
                    getServletContext().getRequestDispatcher("/WEB-INF/"+ BaseServlet.ROOT + "taint/bitcoin-taint-multi-json.jsp").forward(req, res);
                } else  {
                    getServletContext().getRequestDispatcher("/WEB-INF/"+ BaseServlet.ROOT + "taint/bitcoin-taint-multi.jsp").forward(req, res);
                }
            }
        } catch (Exception e1) {
            e1.printStackTrace();

            res.setStatus(500);

            req.setAttribute("not_found", "Unknown Exception: " + e1.getLocalizedMessage());
            getServletContext().getRequestDispatcher(BaseServlet.ROOT).forward(req, res);
        }

    }
}
