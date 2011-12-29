package piuk.bitcoin.website;

import java.io.IOException;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Arrays;
import java.util.Date;
import java.util.UUID;

import javax.mail.Message;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import org.bouncycastle.util.encoders.Hex;
import org.jsoup.Jsoup;

import com.yubico.client.v2.YubicoClient;
import com.yubico.client.v2.YubicoResponse;
import com.yubico.client.v2.YubicoResponseStatus;

import piuk.bitcoin.db.BitcoinDatabaseManager;
import piuk.bitcoin.website.admin.ApiClient;
import piuk.bitcoin.website.admin.SendNotificationsOperation;

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

	@Override
	protected void doGet(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
		super.doGet(req, res);
	

		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Pragma", "no-cache");
		
		req.setAttribute("resource", BaseServlet.LOCAL_RESOURCE_URL);
		req.setAttribute("home_active", null);
		req.setAttribute("wallet_active", " class=\"active\"");

		if (req.getPathInfo() == null || req.getPathInfo().length() == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		String pathString = req.getPathInfo().substring(1);
		String components[] = pathString.split("/", -1);
		
		if (pathString == null || pathString.length() == 0) {	
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-index.jsp").forward(req, res);
			return;
		}

		final String guid = components[0];
		
		if (guid.equals("faq")) {
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-faq.jsp").forward(req, res);
			return;
		} else if (guid.equals("login")) {
			req.setAttribute("guid", "");
			getServletContext().getRequestDispatcher("/WEB-INF/"+ BitcoinServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);
			return;
		} else if (guid.equals("new")) {
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
		}
		
		Connection conn = BitcoinDatabaseManager.conn();

		PreparedStatement smt = null;
		try {
			smt = conn.prepareStatement("select guid, payload, auth_type, yubikey, email, acount_locked_time, email_code from bitcoin_wallets where guid = ? or alias = ?");

			smt.setString(1, guid);
			smt.setString(2, guid);

			ResultSet results = smt.executeQuery();

			if (results.next()) {				
				String rguid = results.getString(1);
				String payload = results.getString(2);
				int auth_type = results.getInt(3);
				String yubikey = results.getString(4);
				final String email = results.getString(5);
				long account_locked_time = results.getLong(6);
				String email_code = results.getString(7);

				long now = System.currentTimeMillis();
				
				if (account_locked_time > now)
					throw new Exception("Account is locked for another " + ((account_locked_time - now) / 60000) + " minutes");

				req.setAttribute("guid", rguid);
				
				req.setAttribute("auth_type", auth_type);

				//If not 2 factor authentication insert the wallet data right away
				if (auth_type == AuthTypeStandard) {
					req.setAttribute("wallet_data", payload);
				} else {
					
					HttpSession session = req.getSession(false);
					
					//Check to see if the user has their two factor authentication settings saved
					boolean needs_auth = true;
					if (session != null) {
						String saved_guid = (String) session.getAttribute("saved_guid");
						
						if (saved_guid != null && saved_guid.equals(guid)) {
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
							
							if (email_code == null || email_code.length() == 0) {
								Thread thread = new Thread() { //Do in background thread as it can be slow
									public void run() {
										makeAndSendTwoFactorEmail(email, guid);
									}
								};
								
								thread.start();
							}
						}
					}
				}
				
				req.setAttribute("auth", rguid);
			
				getServletContext().getRequestDispatcher("/WEB-INF/" + BitcoinServlet.ROOT + "bitcoin-wallet-app.jsp").forward(req, res);
				
			} else {
				throw new Exception("Unknown wallet identifier");
			}
						
		} catch (Exception e) {		
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
			String message = "<p align=\"center\"><h1>Important.</h1><p>A number of failed attempts have been made to login to to your My Wallet account. For your protection the new login attempts have been disabled until " + new Date(lock_time).toString() + " </p> <p>If these login attempts were not made by you it is recommended you change your password as soon as the account is available again <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a> if you are particularily concerned please contact us and we will extend the lock.</p>";
			
			ApiClient.conn().sendMail(email, "Your My Wallet Account has been locked", message);
		}
				
		
		System.out.println(new Date(lock_time).getTime() - System.currentTimeMillis());
		
		
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
	
	public static boolean sendEmailLink(String email, String guid) {
		return ApiClient.conn().sendMail(email, "Link to your new wallet", "<p align=\"center\"><h1>Welcome To Your New Wallet.</h1><p>You can login at anytime using the link below. Be sure to keep this safe and stored separately from your password. </p><p><a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a></p>");
	}
	
	public static boolean makeAndSendTwoFactorEmail(String email, String guid) {
		
		String code = UUID.randomUUID().toString().substring(0, EmailCodeLength).toUpperCase();
		
		ApiClient.conn().sendMail(email, "My Wallet Login Code", "<h1>Confirmation Required</h1> <p>An attempt has been made to login to your My wallet account. Enter the confirmation code below to access your account. If it was not you who made this login attempt you can ignore this email. </p><h2>" + code +"</h2>");
		
		Connection conn = BitcoinDatabaseManager.conn();
		PreparedStatement smt = null;
		try {
			
			//Reset the email code because it's possible the confirmation email got lost somewhere on the intertubes
			smt = conn.prepareStatement("update bitcoin_wallets set email_code = ? where guid = ?");
			
			System.out.println("Set code" + code);
			
			smt.setString(1, code);
			smt.setString(2, guid);

			if (smt.executeUpdate() == 1)
				return true;
			
		} catch (Exception e) {
			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(conn);
			BitcoinDatabaseManager.close(smt);
		}		
		
		return false;
	}

	public static boolean sendEmailBackup(String guid, String email, String payload)  {
		return ApiClient.conn().sendMail(email, "Wallet Backup", "<h1>Encrypted Wallet Backup</h1> <p>Below is your AES encrypted wallet data. You can use it to restore your wallet at anytime using <a href=\"https://blockchain.info/wallet\">My Wallet</a> or using standard unix tools</p> <p>Your wallet url is <a href=\"https://blockchain.info/wallet/" + guid + "\">https://blockchain.info/wallet/" + guid + "</a></p> <small>" + payload + "</small>");
	}
	
	public String addSlashes(String str){
		if(str==null) return "";

		StringBuffer s = new StringBuffer ((String) str);
		for (int i = 0; i < s.length(); i++)
		if (s.charAt (i) == '\'')
		s.insert (i++, '\\');
		return s.toString();

	}

	protected void doPost(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {

		res.setContentType("text/plain");

		Connection conn = BitcoinDatabaseManager.conn();
		try {

			String guid = req.getParameter("guid");

			String sharedKey = req.getParameter("sharedKey");

			String payload = req.getParameter("payload");

			//Strip any html or javascript
			if (payload != null)
				payload = Jsoup.parse(payload).text();
			
			if (sharedKey != null)
				sharedKey = Jsoup.parse(sharedKey).text();
			
			if (guid != null)
				guid = Jsoup.parse(guid).text();
		    
			if (guid== null || guid.length() != 36) {
				res.setStatus(500);
				res.getOutputStream().print("Invalid input");
				return;
			}
			
			String ip = req.getHeader("X-Forwarded-For");

			if (ip == null) {
				ip = req.getRemoteAddr();
			}
			
			String method = req.getParameter("method");
			
			long now = new Date().getTime();

			PreparedStatement smt = null;

			if (method.equals("insert")) {
				
				//Check payload

				int length = Integer.valueOf(req.getParameter("length")).intValue();

				if (payload == null || payload.length() == 0 || length != payload.length()) {
					res.setStatus(500);

					res.getOutputStream().print("Invalid input");

					return;
				}
			
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
				
				
				//Check payload
				int length = Integer.valueOf(req.getParameter("length")).intValue();

				if (payload == null || payload.length() == 0 || length != payload.length()) {
					res.setStatus(500);

					res.getOutputStream().print("Invalid input");

					return;
				}
				
				byte[] checksum = Hex.decode(req.getParameter("checksum"));
				
				MessageDigest md = MessageDigest.getInstance("SHA-256");
				
				byte[] thedigest = md.digest(payload.getBytes("UTF-8"));
				
				System.out.println(new String(thedigest));
				
				if (!Arrays.equals(thedigest, checksum)) {
					res.setStatus(500);
					res.getOutputStream().print("Checksum did not validate");
					return;
				}
				
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set payload = ?, updated = ?, updated_ip = ?, payload_checksum = ? where guid = ? and (shared_key is null or shared_key = ?)");

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
				PreparedStatement select_smt = conn.prepareStatement("select payload, payload_checksum from bitcoin_wallets where guid = ? and (shared_key is null or shared_key = ?)");
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
						res.getOutputStream().print("Failed to re-read wallet after save. You wallet may not be saved properly.");	
						return;
					}

				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}

				
			} else if (method.equals("update-auth-type")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set auth_type = ? where guid = ? and (shared_key is null or shared_key = ?)");

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
				
			}else if (method.equals("update-yubikey")) {
				
				//Check payload
				int length = Integer.valueOf(req.getParameter("length")).intValue();
				if (payload == null || payload.length() == 0 || length != payload.length()) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid input");
					return;
				}
				
				if (!YubicoClient.isValidOTPFormat(payload)) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid Yubikey OTP");
					return;
				}
				
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set yubikey = ? where guid = ? and (shared_key is null or shared_key = ?)");

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
				
			} else if (method.equals("update-email")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set email = ? where guid = ? and (shared_key = ? or shared_key is NULL)");

				try {
					update_smt.setString(1, payload);
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {						
						if (sendEmailLink(payload, guid)) {
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
				PreparedStatement select_smt = conn.prepareStatement("select email, secret_phrase, alias, yubikey from bitcoin_wallets where guid = ? and (shared_key = ? or shared_key is NULL)");

				try {
					select_smt.setString(1, guid);
					select_smt.setString(2, sharedKey);

					ResultSet results = select_smt.executeQuery();
					
					if (results.next()) {
						String email = results.getString(1);
						String phrase = addSlashes(results.getString(2));
						String alias = addSlashes(results.getString(3));
						String yubikey = addSlashes(results.getString(4));

						if (email == null)
							email = "";
						
						if (phrase == null)
							phrase = "";
						
						if (alias == null)
							alias = "";
						
						if (yubikey == null)
							yubikey = "";
						
						res.setContentType("text/json");
						
						res.getOutputStream().print("{\"email\" : \"" + email + "\", \"phrase\" : \"" + phrase + "\", \"alias\" : \"" + alias + "\", \"yubikey\" : \"" + yubikey + "\"}");
						
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Failed to get wallet info");
					}
				} finally {
					BitcoinDatabaseManager.close(select_smt);
				}
			} else if (method.equals("update-phrase")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set secret_phrase = ? where guid = ? and (shared_key = ? or shared_key is NULL)");

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
			} else if (method.equals("update-alias")) {
				PreparedStatement update_smt = conn.prepareStatement("update bitcoin_wallets set alias = ? where guid = ? and (shared_key = ? or shared_key is NULL)");

				try {
					update_smt.setString(1, payload);
					update_smt.setString(2, guid);
					update_smt.setString(3, sharedKey);

					if (update_smt.executeUpdate() == 1) {
						res.getOutputStream().print("Alias successfully updated");
					} else {
						res.setStatus(500);
						res.getOutputStream().print("Error updating alias");	
					}

				} finally {
					BitcoinDatabaseManager.close(update_smt);
				}
			} else if (method.equals("email-backup")) {
				PreparedStatement select_smt = conn.prepareStatement("select email, payload from bitcoin_wallets where guid = ? and (shared_key = ? or shared_key is NULL)");

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
								
				//Check payload
				int length = Integer.valueOf(req.getParameter("length")).intValue();
				if (payload == null || payload.length() == 0 || length != payload.length()) {
					res.setStatus(500);
					res.getOutputStream().print("Invalid input");
					return;
				}
				
				int failed_logins = 0;
				boolean login_did_fail = false;
				String email = null;
				
				PreparedStatement select_smt = null;
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

						PreparedStatement update_logins = null;
						try {
							update_logins = conn.prepareStatement("update bitcoin_wallets set failed_logins = failed_logins + 1 where guid = ?");
	
							update_logins.setString(1, guid);
							
							update_logins.executeUpdate();
						} finally {
							BitcoinDatabaseManager.close(update_logins);
						}
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
					
					BitcoinDatabaseManager.close(select_smt);
				}
			}
		}
				
		} catch (Exception e) {
			res.setStatus(500);

			res.getOutputStream().print("Exception caught syncing wallet. Please contact the site administrator.");

			e.printStackTrace();
		} finally {
			BitcoinDatabaseManager.close(conn);
		}
	}
}
