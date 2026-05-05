package com.github.zaegan.burnerpad;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import com.github.zaegan.burnerpad.crypto.CryptoManager;
import com.github.zaegan.burnerpad.prefs.SecurePrefs;
import com.github.zaegan.burnerpad.storage.StorageManager;
import com.github.zaegan.burnerpad.theme.ThemeManager;

/**
 * Application class.
 *
 * Tracks foreground activity count to detect when the app goes to background.
 * When ALL activities stop, the session key is cleared (app locks).
 *
 * EditorActivity flushes its shadow in onStop() before this fires, so data is safe.
 */
public class BurnerPadApp extends Application implements Application.ActivityLifecycleCallbacks {

    private int startedCount  = 0;
    private boolean wasInForeground = false;

    /** True while a SAF picker or similar external intent is active. Prevents locking. */
    private static boolean suppressLock = false;

    public static void setSuppressLock(boolean value) {
        suppressLock = value;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            SecurePrefs.init(this);
        } catch (Exception e) {
            // EncryptedSharedPreferences failed (e.g. keystore corrupted). App cannot run.
            throw new RuntimeException("SecurePrefs init failed: " + e.getMessage(), e);
        }
        StorageManager.init(this);
        ThemeManager.applyFromPrefs();
        registerActivityLifecycleCallbacks(this);
    }

    // ── ActivityLifecycleCallbacks ────────────────────────────────────────────

    @Override public void onActivityCreated(Activity a, Bundle b)  {}
    @Override public void onActivityStarted(Activity a)            { startedCount++; wasInForeground = true; }
    @Override public void onActivityResumed(Activity a)            {}
    @Override public void onActivityPaused(Activity a)             {}
    @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}

    @Override
    public void onActivityStopped(Activity a) {
        startedCount--;
        if (startedCount <= 0 && wasInForeground && !suppressLock) {
            startedCount = 0;
            // App has gone fully to background — clear session key so next foreground entry requires PIN
            CryptoManager.clearSessionKey();
        }
    }

    @Override public void onActivityDestroyed(Activity a)          {}
}
