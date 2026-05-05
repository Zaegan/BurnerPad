package com.github.zaegan.burnerpad.storage;

import android.content.Context;
import android.util.Base64;

import com.github.zaegan.burnerpad.crypto.CryptoManager;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.ZipParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * All note file I/O for BurnerPad.
 *
 * Directory layout (inside context.getFilesDir()):
 *   notes/        — encrypted note files (.bp)
 *   recovery/     — encrypted shadow/draft files (.bp)
 *
 * File format: each .bp file contains the JSON produced by CryptoManager.
 *
 * NAMING: names are stored exactly as provided; no extension forced.
 * EXPORT: if name has no '.', appends '.txt' to avoid extension-less files.
 *
 * DRAFT SAFETY:
 *   writeNote()   — deletes any draft at target path first
 *   renameNote()  — moves draft along with the note
 *   deleteNote()  — deletes accompanying draft
 *
 * ARCHIVE: ZIP of decrypted plaintext, then AES-256-CBC encrypted, saved as .bparchive.
 *   Schema JSON inside ZIP records directory structure (including empty dirs).
 */
public final class StorageManager {

    private static final String EXT = ".bp";
    public static final int CURRENT_SCHEMA = 1;

    private static File notesDir;
    private static File recoveryDir;
    private static File tempDir;

    private StorageManager() {}

    public static void init(Context context) {
        notesDir    = new File(context.getFilesDir(), "notes");
        recoveryDir = new File(context.getFilesDir(), "recovery");
        tempDir     = new File(context.getCacheDir(),  "burnerpad_temp");
        ensureDir(notesDir);
        ensureDir(recoveryDir);
    }

    // ── Path utilities ────────────────────────────────────────────────────────

    private static File noteFile(String relativePath) {
        return new File(notesDir, relativePath + EXT);
    }

    private static File recoveryFile(String relativePath) {
        return new File(recoveryDir, relativePath + EXT);
    }

    /** Validate a user-provided name component (no slashes, dots-only names, etc). */
    public static String sanitizeName(String input) throws Exception {
        if (input == null) throw new Exception("Invalid name.");
        String s = input.trim();
        if (s.isEmpty())         throw new Exception("Name cannot be empty.");
        if (s.contains("/"))     throw new Exception("Name cannot contain slashes.");
        if (s.contains("\\"))   throw new Exception("Name cannot contain backslashes.");
        if (s.contains("\0"))   throw new Exception("Name cannot contain null bytes.");
        if (s.equals("."))       throw new Exception("Invalid name.");
        if (s.equals(".."))      throw new Exception("Invalid name.");
        if (s.equals("~"))       throw new Exception("Invalid name.");
        return s;
    }

    public static String exportName(String noteName) {
        return noteName.contains(".") ? noteName : noteName + ".txt";
    }

    public static void validateArchivePassword(String password) throws Exception {
        if (password == null || password.isEmpty())
            throw new Exception("Password cannot be empty.");
        if (password.contains("'"))  throw new Exception("Password cannot contain single quotes.");
        if (password.contains("\"")) throw new Exception("Password cannot contain double quotes.");
        if (password.contains("\\")) throw new Exception("Password cannot contain backslashes.");
        if (password.length() < 12) throw new Exception("Password must be at least 12 characters.");
        if (!password.matches(".*[A-Z].*")) throw new Exception("Password must contain at least one uppercase letter.");
        if (!password.matches(".*[a-z].*")) throw new Exception("Password must contain at least one lowercase letter.");
        if (!password.matches(".*[0-9].*")) throw new Exception("Password must contain at least one number.");
        if (!password.matches(".*[!@#$%^&*()\\-_=+\\[\\]{}|;:<>.?/].*"))
            throw new Exception("Password must contain at least one symbol.");
    }

    // ── Directory listing ─────────────────────────────────────────────────────

