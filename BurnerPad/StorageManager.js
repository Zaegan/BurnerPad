/**
 * StorageManager.js
 *
 * Handles all note file operations for BurnerPad.
 *
 * Notes:     <DocumentDirectoryPath>/notes/
 * Recovery:  <DocumentDirectoryPath>/recovery/
 *
 * NAMING: File names stored and displayed exactly as user provides.
 * No extensions forced on create, rename, import, or save as.
 * Export: if name has no '.', append '.txt' to avoid extension-less files.
 *
 * DRAFT SAFETY RULES:
 * - writeNote(): deletes any draft at target path before writing
 * - rename(): deletes any draft at new path before moving existing draft
 * - deleteNote(): deletes accompanying draft automatically
 *
 * ARCHIVE: preserves empty directories by listing them in schema.json
 */

import RNFS from 'react-native-fs';
import {zip, unzip} from 'react-native-zip-archive';
import CryptoManager from '../crypto/CryptoManager';
import MigrationManager from '../crypto/MigrationManager';

const NOTES_DIR    = `${RNFS.DocumentDirectoryPath}/notes`;
const RECOVERY_DIR = `${RNFS.DocumentDirectoryPath}/recovery`;
const TEMP_DIR     = `${RNFS.TemporaryDirectoryPath}/burnerpad_temp`;
const EXT          = '.bp';

// ── Path utilities ────────────────────────────────────────────────────────────

function normalizeDirPath(input) {
  if (typeof input !== 'string') throw new Error('Invalid path.');
  const trimmed = input.trim();
  if (!trimmed || /^\/+$/.test(trimmed)) return '';
  const collapsed = trimmed.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const components = collapsed.split('/');
  for (const component of components) {
    const c = component.trim();
    if (c === '')   throw new Error('Invalid path: empty component.');
    if (c === '.')  throw new Error('Invalid path: relative components not allowed.');
    if (c === '..') throw new Error('Invalid path: relative components not allowed.');
    if (c === '~')  throw new Error('Invalid path: relative components not allowed.');
    if (c.includes('\0')) throw new Error('Invalid path: null bytes not allowed.');
    if (c !== component) throw new Error('Invalid path: leading or trailing whitespace in component.');
  }
  return components.join('/');
}

function sanitizeName(input) {
  if (typeof input !== 'string') throw new Error('Invalid name.');
  const trimmed = input.trim();
  if (!trimmed)               throw new Error('Name cannot be empty.');
  if (/^\s+$/.test(trimmed)) throw new Error('Name cannot be whitespace only.');
  if (trimmed.includes('/'))  throw new Error('Name cannot contain slashes.');
  if (trimmed.includes('\\')) throw new Error('Name cannot contain backslashes.');
  if (trimmed.includes('\0')) throw new Error('Name cannot contain null bytes.');
  if (trimmed === '.')        throw new Error('Invalid name.');
  if (trimmed === '..')       throw new Error('Invalid name.');
  if (trimmed === '~')        throw new Error('Invalid name.');
  return trimmed;
}

function exportName(noteName) {
  return noteName.includes('.') ? noteName : `${noteName}.txt`;
}

