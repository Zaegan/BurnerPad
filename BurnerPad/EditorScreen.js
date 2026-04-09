/**
 * EditorScreen.js
 *
 * Plain text note editor.
 *
 * SCROLLING ARCHITECTURE:
 * - TextInput: scrollEnabled={false}, grows to full content height via onContentSizeChange
 * - ScrollView: wraps TextInput, handles all momentum scrolling
 * - KeyboardAvoidingView: shrinks viewport when keyboard appears
 * - Android natively scrolls the ScrollView to keep the cursor visible when typing
 *   (this is the correct behavior — we do NOT override it with manual calculations)
 * - BOTTOM_SPACER allows scrolling last line to top of screen
 *
 * UNSAVED CHANGES DIALOG ORDER:
 *   Save and exit  →  Exit and delete draft  →  Cancel
 *
 * SESSION KEY ERRORS:
 * - beforeRemove and goUp() check hasSessionKey() first
 * - If no key, navigate immediately without showing unsaved dialog
 * - requirePin() is called to force re-login
 */

import React, {useState, useEffect, useRef} from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, TouchableWithoutFeedback,
  Alert, Modal, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import RNFS from 'react-native-fs';
import StorageManager from '../storage/StorageManager';
import CryptoManager from '../crypto/CryptoManager';
import {requirePin, registerBeforeLock, unregisterBeforeLock} from '../../App';

const SHADOW_DELAY   = 3000;
const AUTOSAVE_DELAY = 800;
// Extra space below content so the last line can scroll near the top of the screen
const BOTTOM_SPACER  = 500;

