package com.github.zaegan.burnerpad.prefs;

import com.github.zaegan.burnerpad.crypto.CryptoManager;

import java.util.Arrays;

/**
 * PIN lifecycle: initialization, verification, change, duress PIN, wipe.
 * All persistent state lives in SecurePrefs.
 *
 * Key scheme:
 *   pinSalt + PIN    → pinHash  (stored; used only to verify PIN)
 *   deriveSalt + PIN → sessionKey (derived on unlock; held in CryptoManager, never stored)
 *
 * SCHEMA version 1 (matches original RN app).
 */
public final class PinManager {

    public static final int    CURRENT_SCHEMA = 1;
    public static final String NO_PIN         = "12345";
    private static final int   SALT_BYTES     = 16;

    private static final String KEY_PIN_HASH    = "burnerpad_pin_hash";
    private static final String KEY_PIN_SALT    = "burnerpad_pin_salt";
    private static final String KEY_DERIVE_SALT = "burnerpad_derive_salt";
    private static final String KEY_DURESS_HASH = "burnerpad_duress_hash";
    private static final String KEY_DURESS_SALT = "burnerpad_duress_salt";
    private static final String KEY_INITIALIZED = "burnerpad_initialized";
    private static final String KEY_AUTOSAVE    = "burnerpad_autosave";
    private static final String KEY_THEME       = "burnerpad_theme";
    private static final String KEY_WALKTHROUGH = "burnerpad_walkthrough_seen";
    private static final String KEY_TUTORIALS   = "burnerpad_tutorials";
    private static final String KEY_LAST_LOC    = "burnerpad_last_location";
    private static final String KEY_SCHEMA      = "burnerpad_schema";

    private PinManager() {}

    // ── Initialization ───────────────────────────────────────────────────────

    public static boolean isInitialized() {
        return "true".equals(SecurePrefs.get(KEY_INITIALIZED, "false"));
    }

    /**
     * First-time setup: generate salts, store PIN hash, set session key.
     * Do NOT call for PIN changes — use changePin() instead.
     */
    public static void initialize(String pin) throws Exception {
        String deriveSalt = CryptoManager.randomHex(SALT_BYTES);
        SecurePrefs.set(KEY_DERIVE_SALT, deriveSalt);

        String pinSalt = CryptoManager.randomHex(SALT_BYTES);
        byte[] pinHash = CryptoManager.deriveKey(pin, pinSalt);
        SecurePrefs.set(KEY_PIN_SALT, pinSalt);
        SecurePrefs.set(KEY_PIN_HASH, CryptoManager.toHex(pinHash));
        Arrays.fill(pinHash, (byte) 0);

        SecurePrefs.remove(KEY_DURESS_HASH);
        SecurePrefs.remove(KEY_DURESS_SALT);
        SecurePrefs.set(KEY_INITIALIZED, "true");
        SecurePrefs.set(KEY_SCHEMA, String.valueOf(CURRENT_SCHEMA));

        byte[] sessionKey = CryptoManager.deriveKey(pin, deriveSalt);
        CryptoManager.setSessionKey(sessionKey);
        Arrays.fill(sessionKey, (byte) 0);
    }

    // ── PIN verification ─────────────────────────────────────────────────────

    /** Returns "correct", "duress", or "wrong". Sets session key on "correct". */
    public static String verifyPin(String pin) {
        try {
            String pinSalt    = SecurePrefs.get(KEY_PIN_SALT, null);
            String storedHash = SecurePrefs.get(KEY_PIN_HASH, null);
            if (pinSalt == null || storedHash == null) return "wrong";

            byte[] hash = CryptoManager.deriveKey(pin, pinSalt);
            String hashHex = CryptoManager.toHex(hash);
            Arrays.fill(hash, (byte) 0);

            if (hashHex.equals(storedHash)) {
                String deriveSalt = SecurePrefs.get(KEY_DERIVE_SALT, null);
                if (deriveSalt == null) return "wrong";
                byte[] sessionKey = CryptoManager.deriveKey(pin, deriveSalt);
                CryptoManager.setSessionKey(sessionKey);
                Arrays.fill(sessionKey, (byte) 0);
                return "correct";
            }

            // Check duress PIN
            String duressHash = SecurePrefs.get(KEY_DURESS_HASH, null);
            if (duressHash != null) {
                String duressSalt = SecurePrefs.get(KEY_DURESS_SALT, null);
                if (duressSalt != null) {
                    byte[] dCheck = CryptoManager.deriveKey(pin, duressSalt);
                    String dCheckHex = CryptoManager.toHex(dCheck);
                    Arrays.fill(dCheck, (byte) 0);
                    if (dCheckHex.equals(duressHash)) return "duress";
                }
            }
            return "wrong";
        } catch (Exception e) {
            return "wrong";
        }
    }

