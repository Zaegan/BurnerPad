package com.github.zaegan.burnerpad;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Environment;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.github.zaegan.burnerpad.crypto.CryptoManager;
import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.storage.StorageManager;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;

/**
 * Plain text note editor.
 *
 * SCROLLING:
 *   android:windowSoftInputMode="adjustResize" in manifest causes the window to
 *   shrink when the keyboard appears. The ScrollView + EditText system then
 *   automatically scrolls to keep the cursor visible — no manual calculation needed.
 *
 * UNSAVED CHANGES:
 *   - If autosave: writes on every change (AUTOSAVE_DELAY ms debounce)
 *   - If manual:   writes shadow on every change (SHADOW_DELAY ms debounce)
 *   - On back/up with unsaved: "Save and exit / Exit and delete draft / Cancel"
 *
 * SESSION KEY EXPIRY:
 *   Detected in onResume → launch PinActivity overlay.
 *   Shadow is flushed in onStop() before session key is cleared by BurnerPadApp.
 *
 * FORMATTING STRIP:
 *   Smart quotes, em-dashes, zero-width chars etc. stripped on every text change.
 */
public class EditorActivity extends AppCompatActivity {

    public static final String EXTRA_NOTE_PATH = "note_path";
    public static final String EXTRA_NOTE_NAME = "note_name";

    private static final int    AUTOSAVE_DELAY = 800;   // ms
    private static final int    SHADOW_DELAY   = 3000;  // ms

    private EditText etEditor;
    private TextView tvNoteName, tvAutosavedLabel, btnSave, tvWordCount, tvStatus;
    private View     footerDivider;

    private String  notePath;
    private String  noteName;
    private boolean autosave    = false;
    private boolean isDirty     = false;
    private boolean isLoaded    = false;
    private boolean isSaving    = false;