function dirOf(filePath) {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function isSessionError(e) {
  const msg = e?.message || String(e);
  return msg.includes('session key') || msg.includes('session');
}

export default function EditorScreen({navigation, route}) {
  const {notePath, noteName: initialName} = route.params;

  const [noteName, setNoteName]   = useState(initialName);
  const [content, setContent]     = useState('');
  const [isLoaded, setIsLoaded]   = useState(false);
  const [autosave, setAutosave]   = useState(false);
  const [isSaving, setIsSaving]   = useState(false);
  const [isDirty, setIsDirty]     = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameName, setRenameName]       = useState('');
  const [renameError, setRenameError]     = useState('');
  const [isRenaming, setIsRenaming]       = useState(false);

  const [saveAsVisible, setSaveAsVisible] = useState(false);
  const [saveAsName, setSaveAsName]       = useState('');
  const [saveAsDir, setSaveAsDir]         = useState('');
  const [saveAsOrigDir, setSaveAsOrigDir] = useState('');
  const [saveAsError, setSaveAsError]     = useState('');
  const [isSavingAs, setIsSavingAs]       = useState(false);

  const saveTimer     = useRef(null);
  const shadowTimer   = useRef(null);
  const latestContent = useRef('');
  const latestPath    = useRef(notePath);
  const isDirtyRef    = useRef(false);
  const autosaveRef   = useRef(false);

  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { autosaveRef.current = autosave; }, [autosave]);

  // ── Flush shadow before app locks (AppState: active → inactive/background) ─
  // Runs before App.js clears the session key, ensuring unsaved edits are
  // captured even if the shadow debounce timer hasn't fired yet.

  useEffect(() => {
    registerBeforeLock(async () => {
      if (isDirtyRef.current && !autosaveRef.current) {
        if (shadowTimer.current) clearTimeout(shadowTimer.current);
        try { await StorageManager.writeShadow(latestPath.current, latestContent.current); } catch {}
      }
    });
    return () => unregisterBeforeLock();
  }, []);

  // ── Unsaved changes dialog ────────────────────────────────────────────────
  // Order: Save and exit / Exit and delete draft / Cancel
  // No style hints that would let Android reorder buttons.

  function showUnsavedDialog({onSaveAndExit, onDiscardAndExit}) {
    Alert.alert(
      'Unsaved changes',
      'Turn on autosave in settings to prevent these prompts.',
      [
        {text: 'Save and exit',         onPress: onSaveAndExit},
        {text: 'Exit and delete draft',  onPress: onDiscardAndExit},
        {text: 'Cancel',                 onPress: undefined},
      ],
    );
  }

  // ── Up navigation ─────────────────────────────────────────────────────────

  function goUp() {
    const targetDir = dirOf(latestPath.current);

    // If no session key, go straight to PIN without asking about unsaved changes
    if (!CryptoManager.hasSessionKey()) {
      requirePin();
      return;
    }

    if (!isDirtyRef.current || autosaveRef.current) {
      navigation.navigate('FileBrowser', {path: targetDir});
      return;
    }

    showUnsavedDialog({
      onSaveAndExit: async () => {
        try {
          await StorageManager.writeNote(latestPath.current, latestContent.current);
          await StorageManager.deleteShadow(latestPath.current);
          navigation.navigate('FileBrowser', {path: targetDir});
        } catch (e) {
          if (isSessionError(e)) {
            Alert.alert('Session expired', 'Your session has expired.', [{text: 'Log in', onPress: requirePin}]);
          } else {
            Alert.alert('Save failed', e.message || String(e));
          }
        }
      },
      onDiscardAndExit: async () => {
        await StorageManager.deleteShadow(latestPath.current);
        navigation.navigate('FileBrowser', {path: targetDir});
      },
    });
  }

  // ── System back button exit guard ─────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      // If no session key, let navigation proceed — PIN will handle it
      if (!CryptoManager.hasSessionKey()) return;
      if (!isDirtyRef.current || autosaveRef.current) return;

      e.preventDefault();
      showUnsavedDialog({
        onSaveAndExit: async () => {
          try {
            await StorageManager.writeNote(latestPath.current, latestContent.current);
            await StorageManager.deleteShadow(latestPath.current);
          } catch (err) {
            if (isSessionError(err)) {
              Alert.alert('Session expired', 'Your session has expired.', [{text: 'Log in', onPress: requirePin}]);
            } else {
              Alert.alert('Save failed', err.message || String(err));
            }
            return;
          }
          navigation.dispatch(e.data.action);
        },
        onDiscardAndExit: async () => {
          await StorageManager.deleteShadow(latestPath.current);
          navigation.dispatch(e.data.action);
        },
      });
    });
    return unsubscribe;
  }, [navigation]);

  // ── Load note ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const autosaveEnabled = await CryptoManager.getAutosave();
        setAutosave(autosaveEnabled);
        autosaveRef.current = autosaveEnabled;

        const hasShadow = await StorageManager.shadowExists(notePath);
        if (hasShadow) {
          Alert.alert(
            'Recovery file detected',
            autosaveEnabled
              ? 'A recovery version of this note exists. Apply it or discard it?'
              : 'A recovery version of this note exists. Open it, or discard it and open the last saved version?',
            [
              {
                text: autosaveEnabled ? 'Apply recovery' : 'Open recovery',
                onPress: async () => {
                  const text = await StorageManager.readShadow(notePath);
                  if (autosaveEnabled) {
                    await StorageManager.writeNote(notePath, text);
                    await StorageManager.deleteShadow(notePath);
                  } else {
                    setIsDirty(true);
                    isDirtyRef.current = true;
                  }
                  setContent(text);
                  latestContent.current = text;
                  setIsLoaded(true);
                },
              },
              {
                text: 'Discard recovery',
                onPress: async () => {
                  await StorageManager.deleteShadow(notePath);
                  const text = await StorageManager.readNote(notePath);
                  setContent(text);
                  latestContent.current = text;
                  setIsLoaded(true);
                },
              },
            ],
            {cancelable: false},
          );
        } else {
          const text = await StorageManager.readNote(notePath);
          setContent(text);
          latestContent.current = text;
          setIsLoaded(true);
        }
      } catch (e) {
        if (isSessionError(e)) {
          Alert.alert('Session expired', 'Your session has expired.', [{text: 'Log in', onPress: requirePin}]);
        } else {
          Alert.alert('Error', e.message || String(e));
        }
        navigation.goBack();
      }
    })();
    return () => {
      if (saveTimer.current)   clearTimeout(saveTimer.current);
      if (shadowTimer.current) clearTimeout(shadowTimer.current);
    };
  }, []);

  // ── Editing ───────────────────────────────────────────────────────────────

  function handleChange(text) {
    const stripped = stripFormattingCharacters(text);
    setContent(stripped);
    latestContent.current = stripped;
    setIsDirty(true);
    isDirtyRef.current = true;

    if (autosaveRef.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setIsSaving(true);
      saveTimer.current = setTimeout(async () => {
        try { await StorageManager.writeNote(latestPath.current, stripped); } catch {}
        setIsSaving(false);
      }, AUTOSAVE_DELAY);
    } else {
      if (shadowTimer.current) clearTimeout(shadowTimer.current);
      shadowTimer.current = setTimeout(async () => {
        try { await StorageManager.writeShadow(latestPath.current, stripped); } catch {}
      }, SHADOW_DELAY);
    }
  }

  async function handleSave() {
    if (saveTimer.current)   clearTimeout(saveTimer.current);
    if (shadowTimer.current) clearTimeout(shadowTimer.current);
    setIsSaving(true);
    try {
      await StorageManager.writeNote(latestPath.current, latestContent.current);
      await StorageManager.deleteShadow(latestPath.current);
      setIsDirty(false);
      isDirtyRef.current = false;
    } catch (e) {
      if (isSessionError(e)) {
        Alert.alert('Session expired', 'Your session has expired.', [{text: 'Log in', onPress: requirePin}]);
      } else {
        Alert.alert('Save failed', e.message || String(e));
      }
    } finally {
      setIsSaving(false);
    }
  }

  // ── ... menu actions ──────────────────────────────────────────────────────

  function menuSaveAs() {
    setMenuVisible(false);
    const dir = dirOf(latestPath.current);
    setSaveAsName(noteName);
    setSaveAsDir(dir);
    setSaveAsOrigDir(dir);
    setSaveAsError('');
    setSaveAsVisible(true);
  }

  async function menuExport() {
    setMenuVisible(false);
    try {
      const {plaintext, filename} = await StorageManager.getExportData(latestPath.current, noteName);
      const destPath = `${RNFS.DownloadDirectoryPath}/${filename}`;
      let finalPath  = destPath;
      if (await RNFS.exists(destPath)) {
        const dotIndex = filename.lastIndexOf('.');
        const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
        const ext  = dotIndex >= 0 ? filename.slice(dotIndex) : '';
        let n = 1;
        while (await RNFS.exists(`${RNFS.DownloadDirectoryPath}/${base} (${n})${ext}`)) n++;
        finalPath = `${RNFS.DownloadDirectoryPath}/${base} (${n})${ext}`;
      }
      await RNFS.writeFile(finalPath, plaintext, 'utf8');
      Alert.alert('Exported', `Saved to Downloads as "${finalPath.split('/').pop()}".`);
    } catch (e) {
      if (isSessionError(e)) {
        Alert.alert('Session expired', 'Your session has expired.', [{text: 'Log in', onPress: requirePin}]);
      } else {
        Alert.alert('Export failed', e.message || String(e));
      }
    }
  }

  function menuRename() {
    setMenuVisible(false);
    setRenameName(noteName);
    setRenameError('');
    setRenameVisible(true);
  }

  function menuDelete() {
    setMenuVisible(false);
    Alert.alert(
      'Delete this note?',
      'This cannot be undone.',
      [
        {
          text: 'Delete',
          onPress: async () => {
            try {
              const dir = dirOf(latestPath.current);
              await StorageManager.deleteNote(latestPath.current);
              navigation.navigate('FileBrowser', {path: dir});
            } catch (e) {
              Alert.alert('Delete failed', e.message || String(e));
            }
          },
        },
        {text: 'Cancel'},
      ],
    );
  }

  // ── Save As ───────────────────────────────────────────────────────────────

  async function confirmSaveAs() {
    if (!saveAsName.trim() || isSavingAs) return;
    setSaveAsError('');
    let name;
    try { name = StorageManager.sanitizeName(saveAsName); }
    catch (e) { setSaveAsError(e.message); return; }

    let targetDir;
    try { targetDir = await StorageManager.validateTargetDir(saveAsDir); }
    catch (e) { setSaveAsError(e.message); return; }

    const newPath = targetDir ? `${targetDir}/${name}` : name;
    if (await StorageManager.exists(newPath, false)) {
      setSaveAsError('A note with that name already exists in that location.');
      return;
    }

    setIsSavingAs(true);
    try {
      await StorageManager.writeNote(newPath, latestContent.current);
      latestPath.current = newPath;
      setNoteName(name);
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveAsVisible(false);
    } catch { setSaveAsError('Could not save. Try a different name or location.'); }
    finally { setIsSavingAs(false); }
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  async function handleRename() {
    if (!renameName.trim() || isRenaming) return;
    setRenameError('');
    let newName;
    try { newName = StorageManager.sanitizeName(renameName); }
    catch (e) { setRenameError(e.message); return; }

    if (newName === noteName) { setRenameVisible(false); return; }

    const parts = latestPath.current.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');

    if (await StorageManager.exists(newPath, false)) {
      setRenameError('A note with that name already exists.');
      return;
    }

    setIsRenaming(true);
    try {
      await StorageManager.rename(latestPath.current, newPath, false);
      latestPath.current = newPath;
      setNoteName(newName);
      setRenameVisible(false);
    } catch (e) { setRenameError(e.message || 'Invalid name.'); }
    finally { setIsRenaming(false); }
  }

  function stripFormattingCharacters(text) {
    return text
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\uFFFC]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .replace(/<[^>]*>/g, '');
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goUp} style={styles.upBtn}>
          <Text style={styles.upBtnText}>↑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleContainer} onLongPress={menuRename} delayLongPress={500}>
          <Text style={styles.title} numberOfLines={1}>{noteName}</Text>
        </TouchableOpacity>
        {autosave ? (
          <Text style={styles.autosavedLabel}>{isSaving ? 'saving…' : 'autosaved'}</Text>
        ) : (
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={isSaving}>
            <Text style={styles.saveBtnText}>{isSaving ? '…' : 'save'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuVisible(true)}>
          <Text style={styles.menuBtnText}>···</Text>
        </TouchableOpacity>
      </View>

      {/* Scrollable editor — ScrollView provides momentum scrolling,
          TextInput grows to full content height so scroll is independent of cursor */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        decelerationRate="normal">
        {isLoaded && (
          <TextInput
            style={styles.editor}
            value={content}
            onChangeText={handleChange}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={true}
            spellCheck={true}
            placeholder="start typing…"
            placeholderTextColor="#2a2a2a"
            disableFullscreenUI={true}
          />
        )}
        {/* Allows last line to scroll toward top of screen */}
        <View style={{height: BOTTOM_SPACER}} />
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount} {charCount === 1 ? 'char' : 'chars'}
        </Text>
        <Text style={styles.footerText}>{isDirty && !autosave ? 'unsaved' : 'plain text'}</Text>
      </View>

      {/* ... Dropdown menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
          <View style={styles.menuOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menuBox}>
                {[
                  {label: 'Save As', onPress: menuSaveAs},
                  {label: 'Export',  onPress: menuExport},
                  {label: 'Rename',  onPress: menuRename},
                  {label: 'Delete',  onPress: menuDelete, danger: true},
                ].map((item, i) => (
                  <View key={item.label}>
                    {i > 0 && <View style={styles.menuDivider} />}
                    <TouchableOpacity style={styles.menuItem} onPress={item.onPress}>
                      <Text style={[styles.menuItemText, item.danger && styles.menuItemDanger]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Rename modal */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Rename note</Text>
            <TextInput
              style={styles.modalInput}
              value={renameName}
              onChangeText={text => {setRenameName(text); setRenameError('');}}
              autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            {renameError ? <Text style={styles.modalError}>{renameError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setRenameVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRename} style={styles.modalBtn} disabled={isRenaming}>
                <Text style={styles.modalBtnText}>{isRenaming ? '...' : 'rename'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Save As modal */}
      <Modal visible={saveAsVisible} transparent animationType="fade" onRequestClose={() => setSaveAsVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Save as</Text>
            <Text style={styles.fieldLabel}>Filename</Text>
            <TextInput
              style={styles.modalInput}
              value={saveAsName}
              onChangeText={text => {setSaveAsName(text); setSaveAsError('');}}
              autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="next"
            />
            <View style={styles.dirRow}>
              <Text style={styles.fieldLabel}>Directory</Text>
              <TouchableOpacity onPress={() => {setSaveAsDir(saveAsOrigDir); setSaveAsError('');}}>
                <Text style={styles.resetBtnText}>reset</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              value={saveAsDir}
              onChangeText={text => {setSaveAsDir(text); setSaveAsError('');}}
              placeholder="leave empty for root"
              placeholderTextColor="#333"
              autoCapitalize="none" autoCorrect={false} returnKeyType="done"
              onSubmitEditing={confirmSaveAs}
            />
            <Text style={styles.dirHint}>
              Type path to an existing folder (e.g. work/notes). Leave empty for root.
            </Text>
            {saveAsError ? <Text style={styles.modalError}>{saveAsError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setSaveAsVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmSaveAs} style={styles.modalBtn} disabled={isSavingAs}>
                <Text style={styles.modalBtnText}>{isSavingAs ? '...' : 'save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      {flex: 1, backgroundColor: '#0d0d0d'},
  header:         {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#141414', gap: 10},
  upBtn:          {paddingRight: 4},
  upBtnText:      {color: '#555', fontSize: 20, fontFamily: 'Courier New'},
  titleContainer: {flex: 1},
  title:          {color: '#777', fontSize: 13, fontFamily: 'Courier New', letterSpacing: 2},
  autosavedLabel: {color: '#2a2a2a', fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
  saveBtn:        {paddingVertical: 4, paddingHorizontal: 2},
  saveBtnText:    {color: '#555', fontSize: 12, fontFamily: 'Courier New', letterSpacing: 1},
  menuBtn:        {paddingVertical: 4, paddingHorizontal: 4},
  menuBtnText:    {color: '#555', fontSize: 16, letterSpacing: 2, fontFamily: 'Courier New'},
  scrollView:     {flex: 1},
  scrollContent:  {flexGrow: 1},
  editor:         {
    flex: 1,
    color: '#d8d8d8',
    fontSize: 15,
    lineHeight: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
    fontFamily: 'Courier New',
    letterSpacing: 0.3,
    // No fixed height — grows with content
    minHeight: '100%',
  },
  footer:         {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#141414'},
  footerText:     {color: '#2a2a2a', fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
  menuOverlay:    {flex: 1, backgroundColor: 'transparent'},
  menuBox:        {position: 'absolute', top: 100, right: 16, backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', minWidth: 140, elevation: 8},
  menuItem:       {paddingVertical: 14, paddingHorizontal: 20},
  menuItemText:   {color: '#c0c0c0', fontSize: 13, fontFamily: 'Courier New', letterSpacing: 1},
  menuItemDanger: {color: '#7a3a3a'},
  menuDivider:    {height: 1, backgroundColor: '#1e1e1e'},
  modalOverlay:   {flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', paddingHorizontal: 32},
  modalBox:       {backgroundColor: '#111', padding: 28, borderWidth: 1, borderColor: '#1e1e1e'},
  modalTitle:     {color: '#555', fontSize: 11, letterSpacing: 3, fontFamily: 'Courier New', marginBottom: 16},
  fieldLabel:     {color: '#444', fontSize: 11, letterSpacing: 1, fontFamily: 'Courier New', marginBottom: 6, marginTop: 12},
  dirRow:         {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 6},
  resetBtnText:   {color: '#444', fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
  dirHint:        {color: '#2a2a2a', fontSize: 10, fontFamily: 'Courier New', lineHeight: 16, marginTop: 6},
  modalInput:     {borderBottomWidth: 1, borderBottomColor: '#2a2a2a', color: '#e8e8e8', fontSize: 15, paddingVertical: 8, fontFamily: 'Courier New', marginBottom: 4},
  modalError:     {color: '#7a3a3a', fontSize: 11, fontFamily: 'Courier New', marginTop: 10, marginBottom: 4},
  modalActions:   {flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 20},
  modalBtn:       {paddingVertical: 6, paddingHorizontal: 4},
  modalBtnText:   {color: '#666', fontSize: 12, fontFamily: 'Courier New', letterSpacing: 2},
});
