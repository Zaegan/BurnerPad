package com.github.zaegan.burnerpad;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.storage.StorageManager;

import org.json.JSONObject;

/**
 * Lock screen — shown on every launch and every return from background.
 *
 * Two modes, set via EXTRA_LAUNCH_MODE:
 *   true  = launch mode: routes to FileBrowser/last-location on success; finish() on back = exit app
 *   false = lock mode:   started on top of current activity; finish() on success returns to it
 *
 * Behaviour:
 *   - Silently tries PIN "12345" on mount; if correct, routes without showing UI
 *   - 5+ wrong attempts: show reinstall hint
 *   - Duress PIN: wipes everything, re-inits, navigates to clean FileBrowser
 */
public class PinActivity extends AppCompatActivity {

    public static final String EXTRA_LAUNCH_MODE = "launch_mode";
    private static final int WRONG_BEFORE_HINT   = 5;

    private EditText      etPin;
    private TextView      tvError;
    private LinearLayout  hintBox;
    private LinearLayout  pinInputRow;

    private boolean isLaunchMode = false;
    private int     wrongAttempts = 0;
    private boolean isProcessing  = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_pin);

        isLaunchMode = getIntent().getBooleanExtra(EXTRA_LAUNCH_MODE, false);

        etPin       = findViewById(R.id.etPin);
        tvError     = findViewById(R.id.tvError);
        hintBox     = findViewById(R.id.hintBox);
        pinInputRow = findViewById(R.id.pinInputRow);

        Button btnUnlock = findViewById(R.id.btnUnlock);
        btnUnlock.setOnClickListener(v -> handleSubmit());

        etPin.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                handleSubmit();
                return true;
            }
            return false;
        });

        // Silently try the no-PIN shortcut
        silentTryNoPin();
    }

    private void silentTryNoPin() {
        new Thread(() -> {
            String result = PinManager.verifyPin(PinManager.NO_PIN);
            runOnUiThread(() -> {
                if ("correct".equals(result)) {
                    navigateAfterUnlock();
                } else {
                    // Show UI and focus PIN input
                    etPin.requestFocus();
                }
            });
        }).start();
    }

    private void handleSubmit() {
        String pin = etPin.getText().toString();
        if (pin.isEmpty() || isProcessing) return;
        isProcessing = true;
        tvError.setVisibility(View.GONE);

        new Thread(() -> {
            String result = PinManager.verifyPin(pin);
            runOnUiThread(() -> {
                isProcessing = false;
                etPin.setText("");
                if ("correct".equals(result)) {
                    navigateAfterUnlock();
                } else if ("duress".equals(result)) {
                    handleDuress(pin);
                } else {
                    wrongAttempts++;
                    if (wrongAttempts >= WRONG_BEFORE_HINT) hintBox.setVisibility(View.VISIBLE);
                    tvError.setText("Incorrect PIN.");
                    tvError.setVisibility(View.VISIBLE);
                    shake(pinInputRow);
                }
            });
        }).start();
    }

    private void handleDuress(String pin) {
        new Thread(() -> {
            try {
                PinManager.wipeKeys();
                StorageManager.wipeAllNotes();
                PinManager.initialize(pin);
                StorageManager.createDefaultNote();
            } catch (Exception ignored) {}
            runOnUiThread(() -> {
                Intent intent = new Intent(this, FileBrowserActivity.class);
                intent.putExtra(FileBrowserActivity.EXTRA_PATH, "");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(intent);
                finish();
            });
        }).start();
    }

    private void navigateAfterUnlock() {
        if (!isLaunchMode) {
            // Lock mode: just pop back to the calling activity
            setResult(RESULT_OK);
            finish();
            return;
        }

        // Launch mode: restore last location or go to FileBrowser
        String lastLocJson = PinManager.getLastLocation();
        if (lastLocJson != null) {
            try {
                JSONObject loc = new JSONObject(lastLocJson);
                String screen  = loc.optString("screen");
                JSONObject params = loc.optJSONObject("params");
                if ("Editor".equals(screen) && params != null) {
                    String notePath = params.optString("notePath");
                    String noteName = params.optString("noteName");
                    if (!notePath.isEmpty() && !noteName.isEmpty()) {
                        // Stack: FileBrowser → Editor
                        String dir = notePath.contains("/")
                                ? notePath.substring(0, notePath.lastIndexOf('/'))
                                : "";
                        Intent fbIntent = new Intent(this, FileBrowserActivity.class);
                        fbIntent.putExtra(FileBrowserActivity.EXTRA_PATH, dir);
                        Intent edIntent = new Intent(this, EditorActivity.class);
                        edIntent.putExtra(EditorActivity.EXTRA_NOTE_PATH, notePath);
                        edIntent.putExtra(EditorActivity.EXTRA_NOTE_NAME, noteName);
                        startActivities(new Intent[]{fbIntent, edIntent});
                        finish();
                        return;
                    }
                }
                if ("FileBrowser".equals(screen) && params != null) {
                    String path = params.optString("path", "");
                    Intent intent = new Intent(this, FileBrowserActivity.class);
                    intent.putExtra(FileBrowserActivity.EXTRA_PATH, path);
                    startActivity(intent);
                    finish();
                    return;
                }
            } catch (Exception ignored) {}
        }

        // Default: root FileBrowser
        Intent intent = new Intent(this, FileBrowserActivity.class);
        intent.putExtra(FileBrowserActivity.EXTRA_PATH, "");
        startActivity(intent);
        finish();
    }

    // ── Shake animation ───────────────────────────────────────────────────────

    private void shake(View view) {
        float d = 20f;
        ObjectAnimator a1 = ObjectAnimator.ofFloat(view, "translationX",  0,  d, -d,  d, -d, 0);
        a1.setDuration(300);
        AnimatorSet set = new AnimatorSet();
        set.play(a1);
        set.start();
    }

    @Override
    public void onBackPressed() {
        if (isLaunchMode) {
            // In launch mode, back = exit app
            finishAffinity();
        } else {
            // In lock mode, back = minimize app (don't reveal content behind)
            moveTaskToBack(true);
        }
    }
}
