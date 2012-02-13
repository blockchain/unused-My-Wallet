package piuk.bitcoin.website;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Serializable;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.UUID;

import javax.mail.internet.InternetAddress;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import net.tanesha.recaptcha.ReCaptchaImpl;

import org.apache.commons.codec.binary.Base64;
import org.apache.commons.io.IOUtils;
import org.bouncycastle.util.encoders.Hex;
import org.jsoup.Jsoup;

import com.dropbox.client2.DropboxAPI;
import com.dropbox.client2.session.AppKeyPair;
import com.dropbox.client2.session.RequestTokenPair;
import com.dropbox.client2.session.Session.AccessType;
import com.dropbox.client2.session.WebAuthSession;
import com.dropbox.client2.session.WebAuthSession.WebAuthInfo;
import com.yubico.client.v2.YubicoClient;
import com.yubico.client.v2.YubicoResponse;
import com.yubico.client.v2.YubicoResponseStatus;

import piuk.bitcoin.Hash;
import piuk.bitcoin.beans.BitcoinAddress;
import piuk.bitcoin.db.BitcoinDatabaseManager;
import piuk.bitcoin.website.admin.AdminServlet;
import piuk.bitcoin.website.admin.ApiClient;
import piuk.db.Cache;

/**
 * Servlet implementation class ChartsServlet
 */
@WebServlet({ BitcoinServlet.ROOT + "wallet/*" })
public class WalletServlet extends BaseServlet {
	private static final long serialVersionUID = 1L;
	private static final int AuthTypeStandard = 0;
	private static final int AuthTypeYubikey = 1;
	private static final int AuthTypeEmail = 2;
	private static final int AuthTypeYubikeyMtGox = 3;
	private static final int MaxFailedLogins = 4;
	private static final int EmailCodeLength = 5;

	final static String randomUIID = UUID.randomUUID().toString();
	final static private String DROPBOX_APP_KEY = AdminServlet.DROPBOX_APP_KEY;
	final static private String DROPBOX_APP_SECRET = AdminServlet.DROPBOX_APP_SECRET;
	final static private AccessType DROPBOX_ACCESS_TYPE = AccessType.APP_FOLDER;
	final static private String DROPBOX_CACHE_PREFIX = "drop:";
	final static private String DROPBOX_CALLBACK = "https://www.blockchain.info/wallet/dropbox-update";

	final public static int MaxAddresses = 400;

	public static class DropBoxCacheEntry implements Serializable {
		private static final long serialVersionUID = 2L;
		private final String guid;
		private final String key;
		private final String secret;

