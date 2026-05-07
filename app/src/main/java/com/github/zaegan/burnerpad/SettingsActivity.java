package com.github.zaegan.burnerpad;

import androidx.appcompat.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;

import com.github.zaegan.burnerpad.crypto.CryptoManager;
import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.storage.StorageManager;
import com.github.zaegan.burnerpad.theme.ThemeManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;

/**
 * Settings screen, protected by a PIN gate.
 *
 * Sections (all in settingsContent, hidden until gate passed):
 *  - Theme selector (dark / light / system)
 *  - Autosave toggle
 *  - Status bar toggle
 *  - Change PIN (re-encrypts all notes)
 *  - Backup (creates encrypted archive → Downloads)
 *  - Restore (pick archive via SAF)
 *  - Duress PIN (set / change / remove)
 *  - Rate this app
 *  - Privacy policy link
 */
public class SettingsActivity extends AppCompatActivity {

    private static final int REQ_RESTORE_FILE = 2001;

    // Gate
    private LinearLayout pinGate;
    private EditText     etGatePin;
    private TextView     tvGateError;
    private Button       btnGateContinue;

    // Content
    private LinearLayout settingsContent;

    // Theme
    private TextView btnThemeDark;
    private TextView btnThemeLight;
    private TextView btnThemeSystem;

    // Autosave
    private SwitchCompat switchAutosave;
    private SwitchCompat switchStatusBar;

    // Change PIN
    private EditText etCurrentPin;
    private EditText etNewPin;
    private EditText etConfirmNewPin;
    private TextView tvPinChangeError;
    private TextView tvPinChangeProgress;
    private Button   btnChangePin;

    // Backup
    private EditText etExportPassword;
    private EditText etExportConfirm;
    private TextView tvExportError;
    private Button   btnCreateBackup;

    // Restore
    private EditText etRestorePassword;
    private TextView tvRestoreError;
    private TextView tvRestoreProgress;
    private Button   btnRestore;

    // Duress
    private LinearLayout duressModeRow;
    private TextView     btnDuressChange;
    private TextView     btnDuressRemove;
    private LinearLayout duressPinSection;
    private EditText     etDuressPin;
    private EditText     etConfirmDuressPin;
    private EditText     etConfirmPhrase;
    private TextView     tvDuressError;
    private Button       btnDuressAction;

    // Duress mode: "set", "change", "remove"
    private String duressMode = "set";

    // Pending restore password for SAF result
    private String pendingRestorePassword;

    private static final String KEY_UNLOCKED = "unlocked";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        ThemeManager.applyFromPrefs();
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        bindViews();
        setupGate();
        setupTheme();
        setupAutosave();
        setupStatusBar();
        setupChangePin();
        setupBackup();
        setupRestore();
        setupDuress();
        setupRate();
        setupPrivacy();

        // Restore unlocked state after recreate() (e.g. theme change)
        if (savedInstanceState != null && savedInstanceState.getBoolean(KEY_UNLOCKED, false)) {
            pinGate.setVisibility(View.GONE);
            settingsContent.setVisibility(View.VISIBLE);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(KEY_UNLOCKED, settingsContent.getVisibility() == View.VISIBLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!CryptoManager.hasSessionKey()) {
            Intent intent = new Intent(this, PinActivity.class);
            intent.putExtra(PinActivity.EXTRA_LAUNCH_MODE, false);
            startActivityForResult(intent, 9999);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == 9999) {
            if (resultCode != RESULT_OK) finish();
            return;
        }

        if (requestCode == REQ_RESTORE_FILE) {
            BurnerPadApp.setSuppressLock(false);
            if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
            Uri fileUri = data.getData();
            String password = pendingRestorePassword;
            pendingRestorePassword = null;
            doRestore(fileUri, password);
        }
    }

    // ── View binding ─────────────────────────────────────────────────────────

