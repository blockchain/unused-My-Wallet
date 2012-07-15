package piuk.website;


import com.google.bitcoin.core.AddressFormatException;
import com.google.bitcoin.core.Base58;
import com.google.bitcoin.core.ECKey;
import com.google.bitcoin.core.NetworkParameters;
import org.json.JSONObject;
import piuk.api.ChainManager;
import piuk.beans.BitcoinAddress;
import piuk.common.Pair;
import piuk.db.BitcoinDatabaseManager;
import piuk.db.DBBitcoinBlock;
import piuk.db.DBBitcoinTx;
import piuk.merchant.MyWallet;
import piuk.website.admin.ProcessForwardsOperation;

import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@WebServlet({ HomeServlet.ROOT + "forwarder" })
public class ForwardingServlet extends BaseServlet {
    public static final double MixingFeePercent = 1.5;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
        try {
            super.doGet(req, res);
        } catch (ServletException e) {
            return;
        }

        String action = req.getParameter("action");

        if (action == null)
            return;

        try {
            if (action.equals("create-mix")) {
                String destinationAddress = req.getParameter("address");

                if (destinationAddress == null)
                    throw new Exception("You Must Provide a Destination Address");

                BitcoinAddress address = new BitcoinAddress(destinationAddress);

                if (address == null || !address.toString().equals(destinationAddress))
                    throw new Exception("Error parsing Destination address");

                Connection conn = BitcoinDatabaseManager.conn();
                try {
                    conn.setAutoCommit(false);

                    Pair<BitcoinAddress, String> input_generated = ProcessForwardsOperation.generateNewEncryptedPK();
                    Pair<BitcoinAddress, String> output_generated = ProcessForwardsOperation.generateNewEncryptedPK();

                    //Create one forwarding which the user needs to fund
                    ProcessForwardsOperation.Forwarding first = new ProcessForwardsOperation.Forwarding();

                    first.input_address = input_generated.getFirst().toString();
                    first.input_priv = input_generated.getSecond();
                    first.output_address = output_generated.getFirst().toString();
                    first.taint = 0;
                    first.fee_percent = MixingFeePercent;
                    first.confirmations = 0;

                    if (!first.insert(conn)) {
                        throw new SQLException(("Error inserting input_generated forwarding pair"));
                    }

                    //Insert the second forwarding
                    ProcessForwardsOperation.Forwarding second = new ProcessForwardsOperation.Forwarding();

                    second.input_address = output_generated.getFirst().toString();
                    second.input_priv = output_generated.getSecond();
                    second.output_address = destinationAddress;
                    second.taint = 100; //No taint Requirement for second stage
                    second.fee_percent = 0; //No Fee For Second Stage
                    second.confirmations = 0; //Confirmations not needed

                    if (!second.insert(conn)) {
                        throw new SQLException(("Error inserting output_generated forwarding pair"));
                    }

                    conn.commit();

                    JSONObject obj = new JSONObject();

                    obj.put("input_address", input_generated.getFirst().toString());
                    obj.put("destination", destinationAddress);

                    res.setContentType("text/json");

                    System.out.println(obj.toString());

                    res.getOutputStream().print(obj.toString());

                } catch (Exception e) {
                    conn.rollback();

                    throw e;
                } finally {
                    BitcoinDatabaseManager.close(conn);
                }
            }
        } catch (Exception e) {

            e.printStackTrace();

            res.setContentType("text/plain");
            res.setStatus(500);
            res.getOutputStream().print(e.getLocalizedMessage());
        }
    }
}