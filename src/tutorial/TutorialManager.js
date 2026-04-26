/**
 * TutorialManager.js
 *
 * Tracks which tutorial overlays have been seen.
 * Stored in EncryptedStorage, separate from crypto keys.
 *
 * States:
 *   declined: true  — user chose "decline all"; no tutorials shown ever again
 *   <id>: true      — that specific tutorial has been completed/skipped
 */

import EncryptedStorage from 'react-native-encrypted-storage';

const KEY = 'burnerpad_tutorials';

export const TUTORIALS = {
  SETTINGS_INTRO: 'settings_intro',
};

async function load() {
  try {
    const raw = await EncryptedStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function save(data) {
  await EncryptedStorage.setItem(KEY, JSON.stringify(data));
}

export async function shouldShow(id) {
  const data = await load();
  if (data.declined) return false;
  return !data[id];
}

export async function markDone(id) {
  const data = await load();
  data[id] = true;
  await save(data);
}

export async function declineAll() {
  const data = await load();
  data.declined = true;
  await save(data);
}
