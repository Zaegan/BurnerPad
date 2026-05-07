package com.github.zaegan.burnerpad.tutorial;

import com.github.zaegan.burnerpad.prefs.PinManager;

import org.json.JSONObject;

/**
 * Tracks which tutorial overlays have been seen.
 * State stored in SecurePrefs as a JSON object.
 *
 * States:
 *   declined: true  — user chose "decline all"; no tutorials shown ever again
 *   <id>: true      — that specific tutorial has been completed/skipped
 */
public final class TutorialManager {

    public static final String SETTINGS_INTRO = "settings_intro";

    private TutorialManager() {}

    private static JSONObject load() {
        try {
            return new JSONObject(PinManager.getTutorials());
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void save(JSONObject data) {
        PinManager.setTutorials(data.toString());
    }

    public static boolean shouldShow(String id) {
        JSONObject data = load();
        if (data.optBoolean("declined", false)) return false;
        return !data.optBoolean(id, false);
    }

    public static void markDone(String id) {
        JSONObject data = load();
        try { data.put(id, true); } catch (Exception ignored) {}
        save(data);
    }

    public static void declineAll() {
        JSONObject data = load();
        try { data.put("declined", true); } catch (Exception ignored) {}
        save(data);
    }

    public static void resetAll() {
        save(new JSONObject());
    }

    public static void completeAll() {
        JSONObject data = new JSONObject();
        try {
            data.put(SETTINGS_INTRO, true);
            data.put("declined", true);
        } catch (Exception ignored) {}
        save(data);
    }

    public static boolean isAllComplete() {
        JSONObject data = load();
        if (!data.optBoolean(SETTINGS_INTRO, false)) return false;
        return true;
    }
}
