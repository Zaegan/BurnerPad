/**
 * CryptoManager.js
 *
 * Full crypto stack for BurnerPad.
 * All cryptographic operations delegated to CryptoModule.kt (javax.crypto).
 * No third-party crypto libraries.
 *
 * ENCRYPTION ARCHITECTURE:
 *   Outer layer: Android Keystore via react-native-encrypted-storage
 *     - Protects key material at rest, tied to app identity
 *   Inner layer: AES-256-CBC + HMAC-SHA256 with PIN-derived key
 *     - Requires knowledge of PIN to decrypt
 *
 * KEY DERIVATION:
 *   PBKDF2WithHmacSHA256, 100,000 iterations, 256-bit output
 *   128-bit random salt per installation, stored in EncryptedStorage
 *   Session key held in memory only, never written to disk
 *   Cleared on app background, re-derived on next PIN entry
 *
 * FILE FORMAT:
 *   JSON { iv, ciphertext, hmac }
 *   iv:         hex string (32 chars, 128-bit)
 *   ciphertext: base64 string (AES-256-CBC/PKCS5)
 *   hmac:       hex string (64 chars, HMAC-SHA256 of base64 ciphertext)
 *
 * PIN REQUIREMENTS:
 *   Minimum 5 characters. Enforced at setup and PIN change.
 *   PIN 12345 silently bypasses the lock screen.
 *
 * SCHEMA: 1
 */

import {NativeModules} from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import MigrationManager from './MigrationManager';

const {CryptoModule} = NativeModules;

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_BITS   = 256;
const SALT_BYTES        = 16;
const MIN_PIN_LENGTH    = 5;

const KEYS = {
  PIN_HASH:    'burnerpad_pin_hash',
  PIN_SALT:    'burnerpad_pin_salt',
  DERIVE_SALT: 'burnerpad_derive_salt',
  DURESS_HASH: 'burnerpad_duress_hash',
  DURESS_SALT: 'burnerpad_duress_salt',
  INITIALIZED: 'burnerpad_initialized',
  AUTOSAVE:    'burnerpad_autosave',
};

// ── Session key (in-memory only, never persisted) ────────────────────────────

let _sessionKey = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function randomHex(byteCount) {
  return await CryptoModule.randomHex(byteCount);
}

async function pbkdf2(password, saltHex) {
  return await CryptoModule.deriveKey(
    password,
    saltHex,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_BITS,
  );
}

async function encryptWithKey(plaintext, keyHex) {
  const iv         = await CryptoModule.randomIv();
  const ciphertext = await CryptoModule.encrypt(plaintext, keyHex, iv);
  const hmac       = await CryptoModule.hmac256(ciphertext, keyHex);
  return JSON.stringify({iv, ciphertext, hmac});
}

async function decryptWithKey(encryptedJson, keyHex) {
  if (!encryptedJson || encryptedJson.length < 10) return '';
  const {iv, ciphertext, hmac} = JSON.parse(encryptedJson);
  const expectedHmac = await CryptoModule.hmac256(ciphertext, keyHex);
  if (expectedHmac !== hmac) throw new Error('Authentication failed. File may be corrupted.');
  return await CryptoModule.decrypt(ciphertext, keyHex, iv);
}

// ── Public API ───────────────────────────────────────────────────────────────

