package piuk.website;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Serializable;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.URLEncoder;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.mail.internet.InternetAddress;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.codec.binary.Base32;
import org.apache.commons.codec.binary.Base64;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang.StringEscapeUtils;
import org.apache.commons.lang.StringUtils;
import org.bouncycastle.util.encoders.Hex;
import org.jsoup.Jsoup;

import com.dropbox.client2.DropboxAPI;
import com.dropbox.client2.session.AccessTokenPair;
import com.dropbox.client2.session.AppKeyPair;
import com.dropbox.client2.session.RequestTokenPair;
import com.dropbox.client2.session.Session.AccessType;
import com.dropbox.client2.session.WebAuthSession;
import com.dropbox.client2.session.WebAuthSession.WebAuthInfo;
import com.google.api.client.auth.oauth2.Credential;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeRequestUrl;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeTokenRequest;
import com.google.api.client.googleapis.auth.oauth2.GoogleClientSecrets;
import com.google.api.client.googleapis.auth.oauth2.GoogleCredential;
import com.google.api.client.googleapis.auth.oauth2.GoogleTokenResponse;
import com.google.api.client.http.ByteArrayContent;
import com.google.api.client.http.HttpTransport;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.JsonFactory;
import com.google.api.client.json.jackson.JacksonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.model.File;
import com.google.bitcoin.core.ECKey;
import com.google.bitcoin.core.NetworkParameters;
import com.yubico.client.v2.YubicoClient;
import com.yubico.client.v2.YubicoResponse;
import com.yubico.client.v2.YubicoResponseStatus;

import piuk.api.RMIClient;
import piuk.api.NotificationsManager;
import piuk.beans.BitcoinAddress;
import piuk.db.BitcoinDatabaseManager;
import piuk.db.Cache;
import piuk.db.DBBitcoinAddress;
import piuk.merchant.MyWallet;
import piuk.website.admin.AdminServlet;
import piuk.common.Pair;
import piuk.website.admin.RequestLimiter;
import piuk.common.Scrambler;

/**
 * Servlet implementation class ChartsServlet
 */
@WebServlet({ HomeServlet.ROOT + "wallet/*", HomeServlet.ROOT + "pwallet/*" })
public class WalletServlet extends BaseServlet {
	public static final long serialVersionUID = 1L;
	public static final int AuthTypeStandard = 0;
	public static final int AuthTypeYubikey = 1;
	public static final int AuthTypeEmail = 2;
	public static final int AuthTypeYubikeyMtGox = 3;
	public static final int AuthTypeGoogleAuthenticator = 4;

	public static final String DemoAccountGUID = "abcaa314-6f67-6705-b384-5d47fbe9d7cc";

	private static final int MaxFailedLogins = 4;
	private static final int EmailCodeLength = 5;
	private static final int GoogleAuthentictorSecretSize = 10; //128 bits

	final static private String DROPBOX_APP_KEY = AdminServlet.DROPBOX_APP_KEY;
	final static private String DROPBOX_APP_SECRET = AdminServlet.DROPBOX_APP_SECRET;
	final static private AccessType DROPBOX_ACCESS_TYPE = AccessType.APP_FOLDER;
	final static private String DROPBOX_CACHE_PREFIX = "drop:";
	final static private String DROPBOX_CALLBACK = "https://blockchain.info/wallet/dropbox-update";

