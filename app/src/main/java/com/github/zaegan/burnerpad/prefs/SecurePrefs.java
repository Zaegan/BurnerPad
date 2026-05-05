package com.github.zaegan.burnerpad.prefs;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * Wrapper around EncryptedSharedPreferences.
 * All sensitive material (PIN hashes, salts, settings) is stored here.
 * The underlying store is encrypted with a key in the Android Keystore.
 */
public final class SecurePrefs {

    private static final String PREFS_FILE = "burnerpad_secure_prefs";

    private static SharedPreferences prefs;

    public static synchronized void init(Context context) throws Exception {
        if (prefs != null) return;
        MasterKey masterKey = new MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
        prefs = EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    public static String get(String key, String defaultValue) {
        return prefs.getString(key, defaultValue);
    }

    public static void set(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    public static void remove(String key) {
        prefs.edit().remove(key).apply();
    }

    public static boolean has(String key) {
        return prefs.contains(key);
    }

    /** Wipe all entries. Used on duress wipe. */
    public static void wipeAll() {
        prefs.edit().clear().apply();
    }
}