    /** Verify real PIN only (no duress check). Used by settings gate. */
    public static boolean confirmRealPin(String pin) {
        try {
            String pinSalt    = SecurePrefs.get(KEY_PIN_SALT, null);
            String storedHash = SecurePrefs.get(KEY_PIN_HASH, null);
            if (pinSalt == null || storedHash == null) return false;
            byte[] hash = CryptoManager.deriveKey(pin, pinSalt);
            String hashHex = CryptoManager.toHex(hash);
            Arrays.fill(hash, (byte) 0);
            return hashHex.equals(storedHash);
        } catch (Exception e) {
            return false;
        }
    }

    // ── PIN change ───────────────────────────────────────────────────────────

    /**
     * Begin PIN change. Returns { oldKey, newKey } for re-encryption.
     * Caller must re-encrypt all files, then call finalizePinChange().
     */
    public static byte[][] beginPinChange(String oldPin, String newPin) throws Exception {
        String result = verifyPin(oldPin);
        if (!"correct".equals(result)) throw new Exception("Incorrect current PIN.");
        String deriveSalt = SecurePrefs.get(KEY_DERIVE_SALT, null);
        if (deriveSalt == null) throw new Exception("Missing derive salt.");
        byte[] oldKey = CryptoManager.copySessionKey();
        byte[] newKey = CryptoManager.deriveKey(newPin, deriveSalt);
        return new byte[][]{oldKey, newKey};
    }

    public static void finalizePinChange(String newPin, byte[] newKey) throws Exception {
        String pinSalt = CryptoManager.randomHex(SALT_BYTES);
        byte[] pinHash = CryptoManager.deriveKey(newPin, pinSalt);
        SecurePrefs.set(KEY_PIN_SALT, pinSalt);
        SecurePrefs.set(KEY_PIN_HASH, CryptoManager.toHex(pinHash));
        Arrays.fill(pinHash, (byte) 0);
        CryptoManager.setSessionKey(newKey);
    }

    // ── Duress PIN ───────────────────────────────────────────────────────────

    public static void setDuressPin(String duressPin) throws Exception {
        String salt = CryptoManager.randomHex(SALT_BYTES);
        byte[] hash = CryptoManager.deriveKey(duressPin, salt);
        SecurePrefs.set(KEY_DURESS_SALT, salt);
        SecurePrefs.set(KEY_DURESS_HASH, CryptoManager.toHex(hash));
        Arrays.fill(hash, (byte) 0);
    }

    public static void removeDuressPin() {
        SecurePrefs.remove(KEY_DURESS_HASH);
        SecurePrefs.remove(KEY_DURESS_SALT);
    }

    public static boolean hasDuressPin() {
        return SecurePrefs.has(KEY_DURESS_HASH);
    }

    // ── Wipe ─────────────────────────────────────────────────────────────────

    public static void wipeKeys() {
        CryptoManager.clearSessionKey();
        SecurePrefs.wipeAll();
    }

    // ── Preferences ─────────────────────────────────────────────────────────

    public static boolean getAutosave() {
        return "true".equals(SecurePrefs.get(KEY_AUTOSAVE, "false"));
    }

    public static void setAutosave(boolean enabled) {
        SecurePrefs.set(KEY_AUTOSAVE, enabled ? "true" : "false");
    }

    public static String getTheme() {
        return SecurePrefs.get(KEY_THEME, "dark");
    }

    public static void setTheme(String mode) {
        SecurePrefs.set(KEY_THEME, mode);
    }

    public static boolean getWalkthroughSeen() {
        return "true".equals(SecurePrefs.get(KEY_WALKTHROUGH, "false"));
    }

    public static void setWalkthroughSeen() {
        SecurePrefs.set(KEY_WALKTHROUGH, "true");
    }

    public static String getTutorials() {
        return SecurePrefs.get(KEY_TUTORIALS, "{}");
    }

    public static void setTutorials(String json) {
        SecurePrefs.set(KEY_TUTORIALS, json);
    }

    public static String getLastLocation() {
        return SecurePrefs.get(KEY_LAST_LOC, null);
    }

    public static void setLastLocation(String json) {
        SecurePrefs.set(KEY_LAST_LOC, json);
    }
}