		public DropBoxCacheEntry(String guid, String key, String secret) {
			super();
			this.guid = guid;
			this.key = key;
			this.secret = secret;
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
	@Override
	protected void doGet(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
		super.doGet(req, res);

		if (maintenance) {
			doMaintaince(res);
			return;
		}

		req.setAttribute("show_adv", false);

		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Pragma", "no-cache");

		req.setAttribute("home_active", null);
		req.setAttribute("wallet_active", " class=\"active\"");

		if (!devMode) {
			//Make all links absolute
			req.setAttribute("root", "https://blockchain.info" + ROOT);
		}

		if (req.getPathInfo() == null || req.getPathInfo().length() == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		req.setAttribute("notifications_type", 0);

		String pathString = req.getPathInfo().substring(1);
		String components[] = pathString.split("/", -1);

		if (pathString == null || pathString.length() == 0 || components.length == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		//Does not need to be escaped as it is never output
		final String guid = components[0].trim();

		Connection conn = BitcoinDatabaseManager.conn();

		PreparedStatement smt = null;
		try {	

			if (guid.equals("faq")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-faq.jsp").forward(req, res);
				return;
			} else if (guid.equals("login")) {
				req.setAttribute("guid", "");
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);
				return;
			} else if (guid.equals("new") || guid.equals("abcaa314-6f67-6705-b384-5d47fbe9d7cc")) { //Special case for demo account - send users to signup page instead
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-new.jsp").forward(req, res);
				return;
			} else if (guid.equals("paypal-vs-bitcoin")) {
				req.setAttribute("guid", "");
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-vs-paypal.jsp").forward(req, res);
				return;
			} else if (guid.equals("yubikey")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-yubikey.jsp").forward(req, res);
				return;
			} else if (guid.equals("security")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-security.jsp").forward(req, res);
				return;
			} else if (guid.equals("devices")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-devices.jsp").forward(req, res);
				return;
			} else if (guid.equals("support-pages")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-support.jsp").forward(req, res);
				return;
			} else if (guid.equals("paper-tutorial")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-paper-tutorial.jsp").forward(req, res);
				return;
			} else if (guid.equals("payment-notifications")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-notifications.jsp").forward(req, res);
				return;
			} else if (guid.equals("backups")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-backups.jsp").forward(req, res);
				return;
			} else if (guid.equals("anonymity")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-anonymity.jsp").forward(req, res);
				return;
			} else if (guid.equals("wallet-format")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-format.jsp").forward(req, res);
				return;
			} else if (guid.equals("escrow")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-escrow.jsp").forward(req, res);
				return;
			} else if (guid.equals("features")) {
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-features.jsp").forward(req, res);
				return;
			} else if (guid.equals("dropbox-update")) {

				String oauth_token = req.getParameter("oauth_token");

				String uid = req.getParameter("uid");

				DropBoxCacheEntry entry = (DropBoxCacheEntry) Cache.get(DROPBOX_CACHE_PREFIX + oauth_token);

				if (entry == null) {
					throw new Exception("Could not find dropbox authentication session");
				}

				AppKeyPair appKeys = new AppKeyPair(DROPBOX_APP_KEY, DROPBOX_APP_SECRET);

				WebAuthSession dropboxSession = new WebAuthSession(appKeys, DROPBOX_ACCESS_TYPE);

				String token = dropboxSession.retrieveWebAccessToken(new RequestTokenPair(entry.getKey(), entry.getsecret()));

				if (!token.equals(uid))
					throw new Exception("Dropbox uid does not match authentication token");

				DropboxAPI<WebAuthSession> api = new DropboxAPI<WebAuthSession>(dropboxSession);

				PreparedStatement selectPayload = conn.prepareStatement("select payload from bitcoin_wallets where guid = ?");

				try {
					selectPayload.setString(1, entry.getGuid());

					ResultSet results = selectPayload.executeQuery();

					if (results.next()) {

						String payload = results.getString(1);

						InputStream stream = new ByteArrayInputStream(payload.getBytes("UTF-8"));

						SimpleDateFormat format = new SimpleDateFormat("dd_MM_yyyy_HH_mm_ss");

						String dateString = format.format(new Date());

						api.putFile("wallet_"+dateString+".aes.json", stream, stream.available(), null, null);

						res.getOutputStream().print("Wallet successfully saved to dropbox. You may now close this window");
					} else {
						throw new Exception("Unauthorized");
					}

				} finally {
					BitcoinDatabaseManager.close(selectPayload);
				}
				return;
			} else if (guid.equals("dropbox-login")) {

				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");

				//Read it back to double check
				PreparedStatement select_smt = conn.prepareStatement("select dropbox_enabled from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {				
						int dropbox_enabled = results.getInt(1);

						if (dropbox_enabled == 1) {

							AppKeyPair appKeys = new AppKeyPair(DROPBOX_APP_KEY, DROPBOX_APP_SECRET);

							WebAuthSession dropboxSession = new WebAuthSession(appKeys, DROPBOX_ACCESS_TYPE);

							WebAuthInfo authInfo = dropboxSession.getAuthInfo(DROPBOX_CALLBACK);

							if (authInfo != null) {
								Cache.put(DROPBOX_CACHE_PREFIX + authInfo.requestTokenPair.key, new DropBoxCacheEntry(rguid, authInfo.requestTokenPair.key, authInfo.requestTokenPair.secret), 86000);
								res.sendRedirect(authInfo.url);
							} else {
								throw new Exception("Error getting Auth info from dropbox");
							}
						} else {
							throw new Exception("Dropbox synchronization not enabled on your acocunt");
						}
					} else {
						throw new Exception("Unauthorized");
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				return;
			} else if (guid.equals("wallet.aes.json")) {
				String rguid = req.getParameter("guid");
				String sharedKey = req.getParameter("sharedKey");


				//Read it back to double check
				PreparedStatement select_smt = conn.prepareStatement("select payload from bitcoin_wallets where guid = ? and shared_key = ?");

				try {

					select_smt.setString(1, rguid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {				
						String payload = results.getString(1);

						res.setContentType("application/octet-stream");

						res.getOutputStream().print(payload);
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				return;
			}

			/** If no special cases were matched we actually display the wallet to the user from here on **/

			//Force https:// on all reauests from here on
			if (!req.isSecure() && !devMode) {
				req.setAttribute("initial_error", "You must use https:// not http:// please update your link");
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
				return;
			} else {
				//If were using https:// we can make link relative again
				req.setAttribute("root", ROOT);
			}


			smt = conn.prepareStatement("select guid, payload, auth_type, yubikey, email, acount_locked_time, email_code, notifications_type, email_code_last_updated, failed_logins from bitcoin_wallets where guid = ? or alias = ?");

			smt.setString(1, guid);
			smt.setString(2, guid); //Alias

			ResultSet results = smt.executeQuery();

			if (results.next()) {				
				final String rguid = results.getString(1);
				String payload = results.getString(2);
				int auth_type = results.getInt(3);
				String yubikey = results.getString(4);
				final String email = results.getString(5);
				long account_locked_time = results.getLong(6);
				String email_code = results.getString(7);
				int notifications_type = results.getShort(8);
				long email_code_last_updated = results.getLong(9);
				int failed_logins = results.getInt(10);

				if (failed_logins >= MaxFailedLogins) {
					if (lockAccount(guid, email, 240)) {
						throw new Exception("Your account account has been locked");
					}
				} else if (failed_logins > 0) {
					req.setAttribute("initial_error", "" + (MaxFailedLogins - failed_logins) + " login attempts left");
				}
				
				long now = System.currentTimeMillis();

				if (account_locked_time > now)
					throw new Exception("Account is locked for another " + ((account_locked_time - now) / 60000) + " minutes");

				//Special case for demo account
				if (rguid.equals("abcaa314-6f67-6705-b384-5d47fbe9d7cc")) {
					req.setAttribute("demo", true);
				}

				req.setAttribute("guid", rguid);
				req.setAttribute("notifications_type", notifications_type);
				req.setAttribute("auth_type", auth_type);

				//If not 2 factor authentication insert the wallet data right away
				if (auth_type == AuthTypeStandard) {
					req.setAttribute("wallet_data", payload);
				} else {

					HttpSession session = req.getSession();

					String saved_guid = (String) session.getAttribute("saved_guid");
					Integer saved_auth_type = (Integer) session.getAttribute("saved_auth_type");

					//Check to see if the user has their two factor authentication settings saved
					boolean needs_auth = true;
					if (session != null) {

						if (saved_guid != null && saved_auth_type != null && saved_guid.equals(rguid) && saved_auth_type == auth_type) {
							req.setAttribute("wallet_data", payload);
							needs_auth = false;
						}
					}

					//Otherwise we need them to authorize themselves
					if (needs_auth) {
						if (auth_type == AuthTypeYubikey ||  auth_type == AuthTypeYubikeyMtGox) {
							//Check that the user has as entered a yubikey in a valid format (in case they didn't fill out the form correctly)
							if (yubikey == null || yubikey.length() == 0) {
								req.setAttribute("auth_type", AuthTypeStandard);
								req.setAttribute("wallet_data", payload);
							} else {
								req.setAttribute("show_yubikey", true);
							}
						} else if (auth_type == AuthTypeEmail) {

							if (email == null || email.length() == 0) {
								req.setAttribute("auth_type", AuthTypeStandard);
								req.setAttribute("wallet_data", payload);
							} else {
								req.setAttribute("show_email", true);
							}

							//If email code is null or it's older than one hour resend it
							//Or the user has mnaually requested a new code
							
							boolean _manual = false;
							if (req.getParameter("email_again") != null) {		
								req.setAttribute("initial_error", "Email code resent. Check you spam folder! Each manual email request counts as one failed login attempt");
								_manual = true;
							}
							
							final boolean manual = _manual;
							
							if (email_code == null || email_code.length() == 0 || email_code_last_updated < System.currentTimeMillis() - 600000 || manual) {
								Thread thread = new Thread() { //Do in background thread as it can be slow
									public void run() {
										String code = generateAndUpdateEmailCode(rguid);

										if (code != null) {
											sendTwoFactorEmail(email, rguid, code);
											
											//Manual re-email counts as one failed login
											if (manual) { 
												Connection conn = BitcoinDatabaseManager.conn();
												try {
													incrementFailedLogins(conn, rguid);
												} catch (SQLException e) {
													e.printStackTrace();
												} finally {
													BitcoinDatabaseManager.close(conn);
												}
											}
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

				getServletContext().getRequestDispatcher("/WEB-INF/" + BitcoinServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);

			} else {
				throw new Exception("Unknown wallet identifier");
			}

		} catch (Exception e) {		

			e.printStackTrace();

			//Admin logging
			System.out.println(req.getRemoteAddr());

			System.out.println(req.getQueryString());

			if (req.getHeader("X-Forwarded-For") != null) {
				System.out.println(req.getHeader("X-Forwarded-For"));
			}

			if (req.getParameter("format") == null) {
				req.setAttribute("initial_error", e.getLocalizedMessage());
				getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			} else if (req.getParameter("format").equals("plain")) {
				res.setStatus(500);
				res.setCharacterEncoding("text/plain");
				res.getOutputStream().print(e.getLocalizedMessage());
			}
		} finally {
			BitcoinDatabaseManager.close(smt);
			BitcoinDatabaseManager.close(conn);
		}
	}

	public static boolean lockAccount(String guid, String email, int minutes) {

		long lock_time =  System.currentTimeMillis() + (minutes * 60000);

		if (email != null) {
			ApiClient api = ApiClient.conn();
			try {
				api.sendMail(email, "Your My Wallet Account has been locked", "<p align=\"center\"><h1>Important.</h1><p>A number of failed attempts have been made to login to to your My Wallet account. For your protection the new login attempts have been disabled until " + new Date(lock_time).toString() + " </p> <p>If these login attempts were not made by you it is recommended you change your password as soon as the account is available again <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a> if you are particularily concerned please contact us and we will extend the lock.</p>");
			} finally {
				ApiClient.close(api);
			}
		}

		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;
		try {

			//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
			smt = conn.prepareStatement("update bitcoin_wallets set acount_locked_time = ?, failed_logins = 0, email_code = null  where guid = ?");

			System.out.println("Set lock time " + lock_time + " " + guid);

			smt.setLong(1, lock_time);
			smt.setString(2, guid);

			if (smt.executeUpdate() == 1) {

				System.out.println("Did update");

				return true;
			}

		} catch (Exception e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(smt);
			BitcoinDatabaseManager.close(conn);
		}		

		return false;

	}

	public static boolean sendEmailLink(String guid) {

		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;

		try {
			//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
			smt = conn.prepareStatement("select email, email_code, alias from bitcoin_wallets where guid = ?");

			smt.setString(1, guid);

			ResultSet results = smt.executeQuery();

			if (results.next()) {

				String email = results.getString(1);
				String email_code = results.getString(2);
				String alias = results.getString(3);

				ApiClient api = ApiClient.conn();
				try {

					String message = "<p align=\"center\"><h1>Welcome To Your New Wallet.</h1><p>You can login at anytime using the link below. Be sure to keep this safe and stored separately from your password. </p><p><a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a>";

					if (alias != null && alias.length() > 0) {
						message += " or <a href=\"https://blockchain.info/wallet/" + alias + "\">https://blockchain.info/wallet/" + alias + "</a>";
					}

					message += "</p><p>To validate your email address please use the following code when prompted on the Account Details page </p> <p> Confirmation Code : <b>" + email_code + "</b></p>";

					api.sendMail(email, "Link to your new wallet", message);
				} finally {
					ApiClient.close(api);
				}

				return true;
			} else {
				return false;
			}

		} catch (Exception e) {
			e.printStackTrace();
			return false;
		} finally {
			BitcoinDatabaseManager.close(smt);
			BitcoinDatabaseManager.close(conn);
		}	
	}

	public static String generateAndUpdateEmailCode(String guid) {
		String code = UUID.randomUUID().toString().substring(0, EmailCodeLength).toUpperCase();

		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;
		try {

			//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
			smt = conn.prepareStatement("update bitcoin_wallets set email_code = ?, email_code_last_updated = ? where guid = ?");

			smt.setString(1, code);
			smt.setLong(2, System.currentTimeMillis());
			smt.setString(3, guid);

			if (smt.executeUpdate() == 1)
				return code;

		} catch (Exception e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(conn);
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

		ApiClient api = ApiClient.conn();
		try {
			return api.sendMail(email, "My Wallet Confirmation code", "<h1>Confirmation Required</h1> <p>An attempt has been made to login to your My wallet account. Enter the confirmation code below to access your account. If it was not you who made this login attempt you can ignore this email. </p><h2>" + code +"</h2>");
		} finally {
			ApiClient.close(api);
		}
	}

	public static boolean sendEmailBackup(String guid, String email, String payload) {

		ApiClient api = ApiClient.conn();
		try {
			return api.sendMail(email, "Wallet Backup", "<h1>Encrypted Wallet Backup</h1> <p>Below is your AES encrypted wallet data. You can use it to restore your wallet at anytime using <a href=\"https://blockchain.info/wallet\">My Wallet</a> or using standard unix tools</p> <p>Your wallet url is <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a></p> <small>" + payload + "</small>");
		} finally {
			ApiClient.close(api);
		}
	}

	public String encode(String str){
		if(str==null) return "";

		StringBuffer s = new StringBuffer ((String) str);

		for (int i = 0; i < s.length(); i++) {	
			if (s.charAt (i) == '"')
				s.insert (i++, '\\');
		}

		return s.toString();
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

	protected void doPost(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
		res.setContentType("text/plain");

		Connection conn = BitcoinDatabaseManager.conn();

		try {
			String guid = req.getParameter("guid");
			String sharedKey = req.getParameter("sharedKey");
			String payload = req.getParameter("payload");
			String method = req.getParameter("method");

			//All commands must have a guid
			int pre_guid_length = guid.length();
			guid = Jsoup.parse(guid).text();
			guid = UUID.fromString(guid).toString();

			//Change to see if we strupped anything - could be a sign of malicious input
			if (guid == null || guid.length() != 36 || pre_guid_length != guid.length()) {
				throw new Exception("Invalid Input");
			}
			
			//get-info has no payload
			if (!method.equals("get-info")) {
				int pre_payload_length = payload.length();

				//Strip and html or javascript
				payload = Jsoup.parse(payload).text();
				int length = Integer.valueOf(req.getParameter("length")).intValue();

				//Check length to see if we stripped anything - could be a sign of malicious input
				//Length verification also serves as rudimentary data corruption check
				//Wallet payload is properly verified with a checksum later
				if (payload == null || payload.length() == 0  || pre_payload_length != payload.length() || length != payload.length()) {
					throw new Exception("Invalid Input");
				}
			} 

			//Shared key is not needed for the get-wallet method
			if (!method.equals("get-wallet")) {
				int pre_shared_length = sharedKey.length();
				sharedKey = Jsoup.parse(sharedKey).text();
				sharedKey = UUID.fromString(sharedKey).toString();

				if (pre_shared_length != sharedKey.length() || sharedKey.length() != 36) {
					throw new Exception("Invalid Input");
				}	
			}

			String ip = req.getRemoteAddr();

			long now = new Date().getTime();

			//Special case for demo account, don't allow modifications
			if (guid.equals("abcaa314-6f67-6705-b384-5d47fbe9d7cc") && !method.equals("get-info")) {
				res.getOutputStream().print("Success!");
				return;
			}

			if (method.equals("insert")) {

				//Check Re-captcha
				String remoteAddr = req.getRemoteAddr(); 
				ReCaptchaImpl reCaptcha = new ReCaptchaImpl();
				reCaptcha.setPrivateKey(AdminServlet.RECAPTHCA_PRIVATE);

				String challenge = req.getParameter("recaptcha_challenge_field");
				String uresponse = req.getParameter("recaptcha_response_field");

				if (challenge == null || uresponse == null || !reCaptcha.checkAnswer(remoteAddr, challenge, uresponse).isValid()) {
					res.setStatus(500);
					res.getOutputStream().print("Captcha Failed");
					return; 
				}

				PreparedStatement select_recent = null;
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
				}


				if (!Base64.isBase64(payload)) {
					throw new Exception("Payload not base64");
				}

				if (payload.length() > 1048576) {
					res.setStatus(500);
					res.getOutputStream().print("Wallets are restricted to 1MB in size");	
					return;
				}

				PreparedStatement smt = null;
				try {
					smt = conn.prepareStatement("insert into bitcoin_wallets (guid, created, payload, shared_key, created_ip) values(?, ?, ?, ?, ?)");

					smt.setString(1, guid);
					smt.setLong(2, now);
					smt.setString(3, payload);
					smt.setString(4, sharedKey);
					smt.setString(5, ip);

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

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set payload = ?, updated = ?, updated_ip = ?, payload_checksum = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload);
					update_smt.setLong(2, now);
					update_smt.setString(3, ip);
					update_smt.setBytes(4, checksum);
					update_smt.setString(5, guid);
					update_smt.setString(6, sharedKey);

					if (update_smt.executeUpdate() != 1) {
						res.setStatus(500);
						res.getOutputStream().print("Error backing up wallet");	
						return;
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

				//Read it back to double check
				PreparedStatement select_smt = conn.prepareStatement("select payload, payload_checksum from bitcoin_wallets where guid = ? and shared_key = ?");
				try {

					select_smt.setString(1, guid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {				
						String wallet_payload = results.getString(1);
						byte[] payload_checksum = results.getBytes(2);

						if (Arrays.equals(checksum, payload_checksum) && payload.equals(wallet_payload)) {							
							res.getOutputStream().print("Wallet succesfully synced with server");
						} else {
							res.setStatus(500);
							res.getOutputStream().print("Wallet was updated, however checksum did not validate on re-read! This is a serious error, please contact support@pi.uk.com");	
							return;
						}
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Failed to re-read wallet after save. Your wallet may not be saved properly.");	
						return;
					}

				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

			} else if (method.equals("update-notifications-type")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set notifications_type = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setInt(1, Integer.valueOf(payload).intValue());
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
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set auth_type = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setInt(1, Integer.valueOf(payload).intValue());
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Two factor authentication settings updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating two factor authentication");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
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

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set yubikey = ? where guid = ? and shared_key = ?");

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
					res.getOutputStream().print("A Maximum of "+MaxAddresses+" bitcoin addresses are supported.");
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

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set email = ?, email_verified = 0 where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload.trim());
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {	

						//Generate a new email code
						generateAndUpdateEmailCode(guid);

						if (sendEmailLink(guid)) {
							res.getOutputStream().print("Email successfully updated. You have been notified");
						} else {
							res.setStatus(500);
							res.getOutputStream().print("Email updated. However an error was encountered when sending confirmation link.");
						} 
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating email");	
					}

				} finally { //get-info
					BitcoinDatabaseManager.close(update_smt);
				}


			} else if (method.equals("get-info")) {
				PreparedStatement select_smt = conn.prepareStatement("select email, secret_phrase, alias, yubikey, email_verified, http_url, skype_username, dropbox_enabled from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, guid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {
						String email = encode(results.getString(1));
						String phrase = encode(results.getString(2));
						String alias = encode(results.getString(3));
						String yubikey = encode(results.getString(4));
						int email_verified = results.getInt(5);
						String http_url = encode(results.getString(6));
						String skype_username = encode(results.getString(7));
						int dropbox_enabled = results.getInt(8);

						res.setContentType("application/json");

						res.getOutputStream().print("{\"email\" : \"" + email + "\", \"phrase\" : \"" + phrase + "\", \"alias\" : \"" + alias + "\", \"yubikey\" : \"" + yubikey + "\", \"email_verified\" : \"" + email_verified + "\", \"http_url\" : \"" + http_url + "\", \"skype_username\" : \"" + skype_username + "\", \"dropbox_enabled\" : \"" + dropbox_enabled + "\"}");

					} else {
						res.setStatus(500);
						res.getOutputStream().print("Failed to get wallet info");
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}
			} else if (method.equals("update-phrase")) {
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
			} else if (method.equals("update-dropbox-enabled")) {

				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set dropbox_enabled = ? where guid = ? and shared_key = ?");

				try {

					if (payload.equals("true"))
						update_smt.setInt(1, 1);
					else
						update_smt.setInt(1, 0);

					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Dropbox updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating dropbox");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}

			} else if (method.equals("update-alias")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set alias = ? where guid = ? and shared_key = ?");

				try {
					update_smt.setString(1, payload.trim());
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
				PreparedStatement select_smt = conn.prepareStatement("select email, payload from bitcoin_wallets where guid = ? and shared_key = ?");

				try {
					select_smt.setString(1, guid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();

					if (results.next()) {
						String email = results.getString(1);
						payload = results.getString(2);

						if (sendEmailBackup(guid, email, payload)) {
							res.getOutputStream().print("Wallet backup sent to " + email);
						} else {
							res.setStatus(500);
							res.getOutputStream().print("Failed to send wallet backup");
						}
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Failed to send wallet backup");
					}

				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}
			} else if (method.equals("get-wallet")) {
				//Get Wallet is called by the javascript client when two-factor authentication is enabled

				int failed_logins = 0;
				boolean login_did_fail = false;
				String email = null;

				PreparedStatement select_smt = null;
				PreparedStatement smt = null;
				try {
					smt = conn.prepareStatement("select payload, email, auth_type, yubikey, acount_locked_time, failed_logins, email_code from bitcoin_wallets where guid = ?");

					smt.setString(1, guid);

					ResultSet results = smt.executeQuery();

					if (results.next()) {				
						String wallet_payload = results.getString(1);
						email = results.getString(2);
						int auth_type = results.getInt(3);
						String yubikey = results.getString(4);
						long account_locked_time = results.getLong(5);
						failed_logins = results.getInt(6);
						String email_code = results.getString(7);

						if (account_locked_time > now) {				
							throw new Exception("Account is locked");
						}

						if (auth_type == AuthTypeYubikey) {
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

									if (!otpYubikey.equals(yubikey)) {
										login_did_fail = true;
										throw new Exception("OTP provided does not match yubikey associated with the account");
									}			

									YubicoResponse response = client.verify(otp);

									if (response.getStatus() == YubicoResponseStatus.OK) {

										HttpSession session = req.getSession(true);

										if (session != null) {
											session.setAttribute("saved_guid", guid);
											session.setAttribute("saved_auth_type", auth_type);

											session.setMaxInactiveInterval(240);
										}

										//Everything ok, output the encrypted payload
										res.getOutputStream().print(wallet_payload);
									} else {
										login_did_fail = true;
										throw new Exception("Failed to validate Yubikey with remote server");
									}
								} catch (Exception e) {
									throw new Exception("Error Validating Yubikey");
								}
							}
						} else if (auth_type == AuthTypeYubikeyMtGox) {

							//For mount gox keys we only check the key identity and don't validate it with the OTP server
							String otp = payload;

							if (otp == null || otp.length() == 0 || otp.length() > 255)
								throw new Exception("You must provide a valid OTP");

							if (!YubicoClient.isValidOTPFormat(otp)) {
								login_did_fail = true;
								throw new Exception("Invalid Yubikey OTP");
							}

							String otpYubikey = YubicoClient.getPublicId(otp);

							if (!otpYubikey.equals(yubikey)) {
								login_did_fail = true;
								throw new Exception("OTP provided does not match yubikey associated with the account");
							} else {


								HttpSession session = req.getSession(true);

								if (session != null) {
									session.setAttribute("saved_guid", guid);
									session.setAttribute("saved_auth_type", auth_type);
									session.setMaxInactiveInterval(1440); //Email expires in 24 hours
								}

								res.getOutputStream().print(wallet_payload);
							}

						} else if (auth_type == AuthTypeEmail) {
							//Check email code

							String code = payload;

							if (code == null || code.length() != EmailCodeLength)
								throw new Exception("You must provide a valid email authentication code");

							if (code.equals(email_code)) {
								HttpSession session = req.getSession(true);

								if (session != null) {
									session.setAttribute("saved_guid", guid);
									session.setAttribute("saved_auth_type", auth_type);
									session.setMaxInactiveInterval(240);
								}

								//Login successful				
								res.getOutputStream().print(wallet_payload);
							} else {
								login_did_fail = true;
								throw new Exception("Email authentication code is incorrect");
							}

						}
					}  else {
						throw new Exception("Unknown Wallet Identifier.");
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

					BitcoinDatabaseManager.close(smt);
					BitcoinDatabaseManager.close(select_smt);
				}
			}

		} catch (Exception e) {

			//Admin logging
			System.out.println(req.getRemoteAddr());

			System.out.println(req.getQueryString());

			if (req.getHeader("X-Forwarded-For") != null) {
				System.out.println(req.getHeader("X-Forwarded-For"));
			}

			res.setStatus(500);

			res.getOutputStream().print("Exception caught syncing wallet. Please contact the site administrator.");

			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(conn);
		}
	}
}
