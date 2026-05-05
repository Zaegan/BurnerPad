package com.github.zaegan.burnerpad.theme;

import androidx.appcompat.app.AppCompatDelegate;

import com.github.zaegan.burnerpad.prefs.PinManager;

/**
 * Applies dark / light / system theme via AppCompatDelegate.
 * Call applyFromPrefs() in Application.onCreate() and after the user changes theme.
 */
public final class ThemeManager {

    private ThemeManager() {}

    public static void apply(String mode) {
        switch (mode) {
            case "light":  AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);           break;
            case "system": AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM); break;
            default:       AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES);           break;
        }
    }

    public static void applyFromPrefs() {
        apply(PinManager.getTheme());
    }
}
