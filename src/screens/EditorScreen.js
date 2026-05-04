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

import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, TouchableWithoutFeedback,
  Alert, Modal, ScrollView, Keyboard, useWindowDimensions,
} from 'react-native';
import RNFS from 'react-native-fs';
import StorageManager from '../storage/StorageManager';
import CryptoManager from '../crypto/CryptoManager';
import {requirePin, registerBeforeLock, unregisterBeforeLock} from '../../App';
import {useTheme} from '../theme/ThemeContext';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

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

  const saveTimer       = useRef(null);
  const shadowTimer     = useRef(null);
  const latestContent   = useRef('');
  const latestPath      = useRef(notePath);
  const isDirtyRef      = useRef(false);
  const autosaveRef     = useRef(false);
  const {height: windowHeight} = useWindowDimensions();

  const scrollViewRef   = useRef(null);
  const selectionEndRef = useRef(0);
  const contentHRef     = useRef(0);
  const scrollYRef      = useRef(0);
  const windowHeightRef = useRef(windowHeight);
  const bottomInsetRef  = useRef(0);  // kept current for use inside async callbacks

  const t = useTheme();
  const {top: topInset, bottom: bottomInset} = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(t, topInset), [t, topInset]);

  useEffect(() => { windowHeightRef.current = windowHeight; }, [windowHeight]);
  useEffect(() => { bottomInsetRef.current  = bottomInset;  }, [bottomInset]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => {
      const kh = e.endCoordinates.height;
      setKeyboardHeight(kh);
      setTimeout(() => {
        if (!scrollViewRef.current) return;
        if (latestContent.current.length === 0) return;
        // Estimate cursor Y using newline count (accurate for single-line paragraphs)
        // scaled by a wrap factor derived from the measured content height
        // (accounts for long lines that wrap to multiple visual lines).
        const text         = latestContent.current;
        const textToCursor = text.slice(0, selectionEndRef.current);
        const linesBefore  = textToCursor.split('\n').length - 1;
        const totalLines   = text.split('\n').length;
        const EDITOR_LINE_H  = 24;  // must match styles.editor.lineHeight
        const EDITOR_PAD_TOP = 24;  // must match styles.editor.paddingTop
        const EDITOR_PAD_BOT = 8;   // must match styles.editor.paddingBottom
        const contentH     = contentHRef.current;
        // Visual line count from the TextInput's measured height; always >= logical lines
        const visualLines  = contentH > 0
          ? Math.max(totalLines, (contentH - EDITOR_PAD_TOP - EDITOR_PAD_BOT) / EDITOR_LINE_H)
          : totalLines;
        const wrapFactor = visualLines / totalLines;
        const cursorY    = EDITOR_PAD_TOP + linesBefore * EDITOR_LINE_H * wrapFactor;
        // visibleH: subtract keyboard, nav-bar inset, header/footer (~60px each)
        const currWH   = windowHeightRef.current;
        const visibleH = currWH - kh - bottomInsetRef.current - topInset - 60;
        if (visibleH <= 0) return;
        const scrollBot = scrollYRef.current + visibleH;
        if (cursorY > scrollBot - 40) {
          scrollViewRef.current.scrollTo({
            y: Math.max(0, cursorY - visibleH + 80),
            animated: true,
          });
        }
      }, 80);
    });
    const hide  = Keyboard.addListener('keyboardDidHide',        () => setKeyboardHeight(0));
    // keyboardDidChangeFrame fires when the keyboard resizes mid-session (e.g. rotation
    // while keyboard is open). Without this, kH stays at the pre-rotation value.
    const frame = Keyboard.addListener('keyboardDidChangeFrame', e => {
      const newKH = e.endCoordinates.height;
      if (newKH > 0) setKeyboardHeight(newKH);
    });
    return () => { show.remove(); hide.remove(); frame.remove(); };
  }, [topInset]);

  // Spacer pushes the footer above both the keyboard AND the nav bar.
  // On button-nav devices bi stays > 0 alongside the keyboard; on gesture-nav
  // devices bi drops to 0 because the gesture strip is absorbed into the keyboard panel.
  // Either way, kH + bi equals the total vertical space the keyboard region occupies.
  // Clamped so a stale kH during rotation can never consume the whole view.
  const spacerHeight = keyboardHeight > 0
    ? Math.min(keyboardHeight + bottomInset, Math.max(0, windowHeight - 160))
    : 0;

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
    <View style={styles.container}>

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
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        decelerationRate="normal"
        scrollEventThrottle={100}
        onScroll={e => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}>
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
            placeholderTextColor={t.textTiny}
            disableFullscreenUI={true}
            onSelectionChange={e => { selectionEndRef.current = e.nativeEvent.selection.end; }}
            onContentSizeChange={e => { contentHRef.current = e.nativeEvent.contentSize.height; }}
          />
        )}
        {/* Allows last line to scroll toward top of screen */}
        <View style={{height: BOTTOM_SPACER}} />
      </ScrollView>

      {/* Footer — always visible; spacer below it fills keyboard height to push it up */}
      <View style={[styles.footer, {paddingBottom: keyboardHeight > 0 ? 4 : bottomInset}]}>
        <Text style={styles.footerText}>
          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount} {charCount === 1 ? 'char' : 'chars'}
        </Text>
        <Text style={styles.footerText}>{isDirty && !autosave ? 'unsaved' : 'plain text'}</Text>
      </View>
      {/* Adaptive spacer: fills the keyboard overlay area (0 with adjustResize, kh with adjustNothing) */}
      <View style={{height: spacerHeight}} />

      {/* DEBUG OVERLAY — remove before release */}
      <View style={{position:'absolute',top:80,right:0,backgroundColor:'rgba(0,0,0,0.75)',padding:4,zIndex:9999}}>
        <Text style={{color:'#0f0',fontFamily:'Courier New',fontSize:10}}>
          {`wH:${Math.round(windowHeight)} kH:${Math.round(keyboardHeight)} bi:${Math.round(bottomInset)} spc:${Math.round(spacerHeight)}`}
        </Text>
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
              placeholderTextColor={t.textGhost}
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
    </View>
  );
}