    public static List<FileEntry> listDir(String relativePath) {
        File dir = relativePath.isEmpty() ? notesDir : new File(notesDir, relativePath);
        ensureDir(dir);
        List<FileEntry> entries = new ArrayList<>();
        File[] files = dir.listFiles();
        if (files == null) return entries;
        for (File f : files) {
            String name = f.isDirectory() ? f.getName()
                    : f.getName().endsWith(EXT)
                    ? f.getName().substring(0, f.getName().length() - EXT.length())
                    : f.getName();
            String path = relativePath.isEmpty() ? name : relativePath + "/" + name;
            entries.add(new FileEntry(name, path, f.isDirectory()));
        }
        entries.sort((a, b) -> {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.compareToIgnoreCase(b.name);
        });
        return entries;
    }

    public static boolean exists(String relativePath, boolean isDirectory) {
        File f = isDirectory ? new File(notesDir, relativePath) : noteFile(relativePath);
        return f.exists();
    }

    // ── Note read/write ───────────────────────────────────────────────────────

    public static String readNote(String relativePath) throws Exception {
        File f = noteFile(relativePath);
        if (!f.exists()) return "";
        return CryptoManager.decryptNote(readText(f));
    }

    public static void writeNote(String relativePath, String plaintext) throws Exception {
        deleteShadow(relativePath);
        File f = noteFile(relativePath);
        ensureDir(f.getParentFile());
        writeText(f, CryptoManager.encryptNote(plaintext));
    }

    /** Write note using an explicit key (for re-encryption during PIN change). */
    public static void writeNoteWithKey(String relativePath, String plaintext, byte[] key) throws Exception {
        File f = noteFile(relativePath);
        ensureDir(f.getParentFile());
        writeText(f, CryptoManager.encryptWithKey(plaintext, key));
    }

    public static void deleteNote(String relativePath) throws Exception {
        File f = noteFile(relativePath);
        if (f.exists()) {
            shredFile(f);
        }
        deleteShadow(relativePath);
    }

    // ── Directory operations ──────────────────────────────────────────────────

    public static void createDirectory(String relativePath) throws Exception {
        String[] parts = relativePath.split("/");
        sanitizeName(parts[parts.length - 1]);
        ensureDir(new File(notesDir, relativePath));
    }

    public static void deleteDirectory(String relativePath) throws Exception {
        File dir = new File(notesDir, relativePath);
        if (dir.exists()) deleteRecursive(dir);
    }

    // ── Rename ────────────────────────────────────────────────────────────────

    public static void renameNote(String oldRelPath, String newRelPath) throws Exception {
        String[] parts = newRelPath.split("/");
        sanitizeName(parts[parts.length - 1]);
        File oldFile = noteFile(oldRelPath);
        File newFile = noteFile(newRelPath);
        ensureDir(newFile.getParentFile());
        // Move note file
        if (!oldFile.renameTo(newFile))
            throw new Exception("Failed to rename note.");
        // Move shadow if it exists
        renameShadow(oldRelPath, newRelPath);
    }

    public static void renameDirectory(String oldRelPath, String newRelPath) throws Exception {
        String[] parts = newRelPath.split("/");
        sanitizeName(parts[parts.length - 1]);
        File oldDir = new File(notesDir, oldRelPath);
        File newDir = new File(notesDir, newRelPath);
        if (!oldDir.renameTo(newDir))
            throw new Exception("Failed to rename folder.");
    }

    // ── Shadow (recovery/draft) files ─────────────────────────────────────────

    public static boolean shadowExists(String relativePath) {
        return recoveryFile(relativePath).exists();
    }

    public static String readShadow(String relativePath) throws Exception {
        File f = recoveryFile(relativePath);
        if (!f.exists()) return "";
        return CryptoManager.decryptNote(readText(f));
    }

    public static void writeShadow(String relativePath, String plaintext) throws Exception {
        File f = recoveryFile(relativePath);
        ensureDir(f.getParentFile());
        writeText(f, CryptoManager.encryptNote(plaintext));
    }

    /** Write shadow using an explicit key (for shadow flush before session key cleared). */
    public static void writeShadowWithKey(String relativePath, String plaintext, byte[] key) throws Exception {
        File f = recoveryFile(relativePath);
        ensureDir(f.getParentFile());
        writeText(f, CryptoManager.encryptWithKey(plaintext, key));
    }

    public static void deleteShadow(String relativePath) {
        File f = recoveryFile(relativePath);
        if (f.exists()) shredFile(f);
    }

