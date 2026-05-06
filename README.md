# BurnerPad

**Encrypted. Plain. Private.**

BurnerPad is an open-source, plain-text notepad for Android with no ads, no cloud, no tracking, and no formatting. Your notes are encrypted on your device and unreadable without your PIN — even to us.

---

## Features

- **PIN-protected** — PBKDF2-derived encryption key, minimum 5 characters
- **Duress PIN** — a second PIN that silently wipes all notes and opens a blank app
- **Double encryption** — Android Keystore outer layer + AES-256-CBC inner layer
- **No cloud** — notes never leave your device
- **No formatting** — plain text only, rich formatting stripped on paste
- **Autosave** — optional; off by default, with shadow/recovery copies when disabled
- **Status bar** — optional word and character count footer in the editor
- **Folders** — organize notes into subdirectories
- **Import / Export** — plaintext files via Android SAF; exports go to Downloads
- **Backup / Restore** — encrypted archive (AES-256-CBC, PBKDF2-derived key, 12+ char password) saved to Downloads; compatible with archives from the original React Native version
- **No-PIN mode** — set PIN to `12345` to skip the lock screen silently
- **Themes** — dark, light, and system-default

---

## Security Architecture

BurnerPad uses a two-layer encryption model:

**Outer layer — Android Keystore**
Managed by `EncryptedSharedPreferences`. Key material is stored in the Android Keystore, tied to the app's package name and signing certificate. This layer protects against extraction of key material from the device filesystem.

**Inner layer — AES-256-CBC + HMAC-SHA256**
Each note is encrypted with a key derived from the user's PIN using PBKDF2WithHmacSHA256 (100,000 iterations, 128-bit random salt per installation). Authentication is provided by HMAC-SHA256 over the ciphertext. This layer protects notes even if the outer layer is bypassed.

**Key derivation — `CryptoManager.java`**
All cryptographic operations (PBKDF2, AES-256-CBC, HMAC-SHA256, secure random) are implemented in `javax.crypto` exclusively. No third-party crypto libraries.

**Session key**
The PIN-derived session key is held in memory only. It is never written to disk. It is cleared when the app goes to the background, requiring PIN re-entry on return.

---

## Building

BurnerPad is a native Android Java app. It is built using a remote build server that pulls from GitHub, scaffolds the Gradle project, and returns signed artifacts.

### Prerequisites

- x86-64 Linux build host (AAPT2 is x86-64 only — ARM build hosts are not supported)
- Python 3
- Java 17 (`JAVA_HOME` must point to JDK 17)
- Android SDK with platform-tools, android-36, and build-tools/36.0.0 (`ANDROID_HOME` must be set)
- imagemagick (`sudo apt install imagemagick`) for icon density generation

### Build

Push your changes to GitHub, then trigger a build:

```bash
python3 build_server.py --repo BurnerPad
```

Add `--clean` to force a full scaffold rebuild (required after dependency changes or when files are deleted).

Artifacts are produced at:
- `BurnerPad-<version>.apk` — unsigned release APK
- `BurnerPad-<version>-signed.apk` — debug-signed APK for sideload testing
- `BurnerPad-<version>.aab` — Android App Bundle for Play Store upload

The generated scaffold directory is outside the repo in `~/build_server/workspace/` and is never committed.

---

## Repository Structure

```
BurnerPad/
├── build.json                    # Build configuration (version, SDK, dependencies)
├── icon-512.png                  # Source icon (512×512, generates all density variants)
├── docs/
│   └── privacy.html              # Privacy policy (served via GitHub Pages)
└── app/src/main/
    ├── AndroidManifest.xml
    ├── java/com/github/zaegan/burnerpad/
    │   ├── MainActivity.java         # Cold-start router
    │   ├── PinActivity.java          # Lock screen
    │   ├── OnboardingActivity.java   # First-launch PIN setup
    │   ├── WalkthroughActivity.java  # Post-setup feature walkthrough
    │   ├── FileBrowserActivity.java  # Note and folder browser
    │   ├── EditorActivity.java       # Plain text editor with autosave
    │   ├── SettingsActivity.java     # Settings (theme, autosave, PIN, backup, duress)
    │   ├── BurnerPadApp.java         # Application class, background lock management
    │   ├── crypto/
    │   │   └── CryptoManager.java    # PBKDF2, AES-256-CBC, HMAC-SHA256, session key
    │   ├── storage/
    │   │   └── StorageManager.java   # Note CRUD, shadow/recovery, archive backup/restore
    │   ├── prefs/
    │   │   ├── PinManager.java       # PIN lifecycle, preferences
    │   │   └── SecurePrefs.java      # EncryptedSharedPreferences wrapper
    │   ├── theme/
    │   │   └── ThemeManager.java     # Theme application (dark/light/system)
    │   └── tutorial/
    │       └── TutorialManager.java  # In-app tutorial state and dismissal
    └── res/
        ├── layout/                   # Activity layouts
        ├── values/                   # Light theme colors, strings, attrs
        └── values-night/             # Dark theme colors
```

---

## Important Warnings

- **There is no PIN recovery.** If you forget your PIN, a full reinstall is the only option and it destroys all notes.
- **The duress PIN permanently wipes all notes** when entered. There is no undo.
- **Backup archives are encrypted.** If you forget the archive password, the backup is unrecoverable.

---

## License

MIT