function makeStyles(t, topInset = 0) {
  return StyleSheet.create({
    container:      {flex: 1, backgroundColor: t.bg},
    header:         {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: Math.max(topInset, 16), paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: t.border, gap: 10},
    upBtn:          {paddingRight: 4},
    upBtnText:      {color: t.textDimmer, fontSize: 20, fontFamily: 'Courier New'},
    titleContainer: {flex: 1},
    title:          {color: t.textMuted, fontSize: 13, fontFamily: 'Courier New', letterSpacing: 2},
    autosavedLabel: {color: t.textTiny, fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
    saveBtn:        {paddingVertical: 4, paddingHorizontal: 2},
    saveBtnText:    {color: t.textDimmer, fontSize: 12, fontFamily: 'Courier New', letterSpacing: 1},
    menuBtn:        {paddingVertical: 4, paddingHorizontal: 4},
    menuBtnText:    {color: t.textDimmer, fontSize: 16, letterSpacing: 2, fontFamily: 'Courier New'},
    scrollView:     {flex: 1},
    scrollContent:  {flexGrow: 1},
    editor:         {
      flex: 1,
      color: t.textEditor,
      fontSize: 15,
      lineHeight: 24,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 8,
      fontFamily: 'Courier New',
      letterSpacing: 0.3,
      minHeight: '100%',
    },
    footer:         {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border},
    footerText:     {color: t.textTiny, fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
    menuOverlay:    {flex: 1, backgroundColor: 'transparent'},
    menuBox:        {position: 'absolute', top: 100, right: 16, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.borderStrong, minWidth: 140, elevation: 8},
    menuItem:       {paddingVertical: 14, paddingHorizontal: 20},
    menuItemText:   {color: t.textSub, fontSize: 13, fontFamily: 'Courier New', letterSpacing: 1},
    menuItemDanger: {color: t.errorMuted},
    menuDivider:    {height: 1, backgroundColor: t.borderMid},
    modalOverlay:   {flex: 1, backgroundColor: t.overlay, justifyContent: 'center', paddingHorizontal: 32},
    modalBox:       {backgroundColor: t.surface, padding: 28, borderWidth: 1, borderColor: t.borderMid},
    modalTitle:     {color: t.textDimmer, fontSize: 11, letterSpacing: 3, fontFamily: 'Courier New', marginBottom: 16},
    fieldLabel:     {color: t.textFaint, fontSize: 11, letterSpacing: 1, fontFamily: 'Courier New', marginBottom: 6, marginTop: 12},
    dirRow:         {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 6},
    resetBtnText:   {color: t.textFaint, fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
    dirHint:        {color: t.textTiny, fontSize: 10, fontFamily: 'Courier New', lineHeight: 16, marginTop: 6},
    modalInput:     {borderBottomWidth: 1, borderBottomColor: t.borderStrong, color: t.text, fontSize: 15, paddingVertical: 8, fontFamily: 'Courier New', marginBottom: 4},
    modalError:     {color: t.errorMuted, fontSize: 11, fontFamily: 'Courier New', marginTop: 10, marginBottom: 4},
    modalActions:   {flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 20},
    modalBtn:       {paddingVertical: 6, paddingHorizontal: 4},
    modalBtnText:   {color: t.textDim, fontSize: 12, fontFamily: 'Courier New', letterSpacing: 2},
  });
}