    private static void renameShadow(String oldRelPath, String newRelPath) {
        File oldFile = recoveryFile(oldRelPath);
        if (oldFile.exists()) {
            File newFile = recoveryFile(newRelPath);
            ensureDir(newFile.getParentFile());
            oldFile.renameTo(newFile);
        }
    }

    // ── Wipe all notes ────────────────────────────────────────────────────────

    public static void wipeAllNotes() {
        deleteRecursive(notesDir);
        deleteRecursive(recoveryDir);
        ensureDir(notesDir);
        ensureDir(recoveryDir);
    }

    public static void createDefaultNote() throws Exception {
        writeNote("untitled.txt", "");
    }

    // ── Export (get plaintext) ────────────────────────────────────────────────

    public static String getNotePlaintext(String relativePath) throws Exception {
        return readNote(relativePath);
    }

    // ── Import (write plaintext as new note) ──────────────────────────────────

    public static void importNotePlaintext(String relativePath, String plaintext) throws Exception {
        writeNote(relativePath, plaintext);
    }

    /** Find a non-colliding path by appending (n) suffix. */
    public static String resolveCollision(String relativePath) {
        int lastSlash = relativePath.lastIndexOf('/');
        String dir  = lastSlash >= 0 ? relativePath.substring(0, lastSlash) : "";
        String name = lastSlash >= 0 ? relativePath.substring(lastSlash + 1) : relativePath;
        int dotIdx  = name.lastIndexOf('.');
        String base = dotIdx >= 0 ? name.substring(0, dotIdx) : name;
        String ext  = dotIdx >= 0 ? name.substring(dotIdx) : "";
        for (int n = 1; n < 10000; n++) {
            String candidate = base + " (" + n + ")" + ext;
            String full = dir.isEmpty() ? candidate : dir + "/" + candidate;
            if (!noteFile(full).exists()) return full;
        }
        return relativePath + "_copy";
    }

    // ── Re-encrypt all (PIN change) ───────────────────────────────────────────

    public interface ProgressCallback {
        void onProgress(float fraction);
    }

    public static void reEncryptAll(byte[] oldKey, byte[] newKey, ProgressCallback cb) throws Exception {
        List<File> noteFiles  = collectFiles(notesDir);
        List<File> draftFiles = collectFiles(recoveryDir);
        int total = noteFiles.size() + draftFiles.size();
        int done  = 0;
        List<File> all = new ArrayList<>();
        all.addAll(noteFiles);
        all.addAll(draftFiles);
        for (File f : all) {
            String enc      = readText(f);
            String plain    = CryptoManager.decryptWithKey(enc, oldKey);
            String newEnc   = CryptoManager.encryptWithKey(plain, newKey);
            writeText(f, newEnc);
            done++;
            if (cb != null) cb.onProgress((float) done / total);
        }
    }

    // ── Backup archive ────────────────────────────────────────────────────────