	public static final JsonFactory GDRIVE_JSON_FACTORY = new JacksonFactory();
	public static final HttpTransport GDRIVE_TRANSPORT = new NetHttpTransport();
	public static final String CLIENT_SECRETS_FILE_PATH  = "/client_secrets.json";
	public static GoogleClientSecrets GDRIVE_SECRETS; //Initizialized by ContextListener
	public static final List<String> GDRIVE_SCOPES = Arrays.asList(
			"https://www.googleapis.com/auth/drive.file",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile");

	final static private String GDRIVE_CACHE_PREFIX = "drop:";
	final static public boolean EnablePaymentWall = false;
	final static int DROPBOX_CACHE_EXPIRY = 2629743; //1 Month
	final public static int MaxAddresses = 400;

	public static class GoogleAuthenticator {
		public static String generateSecret() {
			SecureRandom random = new SecureRandom();
			byte bytes[] = new byte[32];
			random.nextBytes(bytes);

			Base32 codec = new Base32();
			byte[] secretKey = Arrays.copyOf(bytes, GoogleAuthentictorSecretSize);
			byte[] bEncodedKey = codec.encode(secretKey);
			return new String(bEncodedKey);
		}

		public static String getQRBarcodeURL(String user, String host, String secret) {
			return "otpauth://totp/"+user+"@"+host+"?secret="+secret;
		}

		private static int verify_code(byte[] key,long t) throws NoSuchAlgorithmException, InvalidKeyException {
			byte[] data = new byte[8];
			long value = t;
			for (int i = 8; i-- > 0; value >>>= 8) {
				data[i] = (byte) value;
			}

			SecretKeySpec signKey = new SecretKeySpec(key, "HmacSHA1");
			Mac mac = Mac.getInstance("HmacSHA1");
			mac.init(signKey);
			byte[] hash = mac.doFinal(data);


			int offset = hash[20 - 1] & 0xF;

			// We're using a long because Java hasn't got unsigned int.
			long truncatedHash = 0;
			for (int i = 0; i < 4; ++i) {
				truncatedHash <<= 8;
				// We are dealing with signed bytes:
				// we just keep the first byte.
				truncatedHash |= (hash[offset + i] & 0xFF);
			}

			truncatedHash &= 0x7FFFFFFF;
			truncatedHash %= 1000000;

			return (int) truncatedHash;
		}

		public static boolean check_code(String secret, long code, long t) throws NoSuchAlgorithmException, InvalidKeyException {
			Base32 codec = new Base32();
			byte[] decodedKey = codec.decode(secret);


			// Window is used to check codes generated in the near past.
			// You can use this value to tune how far you're willing to go. 
			int window = 5;
			for (int i = -window; i <= window; ++i) {
				long hash = verify_code(decodedKey, (t - 1) + i);
				if (hash == code) {
					return true;
				}
			}
			// The validation code is invalid.
			return false;
		}
	}

	public static class DropBoxCacheEntry implements Serializable {
		private static final long serialVersionUID = 5L;
		private final String guid;
		private final String key;
		private final String secret;
		private String accessTokenKey;
		private String accessTokenSecret;

		public DropBoxCacheEntry(String guid, String key, String secret) {
			super();
			this.guid = guid;
			this.key = key;
			this.secret = secret;
		}

		public AccessTokenPair getAccessToken() {
			if (accessTokenKey == null || accessTokenSecret == null)
				return null;

			return new AccessTokenPair(accessTokenKey, accessTokenSecret);
		}

		public void setAccessToken(AccessTokenPair accessToken) {
			this.accessTokenKey = accessToken.key;
			this.accessTokenSecret = accessToken.secret;
		}

		public String getGuid() {
			return guid;
		}

		public String getKey() {
			return key;
		}

		public String getsecret() {
			return secret;
		}
	}


	protected static boolean doGDriveBackup(Connection conn, String guid, String code) {

		try { 
			String refreshToken = (String) Cache.get(GDRIVE_CACHE_PREFIX + code);

			Credential credentials = null;
			if (refreshToken != null) {
				credentials =  new GoogleCredential.Builder()
				.setClientSecrets(GDRIVE_SECRETS)
				.setTransport(GDRIVE_TRANSPORT)
				.setJsonFactory(GDRIVE_JSON_FACTORY)
				.build().setRefreshToken(refreshToken);
			} else {
				GoogleTokenResponse response =
						new GoogleAuthorizationCodeTokenRequest(
								GDRIVE_TRANSPORT,
								GDRIVE_JSON_FACTORY,
								GDRIVE_SECRETS.getWeb().getClientId(),
								GDRIVE_SECRETS.getWeb().getClientSecret(),
								code, 
								GDRIVE_SECRETS.getWeb().getRedirectUris().get(0)).execute();

				credentials =  new GoogleCredential.Builder()
				.setClientSecrets(GDRIVE_SECRETS)
				.setTransport(GDRIVE_TRANSPORT)
				.setJsonFactory(GDRIVE_JSON_FACTORY)
				.build().setFromTokenResponse(response);

				Cache.put(GDRIVE_CACHE_PREFIX + code, credentials.getRefreshToken(), DROPBOX_CACHE_EXPIRY);
			}

			Drive drive = Drive.builder(GDRIVE_TRANSPORT, GDRIVE_JSON_FACTORY).setHttpRequestInitializer(credentials).build();

			PreparedStatement selectPayload = conn.prepareStatement("select payload from bitcoin_wallets where guid = ?");

			String payload = null;

			try {
				selectPayload.setString(1, guid);

				ResultSet results = selectPayload.executeQuery();

				if (results.next()) {

					payload = results.getString(1);
				} else {
					throw new Exception("Unauthorized");
				}

			} finally {
				BitcoinDatabaseManager.close(selectPayload);
			}

			if (payload != null && payload.length() > 0) {
				SimpleDateFormat format = new SimpleDateFormat("dd_MM_yyyy_HH_mm_ss");

				String dateString = format.format(new Date());

				String fileName = "wallet_"+dateString+".aes.json";

				File file = new File();
				file.setId(fileName);
				file.setTitle(fileName);
				file.setDescription(fileName);
				file.setMimeType("text/plain");

				drive.files().insert(file, new ByteArrayContent("text/plain", payload.getBytes("UTF-8"))).execute();

				return true;
			} else {
				throw new Exception("Null payload");
			}

		} catch (Exception e) {
			return false;
		}
	}

	protected static boolean doDropboxBackup(Connection conn, String oauth_token) {
		try {
			DropBoxCacheEntry entry = (DropBoxCacheEntry) Cache.get(DROPBOX_CACHE_PREFIX + oauth_token);

			if (entry == null) {
				throw new Exception("Could not find dropbox authentication session");
			}

			AppKeyPair appKeys = new AppKeyPair(DROPBOX_APP_KEY, DROPBOX_APP_SECRET);

			WebAuthSession dropboxSession = null;

			if (entry.getAccessToken() != null) {
				dropboxSession = new WebAuthSession(appKeys, DROPBOX_ACCESS_TYPE, entry.getAccessToken());
			} else {
				dropboxSession = new WebAuthSession(appKeys, DROPBOX_ACCESS_TYPE);

				dropboxSession.retrieveWebAccessToken(new RequestTokenPair(entry.getKey(), entry.getsecret()));

				//Update the access token and re-save the cache entry
				entry.setAccessToken(dropboxSession.getAccessTokenPair());

				Cache.put(DROPBOX_CACHE_PREFIX + oauth_token, entry, DROPBOX_CACHE_EXPIRY);
			}

			DropboxAPI<WebAuthSession> api = new DropboxAPI<WebAuthSession>(dropboxSession);

			String payload = null;

			PreparedStatement selectPayload = conn.prepareStatement("select payload from bitcoin_wallets where guid = ?");

			try {
				selectPayload.setString(1, entry.getGuid());

				ResultSet results = selectPayload.executeQuery();

				if (results.next()) {
					payload = results.getString(1);
				} else {
					throw new Exception("Unauthorized");
				}

			} finally {
				BitcoinDatabaseManager.close(selectPayload);
			}

			if (payload != null && payload.length() > 0) {
				InputStream stream = new ByteArrayInputStream(payload.getBytes("UTF-8"));

				SimpleDateFormat format = new SimpleDateFormat("dd_MM_yyyy_HH_mm_ss");

				String dateString = format.format(new Date());

				api.putFile("wallet_"+dateString+".aes.json", stream, stream.available(), null, null);

				return true;
			} else {
				throw new Exception("Null payload");
			}
		} catch (Exception e) {
			return false;
		}
	}

	public static class WalletObject {
		String payload;
		String email;
		int auth_type;
		String yubikey;
		long account_locked_time;
		int failed_logins; 
		String email_code;
		String guid;
		int notifications_type;
		long email_code_last_updated;
		byte[] payload_checksum;
		String google_secret;
		String shared_key;
		String secret_phrase;
		int email_verified;
		String http_url;
		String skype_username;
		int notifications_on;
		int notifications_confirmations;
		int auto_email_backup;
		String alias;


		public static WalletObject getWallet(Connection conn, String guid) throws SQLException {
			return getWallet(conn, guid, null);
		}

		public static WalletObject getWallet(Connection conn, String guid, String alias) throws SQLException {
			WalletObject obj = new WalletObject();

			String sql = "select guid, payload, auth_type, yubikey, email, acount_locked_time, email_code, notifications_type, email_code_last_updated, failed_logins, payload_checksum, google_secret, shared_key, secret_phrase, email_verified, http_url, skype_username, notifications_on, notifications_confirmations, auto_email_backup, alias from bitcoin_wallets where guid = ?";


			if (alias != null)
				sql += " or alias = ?";

			PreparedStatement smt = conn.prepareStatement(sql);
			try {
				smt.setString(1, guid);

				if (alias != null)
					smt.setString(2, alias); //Alias

				//Should not be using it anymore
				guid = null;

				ResultSet results = smt.executeQuery();

				if (results.next()) {	

					obj.guid = results.getString(1);
					obj.payload = results.getString(2);
					obj.auth_type = results.getInt(3);
					obj.yubikey = results.getString(4);
					obj.email = results.getString(5);
					obj.account_locked_time = results.getLong(6);
					obj.email_code = results.getString(7);
					obj.notifications_type = results.getShort(8);
					obj.email_code_last_updated = results.getLong(9);
					obj.failed_logins = results.getInt(10);
					obj.payload_checksum = results.getBytes(11);
					obj.google_secret = results.getString(12);
					obj.shared_key = results.getString(13);
					obj.secret_phrase = results.getString(14);
					obj.email_verified = results.getInt(15);
					obj.http_url = results.getString(16);
					obj.skype_username = results.getString(17);
					obj.notifications_on = results.getInt(18);
					obj.notifications_confirmations = results.getInt(19);
					obj.auto_email_backup = results.getInt(20);
					obj.alias = results.getString(21);

					return obj;
				} 
			} finally {
				BitcoinDatabaseManager.close(smt);
			}

			return null;
		}
	}


	public List<String> guidFromEmail(Connection conn, String email) throws SQLException {
		List<String> data = new ArrayList<String>();

		PreparedStatement select = conn.prepareStatement("select guid from bitcoin_wallets where email = ? limit 3");
		try {
			select.setString(1, email);

			ResultSet results = select.executeQuery();

			while(results.next()) {	
				data.add(results.getString(1));
			}
		} finally {
			BitcoinDatabaseManager.close(select);
		}

		return data;
	}

	@Override
	protected void doGet(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
		try {
			super.doGet(req, res);
		} catch (ServletException e) {
			return;
		}

		req.setAttribute("no_search", true);
		req.setAttribute("show_adv", false);

		req.setAttribute("resource", LOCAL_RESOURCE_URL); //Never use static.blockchain.info

		req.setAttribute("no_footer", true);
		req.setAttribute("home_active", null);
		req.setAttribute("wallet_active", " class=\"active\"");
		req.setAttribute("enable_paymentwall", EnablePaymentWall);
		req.setAttribute("enable_deposit", true);
		req.setAttribute("dev_mode", devMode);
		req.setAttribute("slogan", "Be Your Own Bank");

		//Make all links absolute
		req.setAttribute("root", HTTPS_ROOT);

		if (req.getPathInfo() == null || req.getPathInfo().length() == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		String pathString = req.getPathInfo().substring(1);
		String components[] = pathString.split("/", -1);

		if (pathString == null || pathString.length() == 0 || components.length == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		/** If no special cases were matched we actually display the wallet to the user from here on **/

		//Force https:// on all reauests from here on
		if (!req.isSecure() && !devMode) {
			req.setAttribute("initial_error", "You must use https:// not http:// please update your link");
			getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		} else {
			//If were using https:// we can make link relative again
			req.setAttribute("root", ROOT);
		}


		//Does not need to be escaped as it is never output
		String guid = components[0].trim();

		Connection conn = BitcoinDatabaseManager.conn();

		try {	
			if (guid.equals("faq")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-beginners-faq.jsp").forward(req, res);
				return;
			}if (guid.equals("technical-faq")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-technical-faq.jsp").forward(req, res);
				return;
			} else if (guid.equals("login")) {
				String saved_guid = getCookieValue(req, "cguid");

				if (saved_guid != null && saved_guid.length() == 36 && !saved_guid.equals(DemoAccountGUID)) {
					res.sendRedirect(BaseServlet.ROOT + "wallet/" + saved_guid);
					return;
				} else {
					req.setAttribute("guid", "");
					getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);
				}
				return;
			} else if (guid.equals("new")) { //Special case for demo account - send users to signup page instead
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-new.jsp").forward(req, res);
				return;
			} else if (guid.equals("paypal-vs-bitcoin")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-vs-paypal.jsp").forward(req, res);
				return;
			} else if (guid.equals("android-app")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-android.jsp").forward(req, res);
				return;
			} else if (guid.equals("iphone-app")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-iphone.jsp").forward(req, res);
				return;
			} else if (guid.equals("sms-phone-deposits")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-sms.jsp").forward(req, res);
				return;
			} else if (guid.equals("yubikey")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-yubikey.jsp").forward(req, res);
				return;
			} else if (guid.equals("google-authenticator")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-google-authenticator.jsp").forward(req, res);
				return;
			} else if (guid.equals("security")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-security.jsp").forward(req, res);
				return;
			} else if (guid.equals("devices")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-devices.jsp").forward(req, res);
				return;
			} else if (guid.equals("support-pages")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-support.jsp").forward(req, res);
				return;
			} else if (guid.equals("paper-tutorial")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-paper-tutorial.jsp").forward(req, res);
				return;
			} else if (guid.equals("payment-notifications")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-notifications.jsp").forward(req, res);
				return;
			} else if (guid.equals("backups")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-backups.jsp").forward(req, res);
				return;
			} else if (guid.equals("anonymity")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-anonymity.jsp").forward(req, res);
				return;
			} else if (guid.equals("wallet-format")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-format.jsp").forward(req, res);
				return;
			} else if (guid.equals("escrow")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-escrow.jsp").forward(req, res);
				return;
			} else if (guid.equals("buy-one-bitcoin")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-buy-one-bitcoin.jsp").forward(req, res);
				return;
			} else if (guid.equals("features")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-features.jsp").forward(req, res);
				return;
			} else if (guid.equals("features")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-features.jsp").forward(req, res);
				return;
			} else if (guid.equals("verifier")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-verifier.jsp").forward(req, res);
				return;
			} else if (guid.equals("decryption-error")) {
				req.setAttribute("no_header", true);
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/mobile/bitcoin-wallet-decryption-error.jsp").forward(req, res);
				return;
			} else if (guid.equals("deposit-methods")) {
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/bitcoin-wallet-deposit-methods.jsp").forward(req, res);
				return;
			}  else if (guid.equals("wallet.404.manifest")) {
				res.setStatus(404);
				return;
			} else if (guid.equals("wallet.manifest")) {

				res.addHeader("Cache-Control", "max-age=0, no-cache, no-store, must-revalidate");
				res.addHeader("Pragma", "no-cache");
				res.addHeader("Expires", "Wed, 11 Jan 1984 05:00:00 GMT");
				res.addHeader("Content-type", "text/cache-manifest");

				guid = req.getParameter("guid");

				if (guid != null) {
					UUID rguid = UUID.fromString(guid);

					PreparedStatement select = conn.prepareStatement("select payload_checksum, auth_type from bitcoin_wallets where guid = ?");
					try {
						select.setString(1, rguid.toString());

						ResultSet results = select.executeQuery();

						if (results.next()) {								

							if (results.getBytes(1) != null)
								req.setAttribute("payload_checksum", new String(Hex.encode(results.getBytes(1))));

							req.setAttribute("auth_type", results.getInt(2));
						}

						req.setAttribute("initial_success", "Confirmation Email Sent");

					} finally {
						BitcoinDatabaseManager.close(select);
					}
				}

				getServletContext().getRequestDispatcher("/WEB-INF/wallet/bitcoin-wallet-manifest.jsp").forward(req, res);

				return;
			} else if (guid.equals("wallet.index.manifest")) {

				res.addHeader("Cache-Control", "max-age=0, no-cache, no-store, must-revalidate");
				res.addHeader("Pragma", "no-cache");
				res.addHeader("Expires", "Wed, 11 Jan 1984 05:00:00 GMT");
				res.addHeader("Content-type", "text/cache-manifest");

				getServletContext().getRequestDispatcher("/WEB-INF/wallet/bitcoin-wallet-index-manifest.jsp").forward(req, res);
				return;
			}  else if (guid.equals("iphone-view")) {
				req.setAttribute("no_header", true);

				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");

				if (rguid == null || rguid.length() == 0 || sharedKey == null || sharedKey.length() == 0)
					return;

				PreparedStatement select_smt = conn.prepareStatement("select payload from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {		
						req.setAttribute("guid", rguid);
						req.setAttribute("sharedKey", sharedKey);

						getServletContext().getRequestDispatcher("/WEB-INF/wallet/mobile/bitcoin-wallet-mobile-index.jsp").forward(req, res);
					} else {
						req.setAttribute("initial_error", "Wallet identifier not found. Your wallet is not yet saved on our server yet. Please setup a new account to avoid losing your wallet.");

						getServletContext().getRequestDispatcher("/WEB-INF/wallet/mobile/bitcoin-wallet-mobile-not-found.jsp").forward(req, res);

						return;
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				return;
			} else if (guid.equals("forgot-identifier")) {

				String email = req.getParameter("email");
				if (email != null && email.length() > 0) {
					email = email.trim();

					RequestLimiter.didRequest(req.getRemoteAddr(), 100); //Limited to approx 6 failed tries every 4 hours (Global over whole site)

					if (isValidEmailAddress(email)) {
						List<String> guids = guidFromEmail(conn, email);
						for (String email_guid : guids) {
							sendEmailLink(email_guid, false);
						}

						if (guids.size() > 0)
							req.setAttribute("initial_success", "Confirmation Email Sent");
						else
							req.setAttribute("initial_success", "Email Not Found");
					} else {
						req.setAttribute("initial_error", "Email Address Invalid");
					}
				}

				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-forgot-identifier.jsp").forward(req, res);

				return;
			} else if (guid.equals("dropbox-update")) {
				String oauth_token = req.getParameter("oauth_token");

				if (doDropboxBackup(conn, oauth_token)) {
					res.getOutputStream().print("Wallet successfully saved to dropbox. You may now close this window");
				} else {
					res.getOutputStream().print("Error Saving to dropbox");
				}

				return;
			} else if (guid.equals("gdrive-update")) {

				String rguid = (String)getSesssionValue(req, res, "temp_guid");
				String token = req.getParameter("code");

				if (rguid == null){
					throw new Exception("Temp guid expired");
				}

				//Set the new auth token
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set gdrive_auth_token = ? where guid = ?");

				try {
					update_smt.setString(1, token);
					update_smt.setString(2, rguid);

					update_smt.executeUpdate();
				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

				if (doGDriveBackup(conn, rguid, token)) {
					res.getOutputStream().print("Wallet successfully saved to google drive. You may now close this window");
				} else {

					res.setContentType("text/html");

					res.getOutputStream().print("<h1>Error Saving to Google Drive.</h1> Be sure you have installed the <a href=\"https://chrome.google.com/webstore/detail/djjkppdfofjnpcbnkkangbhanjdnoocd\">My Wallet Chrome App</a> and blockchain.info is listed in your Google Drive Apps.");
				}

				return;
			} else if (guid.equals("gdrive-login")) {

				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");
				String auth_token = null;

				//Read it back to double check
				PreparedStatement select_smt = conn.prepareStatement("select gdrive_auth_token from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {				
						auth_token = results.getString(1);
					} else {
						throw new Exception("Unauthorized");
					}

				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				if (auth_token != null) {
					if (doGDriveBackup(conn, rguid, auth_token)) {
						res.getOutputStream().print("Wallet successfully saved to Google drive.");
						return;
					}
				}

				setSessionValue(req, res, "temp_guid", rguid, 1200);

				GoogleAuthorizationCodeRequestUrl urlBuilder =
						new GoogleAuthorizationCodeRequestUrl(
								GDRIVE_SECRETS.getWeb().getClientId(),
								GDRIVE_SECRETS.getWeb().getRedirectUris().get(0),
								GDRIVE_SCOPES) 
				.setAccessType("offline").setApprovalPrompt("force");

				String redirect_url = urlBuilder.build();

				res.sendRedirect(redirect_url);

				return;
			} else if (guid.equals("dropbox-login")) {

				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");
				String auth_token = null;

				//Read it back to double check
				PreparedStatement select_smt = conn.prepareStatement("select dropbox_auth_token from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {				
						auth_token = results.getString(1);
					} else {
						throw new Exception("Unauthorized");
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				if (auth_token != null) {
					if (doDropboxBackup(conn, auth_token)) {
						res.getOutputStream().print("Wallet successfully saved to dropbox.");
						return;
					}
				}

				AppKeyPair appKeys = new AppKeyPair(DROPBOX_APP_KEY, DROPBOX_APP_SECRET);

				WebAuthSession dropboxSession = new WebAuthSession(appKeys, DROPBOX_ACCESS_TYPE);

				WebAuthInfo authInfo = dropboxSession.getAuthInfo(DROPBOX_CALLBACK);

				if (authInfo != null) {

					boolean didUpdate = false;

					//Set the new auth token
					PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set dropbox_auth_token = ? where guid = ? and shared_key = ?");

					try {
						update_smt.setString(1, authInfo.requestTokenPair.key);
						update_smt.setString(2, rguid);
						update_smt.setString(3, sharedKey);

						//If successfull redirect the user to the oauth login page
						if (update_smt.executeUpdate() == 1) {
							didUpdate = true;
						}
					} finally {
						BitcoinDatabaseManager.close(update_smt);
					}

					if (didUpdate) {
						Cache.put(DROPBOX_CACHE_PREFIX + authInfo.requestTokenPair.key, new DropBoxCacheEntry(rguid, authInfo.requestTokenPair.key, authInfo.requestTokenPair.secret), DROPBOX_CACHE_EXPIRY);
						res.sendRedirect(authInfo.url);
					}
				} else {							
					throw new Exception("Unauthorized");
				}

				return;
			} else if (guid.equals("resolve-alias")) {
				String rguid = req.getParameter("guid");

				PreparedStatement select_smt = conn.prepareStatement("select guid, shared_key from bitcoin_wallets where (guid = ? or alias = ?) and auth_type = 0");

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, rguid);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {			
						guid = results.getString(1);
						String sharedKey = results.getString(2);

						res.setContentType("text/json");

						res.getOutputStream().print("{\"guid\" : \""+guid+"\", \"sharedKey\" : \"" + sharedKey + "\"}");
					} else {

						res.setStatus(500);

						res.setContentType("text/plain");

						res.getOutputStream().print("Wallet identifier not found");
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				return;
			} else if (guid.equals("wallet.aes.json")) {
				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");
				String checksumString = req.getParameter("checksum");

				if (rguid == null || rguid.length() == 0 || sharedKey == null || sharedKey.length() == 0)
					return;

				PreparedStatement select_smt = conn.prepareStatement("select payload, payload_checksum from bitcoin_wallets where guid = ? and shared_key = ?");

				String payload  = null;

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {			

						res.setContentType("application/octet-stream");

						try {
							byte[] checkwith = results.getBytes(2);

							if (checksumString != null && checkwith != null) {
								byte[] checksum = Hex.decode(checksumString);

								if (Arrays.equals(checkwith, checksum)) {
									res.getOutputStream().print("Not modified");
									return;
								}
							}
						} catch (Exception e) {
							e.printStackTrace();
						}

						payload = results.getString(1);
					} else {

						res.setStatus(500);

						res.setContentType("text/plain");

						res.getOutputStream().print("Wallet identifier not found");

						return;
					}

					if (payload != null)
						res.getOutputStream().print(payload);

				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				return;
			} else if (guid.equals("unsubscribe")) {
				String rguid = req.getParameter("guid");

				if (rguid == null || rguid.length() == 0)
					return;

				String unscrambled = Scrambler.unscramble(rguid);

				PreparedStatement disable_notifications = conn.prepareStatement("update bitcoin_wallets set notifications_type = 0 where guid = ?");

				try {
					disable_notifications.setString(1, unscrambled);

					if (disable_notifications.executeUpdate() == 1) {				
						req.setAttribute("initial_success", "Your email has been unsubscribed from all notifications");
					} else {					
						req.setAttribute("initial_error", "Wallet identifier or email code were incorrect. You have not been unsubscribed");
					}
				} finally {
					BitcoinDatabaseManager.close(disable_notifications);
				}

				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);

				return;
			} else if (guid.equals("send-bitcoins-email")) {
				String to = req.getParameter("to");
				String rguid = req.getParameter("guid");
				String priv = req.getParameter("priv");
				String sharedKey = req.getParameter("sharedKey");

				sendBitcoinsEmail(to, rguid, sharedKey, priv);

				return;
			}

			//Guid might actually be an alias
			final WalletObject obj = WalletObject.getWallet(conn, guid, guid);

			//Should not be using it anymore
			guid = null;

			if (obj != null) {	
				if (obj.payload_checksum != null) {
					String payload_checksum = new String(Hex.encode(obj.payload_checksum));
					req.setAttribute("payload_checksum", payload_checksum);
				}

				if (obj.failed_logins >= MaxFailedLogins) {
					if (lockAccount(obj.guid, obj.email, 240)) {
						throw new Exception("Your account account has been locked");
					}
				} else if (obj.failed_logins > 0 && obj.auth_type != AuthTypeStandard) {
					req.setAttribute("initial_error", "" + (MaxFailedLogins - obj.failed_logins) + " login attempts left");
				}

				long now = System.currentTimeMillis();

				if (obj.account_locked_time > now)
					throw new Exception("Account is locked for another " + ((obj.account_locked_time - now) / 60000) + " minutes");

				//Special case for demo account
				if (obj.guid.equals(DemoAccountGUID)) {
					req.setAttribute("demo", true);
				}

				Cache.put(req.getRemoteAddr() + "ip_guid", obj.guid, 3600);

				//If the user has notifications enabled then we need to extract the public keys
				if (obj.notifications_type == 0)
					req.setAttribute("sync-pubkeys", false);
				else
					req.setAttribute("sync-pubkeys", true);

				req.setAttribute("guid", obj.guid);

				if (!obj.guid.equals(DemoAccountGUID)) //Note this is different from the session saved_guid
					putCookie(req, res, "cguid", obj.guid);

				req.setAttribute("auth_type", obj.auth_type);

				req.setAttribute("show_logout", true);

				//If not 2 factor authentication insert the wallet data right away
				if (obj.auth_type == AuthTypeStandard) {
					req.setAttribute("wallet_data", obj.payload);
				} else {

					String saved_guid = getSessionVal(req, res, "saved_guid");
					Integer saved_auth_type = (Integer) getSesssionValue(req, res, "saved_auth_type");

					//Check to see if the user has their two factor authentication settings saved
					boolean needs_auth = true;
					if (saved_guid != null && saved_auth_type != null && saved_guid.equals(obj.guid) && saved_auth_type == obj.auth_type) {
						req.setAttribute("wallet_data", obj.payload);
						needs_auth = false;
					}

					//Otherwise we need them to authorize themselves
					if (needs_auth) {
						if (obj.auth_type == AuthTypeYubikey ||  obj.auth_type == AuthTypeYubikeyMtGox) {
							//Check that the user has as entered a yubikey in a valid format (in case they didn't fill out the form correctly)
							if (obj.yubikey == null || obj.yubikey.length() == 0) {
								req.setAttribute("auth_type", AuthTypeStandard);
								req.setAttribute("wallet_data", obj.payload);
							} else {
								req.setAttribute("show_yubikey", true);
							}
						} else if (obj.auth_type == AuthTypeGoogleAuthenticator) {
							req.setAttribute("show_google_auth", true);
						} else if (obj.auth_type == AuthTypeEmail) {

							if (obj.email == null || obj.email.length() == 0) {
								req.setAttribute("auth_type", AuthTypeStandard);
								req.setAttribute("wallet_data", obj.payload);
							} else {
								req.setAttribute("show_email", true); 
							}

							//If email code is null or it's older than one hour resend it
							//Or the user has mnaually requested a new code

							boolean _manual = false;
							if (req.getParameter("email_again") != null) {		
								req.setAttribute("initial_error", "Email code resent. Check your spam folder! Each manual email request counts as one failed login attempt");
								_manual = true;
							}

							final boolean manual = _manual;

							if (obj.email_code == null || obj.email_code.length() == 0 || obj.email_code_last_updated < System.currentTimeMillis() - 600000 || manual) {
								Thread thread = new Thread() { //Do in background thread as it can be slow
									@Override
									public void run() {
										Connection conn = BitcoinDatabaseManager.conn();
										try {
											String code = generateAndUpdateEmailCode(conn, obj.guid);
											if (code != null) {
												sendTwoFactorEmail(obj.email, obj.guid, code);

												//Manual re-email counts as one failed login
												if (manual) { 
													incrementFailedLogins(conn, obj.guid);
												}
											}
										} catch (SQLException e) {
											e.printStackTrace();
										} finally {
											BitcoinDatabaseManager.close(conn);
										}
									}
								};

								thread.start();
							}
						}
					}
				}

				//User set cookie for there preferred format for transaction layout
				Cookie cookie = getCookie(req, "tx_display");
				if (cookie != null) {
					try {
						req.setAttribute("tx_display", Integer.valueOf(cookie.getValue()));
					} catch (Exception e) { }
				}

				getServletContext().getRequestDispatcher("/WEB-INF/wallet/" + BaseServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);

			} else {
				if (!res.isCommitted()) {					
					res.setStatus(500);

					RequestLimiter.didRequest(req.getRemoteAddr(), 50); //Limited to approx 6 failed tries every 4 hours (Global over whole site)

					req.setAttribute("guid", "");
					req.setAttribute("initial_error", "Unknown Wallet Identifier. Please check you entered it correctly.");
					getServletContext().getRequestDispatcher("/WEB-INF/wallet/" + BaseServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);
				}

				return;
			}

		} catch (Exception e) {		
			RequestLimiter.didRequest(req.getRemoteAddr(), 50);

			e.printStackTrace();

			printHTTP(req);

			if (req.getParameter("format") == null) {
				req.setAttribute("initial_error", e.getLocalizedMessage());
				getServletContext().getRequestDispatcher("/WEB-INF/wallet/"+ BaseServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			} else if (req.getParameter("format").equals("plain")) {
				res.setStatus(500);
				res.setCharacterEncoding("text/plain");
				res.getOutputStream().print(e.getLocalizedMessage());
			}
		} finally {
			BitcoinDatabaseManager.close(conn);
		}
	}

	private String getSessionVal(HttpServletRequest req,
			HttpServletResponse res, String string) {
		// TODO Auto-generated method stub
		return null;
	}

	public static boolean lockAccount(String guid, String email, int minutes) {

		long lock_time =  System.currentTimeMillis() + (minutes * 60000);

		if (email != null) {
			NotificationsManager.sendMail(email, "Your My Wallet Account has been locked", "<p align=\"center\"><h1>Important.</h1><p>A number of failed attempts have been made to login to to your My Wallet account. For your protection the new login attempts have been disabled until " + new Date(lock_time).toString() + " </p> <p>If these login attempts were not made by you it is recommended you change your password as soon as the account is available again <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a> if you are particularily concerned please contact us and we will extend the lock.</p>");
		}

		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;
		try {
			//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
			smt = conn.prepareStatement("update bitcoin_wallets set acount_locked_time = ?, failed_logins = 0, email_code = null  where guid = ?");

			smt.setLong(1, lock_time);
			smt.setString(2, guid);

			smt.executeUpdate();

		} catch (Exception e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(smt);
			BitcoinDatabaseManager.close(conn);
		}		

		return true;
	}

	public boolean sendBitcoinsEmail(String to, String guid, String sharedKey, String priv) throws Exception {

		ECKey key = MyWallet.decodeUnencryptedPK(priv);

		DBBitcoinAddress address =  new DBBitcoinAddress(key.toAddress(NetworkParameters.prodNet()).toString());

		long amount = 0; 
		String from_name = "";

		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;
		try {
			smt = conn.prepareStatement("select email, alias from bitcoin_wallets where guid = ? and shared_key = ?");

			address.calculateTxResults(conn);

			amount = address.getFinalBalance();

			if (amount == 0) {
				return false;
			}

			smt.setString(1, guid);
			smt.setString(2, sharedKey);

			ResultSet results = smt.executeQuery();

			if (results.next()) {
				String email = results.getString(1);
				String alias = results.getString(2);

				if (email != null)
					from_name = email;
				else if (alias != null)
					from_name = alias;
			}
		} finally {
			BitcoinDatabaseManager.close(smt);
			BitcoinDatabaseManager.close(conn);
		}

		try {
			@SuppressWarnings("deprecation")
			URL url = new URL(HTTPS_ROOT + "email-template?from_name="+URLEncoder.encode(from_name) + "&amount="+ amount+ "&priv="+ URLEncoder.encode(priv) +"&type=send-bitcoins-get");

			HttpURLConnection connection = (HttpURLConnection) url.openConnection();

			connection.setConnectTimeout(1000);

			connection.connect();
			try {
				if (connection.getResponseCode() != 200)
					throw new Exception("Invalid Response Code");

				String template = IOUtils.toString(connection.getInputStream(), "UTF-8");

				if (from_name.length() > 0)
					NotificationsManager.sendMail(to, from_name + " Has Sent You Bitcoins", template);
				else
					NotificationsManager.sendMail(to, "You Have Been Sent Bitcoins", template);

				return true;

			} finally {
				connection.disconnect();
			}
		} catch (Exception e) {
			e.printStackTrace();
		}

		return false;
	}

	public static boolean sendEmailLink(String guid, boolean attachBackup) {

		Connection conn = BitcoinDatabaseManager.conn();
		try {
			PreparedStatement smt = null;

			String template  = null;
			String email = null;
			String sharedKey  = null;

			try {
				//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
				smt = conn.prepareStatement("select email, shared_key from bitcoin_wallets where guid = ? and email_backups_today < 5");

				smt.setString(1, guid);

				ResultSet results = smt.executeQuery();

				if (results.next()) {
					email = results.getString(1);
					sharedKey = results.getString(2);
					template = EmailTemplate.getTemplate(guid, "welcome");
				}

			} catch (Exception e) {
				e.printStackTrace();
				return false;
			} finally {
				BitcoinDatabaseManager.close(smt);
			}	

			if (template != null && email != null && sharedKey != null) {

				if (attachBackup)
					NotificationsManager.sendMail(email, "Welcome To My Wallet", template, "https://blockchain.info/wallet/wallet.aes.json?guid="+guid+"&sharedKey="+sharedKey);
				else
					NotificationsManager.sendMail(email, "Welcome To My Wallet", template);

				try {
					incrementBackupCount(conn, guid);
				} catch (SQLException e) {
					e.printStackTrace();
				}

				return true;
			}

			return false;
		} finally {
			BitcoinDatabaseManager.close(conn);
		}
	}

	public static String generateAndUpdateEmailCode(Connection conn, String guid) throws SQLException {
		String code = UUID.randomUUID().toString().substring(0, EmailCodeLength).toUpperCase();

		//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
		PreparedStatement smt = conn.prepareStatement("update bitcoin_wallets set email_code = ?, email_code_last_updated = ? where guid = ?");
		try {
			smt.setString(1, code);
			smt.setLong(2, System.currentTimeMillis());
			smt.setString(3, guid);

			if (smt.executeUpdate() == 1)
				return code;

		} catch (Exception e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(smt);
		}		

		return null;
	}

	public void incrementFailedLogins(Connection conn, String guid) throws SQLException {
		PreparedStatement update_logins = null;
		try {
			update_logins = conn.prepareStatement("update bitcoin_wallets set failed_logins = failed_logins + 1 where guid = ?");

			update_logins.setString(1, guid);

			update_logins.executeUpdate();
		} finally {
			BitcoinDatabaseManager.close(update_logins);
		}
	}

	public static boolean sendTwoFactorEmail(String email, String guid, String code) {
		return NotificationsManager.sendMail(email, "My Wallet Confirmation code", "<h1>Confirmation Required</h1> <p>An attempt has been made to login to your My wallet account. Enter the confirmation code below to access your account. If it was not you who made this login attempt you can ignore this email. </p><h2>" + code +"</h2>");
	}

	private static void incrementBackupCount(Connection conn, String guid) throws SQLException {
		PreparedStatement update_backup_count = null;

		try {
			update_backup_count =  conn.prepareStatement("update bitcoin_wallets set email_backups_today = email_backups_today+1 where guid = ?");

			update_backup_count.setString(1, guid);

			update_backup_count.executeUpdate();

		} finally {
			BitcoinDatabaseManager.close(update_backup_count);
		}
	}


	public static int getSentMailCount(Connection conn, String guid) {

		PreparedStatement select_smt = null;

		try {
			select_smt =  conn.prepareStatement("select email_backups_today from bitcoin_wallets where guid = ?");

			select_smt.setString(1, guid);

			ResultSet results = select_smt.executeQuery();

			if (results.next()) {
				return results.getInt(1);
			}
		} catch (SQLException e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(select_smt);
		}

		return -1;
	}

	public static boolean sendEmailBackup(Connection conn, String guid, String sharedKey) throws SQLException {

		String email = null;

		PreparedStatement select_smt = null;
		try {
			select_smt =  conn.prepareStatement("select email from bitcoin_wallets where guid = ? and shared_key = ? and email is not null and email_verified = 1");

			select_smt.setString(1, guid);
			select_smt.setString(2, sharedKey);

			ResultSet results = select_smt.executeQuery();

			if (results.next()) {
				email = results.getString(1);

				if (email == null || !isValidEmailAddress(email))
					return false;
			}
		} finally {
			BitcoinDatabaseManager.close(select_smt);
		}

		if (email != null) {
			try {
				return NotificationsManager.sendMail(email, "Wallet Backup", 
						"<h1>My Wallet Backup</h1> <p>Attached is your AES encrypted wallet backup. You can use it to restore your wallet at anytime using <a href=\"https://blockchain.info/wallet\">My Wallet</a> or using standard unix tools</p> <p>Your wallet url is <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a></p>",
						"https://blockchain.info/wallet/wallet.aes.json?guid="+guid+"&sharedKey="+sharedKey);
			} finally {
				incrementBackupCount(conn, guid);
			}
		}

		return false;
	}

	public static boolean isValidEmailAddress(String aEmailAddress){
		try {
			InternetAddress emailAddr = new InternetAddress(aEmailAddress);

			emailAddr.validate();

			return true;
		} catch (Exception ex){
			return false;
		}
	}


	public static boolean backupWallet(Connection conn, String guid, String sharedKey) throws SQLException {
		boolean done_backup = false;

		int auto_email_backup;
		String dropbox_auth_token;
		String gdrive_auth_token;

		PreparedStatement smt = null;
		try {
			smt = conn.prepareStatement("select auto_email_backup, dropbox_auth_token, gdrive_auth_token from bitcoin_wallets where guid = ? and shared_key = ?");

			smt.setString(1, guid);
			smt.setString(2, sharedKey);

			ResultSet results = smt.executeQuery();

			if (results.next()) {	
				auto_email_backup = results.getInt(1);
				dropbox_auth_token = results.getString(2);
				gdrive_auth_token = results.getString(3);
			} else {
				return false;
			}

		} finally {
			BitcoinDatabaseManager.close(smt);
		}

		//If the user has a dropbox session do an automatic backup
		if (!done_backup && gdrive_auth_token != null) {
			done_backup = doGDriveBackup(conn, guid, gdrive_auth_token);
		}

		//If the user has a dropbox session do an automatic backup
		if (!done_backup && dropbox_auth_token != null) {
			done_backup = doDropboxBackup(conn, dropbox_auth_token);
		}

		//Do an automatic email backup
		if (!done_backup && auto_email_backup == 1 && getSentMailCount(conn, guid) <= 3) {
			done_backup = sendEmailBackup(conn, guid, sharedKey);
		}

		return done_backup;
	}

	public Pair<String, byte[]> getPayloadAndChecksum(Connection conn, String guid, String sharedKey) throws Exception {

		//Read it back to double check
		PreparedStatement select_smt = conn.prepareStatement("select payload, payload_checksum from bitcoin_wallets where guid = ? and shared_key = ?");
		try {

			select_smt.setString(1, guid);
			select_smt.setString(2, sharedKey);

			ResultSet results = select_smt.executeQuery();

			if (results.next()) {				
				String wallet_payload = results.getString(1);
				byte[] payload_checksum = results.getBytes(2);

				return new Pair<String, byte[]>(wallet_payload, payload_checksum);
			} else {
				throw new Exception("Failed to re-read wallet after save. Your wallet may not be saved properly.");	
			}

		} finally {
			BitcoinDatabaseManager.close(select_smt);
		}
	}
	
	public static void verifyAllWalletChecksums(Connection conn) throws SQLException, NoSuchAlgorithmException, UnsupportedEncodingException {
		
		MessageDigest md = MessageDigest.getInstance("SHA-256");

		int total = 0;
		List<String> bad_guids = new ArrayList<String>();

		PreparedStatement select_smt = conn.prepareStatement("select guid, payload, payload_checksum from bitcoin_wallets where payload_checksum is not null");
		try {
			ResultSet results = select_smt.executeQuery();

			while (results.next()) {			
				String guid = results.getString(1);
				String wallet_payload = results.getString(2);
				byte[] payload_checksum = results.getBytes(3);

				
				byte[] thedigest = md.digest(wallet_payload.getBytes("UTF-8"));

				if (!Base64.isBase64(wallet_payload) || !Arrays.equals(thedigest, payload_checksum)) {
					bad_guids.add(guid);
				}
				
				++total;
			} 
		 
			System.out.println("Checked " + total + " wallets " + bad_guids.size() + " currupted");
			
			if (bad_guids.size() > 0)
				System.out.println(bad_guids);
		} finally {
			BitcoinDatabaseManager.close(select_smt);
		}	
	}

	@Override
	protected void doPost(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
		res.setContentType("text/plain");

		Connection conn = BitcoinDatabaseManager.conn();

		try {
			String guid = req.getParameter("guid");
			String sharedKey = req.getParameter("sharedKey");
			String payload = req.getParameter("payload");
			String method = req.getParameter("method");
			String length = req.getParameter("length");

			System.out.println(method + " - " + guid);

			//All commands must have a guid
			int pre_guid_length = guid.length();
			guid = Jsoup.parse(guid).text(); //Strip and html 
			guid = UUID.fromString(guid).toString(); //Check is valid uuid format

			//Change to see if we stripped anything - could be a sign of malicious input
			if (guid == null || guid.length() != 36 || pre_guid_length != guid.length()) {
				throw new Exception("Invalid Input");
			}

			//get-info has no payload
			if (!method.equals("get-info") && !method.equals("email-backup")) {
				int pre_payload_length = payload.length();

				//Strip and html or javascript
				payload = Jsoup.parse(payload).text();

				int ulength = 0;
				try {
					ulength = Integer.valueOf(length).intValue(); //Must catch this as potential for XSS here
				} catch (Exception e) {
					throw new Exception("Length must be numerical");
				}

				//Check length to see if we stripped anything - could be a sign of malicious input
				//Length verification also serves as rudimentary data corruption check
				//Wallet payload is properly verified with a checksum later
				if (payload == null || payload.length() == 0  || pre_payload_length != payload.length() || ulength!= payload.length()) {
					throw new Exception("Invalid Input");
				}
			} 

			//Shared key is not needed for the get-wallet method
			if (!method.equals("get-wallet")) {
				int pre_shared_length = sharedKey.length();
				sharedKey = Jsoup.parse(sharedKey).text(); //Strip and html 
				sharedKey = UUID.fromString(sharedKey).toString(); //Check is valid uuid

				if (pre_shared_length != sharedKey.length() || sharedKey.length() != 36) {
					throw new Exception("Invalid Input");
				}	
			}

			String ip = req.getRemoteAddr();

			long now = new Date().getTime();

			//Special case for demo account, don't allow modifications
			if (guid.equals(DemoAccountGUID) && !method.equals("get-info")) {
				res.getOutputStream().print("Success!");
				return;
			} 

			if (method.equals("insert")) {
				String kaptchaExpected = (String)getSesssionValue(req, res, com.google.code.kaptcha.Constants.KAPTCHA_SESSION_KEY);
				String kaptchaReceived = req.getParameter("kaptcha");

				if (kaptchaReceived == null || !kaptchaReceived.equalsIgnoreCase(kaptchaExpected))
				{
					res.setStatus(500);
					res.getOutputStream().print("Captcha Failed");
					return; 
				}

				//Check for any wallet created recently
				/*PreparedStatement select_recent = null;
				try {
					select_recent = conn.prepareStatement("select guid from bitcoin_wallets where created_ip = ? and created > ? limit 1");

					select_recent.setString(1, ip);
					select_recent.setLong(2, now-43200000);

					ResultSet results = select_recent.executeQuery();

					if (results.next()) {
						String eguid = results.getString(1);

						if (eguid != null) {
							res.setStatus(500);
							res.getOutputStream().print("This ip address already created a wallet recently. Identifier " + eguid);
							return;
						}
					}
				} finally {
					BitcoinDatabaseManager.close(select_recent);
				}*/

				if (!Base64.isBase64(payload)) {
					throw new Exception("Payload not base64");
				}

				if (payload.length() > 1048576) {
					res.setStatus(500);
					res.getOutputStream().print("Wallets are restricted to 1MB in size");	
					return;
				}

				MessageDigest md = MessageDigest.getInstance("SHA-256");

				byte[] checksum = md.digest(payload.getBytes("UTF-8"));

				PreparedStatement smt = null;
				try {
					smt = conn.prepareStatement("insert into bitcoin_wallets (guid, created, payload, shared_key, created_ip, payload_checksum) values(?, ?, ?, ?, ?, ?)");

					smt.setString(1, guid);
					smt.setLong(2, now);
					smt.setString(3, payload);
					smt.setString(4, sharedKey);
					smt.setString(5, ip);
					smt.setBytes(6, checksum);

					if (smt.executeUpdate() == 1) {
						res.getOutputStream().print("Wallet succesfully synced with server");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error creating wallet");	
					}
				} finally {
					BitcoinDatabaseManager.close(smt);
				}
			} else if (method.equals("update")) {

				if (!Base64.isBase64(payload)) {
					throw new Exception("Payload not base64");
				}

				if (payload.length() > 1048576) {
					res.setStatus(500);
					res.getOutputStream().print("Wallets are restricted to 1MB in size");	
					return;
				}

				byte[] checksum = Hex.decode(req.getParameter("checksum"));

				MessageDigest md = MessageDigest.getInstance("SHA-256");

				byte[] thedigest = md.digest(payload.getBytes("UTF-8"));

				if (!Arrays.equals(thedigest, checksum)) {
					res.setStatus(500);
					res.getOutputStream().print("Checksum did not validate");
					return;
				}

				boolean didInsert = false;
				for (int ii = 0; ii < 3; ++ii) {
					try {
						PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set payload = ?, updated = ?, updated_ip = ?, payload_checksum = ? where guid = ? and shared_key = ?");
						try {
							update_smt.setString(1, payload);
							update_smt.setLong(2, now);
							update_smt.setString(3, ip);
							update_smt.setBytes(4, checksum);
							update_smt.setString(5, guid);
							update_smt.setString(6, sharedKey);

							if (update_smt.executeUpdate() == 1) {
								didInsert = true;
								break;
							}
						} finally {
							BitcoinDatabaseManager.close(update_smt);
						}
					} catch (SQLException e) {
						e.printStackTrace();
					}
				}

				if (!didInsert) {
					res.setStatus(500);
					res.getOutputStream().print("Error backing up wallet");	
					return;
				} 

				Pair<String, byte[]> pair = getPayloadAndChecksum(conn, guid, sharedKey);
				if (Arrays.equals(checksum, pair.getSecond()) && payload.equals(pair.getFirst())) {							
					res.getOutputStream().print("Wallet succesfully synced with server");

					try {
						//Notify the websocket that the wallet changed
						RMIClient api = RMIClient.conn();
						try {
							api.sendWalletDidChangeNotification(guid, req.getParameter("checksum"));
						} finally { 
							RMIClient.close(api);
						}

						backupWallet(conn, guid, sharedKey);
					} catch (Exception e) {
						e.printStackTrace();
					}
				} else {
					throw new Exception("Wallet was updated, however checksum did not validate on re-read! This is a serious error, please contact " + AdminServlet.ADMIN_EMAIL);	
				}

			} else if (method.equals("update-notifications-type") || method.equals("update-notifications-on") || method.equals("update-notifications-confirmations")) {

				PreparedStatement update_smt = null;

				if (method.equals("update-notifications-type"))
					update_smt = conn.prepareStatement("update bitcoin_wallets set notifications_type = ? where guid = ? and shared_key = ?");
				else if (method.equals("update-notifications-on"))
					update_smt = conn.prepareStatement("update bitcoin_wallets set notifications_on = ? where guid = ? and shared_key = ?");
				else if (method.equals("update-notifications-confirmations"))
					update_smt = conn.prepareStatement("update bitcoin_wallets set notifications_confirmations = ? where guid = ? and shared_key = ?");

				try {
					try {
						update_smt.setInt(1, Integer.valueOf(payload).intValue());
					} catch (Exception e) {
						throw new Exception("Payload must be numerical");
					}

					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Notifications settings updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating notifications type");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			} else if (method.equals("update-auth-type")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set auth_type = ?, failed_logins = 0 where guid = ? and shared_key = ?");

				int auth_type = 0;
				try {
					auth_type = Integer.valueOf(payload).intValue();
				} catch (Exception e) {
					throw new Exception("Payload must be numerical");
				}

				try {
					update_smt.setInt(1, auth_type);
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Two factor authentication settings updated.");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating two factor authentication.");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

				if (auth_type == AuthTypeGoogleAuthenticator) {
					String new_secret = GoogleAuthenticator.generateSecret();

					PreparedStatement update_secret_smt = conn.prepareStatement("update bitcoin_wallets set google_secret = ? where guid = ? and shared_key = ?");

					try {
						update_secret_smt.setString(1, new_secret);
						update_secret_smt.setString(2, guid);
						update_secret_smt.setString(3, sharedKey);

						if (update_secret_smt.executeUpdate() == 1) {
							res.getOutputStream().print(" Google Secret Generated");
						} else {
							res.setStatus(500);
							res.getOutputStream().print(" Error Generating Google Authenticator Secret");	
						}

					} finally {
						BitcoinDatabaseManager.close(update_smt);
					}
				}

			} else if (method.equals("update-skype")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set skype_username = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload.trim());
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Skype Username updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating Skype username");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			}  else if (method.equals("update-http-url")) {

				URL url = new URL(payload.trim());

				if (!url.getProtocol().equals("http")) {
					res.setStatus(500);
					res.getOutputStream().print("Must provide a valid HTTP url");
					return;
				}

				if (InetAddress.getByName(url.getHost()).isSiteLocalAddress() || url.getHost().indexOf("blockchain.info") != -1 || url.getHost().equals("localhost")) { 
					res.setStatus(500);
					res.getOutputStream().print("URL provided seems to be a local address");
					return;
				}

				HttpURLConnection connection = (HttpURLConnection) url.openConnection();

				connection.setConnectTimeout(10000);

				connection.setInstanceFollowRedirects(false);

				connection.connect();

				if (connection.getResponseCode() != 200) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid HTTP Response code " + connection.getResponseCode());
					return;
				}

				String response = IOUtils.toString(connection.getInputStream(), "UTF-8");

				if (!response.equals(guid)) {
					res.setStatus(500);
					res.getOutputStream().print("URL must respond with wallet identifier. Please see documentation");
					return;
				}

				connection.disconnect();

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set http_url = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, url.toExternalForm());
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("HTTP URL updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating HTTP url");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			} else if (method.equals("update-yubikey")) {

				if (!YubicoClient.isValidOTPFormat(payload)) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid Yubikey OTP");
					return;
				}

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set yubikey = ?, failed_logins = 0 where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, YubicoClient.getPublicId(payload));
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Yubikey successfully updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating yubikey");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			} else if (method.equals("verify-email")) {

				PreparedStatement email_confirm_stmt = null;
				try {
					email_confirm_stmt = conn.prepareStatement("update bitcoin_wallets set email_verified = 1, email_code = null where guid = ? and email_code = ?");

					email_confirm_stmt.setString(1, guid);
					email_confirm_stmt.setString(2, payload.trim());

					if (email_confirm_stmt.executeUpdate() == 1) {
						res.getOutputStream().print("Email successfully verified");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Unable to verify email.");
					}
				} finally {
					BitcoinDatabaseManager.close(email_confirm_stmt);
				}

			} else if (method.equals("update-pub-keys")) {

				//Clear existing
				PreparedStatement chck_shared = null;
				try {
					chck_shared = conn.prepareStatement("delete from bitcoin_wallet_keys where guid = ? and (select count(*) from bitcoin_wallets where guid = ? and shared_key = ?) > 0");
					chck_shared.setString(1, guid);
					chck_shared.setString(2, guid);
					chck_shared.setString(3, sharedKey);

					chck_shared.executeUpdate();
				} finally {
					BitcoinDatabaseManager.close(chck_shared);
				}

				String[] addresses = payload.split("\\|");

				if (addresses == null || addresses.length == 0)
					return;

				if (addresses.length > MaxAddresses) {
					res.setStatus(500);
					res.getOutputStream().print("A Maximum of " + MaxAddresses + " bitcoin addresses are supported.");
					return;
				}

				PreparedStatement insert_smt = null;
				try {
					insert_smt = conn.prepareStatement("insert into bitcoin_wallet_keys (guid, hash) select guid, ? from bitcoin_wallets where guid = ? and shared_key = ?");

					for (String addr : addresses) {

						//Disallow Deepbit green address
						if (addr.equals("1VayNert3x1KzbpzMGt2qdqrAThiRovi8"))
							continue;

						byte[] hash160 = new BitcoinAddress(addr).getHash160().getBytes();

						if (hash160.length != 20) {
							res.setStatus(500);
							res.getOutputStream().print("Invalid Hash 160.");
							return;
						}

						insert_smt.setBytes(1, hash160);
						insert_smt.setString(2, guid);
						insert_smt.setString(3, sharedKey);

						insert_smt.executeUpdate();
					}

				} finally {
					BitcoinDatabaseManager.close(insert_smt);
				}

			} else if (method.equals("update-email")) {
				if (!isValidEmailAddress(payload.trim())) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid Email Address");
					return;
				}

				boolean didUpdate = false;
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set email = ?, email_verified = 0 where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload.trim());
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {	
						didUpdate = true;
					} 
				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

				if (didUpdate) {
					//Generate a new email code
					generateAndUpdateEmailCode(conn, guid);

					if (sendEmailLink(guid, true)) {
						res.getOutputStream().print("Email successfully updated. You have been notified");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Email updated. However an error was encountered when sending confirmation link.");
					} 
				} else {
					res.setStatus(500);
					res.getOutputStream().print("Error updating email");	
				}
			} else if (method.equals("get-info")) {

				WalletObject obj = WalletObject.getWallet(conn, guid);

				if (obj == null || !obj.shared_key.equals(sharedKey)) {
					res.setStatus(500);
					res.getOutputStream().print("Failed to get wallet info");
				}

				String email = obj.email;
				if (email != null)
					email = StringEscapeUtils.escapeJavaScript(email);
				else 
					email = "";

				String phrase = obj.secret_phrase;
				if (phrase != null)
					phrase = StringEscapeUtils.escapeJavaScript(phrase);
				else 
					phrase = "";

				String alias = obj.alias;
				if (alias != null)
					alias = StringEscapeUtils.escapeJavaScript(alias);
				else 
					alias = "";

				String http_url = obj.http_url;
				if (http_url != null)
					http_url = StringEscapeUtils.escapeJavaScript(http_url);
				else 
					http_url = "";

				String skype_username = obj.skype_username;
				if (skype_username != null)
					skype_username = StringEscapeUtils.escapeJavaScript(skype_username);
				else 
					skype_username = "";

				String yubikey = "";
				if (obj.auth_type == AuthTypeYubikey || obj.auth_type == AuthTypeYubikeyMtGox) {
					yubikey = StringEscapeUtils.escapeJavaScript(obj.yubikey);
				}

				String google_secret = obj.google_secret;
				String google_secret_url = "";
				if (obj.auth_type == AuthTypeGoogleAuthenticator && google_secret != null) {
					if (alias != null) {
						google_secret_url = GoogleAuthenticator.getQRBarcodeURL(alias, "blockchain.info", google_secret);
					} else {
						google_secret_url = GoogleAuthenticator.getQRBarcodeURL(guid, "blockchain.info", google_secret);
					}

					google_secret_url = StringEscapeUtils.escapeJavaScript(google_secret_url);
				}

				res.setContentType("application/json");

				res.getOutputStream().print("{\"email\" : \"" + email + "\", \"phrase\" : \"" + phrase + "\", \"alias\" : \"" + alias + "\", \"yubikey\" : \"" + yubikey + "\", \"email_verified\" : \"" + obj.email_verified + "\", \"http_url\" : \"" + http_url + "\", \"skype_username\" : \"" + skype_username + "\", \"google_secret_url\" : \"" + google_secret_url + "\", \"auth_type\" : " + obj.auth_type + ", \"notifications_type\" : " + obj.notifications_type + ", \"notifications_on\" : " + obj.notifications_on + ", \"notifications_confirmations\" : " + obj.notifications_confirmations + ", \"auto_email_backup\" : " + obj.auto_email_backup + "}");

			} else if (method.equals("update-phrase")) {

				if (!StringUtils.isAlphanumericSpace(payload)) {
					res.setStatus(500);
					res.getOutputStream().print("Secret Phrase must be alphanumric");
					return;
				}

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set secret_phrase = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload);
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Secret phrase successfully updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating secret phrase");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}
			} else if (method.equals("update-auto-email-backup")) {

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set auto_email_backup = ? where guid = ? and shared_key = ?");

				try {
					if (payload.equals("true"))
						update_smt.setInt(1, 1);
					else
						update_smt.setInt(1, 0);

					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						if (payload.equals("true"))
							res.getOutputStream().print("Auto Email Backup Enabled");
						else
							res.getOutputStream().print("Auto Email Backup Disabled");

					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error Updating Email Settings");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			} else if (method.equals("update-alias")) {

				String alias = payload.trim();

				if (!StringUtils.isAlphanumeric(alias)) {
					res.setStatus(500);
					res.getOutputStream().print("Alias must be alphanumric");
					return;
				}

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set alias = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, alias);
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					try {
						if (update_smt.executeUpdate() == 1) {
							res.getOutputStream().print("Alias successfully updated");
						} else {
							res.setStatus(500);
							res.getOutputStream().print("Error updating alias");	
						}
					} catch (Exception e) {
						res.setStatus(500);
						res.getOutputStream().print("Alias has already been taken.");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}
			} else if (method.equals("email-backup")) {

				if (getSentMailCount(conn, guid) >= 10) {
					res.setStatus(500);
					res.getOutputStream().print("You ahve reached the maximum email quota for today.");
					return;
				}

				if (sendEmailBackup(conn, guid, sharedKey)) {
					res.getOutputStream().print("Wallet backup sent");
				} else {
					res.setStatus(500);
					res.getOutputStream().print("Failed to send wallet backup");
				}

			} else if (method.equals("get-wallet")) {
				//Get Wallet is called by the javascript client when two-factor authentication is enabled

				int failed_logins = 0;
				boolean login_did_fail = false;
				String email = null;

				WalletObject obj = WalletObject.getWallet(conn, guid);				

				try {
					if (obj != null) {				
						if (obj.account_locked_time > now) {				
							throw new Exception("Account is locked");
						}

						//Not Two factor authenitcation just print the wallet data
						if (obj.auth_type == AuthTypeStandard) {
							res.getOutputStream().print(obj.payload);
						} else if (obj.auth_type == AuthTypeYubikey) {
							String otp = payload;

							if (otp == null || otp.length() == 0 || otp.length() > 255)
								throw new Exception("You must provide a valid OTP");

							if (otp != null) {			

								YubicoClient client = YubicoClient.getClient(4711);

								if (client == null)
									throw new Exception("Error connecting to OTP validating server");

								try {
									if (!YubicoClient.isValidOTPFormat(otp)) {
										login_did_fail = true;
										throw new Exception("Invalid Yubikey OTP");
									}

									String otpYubikey = YubicoClient.getPublicId(otp);

									if (!otpYubikey.equals(obj.yubikey)) {
										login_did_fail = true;
										throw new Exception("OTP provided does not match yubikey associated with the account");
									}			

									YubicoResponse response = client.verify(otp);

									if (response.getStatus() == YubicoResponseStatus.OK) {
										setSessionValue(req, res, "saved_guid", guid, 1440);
										setSessionValue(req, res, "saved_auth_type", obj.auth_type, 1440);

										//Everything ok, output the encrypted payload
										res.getOutputStream().print(obj.payload);
									} else {
										login_did_fail = true;
										throw new Exception("Failed to validate Yubikey with remote server");
									}
								} catch (Exception e) {
									e.printStackTrace();

									throw new Exception("Error Validating Yubikey");
								}
							}
						} else if (obj.auth_type == AuthTypeYubikeyMtGox) {

							//For mount gox keys we only check the key identity and don't validate it with the OTP server
							String otp = payload;

							if (otp == null || otp.length() == 0 || otp.length() > 255)
								throw new Exception("You must provide a valid OTP");

							if (!YubicoClient.isValidOTPFormat(otp)) {
								login_did_fail = true;
								throw new Exception("Invalid Yubikey OTP");
							}

							String otpYubikey = YubicoClient.getPublicId(otp);

							if (!otpYubikey.equals(obj.yubikey)) {
								login_did_fail = true;
								throw new Exception("OTP provided does not match yubikey associated with the account");
							} else {

								setSessionValue(req, res, "saved_guid", guid, 1440);
								setSessionValue(req, res, "saved_auth_type", obj.auth_type, 1440);

								res.getOutputStream().print(obj.payload);
							}

						} else if (obj.auth_type == AuthTypeEmail) {
							//Check email code

							String code = payload;

							if (code == null || code.length() != EmailCodeLength)
								throw new Exception("You must provide a valid email authentication code");

							if (code.equals(obj.email_code)) {
								setSessionValue(req, res, "saved_guid", guid, 43200);
								setSessionValue(req, res, "saved_auth_type", obj.auth_type, 43200);

								//Login successful				
								res.getOutputStream().print(obj.payload);
							} else {
								login_did_fail = true;
								throw new Exception("Email authentication code is incorrect");
							}

						}  else if (obj.auth_type == AuthTypeGoogleAuthenticator) {
							//Validate the TOTP

							Long code = null;
							try {
								code = Long.valueOf(payload);
							} catch (Exception e) {
								throw new Exception("Authentication code must be numerical");
							}

							//time window of 30 seconds (30,000 milliseconds)
							if (GoogleAuthenticator.check_code(obj.google_secret, code, new Date().getTime()  / 30000)) {
								setSessionValue(req, res, "saved_guid", guid, 1440);
								setSessionValue(req, res, "saved_auth_type", obj.auth_type, 1440);

								//Everything ok, output the encrypted payload
								res.getOutputStream().print(obj.payload);
							} else {
								login_did_fail = true;
								throw new Exception("Google Authentication code is incorrect");
							}
						}
					}  else {
						throw new Exception("Unknown Wallet Identifier. Please check you entered it correctly.");
					}
				} catch (Exception e) {
					res.setStatus(500);

					if (login_did_fail) {

						if (failed_logins >= MaxFailedLogins) {
							if (lockAccount(guid, email, 240))
								res.getOutputStream().print(e.getLocalizedMessage() + " (Your account account has been locked)");

						} else {
							res.getOutputStream().print(e.getLocalizedMessage() + " (" + (MaxFailedLogins - failed_logins) + " login attempts left)");

							incrementFailedLogins(conn, guid);
						}
					} else {
						res.getOutputStream().print(e.getLocalizedMessage());
					}

				} finally {
					if (!login_did_fail) {

						PreparedStatement update_succees = null;
						try {
							//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
							update_succees = conn.prepareStatement("update bitcoin_wallets set email_code = null, failed_logins = 0 where guid = ?");

							update_succees.setString(1, guid);

							update_succees.executeUpdate();
						} catch (Exception e) {
							e.printStackTrace();
						} finally {
							BitcoinDatabaseManager.close(update_succees);
						}		
					}
				}
			}

		} catch (Exception e) {
			RequestLimiter.didRequest(req.getRemoteAddr(), 50); //Limited to approx 6 failed tries every 4 hours (Global over whole site)

			printHTTP(req);

			res.setStatus(500);

			res.getOutputStream().print("Exception caught syncing wallet. Please contact the site administrator.");

			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(conn);
		}
	}
}
