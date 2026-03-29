# BurnerPad

Encrypted. Plain. Private.

A notepad app for Android with:
- Full encryption at rest (Android Keystore backed)
- PIN lock (numbers, letters, symbols — minimum 4 characters)
- Optional duress PIN that silently wipes everything and opens normally
- Plain text only — all rich formatting stripped on paste
- No ads, no cloud, no tracking, no network permissions
- Open source

---

## Setting up your development environment (complete beginner guide)

### Step 1 — Install prerequisites

You need three things on your computer:

**Node.js** (JavaScript runtime)
- Download from https://nodejs.org — get the LTS version
- Install it, then open a terminal and check: `node --version`

**Android Studio** (the Android development environment)
- Download from https://developer.android.com/studio
- During installation, make sure "Android SDK" and "Android Virtual Device" are checked
- After install, open Android Studio → More Actions → SDK Manager
- Under "SDK Platforms", install Android API 35
- Under "SDK Tools", make sure "Android SDK Build-Tools" is checked

**Java Development Kit (JDK)**
- Android Studio usually includes this. If not, install JDK 17 from https://adoptium.net

### Step 2 — Set environment variables

After installing Android Studio, you need to tell your terminal where the Android SDK is.

**On Mac/Linux**, add these lines to your `~/.bashrc` or `~/.zshrc`:
```
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```
Then run: `source ~/.bashrc`

**On Windows**, search for "Environment Variables" in the Start menu and add:
- Variable: `ANDROID_HOME`
- Value: `C:\Users\YourName\AppData\Local\Android\Sdk`

### Step 3 — Install project dependencies

Open a terminal in the BurnerPad folder and run:
```
npm install
```

This downloads all the libraries the app needs. It may take a few minutes.

### Step 4 — Install React Native CLI
```
npm install -g react-native-cli
```

### Step 5 — Start an Android emulator

In Android Studio:
- Click "More Actions" → "Virtual Device Manager"
- Click "Create Device"
- Choose a phone (e.g. Pixel 6), click Next
- Choose a system image (API 35), click Next, then Finish
- Press the ▶ play button to start the emulator

Wait for the emulator to fully boot (you'll see the Android home screen).

### Step 6 — Run BurnerPad

In your terminal, from the BurnerPad folder:
```
npx react-native run-android
```

This will build the app and install it on the emulator. The first build takes several minutes. Subsequent builds are faster.

### Step 7 — Running on a real phone (optional)

- Enable "Developer Options" on your Android phone:
  Settings → About Phone → tap "Build Number" 7 times
- Enable "USB Debugging" in Developer Options
- Connect your phone via USB
- Run `adb devices` to confirm it's detected
- Run `npx react-native run-android` — it will install on your phone

---

## Project structure

```
BurnerPad/
  App.js                          Entry point, navigation setup
  src/
    crypto/
      CryptoManager.js            Key generation, PIN hashing, encrypt/decrypt
    storage/
      StorageManager.js           Note file CRUD, wipe sequence
    screens/
      OnboardingScreen.js         First launch, PIN setup
      PinScreen.js                Lock screen (shown every launch)
      FileBrowserScreen.js        Note and folder list
      EditorScreen.js             Plain text editor
      SettingsScreen.js           Duress PIN setup
```

---

## Security notes

### What's production-ready
- Key storage via `react-native-encrypted-storage` uses Android Keystore under the hood. Keys never leave the secure hardware element on supported devices.
- The wipe sequence destroys the key BEFORE overwriting files. Even if the file deletion is interrupted, the encrypted blobs are cryptographically unreadable.
- The duress PIN trigger is indistinguishable from a normal correct PIN login.

### What needs upgrading before shipping
Two placeholders exist in `CryptoManager.js` that are clearly marked:

1. **Encryption**: The `encryptNote`/`decryptNote` functions use a XOR stream cipher. This is NOT secure. Replace with AES-256-GCM using `react-native-aes-crypto` or a native module.

2. **PIN hashing**: `stretchPin` uses iterative hashing, not a proper KDF. Replace with PBKDF2 or Argon2 via a native module.

3. **Random bytes**: `randomBytes` uses `Math.random()`. Add `react-native-get-random-values` and import it in `index.js` for a real CSPRNG.

These are straightforward to replace and the architecture is designed to make swapping them easy — they're isolated in `CryptoManager.js`.

---

## The Spaceballs reference

If you don't want a PIN, the onboarding screen suggests using `12345`. This is intentional. The combination to my luggage.

---

## License

MIT. Do whatever you want with it. It's just a notepad.