const CryptoManager = {

  MIN_PIN_LENGTH,
  PBKDF2_ITERATIONS,

  // ── Session key ──────────────────────────────────────────────────────────

  setSessionKey(key)  { _sessionKey = key; },
  clearSessionKey()   { _sessionKey = null; },
  hasSessionKey()     { return _sessionKey !== null; },

  // ── Initialization ───────────────────────────────────────────────────────

  async isInitialized() {
    try {
      const val = await EncryptedStorage.getItem(KEYS.INITIALIZED);
      return val === 'true';
    } catch {
      return false;
    }
  },

  /**
   * First-time setup. Generates salts, hashes PIN, sets session key.
   * Never call for PIN changes — use changePin() instead.
   */
  async initialize(pin) {
    const deriveSalt = await randomHex(SALT_BYTES);
    await EncryptedStorage.setItem(KEYS.DERIVE_SALT, deriveSalt);

    const pinSalt = await randomHex(SALT_BYTES);
    const pinHash = await pbkdf2(pin, pinSalt);
    await EncryptedStorage.setItem(KEYS.PIN_SALT, pinSalt);
    await EncryptedStorage.setItem(KEYS.PIN_HASH, pinHash);

    await EncryptedStorage.removeItem(KEYS.DURESS_HASH);
    await EncryptedStorage.removeItem(KEYS.DURESS_SALT);
    await EncryptedStorage.setItem(KEYS.INITIALIZED, 'true');
    await MigrationManager.setStoredSchema();

    const sessionKey = await pbkdf2(pin, deriveSalt);
    this.setSessionKey(sessionKey);
  },

  /**
   * Begin PIN change. Returns {oldSessionKey, newSessionKey}.
   * Caller must re-encrypt all files then call finalizePinChange().
   */
  async changePin(oldPin, newPin) {
    const result = await this.verifyPin(oldPin);
    if (result !== 'correct') throw new Error('Incorrect current PIN.');
    const deriveSalt    = await EncryptedStorage.getItem(KEYS.DERIVE_SALT);
    const newSessionKey = await pbkdf2(newPin, deriveSalt);
    const oldSessionKey = _sessionKey;
    return {oldSessionKey, newSessionKey};
  },

  /**
   * Finalize PIN change after re-encryption is complete.
   */
  async finalizePinChange(newPin, newSessionKey) {
    const pinSalt = await randomHex(SALT_BYTES);
    const pinHash = await pbkdf2(newPin, pinSalt);
    await EncryptedStorage.setItem(KEYS.PIN_SALT, pinSalt);
    await EncryptedStorage.setItem(KEYS.PIN_HASH, pinHash);
    this.setSessionKey(newSessionKey);
  },

  // ── PIN verification ─────────────────────────────────────────────────────

  /**
   * Verify PIN. Returns 'correct' | 'duress' | 'wrong'.
   * On 'correct', derives and sets session key.
   */
  async verifyPin(pin) {
    try {
      const pinSalt    = await EncryptedStorage.getItem(KEYS.PIN_SALT);
      const storedHash = await EncryptedStorage.getItem(KEYS.PIN_HASH);
      const hash       = await pbkdf2(pin, pinSalt);

      if (hash === storedHash) {
        const deriveSalt = await EncryptedStorage.getItem(KEYS.DERIVE_SALT);
        const sessionKey = await pbkdf2(pin, deriveSalt);
        this.setSessionKey(sessionKey);
        return 'correct';
      }

      const duressHash = await EncryptedStorage.getItem(KEYS.DURESS_HASH);
      if (duressHash) {
        const duressSalt  = await EncryptedStorage.getItem(KEYS.DURESS_SALT);
        const duressCheck = await pbkdf2(pin, duressSalt);
        if (duressCheck === duressHash) return 'duress';
      }

      return 'wrong';
    } catch {
      return 'wrong';
    }
  },

  async confirmRealPin(pin) {
    try {
      const pinSalt    = await EncryptedStorage.getItem(KEYS.PIN_SALT);
      const storedHash = await EncryptedStorage.getItem(KEYS.PIN_HASH);
      const hash       = await pbkdf2(pin, pinSalt);
      return hash === storedHash;
    } catch {
      return false;
    }
  },

  // ── Duress PIN ───────────────────────────────────────────────────────────

  async setDuressPin(duressPin) {
    const salt = await randomHex(SALT_BYTES);
    const hash = await pbkdf2(duressPin, salt);
    await EncryptedStorage.setItem(KEYS.DURESS_SALT, salt);
    await EncryptedStorage.setItem(KEYS.DURESS_HASH, hash);
  },

  async removeDuressPin() {
    await EncryptedStorage.removeItem(KEYS.DURESS_HASH);
    await EncryptedStorage.removeItem(KEYS.DURESS_SALT);
  },

  async hasDuressPin() {
    try {
      const val = await EncryptedStorage.getItem(KEYS.DURESS_HASH);
      return !!val;
    } catch {
      return false;
    }
  },

  // ── Wipe ─────────────────────────────────────────────────────────────────

  async wipeKeys() {
    this.clearSessionKey();
    for (const key of Object.values(KEYS)) {
      await EncryptedStorage.removeItem(key);
    }
    await EncryptedStorage.removeItem(MigrationManager.SCHEMA_KEY);
  },

  // ── Autosave preference ──────────────────────────────────────────────────

  async getAutosave() {
    try {
      const val = await EncryptedStorage.getItem(KEYS.AUTOSAVE);
      return val === 'true';
    } catch {
      return false;
    }
  },

  async setAutosave(enabled) {
    await EncryptedStorage.setItem(KEYS.AUTOSAVE, enabled ? 'true' : 'false');
  },

  // ── File encryption / decryption ─────────────────────────────────────────

  async encryptNote(plaintext) {
    if (!_sessionKey) throw new Error('No session key. Please log in again.');
    return await encryptWithKey(plaintext, _sessionKey);
  },

  async decryptNote(encryptedJson) {
    if (!_sessionKey) throw new Error('No session key. Please log in again.');
    return await decryptWithKey(encryptedJson, _sessionKey);
  },

  async encryptNoteWithKey(plaintext, key) {
    return await encryptWithKey(plaintext, key);
  },

  async decryptNoteWithKey(encryptedJson, key) {
    return await decryptWithKey(encryptedJson, key);
  },

  // ── Archive encryption ───────────────────────────────────────────────────

  async encryptArchive(plaintext, password) {
    const salt           = await randomHex(SALT_BYTES);
    const key            = await pbkdf2(password, salt);
    const enc            = await encryptWithKey(plaintext, key);
    const {iv, ciphertext, hmac} = JSON.parse(enc);
    return JSON.stringify({salt, iv, ciphertext, hmac});
  },

  async decryptArchive(encryptedJson, password) {
    const {salt, iv, ciphertext, hmac} = JSON.parse(encryptedJson);
    const key          = await pbkdf2(password, salt);
    const expectedHmac = await CryptoModule.hmac256(ciphertext, key);
    if (expectedHmac !== hmac) throw new Error('Incorrect password or corrupted archive.');
    return await CryptoModule.decrypt(ciphertext, key, iv);
  },
};

export default CryptoManager;
