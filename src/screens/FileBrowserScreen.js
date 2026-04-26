/**
 * FileBrowserScreen.js
 *
 * Main file browser.
 *
 * ↑ button navigates to parent directory (not shown at root).
 *
 * Export: writes plaintext to Android Downloads folder directly.
 * Import: uses SAF pick + keepLocalCopy with suppressLock.
 */

import React, {useState, useCallback, useMemo, useRef} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TouchableHighlight,
  StyleSheet, Alert, TextInput, Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {pick, keepLocalCopy, types, isCancel} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import StorageManager from '../storage/StorageManager';
import {setSuppressLock} from '../../App';
import {useTheme} from '../theme/ThemeContext';
import * as TutorialManager from '../tutorial/TutorialManager';
import EncryptedStorage from 'react-native-encrypted-storage';

export default function FileBrowserScreen({navigation, route}) {
  const currentPath = route.params?.path ?? '';
  const [items, setItems] = useState([]);

  const [createVisible, setCreateVisible] = useState(false);
  const [createMode, setCreateMode]       = useState('note');
  const [createName, setCreateName]       = useState('');
  const [createError, setCreateError]     = useState('');
  const [isCreating, setIsCreating]       = useState(false);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameTarget, setRenameTarget]   = useState(null);
  const [renameName, setRenameName]       = useState('');
  const [renameError, setRenameError]     = useState('');
  const [isRenaming, setIsRenaming]       = useState(false);

  const [importVisible, setImportVisible] = useState(false);
  const [importName, setImportName]       = useState('');
  const [importContent, setImportContent] = useState('');
  const [importError, setImportError]     = useState('');
  const [isImporting, setIsImporting]     = useState(false);

  const [tutorialVisible, setTutorialVisible] = useState(false);
  const tutorialChecked = useRef(false);

  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  useFocusEffect(useCallback(() => {
    loadItems();
    EncryptedStorage.setItem('last_location', JSON.stringify(
      {screen: 'FileBrowser', params: {path: currentPath}},
    )).catch(() => {});
    if (!currentPath && !tutorialChecked.current) {
      tutorialChecked.current = true;
      TutorialManager.shouldShow(TutorialManager.TUTORIALS.SETTINGS_INTRO).then(show => {
        if (show) setTutorialVisible(true);
      });
    }
  }, [currentPath]));

  async function loadItems() {
    try {
      const list = await StorageManager.listDir(currentPath);
      list.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      setItems(list);
    } catch { Alert.alert('Error', 'Could not load notes.'); }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function goUp() {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    navigation.navigate('FileBrowser', {path: parts.join('/')});
  }

  function handleTap(item) {
    if (item.isDirectory) {
      navigation.push('FileBrowser', {path: item.path});
    } else {
      EncryptedStorage.setItem('last_location', JSON.stringify(
        {screen: 'Editor', params: {notePath: item.path, noteName: item.name}},
      )).catch(() => {});
      navigation.navigate('Editor', {notePath: item.path, noteName: item.name});
    }
  }

  function handleLongPress(item) {
    const options = [
      {text: 'Rename', onPress: () => openRename(item)},
      {text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item)},
    ];
    if (!item.isDirectory) {
      options.unshift({text: 'Export', onPress: () => handleExport(item)});
    }
    options.push({text: 'Cancel', style: 'cancel'});
    Alert.alert(item.name, '', options);
  }

  // ── Export (Downloads folder) ─────────────────────────────────────────────

  async function handleExport(item) {
    try {
      const {plaintext, filename} = await StorageManager.getExportData(item.path, item.name);
      const destPath = `${RNFS.DownloadDirectoryPath}/${filename}`;

      let finalPath = destPath;
      if (await RNFS.exists(destPath)) {
        const dotIndex = filename.lastIndexOf('.');
        const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
        const ext  = dotIndex >= 0 ? filename.slice(dotIndex) : '';
        let n = 1;
        while (await RNFS.exists(`${RNFS.DownloadDirectoryPath}/${base} (${n})${ext}`)) n++;
        finalPath = `${RNFS.DownloadDirectoryPath}/${base} (${n})${ext}`;
      }

      await RNFS.writeFile(finalPath, plaintext, 'utf8');
      const savedName = finalPath.split('/').pop();
      Alert.alert('Exported', `Saved to Downloads as "${savedName}".`);
    } catch (e) {
      Alert.alert('Export failed', e.message || String(e));
    }
  }

  // ── Import (SAF pick) ─────────────────────────────────────────────────────

  async function handleImport() {
    try {
      setSuppressLock(true);
      let result, localCopy;
      try {
        [result] = await pick({type: [types.allFiles]});
        [localCopy] = await keepLocalCopy({
          files: [{uri: result.uri, fileName: result.name ?? 'imported'}],
          destination: 'cachesDirectory',
        });
      } finally {
        setSuppressLock(false);
      }
      const content = await RNFS.readFile(localCopy.localUri, 'utf8');
      setImportContent(content);
      setImportName(result.name || 'imported');
      setImportError('');
      setImportVisible(true);
    } catch (e) {
      setSuppressLock(false);
      if (!isCancel(e)) Alert.alert('Import failed', e.message || String(e));
    }
  }

  async function confirmImport() {
    if (!importName.trim() || isImporting) return;
    setImportError('');
    let name;
    try { name = StorageManager.sanitizeName(importName); }
    catch (e) { setImportError(e.message); return; }

    const relativePath = currentPath ? `${currentPath}/${name}` : name;
    const collision    = await StorageManager.exists(relativePath, false);

    if (collision) {
      Alert.alert(
        `"${relativePath}" already exists`,
        'What would you like to do?',
        [
          {text: 'Replace', style: 'destructive', onPress: () => doImport(relativePath)},
          {text: 'Rename import', onPress: async () => doImport(await StorageManager.resolveCollision(relativePath))},
          {text: 'Skip', style: 'cancel'},
        ],
      );
      return;
    }
    await doImport(relativePath);
  }

  async function doImport(resolvedPath) {
    setIsImporting(true);
    try {
      await StorageManager.importNotePlaintext(resolvedPath, importContent);
      setImportVisible(false);
      setImportContent('');
      setImportName('');
      loadItems();
    } catch (e) { setImportError(e.message || 'Import failed.'); }
    finally { setIsImporting(false); }
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  function openRename(item) {
    setRenameTarget(item);
    setRenameName(item.name);
    setRenameError('');
    setRenameVisible(true);
  }

  async function handleRename() {
    if (!renameName.trim() || isRenaming) return;
    setRenameError('');
    let newName;
    try { newName = StorageManager.sanitizeName(renameName); }
    catch (e) { setRenameError(e.message); return; }

    if (newName === renameTarget.name) { setRenameVisible(false); return; }

    const parts = renameTarget.path.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');

    if (await StorageManager.exists(newPath, renameTarget.isDirectory)) {
      setRenameError('A file or folder with that name already exists.');
      return;
    }

    setIsRenaming(true);
    try {
      await StorageManager.rename(renameTarget.path, newPath, renameTarget.isDirectory);
      setRenameVisible(false);
      setRenameTarget(null);
      loadItems();
    } catch (e) { setRenameError(e.message || 'Invalid name.'); }
    finally { setIsRenaming(false); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function confirmDelete(item) {
    Alert.alert(
      `Delete "${item.name}"?`,
      item.isDirectory ? 'This will delete the folder and all notes inside it.' : 'This cannot be undone.',
      [
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              if (item.isDirectory) await StorageManager.deleteDirectory(item.path);
              else await StorageManager.deleteNote(item.path);
              loadItems();
            } catch { Alert.alert('Error', 'Could not delete.'); }
          },
        },
        {text: 'Cancel', style: 'cancel'},
      ],
    );
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createName.trim() || isCreating) return;
    setCreateError('');
    let name;
    try { name = StorageManager.sanitizeName(createName); }
    catch (e) { setCreateError(e.message); return; }

    const relativePath = currentPath ? `${currentPath}/${name}` : name;
    const isDir = createMode === 'directory';

    if (await StorageManager.exists(relativePath, isDir)) {
      setCreateError(isDir ? 'A folder with that name already exists.' : 'A note with that name already exists.');
      return;
    }

    setIsCreating(true);
    try {
      if (isDir) {
        await StorageManager.createDirectory(relativePath);
        setCreateVisible(false);
        setCreateName('');
        loadItems();
      } else {
        await StorageManager.writeNote(relativePath, '');
        setCreateVisible(false);
        setCreateName('');
        EncryptedStorage.setItem('last_location', JSON.stringify(
          {screen: 'Editor', params: {notePath: relativePath, noteName: name}},
        )).catch(() => {});
        navigation.navigate('Editor', {notePath: relativePath, noteName: name});
      }
    } catch (e) { setCreateError(e.message || 'Could not create.'); }
    finally { setIsCreating(false); }
  }

  async function dismissTutorial() {
    await TutorialManager.markDone(TutorialManager.TUTORIALS.SETTINGS_INTRO);
    setTutorialVisible(false);
  }

  async function declineAllTutorials() {
    await TutorialManager.declineAll();
    setTutorialVisible(false);
  }

  const title = currentPath ? currentPath.split('/').pop() : 'BurnerPad';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {currentPath ? (
            <TouchableOpacity onPress={goUp} style={styles.upBtn}>
              <Text style={styles.upBtnText}>↑</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          {[
            {label: '+ note',   onPress: () => { setCreateMode('note');      setCreateName(''); setCreateError(''); setCreateVisible(true); }},
            {label: '+ folder', onPress: () => { setCreateMode('directory'); setCreateName(''); setCreateError(''); setCreateVisible(true); }},
            {label: '+ import', onPress: handleImport},
            {label: '⚙',        onPress: () => { if (tutorialVisible) dismissTutorial(); navigation.navigate('Settings'); }, highlight: tutorialVisible},
          ].map(btn => (
            <TouchableOpacity key={btn.label} style={[styles.headerBtn, btn.highlight && styles.headerBtnHighlight]} onPress={btn.onPress}>
              <Text style={[styles.headerBtnText, btn.highlight && styles.headerBtnTextHighlight]}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>no notes yet</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.path}
          renderItem={({item}) => (
            <TouchableHighlight underlayColor={t.highlight} onPress={() => handleTap(item)} onLongPress={() => handleLongPress(item)}>
              <View style={styles.item}>
                <Text style={styles.itemIcon}>{item.isDirectory ? '📁' : '·'}</Text>
                <Text style={styles.itemName}>{item.name}</Text>
              </View>
            </TouchableHighlight>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* Create modal */}
      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{createMode === 'directory' ? 'New folder' : 'New note'}</Text>
            <TextInput
              style={styles.modalInput}
              value={createName}
              onChangeText={text => {setCreateName(text); setCreateError('');}}
              placeholder={createMode === 'directory' ? 'folder name' : 'filename (e.g. todo.txt)'}
              placeholderTextColor={t.textFaint}
              autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            {createError ? <Text style={styles.modalError}>{createError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCreateVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate} style={styles.modalBtn} disabled={isCreating}>
                <Text style={styles.modalBtnText}>{isCreating ? '...' : 'create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Rename</Text>
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

      {/* Settings tutorial overlay — absolute view so ⚙ button remains tappable behind it */}
      {tutorialVisible && (
        <View style={styles.tutorialOverlay} pointerEvents="box-none">
          <View style={styles.tutorialBox}>
            <Text style={styles.tutorialTitle}>settings  ⚙</Text>
            <Text style={styles.tutorialBody}>
              Tap <Text style={styles.tutorialMono}>⚙</Text> in the top-right corner to access settings — theme,
              duress PIN, and more. Your settings PIN is separate from your
              notes PIN.
            </Text>
            <View style={styles.tutorialActions}>
              <TouchableOpacity onPress={dismissTutorial} style={styles.tutorialBtn}>
                <Text style={styles.tutorialBtnPrimary}>got it →</Text>
              </TouchableOpacity>
              <View style={styles.tutorialLinks}>
                <TouchableOpacity onPress={dismissTutorial}>
                  <Text style={styles.tutorialLink}>skip</Text>
                </TouchableOpacity>
                <Text style={styles.tutorialLinkSep}>·</Text>
                <TouchableOpacity onPress={declineAllTutorials}>
                  <Text style={styles.tutorialLink}>decline all tutorials</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Import modal */}
      <Modal visible={importVisible} transparent animationType="fade" onRequestClose={() => setImportVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Import as</Text>
            <TextInput
              style={styles.modalInput}
              value={importName}
              onChangeText={text => {setImportName(text); setImportError('');}}
              autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="done"
              onSubmitEditing={confirmImport}
            />
            {importError ? <Text style={styles.modalError}>{importError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setImportVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmImport} style={styles.modalBtn} disabled={isImporting}>
                <Text style={styles.modalBtnText}>{isImporting ? '...' : 'import'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    container:     {flex: 1, backgroundColor: t.bg},
    header:        {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: t.border},
    headerLeft:    {flexDirection: 'row', alignItems: 'center', gap: 12},
    upBtn:         {paddingRight: 4},
    upBtnText:     {color: t.textDimmer, fontSize: 20, fontFamily: 'Courier New'},
    title:         {color: t.text, fontSize: 16, letterSpacing: 3, fontFamily: 'Courier New', fontWeight: '200'},
    headerRight:   {flexDirection: 'row', gap: 12},
    headerBtn:              {paddingVertical: 4, paddingHorizontal: 2},
    headerBtnText:          {color: t.textDimmer, fontSize: 11, fontFamily: 'Courier New', letterSpacing: 1},
    headerBtnHighlight:     {borderWidth: 1, borderColor: t.text, paddingVertical: 4, paddingHorizontal: 8},
    headerBtnTextHighlight: {color: t.text, fontSize: 14},
    empty:         {flex: 1, justifyContent: 'center', alignItems: 'center'},
    emptyText:     {color: t.textTiny, fontFamily: 'Courier New', fontSize: 13, letterSpacing: 3},
    item:          {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 14, backgroundColor: t.bg},
    itemIcon:      {fontSize: 16, width: 20},
    itemName:      {color: t.textSub, fontSize: 14, fontFamily: 'Courier New', letterSpacing: 1},
    separator:     {height: 1, backgroundColor: t.border, marginLeft: 54},
    modalOverlay:  {flex: 1, backgroundColor: t.overlay, justifyContent: 'center', paddingHorizontal: 32},
    modalBox:      {backgroundColor: t.surface, padding: 28, borderWidth: 1, borderColor: t.borderMid},
    modalTitle:    {color: t.textDimmer, fontSize: 11, letterSpacing: 3, fontFamily: 'Courier New', marginBottom: 20},
    modalInput:    {borderBottomWidth: 1, borderBottomColor: t.borderStrong, color: t.text, fontSize: 15, paddingVertical: 8, fontFamily: 'Courier New', marginBottom: 8},
    modalError:    {color: t.errorMuted, fontSize: 11, fontFamily: 'Courier New', marginBottom: 8},
    modalActions:  {flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 16},
    modalBtn:         {paddingVertical: 6, paddingHorizontal: 4},
    modalBtnText:     {color: t.textDim, fontSize: 12, fontFamily: 'Courier New', letterSpacing: 2},
    tutorialOverlay:  {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 24},
    tutorialBox:      {backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderMid, paddingHorizontal: 32, paddingTop: 28, paddingBottom: 32},
    tutorialTitle:    {color: t.textDimmer, fontSize: 13, letterSpacing: 3, fontFamily: 'Courier New', marginBottom: 16},
    tutorialBody:     {color: t.textBody, fontSize: 16, lineHeight: 26, fontFamily: 'Courier New', marginBottom: 24},
    tutorialMono:     {color: t.textDim, fontFamily: 'Courier New'},
    tutorialActions:  {gap: 0},
    tutorialBtn:      {alignSelf: 'flex-start'},
    tutorialBtnPrimary:{color: t.text, fontSize: 13, fontFamily: 'Courier New', letterSpacing: 2},
    tutorialLinks:    {flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8},
    tutorialLink:     {color: t.textFaint, fontFamily: 'Courier New', fontSize: 11, letterSpacing: 1},
    tutorialLinkSep:  {color: t.textMicro, fontFamily: 'Courier New', fontSize: 11},
  });
}
