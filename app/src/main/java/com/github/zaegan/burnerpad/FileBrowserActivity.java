package com.github.zaegan.burnerpad;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.DividerItemDecoration;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.github.zaegan.burnerpad.crypto.CryptoManager;
import com.github.zaegan.burnerpad.prefs.PinManager;
import com.github.zaegan.burnerpad.storage.StorageManager;
import com.github.zaegan.burnerpad.tutorial.TutorialManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Main file browser.
 *
 * ↑ button navigates to parent directory (not shown at root).
 * Long-press: Rename / Delete (+ Export for notes).
 * Export: writes plaintext to Downloads folder.
 * Import: uses ACTION_OPEN_DOCUMENT (SAF).
 */
public class FileBrowserActivity extends AppCompatActivity {

    public static final String EXTRA_PATH      = "path";
    private static final int   REQ_IMPORT_FILE = 1001;

    private String       currentPath;
    private RecyclerView recyclerView;
    private FileAdapter  adapter;
    private TextView     tvEmpty, tvTitle, btnUp;
    private FrameLayout  tutorialOverlay;

    private List<StorageManager.FileEntry> items = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_file_browser);

        currentPath    = getIntent().getStringExtra(EXTRA_PATH);
        if (currentPath == null) currentPath = "";

        tvTitle        = findViewById(R.id.tvTitle);
        btnUp          = findViewById(R.id.btnUp);
        tvEmpty        = findViewById(R.id.tvEmpty);
        recyclerView   = findViewById(R.id.recyclerView);
        tutorialOverlay= findViewById(R.id.tutorialOverlay);

        recyclerView.setLayoutManager(new LinearLayoutManager(this));
        recyclerView.addItemDecoration(new DividerItemDecoration(this, DividerItemDecoration.VERTICAL));
        adapter = new FileAdapter();
        recyclerView.setAdapter(adapter);

        tvTitle.setText(currentPath.isEmpty() ? "BurnerPad"
                : currentPath.substring(currentPath.lastIndexOf('/') + 1));

        if (!currentPath.isEmpty()) {
            btnUp.setVisibility(View.VISIBLE);
            btnUp.setOnClickListener(v -> goUp());
        }

        findViewById(R.id.btnNewNote).setOnClickListener(v -> showCreateDialog(false));
        findViewById(R.id.btnNewFolder).setOnClickListener(v -> showCreateDialog(true));
        findViewById(R.id.btnImport).setOnClickListener(v -> startImport());
        findViewById(R.id.btnSettings).setOnClickListener(v -> {
            dismissTutorial();
            startActivity(new Intent(this, SettingsActivity.class));
        });

        // Tutorial overlay wiring
        findViewById(R.id.tvTutorialGotIt).setOnClickListener(v -> dismissTutorial());
        findViewById(R.id.tvTutorialSkip).setOnClickListener(v -> dismissTutorial());
        findViewById(R.id.tvTutorialDeclineAll).setOnClickListener(v -> {
            TutorialManager.declineAll();
            tutorialOverlay.setVisibility(View.GONE);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Lock check
        if (!CryptoManager.hasSessionKey()) {
            startActivity(new Intent(this, PinActivity.class)
                    .putExtra(PinActivity.EXTRA_LAUNCH_MODE, false));
            return;
        }
        loadItems();
        saveLastLocation();
        // Show tutorial once at root
        if (currentPath.isEmpty() && TutorialManager.shouldShow(TutorialManager.SETTINGS_INTRO)) {
            tutorialOverlay.setVisibility(View.VISIBLE);
        }
    }

    private void saveLastLocation() {
        try {
            JSONObject params = new JSONObject();
            params.put("path", currentPath);
            JSONObject loc = new JSONObject();
            loc.put("screen", "FileBrowser");
            loc.put("params", params);
            PinManager.setLastLocation(loc.toString());
        } catch (Exception ignored) {}
    }

    private void loadItems() {
        new Thread(() -> {
            List<StorageManager.FileEntry> loaded = StorageManager.listDir(currentPath);
            runOnUiThread(() -> {
                items.clear();
                items.addAll(loaded);
                adapter.notifyDataSetChanged();
                tvEmpty.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);
                recyclerView.setVisibility(items.isEmpty() ? View.GONE : View.VISIBLE);
            });
        }).start();
    }

    private void goUp() {
        if (currentPath.isEmpty()) return;
        int slash = currentPath.lastIndexOf('/');
        String parent = slash >= 0 ? currentPath.substring(0, slash) : "";
        Intent intent = new Intent(this, FileBrowserActivity.class);
        intent.putExtra(EXTRA_PATH, parent);
        startActivity(intent);
        finish();
    }

    private void openItem(StorageManager.FileEntry item) {
        if (item.isDirectory) {
            Intent intent = new Intent(this, FileBrowserActivity.class);
            intent.putExtra(EXTRA_PATH, item.path);
            startActivity(intent);
        } else {
            try {
                JSONObject params = new JSONObject();
                params.put("notePath", item.path);
                params.put("noteName", item.name);
                JSONObject loc = new JSONObject();
                loc.put("screen", "Editor");
                loc.put("params", params);
                PinManager.setLastLocation(loc.toString());
            } catch (Exception ignored) {}
            Intent intent = new Intent(this, EditorActivity.class);
            intent.putExtra(EditorActivity.EXTRA_NOTE_PATH, item.path);
            intent.putExtra(EditorActivity.EXTRA_NOTE_NAME, item.name);
            startActivity(intent);
        }
    }

    private void longPressItem(StorageManager.FileEntry item) {
        List<String> options = new ArrayList<>();
        if (!item.isDirectory) options.add("Export");
        options.add("Rename");
        options.add("Delete");
        options.add("Cancel");

        new AlertDialog.Builder(this)
                .setTitle(item.name)
                .setItems(options.toArray(new String[0]), (d, which) -> {
                    String opt = options.get(which);
                    switch (opt) {
                        case "Export": exportItem(item); break;
                        case "Rename": showRenameDialog(item); break;
                        case "Delete": confirmDelete(item); break;
                    }
                })
                .show();
    }

    // ── Export ────────────────────────────────────────────────────────────────

    private void exportItem(StorageManager.FileEntry item) {
        new Thread(() -> {
            try {
                String plaintext = StorageManager.getNotePlaintext(item.path);
                String filename  = StorageManager.exportName(item.name);
                writeToDownloads(filename, plaintext.getBytes("UTF-8"), "text/plain");
                runOnUiThread(() -> Toast.makeText(this,
                        "Saved to Downloads as \"" + filename + "\".", Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> showError("Export failed", e.getMessage()));
            }
        }).start();
    }

    // ── Import ────────────────────────────────────────────────────────────────

    private void startImport() {
        BurnerPadApp.setSuppressLock(true);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(intent, REQ_IMPORT_FILE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        BurnerPadApp.setSuppressLock(false);
        if (requestCode == REQ_IMPORT_FILE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri == null) return;
            // Read content
            new Thread(() -> {
                try {
                    String content = readUriAsString(uri);
                    // Infer filename from URI
                    String rawName = uri.getLastPathSegment();
                    if (rawName == null) rawName = "imported";
                    // Strip any path prefix
                    if (rawName.contains("/")) rawName = rawName.substring(rawName.lastIndexOf('/') + 1);
                    String name = rawName;
                    runOnUiThread(() -> showImportNameDialog(name, content));
                } catch (Exception e) {
                    runOnUiThread(() -> showError("Import failed", e.getMessage()));
                }
            }).start();
        }
    }

    private void showImportNameDialog(String suggestedName, String content) {
        EditText et = new EditText(this);
        et.setText(suggestedName);
        et.setSelectAllOnFocus(true);
        et.setPadding(dp(8), dp(8), dp(8), dp(8));

        new AlertDialog.Builder(this)
                .setTitle("Import as")
                .setView(et)
                .setPositiveButton("import", (d, w) -> {
                    String rawName = et.getText().toString().trim();
                    try {
                        String name = StorageManager.sanitizeName(rawName);
                        String relPath = currentPath.isEmpty() ? name : currentPath + "/" + name;
                        doImport(relPath, content, false);
                    } catch (Exception e) {
                        showError("Invalid name", e.getMessage());
                    }
                })
                .setNegativeButton("cancel", null)
                .show();
    }

    private void doImport(String relPath, String content, boolean replacing) {
        boolean exists = StorageManager.exists(relPath, false);
        if (exists && !replacing) {
            new AlertDialog.Builder(this)
                    .setTitle("\"" + relPath + "\" already exists")
                    .setMessage("What would you like to do?")
                    .setPositiveButton("Replace", (d, w) -> doImport(relPath, content, true))
                    .setNegativeButton("Rename import", (d, w) ->
                            doImport(StorageManager.resolveCollision(relPath), content, false))
                    .setNeutralButton("Skip", null)
                    .show();
            return;
        }
        new Thread(() -> {
            try {
                StorageManager.importNotePlaintext(relPath, content);
                runOnUiThread(this::loadItems);
            } catch (Exception e) {
                runOnUiThread(() -> showError("Import failed", e.getMessage()));
            }
        }).start();
    }

    // ── Rename ────────────────────────────────────────────────────────────────

    private void showRenameDialog(StorageManager.FileEntry item) {
        EditText et = new EditText(this);
        et.setText(item.name);
        et.setPadding(dp(8), dp(8), dp(8), dp(8));

        new AlertDialog.Builder(this)
                .setTitle("Rename")
                .setView(et)
                .setPositiveButton("rename", (d, w) -> {
                    String newName = et.getText().toString().trim();
                    try {
                        String sanitized = StorageManager.sanitizeName(newName);
                        if (sanitized.equals(item.name)) return;
                        String[] parts = item.path.split("/");
                        parts[parts.length - 1] = sanitized;
                        String newPath = String.join("/", parts);
                        if (StorageManager.exists(newPath, item.isDirectory)) {
                            showError("Rename failed", "A " + (item.isDirectory ? "folder" : "note") + " with that name already exists.");
                            return;
                        }
                        new Thread(() -> {
                            try {
                                if (item.isDirectory) StorageManager.renameDirectory(item.path, newPath);
                                else StorageManager.renameNote(item.path, newPath);
                                runOnUiThread(this::loadItems);
                            } catch (Exception e) {
                                runOnUiThread(() -> showError("Rename failed", e.getMessage()));
                            }
                        }).start();
                    } catch (Exception e) {
                        showError("Rename failed", e.getMessage());
                    }
                })
                .setNegativeButton("cancel", null)
                .show();
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    private void confirmDelete(StorageManager.FileEntry item) {
        String msg = item.isDirectory
                ? "This will delete the folder and all notes inside it."
                : "This cannot be undone.";
        new AlertDialog.Builder(this)
                .setTitle("Delete \"" + item.name + "\"?")
                .setMessage(msg)
                .setPositiveButton("Delete", (d, w) -> {
                    new Thread(() -> {
                        try {
                            if (item.isDirectory) StorageManager.deleteDirectory(item.path);
                            else StorageManager.deleteNote(item.path);
                            runOnUiThread(this::loadItems);
                        } catch (Exception e) {
                            runOnUiThread(() -> showError("Delete failed", e.getMessage()));
                        }
                    }).start();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    // ── Create ────────────────────────────────────────────────────────────────

    private void showCreateDialog(boolean isFolder) {
        EditText et = new EditText(this);
        et.setHint(isFolder ? "folder name" : "filename (e.g. todo.txt)");
        et.setPadding(dp(8), dp(8), dp(8), dp(8));
        et.setInputType(android.text.InputType.TYPE_CLASS_TEXT);

        new AlertDialog.Builder(this)
                .setTitle(isFolder ? "New folder" : "New note")
                .setView(et)
                .setPositiveButton("create", (d, w) -> {
                    String rawName = et.getText().toString().trim();
                    try {
                        String name    = StorageManager.sanitizeName(rawName);
                        String relPath = currentPath.isEmpty() ? name : currentPath + "/" + name;
                        if (StorageManager.exists(relPath, isFolder)) {
                            showError("Already exists",
                                    isFolder ? "A folder with that name already exists."
                                            : "A note with that name already exists.");
                            return;
                        }
                        if (isFolder) {
                            new Thread(() -> {
                                try {
                                    StorageManager.createDirectory(relPath);
                                    runOnUiThread(this::loadItems);
                                } catch (Exception e) {
                                    runOnUiThread(() -> showError("Create failed", e.getMessage()));
                                }
                            }).start();
                        } else {
                            new Thread(() -> {
                                try {
                                    StorageManager.writeNote(relPath, "");
                                    runOnUiThread(() -> {
                                        Intent intent = new Intent(this, EditorActivity.class);
                                        intent.putExtra(EditorActivity.EXTRA_NOTE_PATH, relPath);
                                        intent.putExtra(EditorActivity.EXTRA_NOTE_NAME, name);
                                        startActivity(intent);
                                    });
                                } catch (Exception e) {
                                    runOnUiThread(() -> showError("Create failed", e.getMessage()));
                                }
                            }).start();
                        }
                    } catch (Exception e) {
                        showError("Invalid name", e.getMessage());
                    }
                })
                .setNegativeButton("cancel", null)
                .show();
    }

    // ── Tutorial ──────────────────────────────────────────────────────────────

    private void dismissTutorial() {
        TutorialManager.markDone(TutorialManager.SETTINGS_INTRO);
        tutorialOverlay.setVisibility(View.GONE);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
            // Auto-number if file exists
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

    private String readUriAsString(Uri uri) throws Exception {
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("Could not open file.");
            byte[] buf = is.readAllBytes();
            return new String(buf, "UTF-8");
        }
    }

    private void showError(String title, String message) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }

    private int dp(int value) {
        return Math.round(android.util.TypedValue.applyDimension(
                android.util.TypedValue.COMPLEX_UNIT_DIP, value,
                getResources().getDisplayMetrics()));
    }

    // ── RecyclerView adapter ──────────────────────────────────────────────────

    private class FileAdapter extends RecyclerView.Adapter<FileAdapter.VH> {

        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_file, parent, false);
            return new VH(v);
        }

        @Override
        public void onBindViewHolder(@NonNull VH holder, int position) {
            StorageManager.FileEntry item = items.get(position);
            holder.tvIcon.setText(item.isDirectory ? "📁" : "·");
            holder.tvName.setText(item.name);
            holder.itemView.setOnClickListener(v -> openItem(item));
            holder.itemView.setOnLongClickListener(v -> { longPressItem(item); return true; });
        }

        @Override public int getItemCount() { return items.size(); }

        class VH extends RecyclerView.ViewHolder {
            TextView tvIcon, tvName;
            VH(View v) {
                super(v);
                tvIcon = v.findViewById(R.id.tvIcon);
                tvName = v.findViewById(R.id.tvName);
            }
        }
    }
}