    public static File createArchive(String password) throws Exception {
        validateArchivePassword(password);
        cleanTemp();
        ensureDir(tempDir);
        File tempNotes    = new File(tempDir, "notes");
        File tempRecovery = new File(tempDir, "recovery");
        ensureDir(tempNotes);
        ensureDir(tempRecovery);

        // Collect all directories (including empty)
        List<String> allDirs = collectDirs(notesDir, "");

        // Write schema.json
        JSONObject schema = new JSONObject();
        schema.put("schema",    CURRENT_SCHEMA);
        schema.put("createdAt", new java.util.Date().toString());
        schema.put("app",       "BurnerPad");
        JSONArray dirsArray = new JSONArray();
        for (String d : allDirs) dirsArray.put(d);
        schema.put("directories", dirsArray);
        writeText(new File(tempDir, "schema.json"), schema.toString(2));

        // Recreate directory structure in temp (including empty dirs)
        for (String dir : allDirs) {
            ensureDir(new File(tempNotes, dir));
        }

        // Decrypt and write note files
        List<File> noteFiles = collectFiles(notesDir);
        for (File f : noteFiles) {
            String relPath = notesDir.toURI().relativize(f.toURI()).getPath();
            String noExt   = relPath.endsWith(EXT) ? relPath.substring(0, relPath.length() - EXT.length()) : relPath;
            String plain   = CryptoManager.decryptNote(readText(f));
            File outFile   = new File(tempNotes, noExt);
            ensureDir(outFile.getParentFile());
            writeText(outFile, plain);
        }

        // Decrypt and write draft files (only those paired with a note)
        List<File> draftFiles = collectFiles(recoveryDir);
        for (File f : draftFiles) {
            String relPath = recoveryDir.toURI().relativize(f.toURI()).getPath();
            // Only include drafts whose note file still exists
            if (!new File(notesDir, relPath).exists()) continue;
            String noExt = relPath.endsWith(EXT) ? relPath.substring(0, relPath.length() - EXT.length()) : relPath;
            String plain = CryptoManager.decryptNote(readText(f));
            File outFile = new File(tempRecovery, noExt);
            ensureDir(outFile.getParentFile());
            writeText(outFile, plain);
        }

        // ZIP the temp dir contents (not the folder itself, to match RN zip behavior)
        File zipFile = new File(tempDir.getParent(), "burnerpad_export.zip");
        if (zipFile.exists()) zipFile.delete();
        ZipParameters zipParams = new ZipParameters();
        zipParams.setIncludeRootFolder(false);
        new ZipFile(zipFile).addFolder(tempDir, zipParams);

        // Read zip as base64, encrypt with password
        byte[] zipBytes = readBytes(zipFile);
        String zipBase64 = Base64.encodeToString(zipBytes, Base64.NO_WRAP);
        String encrypted = CryptoManager.encryptArchive(zipBase64, password);

        File archiveFile = new File(tempDir.getParent(), "burnerpad_backup.bparchive");
        writeText(archiveFile, encrypted);

        // Clean up
        cleanTemp();
        zipFile.delete();

        return archiveFile;
    }

    public interface ConflictCallback {
        /** Return "replace", "rename", or "skip". */
        String onConflict(String path) throws InterruptedException;
    }

    public interface RestoreProgressCallback {
        void onProgress(String message);
    }

    public static void restoreArchive(File archiveFile, String password,
                                      ConflictCallback onConflict,
                                      RestoreProgressCallback onProgress) throws Exception {
        String encryptedJson;
        try {
            encryptedJson = readText(archiveFile);
        } catch (Exception e) {
            throw new Exception("Could not read archive file: " + e.getMessage());
        }

        // Decrypt — propagate the specific error message from CryptoManager
        String zipBase64 = CryptoManager.decryptArchive(encryptedJson, password);

        cleanTemp();
        ensureDir(tempDir);

        File zipFile = new File(tempDir.getParent(), "burnerpad_restore.zip");
        byte[] zipBytes;
        try {
            zipBytes = Base64.decode(zipBase64, Base64.DEFAULT);
        } catch (Exception e) {
            throw new Exception("Decrypted archive content is not valid base64: " + e.getMessage());
        }
        writeBytes(zipFile, zipBytes);
        try {
            new ZipFile(zipFile).extractAll(tempDir.getAbsolutePath());
        } catch (Exception e) {
            throw new Exception("Failed to unzip archive: " + e.getMessage());
        }

        // Find the archive root — RN zip may include the source folder as a top-level entry,
        // producing tempDir/burnerpad_temp/... instead of tempDir/...
        File archiveRoot = tempDir;
        File schemaFile  = new File(tempDir, "schema.json");
        if (!schemaFile.exists()) {
            File[] subdirs = tempDir.listFiles(File::isDirectory);
            if (subdirs != null) {
                for (File sub : subdirs) {
                    File candidate = new File(sub, "schema.json");
                    if (candidate.exists()) {
                        archiveRoot = sub;
                        schemaFile  = candidate;
                        break;
                    }
                }
            }
        }
        if (!schemaFile.exists()) {
            StringBuilder contents = new StringBuilder();
            File[] top = tempDir.listFiles();
            if (top != null) for (File f : top)
                contents.append(f.getName()).append(f.isDirectory() ? "/" : "").append(" ");
            throw new Exception("Invalid archive: schema.json not found. "
                    + "Extracted contents: [" + contents.toString().trim() + "]");
        }

        JSONObject schema = new JSONObject(readText(schemaFile));
        int schemaVersion = schema.optInt("schema", 1);
        if (schemaVersion > CURRENT_SCHEMA)
            throw new Exception("This backup format is not supported. Please update BurnerPad.");

        // Restore empty directories
        JSONArray dirs = schema.optJSONArray("directories");
        if (dirs != null) {
            for (int i = 0; i < dirs.length(); i++) {
                ensureDir(new File(notesDir, dirs.getString(i)));
            }
        }

        // Restore note files
        File tempNotes    = new File(archiveRoot, "notes");
        File tempRecovery = new File(archiveRoot, "recovery");
        List<File> noteFiles = collectFiles(tempNotes);
        String globalResolution = null;

        for (File f : noteFiles) {
            if (f.isDirectory()) continue;
            String relPath = tempNotes.toURI().relativize(f.toURI()).getPath();
            if (onProgress != null) onProgress.onProgress("Restoring " + relPath + "...");

            boolean collision = noteFile(relPath).exists();
            String action     = "replace";
            String resolved   = relPath;

            if (collision) {
                if (globalResolution != null) {
                    action = globalResolution;
                } else {
                    action = onConflict.onConflict(relPath);
                }
            }

            if ("skip".equals(action)) continue;
            if ("rename".equals(action)) resolved = resolveCollision(relPath);

            String plain = readText(f);
            writeNote(resolved, plain);

            // Restore accompanying draft if present
            File draftFile = new File(tempRecovery, relPath);
            if (draftFile.exists()) {
                writeShadow(resolved, readText(draftFile));
            }
        }

        cleanTemp();
        zipFile.delete();
    }