    private void bindViews() {
        // Gate
        pinGate         = findViewById(R.id.pinGate);
        etGatePin       = findViewById(R.id.etGatePin);
        tvGateError     = findViewById(R.id.tvGateError);
        btnGateContinue = findViewById(R.id.btnGateContinue);

        // Content
        settingsContent = findViewById(R.id.settingsContent);

        // Theme
        btnThemeDark   = findViewById(R.id.btnThemeDark);
        btnThemeLight  = findViewById(R.id.btnThemeLight);
        btnThemeSystem = findViewById(R.id.btnThemeSystem);

        // Autosave
        switchAutosave  = findViewById(R.id.switchAutosave);
        switchStatusBar = findViewById(R.id.switchStatusBar);

        // Change PIN
        etCurrentPin       = findViewById(R.id.etCurrentPin);
        etNewPin           = findViewById(R.id.etNewPin);
        etConfirmNewPin    = findViewById(R.id.etConfirmNewPin);
        tvPinChangeError   = findViewById(R.id.tvPinChangeError);
        tvPinChangeProgress = findViewById(R.id.tvPinChangeProgress);
        btnChangePin       = findViewById(R.id.btnChangePin);

        // Backup
        etExportPassword = findViewById(R.id.etExportPassword);
        etExportConfirm  = findViewById(R.id.etExportConfirm);
        tvExportError    = findViewById(R.id.tvExportError);
        btnCreateBackup  = findViewById(R.id.btnCreateBackup);

        // Restore
        etRestorePassword = findViewById(R.id.etRestorePassword);
        tvRestoreError    = findViewById(R.id.tvRestoreError);
        tvRestoreProgress = findViewById(R.id.tvRestoreProgress);
        btnRestore        = findViewById(R.id.btnRestore);

        // Duress
        duressModeRow      = findViewById(R.id.duressModeRow);
        btnDuressChange    = findViewById(R.id.btnDuressChange);
        btnDuressRemove    = findViewById(R.id.btnDuressRemove);
        duressPinSection   = findViewById(R.id.duressPinSection);
        etDuressPin        = findViewById(R.id.etDuressPin);
        etConfirmDuressPin = findViewById(R.id.etConfirmDuressPin);
        etConfirmPhrase    = findViewById(R.id.etConfirmPhrase);
        tvDuressError      = findViewById(R.id.tvDuressError);
        btnDuressAction    = findViewById(R.id.btnDuressAction);

        // Back button
        findViewById(R.id.btnBack).setOnClickListener(v -> finish());
    }

    // ── PIN gate ─────────────────────────────────────────────────────────────

