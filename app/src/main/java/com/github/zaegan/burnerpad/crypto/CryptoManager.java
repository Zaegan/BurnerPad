package com.github.zaegan.burnerpad.crypto;

import android.util.Base64;

import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Full crypto stack for BurnerPad.
 * All operations use standard javax.crypto APIs (no third-party libraries).
 *
 * ENCRYPTION ARCHITECTURE:
 *   Session key: in memory only, never persisted.
 *   File format: JSON { iv, ciphertext, hmac }
 *     iv:         hex string (32 chars = 128-bit IV)
 *     ciphertext: base64 string (AES-256-CBC / PKCS5)
 *     hmac:       hex string (HMAC-SHA256 of base64 ciphertext)
 *   Archive adds: { salt, iv, ciphertext, hmac }
 *
 * KEY DERIVATION: PBKDF2WithHmacSHA256, 100,000 iterations, 256-bit output.
 * Salt: 16 random bytes, stored separately in EncryptedSharedPreferences.
 *
 * PIN SEMANTICS:
 *   pinSalt + PIN → pinHash (for verification, stored)
 *   deriveSalt + PIN → sessionKey (for encryption, in memory only)
 *
 * MIN PIN: 5 characters. PIN "12345" silently bypasses the lock screen.
 */
public final class CryptoManager {

    public static final int MIN_PIN_LENGTH    = 5;
    public static final int PBKDF2_ITERATIONS = 100_000;
    public static final String NO_PIN         = "12345";

    private static final int PBKDF2_KEY_BITS = 256;
    private static final int SALT_BYTES      = 16;

    private static byte[] sessionKey = null;

    private CryptoManager() {}

    // ── Session key ──────────────────────────────────────────────────────────

    public static synchronized void setSessionKey(byte[] key) {
        clearSessionKey();
        sessionKey = Arrays.copyOf(key, key.length);
    }

    public static synchronized void clearSessionKey() {
        if (sessionKey != null) {
            Arrays.fill(sessionKey, (byte) 0);
            sessionKey = null;
        }
    }

    public static synchronized boolean hasSessionKey() {
        return sessionKey != null;
    }

    /** Returns a copy of the session key for use in background threads. May return null. */
    public static synchronized byte[] copySessionKey() {
        if (sessionKey == null) return null;
        return Arrays.copyOf(sessionKey, sessionKey.length);
    }

    // ── Random generation ────────────────────────────────────────────────────

    public static String randomHex(int byteCount) {
        byte[] bytes = new byte[byteCount];
        new SecureRandom().nextBytes(bytes);
        return toHex(bytes);
    }

    // ── Key derivation ───────────────────────────────────────────────────────

    public static byte[] deriveKey(String password, String saltHex) throws Exception {
        byte[] salt = hexToBytes(saltHex);
        PBEKeySpec spec = new PBEKeySpec(
                password.toCharArray(), salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BITS);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] derived = factory.generateSecret(spec).getEncoded();
        spec.clearPassword();
        return derived;
    }

    // ── Symmetric encryption ─────────────────────────────────────────────────

    public static String encryptWithKey(String plaintext, byte[] key) throws Exception {
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE,
                new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        byte[] encrypted  = cipher.doFinal(plaintext.getBytes("UTF-8"));
        String ciphertext = Base64.encodeToString(encrypted, Base64.NO_WRAP);
        String hmac       = hmac256(ciphertext, key);
        JSONObject obj    = new JSONObject();
        obj.put("iv",         toHex(iv));
        obj.put("ciphertext", ciphertext);
        obj.put("hmac",       hmac);
        return obj.toString();
    }

    public static String decryptWithKey(String encryptedJson, byte[] key) throws Exception {
        if (encryptedJson == null || encryptedJson.length() < 10) return "";
        JSONObject obj    = new JSONObject(encryptedJson);
        String iv         = obj.getString("iv");
        String ciphertext = obj.getString("ciphertext");
        String hmac       = obj.getString("hmac");
        String expectedHmac = hmac256(ciphertext, key);
        if (!expectedHmac.equals(hmac)) {
            // Fallback: pre-fix Java build computed HMAC over UTF-8 bytes of the base64 string
            if (!hmac256Utf8(ciphertext, key).equals(hmac))
                throw new Exception("Authentication failed. File may be corrupted.");
        }
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE,
                new SecretKeySpec(key, "AES"), new IvParameterSpec(hexToBytes(iv)));
        byte[] decrypted = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
        return new String(decrypted, "UTF-8");
    }

    // ── Note encryption/decryption (uses session key) ────────────────────────

    public static String encryptNote(String plaintext) throws Exception {
        byte[] key = copySessionKey();
        if (key == null) throw new Exception("No session key. Please log in again.");
        try {
            return encryptWithKey(plaintext, key);
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    public static String decryptNote(String encryptedJson) throws Exception {
        byte[] key = copySessionKey();
        if (key == null) throw new Exception("No session key. Please log in again.");
        try {
            return decryptWithKey(encryptedJson, key);
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    // ── Archive encryption (password-based, separate key) ───────────────────

    public static String encryptArchive(String plaintext, String password) throws Exception {
        String saltHex = randomHex(SALT_BYTES);
        byte[] key = deriveKey(password, saltHex);
        try {
            byte[] iv = new byte[16];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
            byte[] encrypted  = cipher.doFinal(plaintext.getBytes("UTF-8"));
            String ciphertext = Base64.encodeToString(encrypted, Base64.NO_WRAP);
            String hmac       = hmac256(ciphertext, key);
            JSONObject obj    = new JSONObject();
            obj.put("salt",       saltHex);
            obj.put("iv",         toHex(iv));
            obj.put("ciphertext", ciphertext);
            obj.put("hmac",       hmac);
            return obj.toString();
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    public static String decryptArchive(String encryptedJson, String password) throws Exception {
        JSONObject obj    = new JSONObject(encryptedJson);
        String saltHex    = obj.getString("salt");
        String ivHex      = obj.getString("iv");
        String ciphertext = obj.getString("ciphertext");
        String hmac       = obj.getString("hmac");
        byte[] key = deriveKey(password, saltHex);
        try {
            String expectedHmac = hmac256(ciphertext, key);
            if (!expectedHmac.equals(hmac)) {
                // Fallback: pre-fix Java build computed HMAC over UTF-8 bytes of the base64 string
                if (!hmac256Utf8(ciphertext, key).equals(hmac))
                    throw new Exception("Incorrect password or corrupted archive.");
            }
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE,
                    new SecretKeySpec(key, "AES"), new IvParameterSpec(hexToBytes(ivHex)));
            byte[] decrypted = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            return new String(decrypted, "UTF-8");
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    // ── HMAC-SHA256 ──────────────────────────────────────────────────────────

    /** Correct HMAC: over raw bytes of decoded base64 ciphertext (matches original RN CryptoModule). */
    private static String hmac256(String base64Data, byte[] key) throws Exception {
        byte[] data = Base64.decode(base64Data, Base64.NO_WRAP);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return toHex(mac.doFinal(data));
    }

    /** Legacy HMAC: over UTF-8 bytes of the base64 string itself (first Java build only). */
    private static String hmac256Utf8(String data, byte[] key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return toHex(mac.doFinal(data.getBytes("UTF-8")));
    }

    // ── Hex utilities ────────────────────────────────────────────────────────

    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    public static byte[] hexToBytes(String hex) {
        int len  = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2)
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        return data;
    }
}