    private final Runnable autosaveRunnable = this::doAutosave;
    private final Runnable shadowRunnable   = this::doShadow;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_editor);

        notePath = getIntent().getStringExtra(EXTRA_NOTE_PATH);
        noteName = getIntent().getStringExtra(EXTRA_NOTE_NAME);

        etEditor          = findViewById(R.id.etEditor);
        tvNoteName        = findViewById(R.id.tvNoteName);
        tvAutosavedLabel  = findViewById(R.id.tvAutosavedLabel);
        btnSave           = findViewById(R.id.btnSave);
        tvWordCount       = findViewById(R.id.tvWordCount);
        tvStatus          = findViewById(R.id.tvStatus);

        tvNoteName.setText(noteName);
        tvNoteName.setOnLongClickListener(v -> { showRenameDialog(); return true; });

        findViewById(R.id.btnUp).setOnClickListener(v -> goUp());
        btnSave.setOnClickListener(v -> handleSave());
        findViewById(R.id.btnMenu).setOnClickListener(this::showMenu);

        etEditor.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable s) {
                if (!isLoaded) return;
                String stripped = stripFormattingCharacters(s.toString());
                if (!stripped.equals(s.toString())) {
                    int sel = etEditor.getSelectionEnd();
                    etEditor.removeTextChangedListener(this);
                    etEditor.setText(stripped);
                    etEditor.setSelection(Math.min(sel, stripped.length()));
                    etEditor.addTextChangedListener(this);
                    return;
                }
                markDirty();
                scheduleAutoSaveOrShadow();
                updateFooter();
            }
        });

        loadNote();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!CryptoManager.hasSessionKey()) {
            startActivity(new Intent(this, PinActivity.class)
                    .putExtra(PinActivity.EXTRA_LAUNCH_MODE, false));
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Flush shadow before session key may be cleared
        if (isDirty && !autosave) {
            byte[] keyCopy = CryptoManager.copySessionKey();
            if (keyCopy != null) {
                try {
                    String text = etEditor.getText().toString();
                    StorageManager.writeShadowWithKey(notePath, text, keyCopy);
                } catch (Exception ignored) {
                } finally {
                    Arrays.fill(keyCopy, (byte) 0);
                }
            }
        }
        etEditor.removeCallbacks(autosaveRunnable);
        etEditor.removeCallbacks(shadowRunnable);
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    private void loadNote() {
        new Thread(() -> {
            try {
                boolean as   = PinManager.getAutosave();
                boolean hasShadow = StorageManager.shadowExists(notePath);
                if (hasShadow) {
                    String shadowText = StorageManager.readShadow(notePath);
                    boolean autosaveEnabled = as;
                    runOnUiThread(() -> showRecoveryDialog(shadowText, autosaveEnabled));
                } else {
                    String text = StorageManager.readNote(notePath);
                    runOnUiThread(() -> {
                        autosave = as;
                        setEditorText(text);
                        isLoaded = true;
                        updateAutosaveUI();
                        updateFooter();
                    });
                }
            } catch (Exception e) {
                runOnUiThread(() -> {
                    showSessionErrorOrAlert(e);
                    finish();
                });
            }
        }).start();
    }

    private void showRecoveryDialog(String shadowText, boolean as) {
        autosave = as;
        String applyLabel = as ? "Apply recovery" : "Open recovery";
        new AlertDialog.Builder(this)
                .setTitle("Recovery file detected")
                .setMessage(as
                        ? "A recovery version of this note exists. Apply it or discard it?"
                        : "A recovery version of this note exists. Open it, or discard it and open the last saved version?")
                .setCancelable(false)
                .setPositiveButton(applyLabel, (d, w) -> {
                    if (as) {
                        // Apply: overwrite saved note with recovery then delete shadow
                        new Thread(() -> {
                            try {
                                StorageManager.writeNote(notePath, shadowText);
                                StorageManager.deleteShadow(notePath);
                            } catch (Exception ignored) {}
                            runOnUiThread(() -> {
                                setEditorText(shadowText);
                                isLoaded = true;
                                updateAutosaveUI();
                                updateFooter();
                            });
                        }).start();
                    } else {
                        // Open recovery without saving yet (dirty)
                        setEditorText(shadowText);
                        markDirty();
                        isLoaded = true;
                        updateAutosaveUI();
                        updateFooter();
                    }
                })
                .setNegativeButton("Discard recovery", (d, w) -> {
                    new Thread(() -> {
                        try {
                            StorageManager.deleteShadow(notePath);
                            String text = StorageManager.readNote(notePath);
                            runOnUiThread(() -> {
                                setEditorText(text);
                                isLoaded = true;
                                updateAutosaveUI();
                                updateFooter();
                            });
                        } catch (Exception e) {
                            runOnUiThread(() -> { showSessionErrorOrAlert(e); finish(); });
                        }
                    }).start();
                })
                .show();
    }

    private void setEditorText(String text) {
        etEditor.setText(text);
        etEditor.setSelection(0);
    }

    // ── Editing ───────────────────────────────────────────────────────────────

    private void markDirty() {
        isDirty = true;
    }

    private void scheduleAutoSaveOrShadow() {
        etEditor.removeCallbacks(autosaveRunnable);
        etEditor.removeCallbacks(shadowRunnable);
        if (autosave) {
            etEditor.postDelayed(autosaveRunnable, AUTOSAVE_DELAY);
        } else {
            etEditor.postDelayed(shadowRunnable, SHADOW_DELAY);
        }
    }

    private void doAutosave() {
        isSaving = true;
        updateAutosaveUI();
        String text = etEditor.getText().toString();
        new Thread(() -> {
            try { StorageManager.writeNote(notePath, text); } catch (Exception ignored) {}
            runOnUiThread(() -> {
                isSaving  = false;
                isDirty   = false;
                updateAutosaveUI();
                updateFooter();
            });
        }).start();
    }

    private void doShadow() {
        String text = etEditor.getText().toString();
        new Thread(() -> {
            try { StorageManager.writeShadow(notePath, text); } catch (Exception ignored) {}
        }).start();
    }

    private void handleSave() {
        if (isSaving) return;
        etEditor.removeCallbacks(autosaveRunnable);
        etEditor.removeCallbacks(shadowRunnable);
        isSaving = true;
        String text = etEditor.getText().toString();
        new Thread(() -> {
            try {
                StorageManager.writeNote(notePath, text);
                StorageManager.deleteShadow(notePath);
                runOnUiThread(() -> {
                    isSaving = false;
                    isDirty  = false;
                    updateFooter();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    isSaving = false;
                    showSessionErrorOrAlert(e);
                });
            }
        }).start();
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private void goUp() {
        if (!CryptoManager.hasSessionKey()) { finish(); return; }
        if (!isDirty || autosave) {
            navigateUp();
            return;
        }
        showUnsavedDialog(this::navigateUp);
    }

    private void navigateUp() {
        String dir = notePath.contains("/")
                ? notePath.substring(0, notePath.lastIndexOf('/'))
                : "";
        Intent intent = new Intent(this, FileBrowserActivity.class);
        intent.putExtra(FileBrowserActivity.EXTRA_PATH, dir);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    @Override
    public void onBackPressed() {
        goUp();
    }

    private void showUnsavedDialog(Runnable onDone) {
        new AlertDialog.Builder(this)
                .setTitle("Unsaved changes")
                .setMessage("Turn on autosave in settings to prevent these prompts.")
                .setPositiveButton("Save and exit", (d, w) -> {
                    String text = etEditor.getText().toString();
                    new Thread(() -> {
                        try {
                            StorageManager.writeNote(notePath, text);
                            StorageManager.deleteShadow(notePath);
                            runOnUiThread(() -> { isDirty = false; onDone.run(); });
                        } catch (Exception e) {
                            runOnUiThread(() -> showSessionErrorOrAlert(e));
                        }
                    }).start();
                })
                .setNeutralButton("Exit and delete draft", (d, w) -> {
                    new Thread(() -> {
                        StorageManager.deleteShadow(notePath);
                        runOnUiThread(() -> { isDirty = false; onDone.run(); });
                    }).start();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ── Menu actions ──────────────────────────────────────────────────────────

    private void showMenu(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        popup.getMenu().add(0, 1, 0, "Save As");
        popup.getMenu().add(0, 2, 0, "Export");
        popup.getMenu().add(0, 3, 0, "Rename");
        popup.getMenu().add(0, 4, 0, "Delete");
        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: menuSaveAs(); return true;
                case 2: menuExport(); return true;
                case 3: showRenameDialog(); return true;
                case 4: menuDelete(); return true;
            }
            return false;
        });
        popup.show();
    }

    private void menuSaveAs() {
        String dir = notePath.contains("/")
                ? notePath.substring(0, notePath.lastIndexOf('/'))
                : "";
        showSaveAsDialog(dir);
    }

    private void showSaveAsDialog(String currentDir) {
        View v = getLayoutInflater().inflate(android.R.layout.simple_list_item_2, null);
        // Build custom dialog layout inline
        android.widget.LinearLayout ll = new android.widget.LinearLayout(this);
        ll.setOrientation(android.widget.LinearLayout.VERTICAL);
        ll.setPadding(dp(28), dp(16), dp(28), dp(8));

        EditText etName = new EditText(this);
        etName.setHint("filename");
        etName.setText(noteName);
        etName.setTypeface(android.graphics.Typeface.MONOSPACE);
        TextView lblName = new TextView(this);
        lblName.setText("Filename");
        lblName.setTypeface(android.graphics.Typeface.MONOSPACE);
        lblName.setTextSize(11);

        EditText etDir = new EditText(this);
        etDir.setHint("leave empty for root");
        etDir.setText(currentDir);
        etDir.setTypeface(android.graphics.Typeface.MONOSPACE);
        TextView lblDir = new TextView(this);
        lblDir.setText("Directory");
        lblDir.setTypeface(android.graphics.Typeface.MONOSPACE);
        lblDir.setTextSize(11);

        ll.addView(lblName);
        ll.addView(etName);
        ll.addView(lblDir);
        ll.addView(etDir);

        new AlertDialog.Builder(this)
                .setTitle("Save as")
                .setView(ll)
                .setPositiveButton("save", (d, w) -> {
                    try {
                        String name      = StorageManager.sanitizeName(etName.getText().toString());
                        String dirStr    = etDir.getText().toString().trim();
                        String newPath   = dirStr.isEmpty() ? name : dirStr + "/" + name;
                        if (StorageManager.exists(newPath, false)) {
                            showError("A note with that name already exists in that location.");
                            return;
                        }
                        String text = etEditor.getText().toString();
                        new Thread(() -> {
                            try {
                                StorageManager.writeNote(newPath, text);
                                runOnUiThread(() -> {
                                    notePath = newPath;
                                    noteName = name;
                                    tvNoteName.setText(noteName);
                                    isDirty = false;
                                    updateFooter();
                                });
                            } catch (Exception e) {
                                runOnUiThread(() -> showSessionErrorOrAlert(e));
                            }
                        }).start();
                    } catch (Exception e) {
                        showError(e.getMessage());
                    }
                })
                .setNegativeButton("cancel", null)
                .show();
    }

    private void menuExport() {
        new Thread(() -> {
            try {
                String plaintext = etEditor.getText().toString();
                String filename  = StorageManager.exportName(noteName);
                writeToDownloads(filename, plaintext.getBytes("UTF-8"), "text/plain");
                runOnUiThread(() -> Toast.makeText(this,
                        "Saved to Downloads as \"" + filename + "\".", Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> showError("Export failed: " + e.getMessage()));
            }
        }).start();
    }

    private void menuDelete() {
        new AlertDialog.Builder(this)
                .setTitle("Delete this note?")
                .setMessage("This cannot be undone.")
                .setPositiveButton("Delete", (d, w) -> {
                    String dir = notePath.contains("/")
                            ? notePath.substring(0, notePath.lastIndexOf('/'))
                            : "";
                    new Thread(() -> {
                        try {
                            StorageManager.deleteNote(notePath);
                            runOnUiThread(() -> {
                                Intent intent = new Intent(this, FileBrowserActivity.class);
                                intent.putExtra(FileBrowserActivity.EXTRA_PATH, dir);
                                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                startActivity(intent);
                                finish();
                            });
                        } catch (Exception e) {
                            runOnUiThread(() -> showError("Delete failed: " + e.getMessage()));
                        }
                    }).start();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showRenameDialog() {
        EditText et = new EditText(this);
        et.setText(noteName);
        et.setTypeface(android.graphics.Typeface.MONOSPACE);
        et.setPadding(dp(8), dp(8), dp(8), dp(8));

        new AlertDialog.Builder(this)
                .setTitle("Rename note")
                .setView(et)
                .setPositiveButton("rename", (d, w) -> {
                    try {
                        String newName = StorageManager.sanitizeName(et.getText().toString());
                        if (newName.equals(noteName)) return;
                        String[] parts = notePath.split("/");
                        parts[parts.length - 1] = newName;
                        String newPath = String.join("/", parts);
                        if (StorageManager.exists(newPath, false)) {
                            showError("A note with that name already exists.");
                            return;
                        }
                        new Thread(() -> {
                            try {
                                StorageManager.renameNote(notePath, newPath);
                                runOnUiThread(() -> {
                                    notePath = newPath;
                                    noteName = newName;
                                    tvNoteName.setText(noteName);
                                });
                            } catch (Exception e) {
                                runOnUiThread(() -> showError("Rename failed: " + e.getMessage()));
                            }
                        }).start();
                    } catch (Exception e) {
                        showError(e.getMessage());
                    }
                })
                .setNegativeButton("cancel", null)
                .show();
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private void updateAutosaveUI() {
        if (autosave) {
            tvAutosavedLabel.setVisibility(View.VISIBLE);
            tvAutosavedLabel.setText(isSaving ? "saving…" : "autosaved");
            btnSave.setVisibility(View.GONE);
        } else {
            tvAutosavedLabel.setVisibility(View.GONE);
            btnSave.setVisibility(View.VISIBLE);
        }
    }

    private void updateFooter() {
        String text = etEditor.getText().toString();
        int chars   = text.length();
        int words   = text.trim().isEmpty() ? 0 : text.trim().split("\\s+").length;
        tvWordCount.setText(words + (words == 1 ? " word" : " words") + " · "
                + chars + (chars == 1 ? " char" : " chars"));
        tvStatus.setText(isDirty && !autosave ? "unsaved" : "plain text");
    }

    // ── Formatting strip ──────────────────────────────────────────────────────

    private static String stripFormattingCharacters(String text) {
        return text
                .replaceAll("[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\uFFFC]", "")
                .replace('\u2018', '\'').replace('\u2019', '\'')
                .replace('\u201C', '"').replace('\u201D', '"')
                .replace('\u2013', '-').replace('\u2014', '-')
                .replace("\u2026", "...")
                .replace('\u00A0', ' ')
                .replaceAll("<[^>]*>", "");
    }

    // ── Downloads helper ─────────────────────────────────────────────────────

    private void writeToDownloads(String filename, byte[] data, String mimeType) throws Exception {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(android.provider.MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(android.provider.MediaStore.Downloads.IS_PENDING, 1);
            android.net.Uri collection = android.provider.MediaStore.Downloads.getContentUri(
                    android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
            android.net.Uri itemUri = getContentResolver().insert(collection, values);
            if (itemUri == null) throw new Exception("Could not create Downloads file.");
            try (java.io.OutputStream os = getContentResolver().openOutputStream(itemUri)) {
                if (os == null) throw new Exception("Could not open Downloads file for writing.");
                os.write(data);
            }
            values.clear();
            values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0);
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

    private void showSessionErrorOrAlert(Exception e) {
        String msg = e.getMessage() != null ? e.getMessage() : e.toString();
        if (msg.contains("session key") || msg.contains("session")) {
            new AlertDialog.Builder(this)
                    .setTitle("Session expired")
                    .setMessage("Your session has expired.")
                    .setPositiveButton("Log in", (d, w) ->
                            startActivity(new Intent(this, PinActivity.class)
                                    .putExtra(PinActivity.EXTRA_LAUNCH_MODE, false)))
                    .show();
        } else {
            showError(msg);
        }
    }

    private void showError(String message) {
        new AlertDialog.Builder(this)
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }

    private int dp(int value) {
        return Math.round(android.util.TypedValue.applyDimension(
                android.util.TypedValue.COMPLEX_UNIT_DIP, value,
                getResources().getDisplayMetrics()));
    }
}