    private void setupGate() {
        btnGateContinue.setOnClickListener(v -> attemptGate());

        etGatePin.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_DOWN)) {
                attemptGate();
                return true;
            }
            return false;
        });

        // Privacy policy in gate section
        TextView tvPrivacyGate = findViewById(R.id.tvPrivacyGate);
        tvPrivacyGate.setPaintFlags(tvPrivacyGate.getPaintFlags() | android.graphics.Paint.UNDERLINE_TEXT_FLAG);
        tvPrivacyGate.setOnClickListener(v -> openPrivacyPolicy());
    }

    private void attemptGate() {
        String pin = etGatePin.getText().toString();
        if (pin.isEmpty()) {
            tvGateError.setText("Enter your PIN.");
            tvGateError.setVisibility(View.VISIBLE);
            return;
        }

        new Thread(() -> {
            boolean ok = PinManager.confirmRealPin(pin);
            runOnUiThread(() -> {
                if (ok) {
                    pinGate.setVisibility(View.GONE);
                    settingsContent.setVisibility(View.VISIBLE);
                } else {
                    tvGateError.setText("Incorrect PIN.");
                    tvGateError.setVisibility(View.VISIBLE);
                }
            });
        }).start();
    }

    // ── Theme ────────────────────────────────────────────────────────────────

    private void setupTheme() {
        updateThemeHighlight(PinManager.getTheme());

        btnThemeDark.setOnClickListener(v   -> applyTheme("dark"));
        btnThemeLight.setOnClickListener(v  -> applyTheme("light"));
        btnThemeSystem.setOnClickListener(v -> applyTheme("system"));
    }

    private void applyTheme(String mode) {
        PinManager.setTheme(mode);
        ThemeManager.apply(mode);
        updateThemeHighlight(mode);
        recreate();
    }

    private void updateThemeHighlight(String mode) {
        // Dim non-selected; highlight selected with textPrimary alpha
        // Simple approach: bold the selected option by appending " ✓"
        btnThemeDark.setText("dark"   + ("dark".equals(mode)   ? " ✓" : ""));
        btnThemeLight.setText("light" + ("light".equals(mode)  ? " ✓" : ""));
        btnThemeSystem.setText("system" + ("system".equals(mode) ? " ✓" : ""));
    }

    // ── Autosave ─────────────────────────────────────────────────────────────

    private void setupAutosave() {
        switchAutosave.setChecked(PinManager.getAutosave());
        switchAutosave.setOnCheckedChangeListener((buttonView, isChecked) ->
                PinManager.setAutosave(isChecked));
    }

    // ── Status bar ───────────────────────────────────────────────────────────

    private void setupStatusBar() {
        switchStatusBar.setChecked(PinManager.getShowStatusBar());
        switchStatusBar.setOnCheckedChangeListener((buttonView, isChecked) ->
                PinManager.setShowStatusBar(isChecked));
    }

    // ── Change PIN ───────────────────────────────────────────────────────────

    private void setupChangePin() {
        etConfirmNewPin.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                doChangePin();
                return true;
            }
            return false;
        });
        btnChangePin.setOnClickListener(v -> doChangePin());
    }

    private void doChangePin() {
        String currentPin = etCurrentPin.getText().toString().trim();
        String newPin     = etNewPin.getText().toString().trim();
        String confirmPin = etConfirmNewPin.getText().toString().trim();

        tvPinChangeError.setVisibility(View.GONE);
        tvPinChangeProgress.setVisibility(View.GONE);

        if (currentPin.isEmpty() || newPin.isEmpty() || confirmPin.isEmpty()) {
            showPinChangeError("All fields are required.");
            return;
        }
        if (newPin.length() < 5) {
            showPinChangeError("New PIN must be at least 5 characters.");
            return;
        }
        if (!newPin.equals(confirmPin)) {
            showPinChangeError("New PINs do not match.");
            return;
        }

        btnChangePin.setEnabled(false);
        tvPinChangeProgress.setText("Starting…");
        tvPinChangeProgress.setVisibility(View.VISIBLE);

        new Thread(() -> {
            try {
                byte[][] keys = PinManager.beginPinChange(currentPin, newPin);
                byte[] oldKey = keys[0];
                byte[] newKey = keys[1];

                StorageManager.reEncryptAll(oldKey, newKey, fraction -> runOnUiThread(() -> {
                    int pct = (int)(fraction * 100);
                    tvPinChangeProgress.setText("Re-encrypting… " + pct + "%");
                }));

                PinManager.finalizePinChange(newPin, newKey);
                Arrays.fill(oldKey, (byte) 0);
                Arrays.fill(newKey, (byte) 0);

                runOnUiThread(() -> {
                    tvPinChangeProgress.setText("PIN changed.");
                    btnChangePin.setEnabled(true);
                    etCurrentPin.setText("");
                    etNewPin.setText("");
                    etConfirmNewPin.setText("");
                    Toast.makeText(this, "PIN changed successfully.", Toast.LENGTH_SHORT).show();
                });

            } catch (Exception e) {
                runOnUiThread(() -> {
                    showPinChangeError(e.getMessage() != null ? e.getMessage() : "Failed to change PIN.");
                    tvPinChangeProgress.setVisibility(View.GONE);
                    btnChangePin.setEnabled(true);
                });
            }
        }).start();
    }

    private void showPinChangeError(String msg) {
        tvPinChangeError.setText(msg);
        tvPinChangeError.setVisibility(View.VISIBLE);
    }

    // ── Backup ───────────────────────────────────────────────────────────────

    private void setupBackup() {
        btnCreateBackup.setOnClickListener(v -> doCreateBackup());
    }

    private void doCreateBackup() {
        String password = etExportPassword.getText().toString();
        String confirm  = etExportConfirm.getText().toString();

        tvExportError.setVisibility(View.GONE);

        if (password.isEmpty() || confirm.isEmpty()) {
            showExportError("Both password fields are required.");
            return;
        }
        if (!password.equals(confirm)) {
            showExportError("Passwords do not match.");
            return;
        }

        btnCreateBackup.setEnabled(false);

        new Thread(() -> {
            try {
                File archiveFile = StorageManager.createArchive(password);
                byte[] archiveBytes;
                try (FileInputStream fis = new FileInputStream(archiveFile)) {
                    archiveBytes = fis.readAllBytes();
                }

                String filename = "burnerpad_backup_" + System.currentTimeMillis() + ".bparchive";
                writeToDownloads(filename, archiveBytes, "application/octet-stream");

                archiveFile.delete();

                runOnUiThread(() -> {
                    btnCreateBackup.setEnabled(true);
                    etExportPassword.setText("");
                    etExportConfirm.setText("");
                    new AlertDialog.Builder(this)
                            .setTitle("Backup created")
                            .setMessage("Saved to your Downloads folder as:\n" + filename)
                            .setPositiveButton("OK", null)
                            .show();
                });

            } catch (Exception e) {
                runOnUiThread(() -> {
                    showExportError(e.getMessage() != null ? e.getMessage() : "Backup failed.");
                    btnCreateBackup.setEnabled(true);
                });
            }
        }).start();
    }

    private void showExportError(String msg) {
        tvExportError.setText(msg);
        tvExportError.setVisibility(View.VISIBLE);
    }

    // ── Restore ──────────────────────────────────────────────────────────────

    private void setupRestore() {
        btnRestore.setOnClickListener(v -> {
            String password = etRestorePassword.getText().toString();
            tvRestoreError.setVisibility(View.GONE);
            tvRestoreProgress.setVisibility(View.GONE);

            if (password.isEmpty()) {
                showRestoreError("Enter the archive password.");
                return;
            }

            pendingRestorePassword = password;
            BurnerPadApp.setSuppressLock(true);
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            startActivityForResult(intent, REQ_RESTORE_FILE);
        });
    }

    private void doRestore(Uri fileUri, String password) {
        tvRestoreError.setVisibility(View.GONE);
        tvRestoreProgress.setVisibility(View.VISIBLE);
        tvRestoreProgress.setText("Reading archive…");
        btnRestore.setEnabled(false);

        new Thread(() -> {
            try {
                // Copy URI to temp file
                File tempFile = new File(getCacheDir(), "burnerpad_restore_input.bparchive");
                try (InputStream is = getContentResolver().openInputStream(fileUri);
                     FileOutputStream fos = new FileOutputStream(tempFile)) {
                    if (is == null) throw new Exception("Could not open file.");
                    byte[] buf = new byte[65536];
                    int len;
                    while ((len = is.read(buf)) != -1) fos.write(buf, 0, len);
                }

                // Run restore with conflict handling on main thread via blocking queue
                StorageManager.restoreArchive(tempFile, password,
                        conflictPath -> {
                            // Ask on main thread, block until answer
                            BlockingQueue<String> q = new ArrayBlockingQueue<>(1);
                            runOnUiThread(() -> showConflictDialog(conflictPath, q));
                            try {
                                return q.take();
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                                return "skip";
                            }
                        },
                        message -> runOnUiThread(() -> tvRestoreProgress.setText(message))
                );

                tempFile.delete();

                runOnUiThread(() -> {
                    btnRestore.setEnabled(true);
                    etRestorePassword.setText("");
                    tvRestoreProgress.setVisibility(View.GONE);
                    new AlertDialog.Builder(this)
                            .setTitle("Restore complete")
                            .setMessage("Your notes have been restored.")
                            .setPositiveButton("OK", null)
                            .show();
                });

            } catch (Exception e) {
                runOnUiThread(() -> {
                    btnRestore.setEnabled(true);
                    tvRestoreProgress.setVisibility(View.GONE);
                    showRestoreError(e.getMessage() != null ? e.getMessage() : "Restore failed.");
                });
            }
        }).start();
    }

    private void showConflictDialog(String path, BlockingQueue<String> result) {
        new AlertDialog.Builder(this)
                .setTitle("File exists")
                .setMessage("\"" + path + "\" already exists. What should we do?")
                .setCancelable(false)
                .setPositiveButton("Replace", (d, w) -> {
                    try { result.put("replace"); } catch (InterruptedException ignored) {}
                })
                .setNeutralButton("Keep both", (d, w) -> {
                    try { result.put("rename"); } catch (InterruptedException ignored) {}
                })
                .setNegativeButton("Skip", (d, w) -> {
                    try { result.put("skip"); } catch (InterruptedException ignored) {}
                })
                .show();
    }

    private void showRestoreError(String msg) {
        tvRestoreError.setText(msg);
        tvRestoreError.setVisibility(View.VISIBLE);
    }

    // ── Duress PIN ───────────────────────────────────────────────────────────

    private void setupDuress() {
        refreshDuressUi();

        btnDuressChange.setOnClickListener(v -> {
            duressMode = "change";
            duressModeRow.setVisibility(View.GONE);
            duressPinSection.setVisibility(View.VISIBLE);
            btnDuressAction.setText("change duress PIN");
            tvDuressError.setVisibility(View.GONE);
        });

        btnDuressRemove.setOnClickListener(v -> {
            duressMode = "remove";
            duressModeRow.setVisibility(View.GONE);
            duressPinSection.setVisibility(View.GONE);
            btnDuressAction.setText("remove duress PIN");
            tvDuressError.setVisibility(View.GONE);
        });

        etConfirmPhrase.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                doDuressAction();
                return true;
            }
            return false;
        });

        btnDuressAction.setOnClickListener(v -> doDuressAction());
    }

    private void refreshDuressUi() {
        boolean has = PinManager.hasDuressPin();
        if (has) {
            duressMode = "change";
            duressModeRow.setVisibility(View.VISIBLE);
            duressPinSection.setVisibility(View.GONE);
            btnDuressAction.setText("change duress PIN");
        } else {
            duressMode = "set";
            duressModeRow.setVisibility(View.GONE);
            duressPinSection.setVisibility(View.VISIBLE);
            btnDuressAction.setText("set duress PIN");
        }
    }

    private void doDuressAction() {
        tvDuressError.setVisibility(View.GONE);
        String phrase = etConfirmPhrase.getText().toString().trim();

        if (!"ONLY FOR DURESS".equals(phrase)) {
            showDuressError("Type ONLY FOR DURESS exactly to confirm.");
            return;
        }

        if ("remove".equals(duressMode)) {
            PinManager.removeDuressPin();
            etConfirmPhrase.setText("");
            Toast.makeText(this, "Duress PIN removed.", Toast.LENGTH_SHORT).show();
            refreshDuressUi();
            return;
        }

        // set or change
        String duressPin = etDuressPin.getText().toString().trim();
        String confirmDuress = etConfirmDuressPin.getText().toString().trim();

        if (duressPin.isEmpty() || confirmDuress.isEmpty()) {
            showDuressError("All fields are required.");
            return;
        }
        if (duressPin.length() < 5) {
            showDuressError("Duress PIN must be at least 5 characters.");
            return;
        }
        if (!duressPin.equals(confirmDuress)) {
            showDuressError("Duress PINs do not match.");
            return;
        }

        // Verify duress PIN differs from real PIN
        if (PinManager.confirmRealPin(duressPin)) {
            showDuressError("Duress PIN must differ from your real PIN.");
            return;
        }

        new Thread(() -> {
            try {
                PinManager.setDuressPin(duressPin);
                runOnUiThread(() -> {
                    etDuressPin.setText("");
                    etConfirmDuressPin.setText("");
                    etConfirmPhrase.setText("");
                    Toast.makeText(this,
                            "set".equals(duressMode) ? "Duress PIN set." : "Duress PIN changed.",
                            Toast.LENGTH_SHORT).show();
                    refreshDuressUi();
                });
            } catch (Exception e) {
                runOnUiThread(() ->
                        showDuressError(e.getMessage() != null ? e.getMessage() : "Failed to set duress PIN."));
            }
        }).start();
    }

    private void showDuressError(String msg) {
        tvDuressError.setText(msg);
        tvDuressError.setVisibility(View.VISIBLE);
    }

    // ── Rate app ─────────────────────────────────────────────────────────────

    private void setupRate() {
        Button btnRate = findViewById(R.id.btnRate);
        btnRate.setOnClickListener(v -> {
            String packageName = getString(R.string.play_store_id);
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=" + packageName)));
            } catch (android.content.ActivityNotFoundException e) {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=" + packageName)));
            }
        });
    }

    // ── Privacy policy ───────────────────────────────────────────────────────

    private void setupPrivacy() {
        TextView tvPrivacyContent = findViewById(R.id.tvPrivacyContent);
        tvPrivacyContent.setPaintFlags(tvPrivacyContent.getPaintFlags() | android.graphics.Paint.UNDERLINE_TEXT_FLAG);
        tvPrivacyContent.setOnClickListener(v -> openPrivacyPolicy());
    }

    private void openPrivacyPolicy() {
        String url = getString(R.string.privacy_policy_url);
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void writeToDownloads(String filename, byte[] data, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri itemUri = getContentResolver().insert(collection, values);
            if (itemUri == null) throw new Exception("Could not create Downloads file.");
            try (OutputStream os = getContentResolver().openOutputStream(itemUri)) {
                if (os == null) throw new Exception("Could not open Downloads file for writing.");
                os.write(data);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(itemUri, values, null, null);
        } else {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File dest = new File(downloadsDir, filename);
            if (dest.exists()) {
                String base = filename.contains(".") ? filename.substring(0, filename.lastIndexOf('.')) : filename;
                String ext  = filename.contains(".") ? filename.substring(filename.lastIndexOf('.')) : "";
                for (int n = 1; n < 10000; n++) {
                    dest = new File(downloadsDir, base + " (" + n + ")" + ext);
                    if (!dest.exists()) break;
                }
            }
            try (FileOutputStream fos = new FileOutputStream(dest)) {
                fos.write(data);
            }
        }
    }
}
