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
- **Folders** — organize notes into subdirectories
- **Import / Export** — plaintext files via Android SAF; exports go to Downloads
- **Backup / Restore** — encrypted archive (AES-256-CBC, PBKDF2-derived key, 12+ char password) saved to Downloads
- **Schema versioning** — forward-compatible archive format with migration support
- **No-PIN mode** — set PIN to `12345` to skip the lock screen silently

---

## Security Architecture

BurnerPad uses a two-layer encryption model:

**Outer layer — Android Keystore**
Managed by `react-native-encrypted-storage`. Key material is stored in the Android Keystore, tied to the app's package name and signing certificate. This layer protects against extraction of key material from the device filesystem.

**Inner layer — AES-256-CBC + HMAC-SHA256**
Each note is encrypted with a key derived from the user's PIN using PBKDF2WithHmacSHA256 (100,000 iterations, 128-bit random salt per installation). Authentication is provided by HMAC-SHA256 over the ciphertext. This layer protects notes even if the outer layer is bypassed.

**Key derivation — `CryptoModule.kt`**
All cryptographic operations (PBKDF2, AES-256-CBC, HMAC-SHA256, secure random) are implemented as a native Android Kotlin module using `javax.crypto` exclusively. No third-party crypto libraries.

**Session key**
The PIN-derived session key is held in memory only. It is never written to disk. It is cleared when the app goes to the background, requiring PIN re-entry on return.

---

## Building

BurnerPad is a React Native 0.84.1 app for Android. There is no iOS support.

### Prerequisites

- x86-64 Linux (AAPT2 is x86-64 only — ARM build hosts are not supported)
- Node.js v20+ (via nvm recommended)
- Java 17 (`JAVA_HOME` must point to JDK 17)
- Android SDK with platform-tools, android-36, and build-tools/36.0.0 (`ANDROID_HOME` must be set)
- npx

### Build

Source files live in `BurnerPad/`. The build scaffold is generated fresh each time by the build script.

```bash
chmod +x rebuild_burnerpad.sh
./rebuild_burnerpad.sh
```

The APK will be at:
```
BurnerPadApp/android/app/build/outputs/apk/release/app-release.apk
```

`BurnerPadApp/` is in `.gitignore` — it is always regenerated and should never be committed.

---

## Repository Structure

```
BurnerPad/
├── rebuild_burnerpad.sh      # Build script
├── .gitignore
├── README.md
└── BurnerPad/                # Source files
    ├── App.js                # Entry point, AppState lock management
    ├── CryptoManager.js      # PIN/key/session management
    ├── MigrationManager.js   # Schema versioning
    ├── StorageManager.js     # Note CRUD, archive backup/restore
    ├── CryptoModule.kt       # Native Android crypto (PBKDF2, AES, HMAC)
    ├── CryptoPackage.kt      # React Native module registration
    ├── OnboardingScreen.js   # First launch PIN setup
    ├── PinScreen.js          # Lock screen
    ├── FileBrowserScreen.js  # Note and folder browser
    ├── EditorScreen.js       # Plain text editor
    └── SettingsScreen.js     # Autosave, PIN change, backup, duress PIN
```

---

## Important Warnings

- **There is no PIN recovery.** If you forget your PIN, a full reinstall is the only option and it destroys all notes.
- **The duress PIN permanently wipes all notes** when entered. There is no undo.
- **Backup archives are encrypted.** If you forget the archive password, the backup is unrecoverable.

---

## License

MIT