    // ── File helpers ─────────────────────────────────────────────────────────

    private static void ensureDir(File dir) {
        if (!dir.exists()) dir.mkdirs();
    }

    private static String readText(File f) throws Exception {
        byte[] bytes = readBytes(f);
        return new String(bytes, "UTF-8");
    }

    private static void writeText(File f, String text) throws Exception {
        writeBytes(f, text.getBytes("UTF-8"));
    }

    private static byte[] readBytes(File f) throws Exception {
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int read = 0;
            while (read < buf.length) {
                int r = fis.read(buf, read, buf.length - read);
                if (r < 0) break;
                read += r;
            }
            return buf;
        }
    }

    private static void writeBytes(File f, byte[] data) throws Exception {
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(data);
        }
    }

    /** Overwrite file content with zeros before deleting. */
    private static void shredFile(File f) {
        try {
            long len = f.length();
            try (FileOutputStream fos = new FileOutputStream(f)) {
                byte[] zeros = new byte[(int) Math.min(len, 4096)];
                long remaining = len;
                while (remaining > 0) {
                    int chunk = (int) Math.min(remaining, zeros.length);
                    fos.write(zeros, 0, chunk);
                    remaining -= chunk;
                }
            }
        } catch (Exception ignored) {}
        f.delete();
    }

    private static void deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) deleteRecursive(c);
        } else {
            shredFile(f);
            return;
        }
        f.delete();
    }

    private static List<File> collectFiles(File dir) {
        List<File> result = new ArrayList<>();
        if (!dir.exists()) return result;
        File[] files = dir.listFiles();
        if (files == null) return result;
        for (File f : files) {
            if (f.isFile()) result.add(f);
            else result.addAll(collectFiles(f));
        }
        return result;
    }

    private static List<String> collectDirs(File baseDir, String relBase) {
        List<String> result = new ArrayList<>();
        if (!baseDir.exists()) return result;
        File[] items = baseDir.listFiles();
        if (items == null) return result;
        for (File item : items) {
            if (item.isDirectory()) {
                String rel = relBase.isEmpty() ? item.getName() : relBase + "/" + item.getName();
                result.add(rel);
                result.addAll(collectDirs(item, rel));
            }
        }
        return result;
    }

    private static void cleanTemp() {
        if (tempDir.exists()) deleteRecursive(tempDir);
    }

    // ── Simple data class ─────────────────────────────────────────────────────

    public static class FileEntry {
        public final String  name;
        public final String  path;
        public final boolean isDirectory;

        public FileEntry(String name, String path, boolean isDirectory) {
            this.name        = name;
            this.path        = path;
            this.isDirectory = isDirectory;
        }
    }
}
