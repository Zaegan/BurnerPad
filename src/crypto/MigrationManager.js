/**
 * MigrationManager.js
 *
 * Schema versioning and migration scaffolding for BurnerPad.
 *
 * Schema 1 (current — first versioned release):
 * - PIN verification: PBKDF2WithHmacSHA256, 100,000 iterations, 128-bit salt
 * - Encryption key derivation: PBKDF2WithHmacSHA256, same parameters
 * - File encryption: AES-256-CBC + HMAC-256
 * - Recovery files: mirror of notes tree in separate directory
 * - Autosave preference stored in EncryptedStorage
 * - Archive backup: PBKDF2 + AES-256-CBC with user-provided password
 * - Minimum PIN length: 5 characters
 *
 * There are no prior schema versions. Schema 1 is the baseline.
 */

import EncryptedStorage from 'react-native-encrypted-storage';

const CURRENT_SCHEMA = 1;
const SCHEMA_KEY     = 'burnerpad_schema_version';

const MigrationManager = {

  async getStoredSchema() {
    try {
      const val = await EncryptedStorage.getItem(SCHEMA_KEY);
      if (!val) return 0;
      return parseInt(val, 10) || 0;
    } catch {
      return 0;
    }
  },

  async setStoredSchema(version = CURRENT_SCHEMA) {
    await EncryptedStorage.setItem(SCHEMA_KEY, String(version));
  },

  async needsMigration() {
    const stored = await this.getStoredSchema();
    return stored < CURRENT_SCHEMA;
  },

  async runMigrations(context = {}) {
    // No migrations needed — schema 1 is the baseline.
    // Future migrations go here:
    //
    // const stored = await this.getStoredSchema();
    // if (stored < 2) {
    //   await this._migrate_1_to_2(context);
    // }

    await this.setStoredSchema(CURRENT_SCHEMA);
    return {needsPin: false};
  },

  CURRENT_SCHEMA,
  SCHEMA_KEY,
};

export default MigrationManager;