function validateArchivePassword(password) {
  if (typeof password !== 'string') throw new Error('Invalid password.');
  if (password.includes("'"))       throw new Error("Password cannot contain single quotes.");
  if (password.includes('"'))       throw new Error('Password cannot contain double quotes.');
  if (password.includes('\\'))      throw new Error('Password cannot contain backslashes.');
  if (password.length < 12)         throw new Error('Password must be at least 12 characters.');
  if (!/[A-Z]/.test(password))      throw new Error('Password must contain at least one uppercase letter.');
  if (!/[a-z]/.test(password))      throw new Error('Password must contain at least one lowercase letter.');
  if (!/[0-9]/.test(password))      throw new Error('Password must contain at least one number.');
  if (!/[!@#$%^&*()\-_=+\[\]{}|;:<>.?/]/.test(password)) {
    throw new Error('Password must contain at least one symbol: !@#$%^&*()-_=+[]{}|;:<>.?/');
  }
  return true;
}

async function resolveCollision(relativePath) {
  const lastSlash = relativePath.lastIndexOf('/');
  const dir       = lastSlash >= 0 ? relativePath.slice(0, lastSlash) : '';
  const filename  = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;
  const dotIndex  = filename.lastIndexOf('.');
  const base      = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const ext       = dotIndex >= 0 ? filename.slice(dotIndex) : '';
  let n = 1;
  while (true) {
    const candidate = dir ? `${dir}/${base} (${n})${ext}` : `${base} (${n})${ext}`;
    if (!(await RNFS.exists(`${NOTES_DIR}/${candidate}${EXT}`))) return candidate;
    n++;
  }
}

// ── StorageManager ────────────────────────────────────────────────────────────

const StorageManager = {

  async ensureDir(dir) {
    if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
  },

  async listDir(relativePath = '') {
    const fullPath = relativePath ? `${NOTES_DIR}/${relativePath}` : NOTES_DIR;
    await this.ensureDir(fullPath);
    const items = await RNFS.readDir(fullPath);
    return items.map(item => ({
      name: item.isFile() ? item.name.replace(EXT, '') : item.name,
      path: relativePath
        ? `${relativePath}/${item.isFile() ? item.name.replace(EXT, '') : item.name}`
        : item.isFile() ? item.name.replace(EXT, '') : item.name,
      isDirectory: item.isDirectory(),
    }));
  },

  async exists(relativePath, isDirectory = false) {
    const fullPath = isDirectory
      ? `${NOTES_DIR}/${relativePath}`
      : `${NOTES_DIR}/${relativePath}${EXT}`;
    return await RNFS.exists(fullPath);
  },

  async validateTargetDir(userInput) {
    const normalized = normalizeDirPath(userInput);
    if (normalized === '') return '';
    const fullPath = `${NOTES_DIR}/${normalized}`;
    if (!(await RNFS.exists(fullPath))) throw new Error(`Directory "${normalized}" does not exist.`);
    const stat = await RNFS.stat(fullPath);
    if (!stat.isDirectory()) throw new Error(`"${normalized}" is not a directory.`);
    return normalized;
  },

  async readNote(relativePath) {
    const fullPath = `${NOTES_DIR}/${relativePath}${EXT}`;
    if (!(await RNFS.exists(fullPath))) return '';
    return await CryptoManager.decryptNote(await RNFS.readFile(fullPath, 'utf8'));
  },

  async writeNote(relativePath, plaintext) {
    await this.deleteShadow(relativePath);
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      await this.ensureDir(`${NOTES_DIR}/${parts.slice(0, -1).join('/')}`);
    }
    await RNFS.writeFile(
      `${NOTES_DIR}/${relativePath}${EXT}`,
      await CryptoManager.encryptNote(plaintext),
      'utf8',
    );
  },

  async deleteNote(relativePath) {
    const fullPath = `${NOTES_DIR}/${relativePath}${EXT}`;
    if (await RNFS.exists(fullPath)) {
      await RNFS.writeFile(fullPath, '0'.repeat(128), 'utf8');
      await RNFS.unlink(fullPath);
    }
    await this.deleteShadow(relativePath);
  },

  async createDirectory(relativePath) {
    const parts = relativePath.split('/');
    sanitizeName(parts[parts.length - 1]);
    await this.ensureDir(`${NOTES_DIR}/${relativePath}`);
  },

  async deleteDirectory(relativePath) {
    const fullPath = `${NOTES_DIR}/${relativePath}`;
    if (await RNFS.exists(fullPath)) await RNFS.unlink(fullPath);
  },

  async rename(oldRelativePath, newRelativePath, isDirectory = false) {
    const newParts = newRelativePath.split('/');
    sanitizeName(newParts[newParts.length - 1].replace(EXT, ''));

    const oldFull = isDirectory
      ? `${NOTES_DIR}/${oldRelativePath}`
      : `${NOTES_DIR}/${oldRelativePath}${EXT}`;
    const newFull = isDirectory
      ? `${NOTES_DIR}/${newRelativePath}`
      : `${NOTES_DIR}/${newRelativePath}${EXT}`;

    await RNFS.moveFile(oldFull, newFull);

    if (!isDirectory) {
      await this.deleteShadow(newRelativePath);
      await this.renameShadow(oldRelativePath, newRelativePath);
    }
  },

  async ensureShadowDir(relativePath) {
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      await this.ensureDir(`${RECOVERY_DIR}/${parts.slice(0, -1).join('/')}`);
    } else {
      await this.ensureDir(RECOVERY_DIR);
    }
  },

  async shadowExists(relativePath) {
    return await RNFS.exists(`${RECOVERY_DIR}/${relativePath}${EXT}`);
  },

  async readShadow(relativePath) {
    const fullPath = `${RECOVERY_DIR}/${relativePath}${EXT}`;
    if (!(await RNFS.exists(fullPath))) return '';
    return await CryptoManager.decryptNote(await RNFS.readFile(fullPath, 'utf8'));
  },

  async writeShadow(relativePath, plaintext) {
    await this.ensureShadowDir(relativePath);
    await RNFS.writeFile(
      `${RECOVERY_DIR}/${relativePath}${EXT}`,
      await CryptoManager.encryptNote(plaintext),
      'utf8',
    );
  },

  async deleteShadow(relativePath) {
    const fullPath = `${RECOVERY_DIR}/${relativePath}${EXT}`;
    if (await RNFS.exists(fullPath)) {
      await RNFS.writeFile(fullPath, '0'.repeat(128), 'utf8');
      await RNFS.unlink(fullPath);
    }
  },

  async renameShadow(oldRelativePath, newRelativePath) {
    const oldFull = `${RECOVERY_DIR}/${oldRelativePath}${EXT}`;
    if (await RNFS.exists(oldFull)) {
      await this.ensureShadowDir(newRelativePath);
      await RNFS.moveFile(oldFull, `${RECOVERY_DIR}/${newRelativePath}${EXT}`);
    }
  },

  async wipeAllNotes() {
    await this._wipeDir(NOTES_DIR);
    await this._wipeDir(RECOVERY_DIR);
  },

  async _wipeDir(dirPath) {
    if (!(await RNFS.exists(dirPath))) return;
    const items = await RNFS.readDir(dirPath);
    for (const item of items) {
      if (item.isFile()) {
        await RNFS.writeFile(item.path, '0'.repeat(128), 'utf8');
        await RNFS.unlink(item.path);
      } else {
        await this._wipeDir(item.path);
      }
    }
    await RNFS.unlink(dirPath);
  },

  async createDefaultNote() {
    await this.ensureDir(NOTES_DIR);
    await this.writeNote('untitled.txt', '');
  },

  async getExportData(relativePath, noteName) {
    const plaintext = await this.readNote(relativePath);
    return {plaintext, filename: exportName(noteName)};
  },

  async importNotePlaintext(targetPath, plaintext) {
    await this.writeNote(targetPath, plaintext);
  },

  // ── Collect all directories (including empty ones) ────────────────────────

  /**
   * Returns all relative directory paths under baseDir, including empty ones.
   */
  async _collectDirs(baseDir, relativeBase) {
    const results = [];
    if (!(await RNFS.exists(baseDir))) return results;
    const items = await RNFS.readDir(baseDir);
    for (const item of items) {
      if (item.isDirectory()) {
        const rel = relativeBase ? `${relativeBase}/${item.name}` : item.name;
        results.push(rel);
        const sub = await this._collectDirs(item.path, rel);
        results.push(...sub);
      }
    }
    return results;
  },

  // ── Archive backup ────────────────────────────────────────────────────────

  async createArchive(password) {
    validateArchivePassword(password);
    await this._cleanTemp();
    await this.ensureDir(TEMP_DIR);
    await this.ensureDir(`${TEMP_DIR}/notes`);
    await this.ensureDir(`${TEMP_DIR}/recovery`);

    // Collect all directories including empty ones
    const allDirs = await this._collectDirs(NOTES_DIR, '');

    // Collect all note files
    const noteFiles = await this._collectFiles(NOTES_DIR, '');

    const schema = {
      schema:      MigrationManager.CURRENT_SCHEMA,
      createdAt:   new Date().toISOString(),
      app:         'BurnerPad',
      directories: allDirs,  // preserve directory structure including empty dirs
    };
    await RNFS.writeFile(`${TEMP_DIR}/schema.json`, JSON.stringify(schema, null, 2), 'utf8');

    // Recreate directory structure in temp (including empty dirs)
    for (const dir of allDirs) {
      await this.ensureDir(`${TEMP_DIR}/notes/${dir}`);
    }

    // Write decrypted note files
    for (const {relativePath, fullPath} of noteFiles) {
      const plaintext = await CryptoManager.decryptNote(await RNFS.readFile(fullPath, 'utf8'));
      const outName   = relativePath.replace(/\.bp$/, '');
      const outPath   = `${TEMP_DIR}/notes/${outName}`;
      await this._ensureParentDir(outPath);
      await RNFS.writeFile(outPath, plaintext, 'utf8');
    }

    // Write paired draft files (orphaned drafts excluded)
    const draftFiles = await this._collectFiles(RECOVERY_DIR, '');
    for (const {relativePath, fullPath} of draftFiles) {
      if (!(await RNFS.exists(`${NOTES_DIR}/${relativePath}`))) continue;
      const plaintext = await CryptoManager.decryptNote(await RNFS.readFile(fullPath, 'utf8'));
      const outName   = relativePath.replace(/\.bp$/, '');
      const outPath   = `${TEMP_DIR}/recovery/${outName}`;
      await this._ensureParentDir(outPath);
      await RNFS.writeFile(outPath, plaintext, 'utf8');
    }

    const zipPath = `${RNFS.TemporaryDirectoryPath}/burnerpad_export.zip`;
    await zip(TEMP_DIR, zipPath);
    const encryptedZip = await CryptoManager.encryptArchive(
      await RNFS.readFile(zipPath, 'base64'),
      password,
    );
    const archivePath = `${RNFS.TemporaryDirectoryPath}/burnerpad_backup.bparchive`;
    await RNFS.writeFile(archivePath, encryptedZip, 'utf8');
    await this._cleanTemp();
    await RNFS.unlink(zipPath).catch(() => {});
    return archivePath;
  },

  async restoreArchive(archivePath, password, onConflict, onProgress) {
    let zipContent;
    try {
      zipContent = await CryptoManager.decryptArchive(
        await RNFS.readFile(archivePath, 'utf8'),
        password,
      );
    } catch {
      throw new Error('Incorrect password or corrupted archive.');
    }

    await this._cleanTemp();
    await this.ensureDir(TEMP_DIR);
    const zipPath = `${RNFS.TemporaryDirectoryPath}/burnerpad_restore.zip`;
    await RNFS.writeFile(zipPath, zipContent, 'base64');
    await unzip(zipPath, TEMP_DIR);

    const schemaPath = `${TEMP_DIR}/schema.json`;
    if (!(await RNFS.exists(schemaPath))) throw new Error('Invalid archive: missing schema.json.');
    const schema = JSON.parse(await RNFS.readFile(schemaPath, 'utf8'));
    if (schema.schema > MigrationManager.CURRENT_SCHEMA) {
      throw new Error(
        'This export file format is not supported. Please update BurnerPad to the most recent version.',
      );
    }

    // Restore directories first (including empty ones)
    const directories = schema.directories || [];
    for (const dir of directories) {
      await this.ensureDir(`${NOTES_DIR}/${dir}`);
    }

    const noteFiles      = await this._collectFiles(`${TEMP_DIR}/notes`, '');
    let globalResolution = null;

    for (const {relativePath} of noteFiles) {
      // Skip directory placeholder entries (no extension)
      const stat = await RNFS.stat(`${TEMP_DIR}/notes/${relativePath}`);
      if (stat.isDirectory()) continue;

      if (onProgress) onProgress(`Restoring ${relativePath}...`);

      const draftTempPath = `${TEMP_DIR}/recovery/${relativePath}`;
      const hasDraft      = await RNFS.exists(draftTempPath);
      const collision     = await this.exists(relativePath, false);

      let action       = 'replace';
      let resolvedPath = relativePath;

      if (collision) {
        const resolution = globalResolution
          ? {action: globalResolution, applyToAll: false}
          : await onConflict({path: relativePath});
        action = resolution.action;
        if (resolution.applyToAll) globalResolution = action;
      }

      if (action === 'skip') continue;
      if (action === 'rename') resolvedPath = await resolveCollision(relativePath);

      const plaintext = await RNFS.readFile(`${TEMP_DIR}/notes/${relativePath}`, 'utf8');
      await this.writeNote(resolvedPath, plaintext);

      if (hasDraft) {
        const draftPlaintext = await RNFS.readFile(draftTempPath, 'utf8');
        await this.writeShadow(resolvedPath, draftPlaintext);
      }
    }

    await this._cleanTemp();
    await RNFS.unlink(zipPath).catch(() => {});
  },

  async reEncryptAll(oldKey, newKey, onProgress) {
    const noteFiles  = await this._collectFiles(NOTES_DIR, '');
    const draftFiles = await this._collectFiles(RECOVERY_DIR, '');
    const total      = noteFiles.length + draftFiles.length;
    let done         = 0;

    for (const {fullPath} of [...noteFiles, ...draftFiles]) {
      const plaintext = await CryptoManager.decryptNoteWithKey(
        await RNFS.readFile(fullPath, 'utf8'), oldKey,
      );
      await RNFS.writeFile(
        fullPath,
        await CryptoManager.encryptNoteWithKey(plaintext, newKey),
        'utf8',
      );
      done++;
      if (onProgress) onProgress(done / total);
    }
  },

  async _collectFiles(baseDir, relativeBase) {
    const results = [];
    if (!(await RNFS.exists(baseDir))) return results;
    const items = await RNFS.readDir(baseDir);
    for (const item of items) {
      const rel = relativeBase ? `${relativeBase}/${item.name}` : item.name;
      if (item.isFile()) {
        results.push({relativePath: rel, fullPath: item.path});
      } else {
        results.push(...await this._collectFiles(item.path, rel));
      }
    }
    return results;
  },

  async _ensureParentDir(filePath) {
    const parts = filePath.split('/');
    parts.pop();
    await this.ensureDir(parts.join('/'));
  },

  async _cleanTemp() {
    if (await RNFS.exists(TEMP_DIR)) await RNFS.unlink(TEMP_DIR);
  },

  normalizeDirPath,
  sanitizeName,
  validateArchivePassword,
  resolveCollision,
  exportName,
};

export default StorageManager;
