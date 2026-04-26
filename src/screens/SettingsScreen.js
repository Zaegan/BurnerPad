/**
 * SettingsScreen.js
 *
 * Settings (all PIN-gated except privacy policy link):
 * 1. Theme (dark / light / system)
 * 2. Autosave toggle
 * 3. Change PIN (min 5 chars, re-encrypts all files)
 * 4. Backup — encrypted archive written to Downloads folder
 * 5. Restore — encrypted archive picked via SAF with suppressLock
 * 6. Duress PIN (min 5 chars)
 * 7. Rate This App (Play Store link)
 *
 * Privacy Policy link is shown in the gate (locked) view — accessible
 * without entering a PIN for legal/trust reasons.
 */

import React, {useState, useRef, useMemo} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
  Switch, ActivityIndicator, Linking,
} from 'react-native';
import {pick, keepLocalCopy, types, isCancel} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import CryptoManager from '../crypto/CryptoManager';
import StorageManager from '../storage/StorageManager';
import {setSuppressLock, setAppTheme} from '../../App';
import {useTheme} from '../theme/ThemeContext';

const DURESS_PHRASE = 'ONLY FOR DURESS';
const MIN_PIN       = CryptoManager.MIN_PIN_LENGTH;

export default function SettingsScreen({navigation}) {
  const [gatePin, setGatePin]       = useState('');
  const [gateError, setGateError]   = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [themeMode, setThemeMode] = useState('dark');
  const [autosave, setAutosave] = useState(false);

  const [currentPin, setCurrentPin]               = useState('');
  const [newPin, setNewPin]                       = useState('');
  const [confirmNewPin, setConfirmNewPin]         = useState('');
  const [pinChangeError, setPinChangeError]       = useState('');
  const [pinChangeProgress, setPinChangeProgress] = useState('');
  const [isChangingPin, setIsChangingPin]         = useState(false);
  const newPinRef        = useRef(null);
  const confirmNewPinRef = useRef(null);

  const [exportPassword, setExportPassword]               = useState('');
  const [exportPasswordVisible, setExportPasswordVisible] = useState(false);
  const [exportConfirm, setExportConfirm]                 = useState('');
  const [exportConfirmVisible, setExportConfirmVisible]   = useState(false);
  const [exportError, setExportError]                     = useState('');
  const [isExporting, setIsExporting]                     = useState(false);

  const [restorePassword, setRestorePassword]               = useState('');
  const [restorePasswordVisible, setRestorePasswordVisible] = useState(false);
  const [restoreError, setRestoreError]                     = useState('');
  const [restoreProgress, setRestoreProgress]               = useState('');
  const [isRestoring, setIsRestoring]                       = useState(false);

  const [duressPin, setDuressPin]               = useState('');
  const [confirmDuressPin, setConfirmDuressPin] = useState('');
  const [confirmPhrase, setConfirmPhrase]       = useState('');
  const [formError, setFormError]               = useState('');
  const [isProcessing, setIsProcessing]         = useState(false);
  const [hasDuress, setHasDuress]               = useState(false);
  const [mode, setMode]                         = useState('set');
  const duressRef        = useRef(null);
  const confirmDuressRef = useRef(null);
  const phraseRef        = useRef(null);

  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  async function handleGateSubmit() {
    setGateError('');
    const ok = await CryptoManager.confirmRealPin(gatePin);
    if (!ok) { setGateError('Incorrect PIN.'); setGatePin(''); return; }
    setHasDuress(await CryptoManager.hasDuressPin());
    setAutosave(await CryptoManager.getAutosave());
    const savedMode = await CryptoManager.getTheme();
    setThemeMode(savedMode);
    setIsUnlocked(true);
  }

  function handleThemeChange(mode) {
    setThemeMode(mode);
    setAppTheme(mode);
  }

  async function handleAutosaveToggle(value) {
    setAutosave(value);
    await CryptoManager.setAutosave(value);
  }

  async function handleChangePin() {
    setPinChangeError('');
    setPinChangeProgress('');
    if (!currentPin)             { setPinChangeError('Enter your current PIN.'); return; }
    if (newPin.length < MIN_PIN) { setPinChangeError(`New PIN must be at least ${MIN_PIN} characters.`); return; }
    if (newPin !== confirmNewPin){ setPinChangeError('New PINs do not match.'); setConfirmNewPin(''); return; }

    setIsChangingPin(true);
    try {
      const {oldSessionKey, newSessionKey} = await CryptoManager.changePin(currentPin, newPin);
      setPinChangeProgress('Re-encrypting files…');
      await StorageManager.reEncryptAll(
        oldSessionKey, newSessionKey,
        p => setPinChangeProgress(`Re-encrypting… ${Math.round(p * 100)}%`),
      );
      await CryptoManager.finalizePinChange(newPin, newSessionKey);
      setCurrentPin(''); setNewPin(''); setConfirmNewPin('');
      setPinChangeProgress('');
      Alert.alert('PIN changed.', 'Your new PIN is active.');
    } catch (e) {
      setPinChangeError(e.message || 'Failed to change PIN.');
      setPinChangeProgress('');
    } finally {
      setIsChangingPin(false);
    }
  }

  // ── Backup (write to Downloads) ───────────────────────────────────────────

  async function handleExport() {
    setExportError('');
    if (exportPassword !== exportConfirm) { setExportError('Passwords do not match.'); return; }
    try { StorageManager.validateArchivePassword(exportPassword); }
    catch (e) { setExportError(e.message); return; }

    setIsExporting(true);
    try {
      const archivePath = await StorageManager.createArchive(exportPassword);

      // Write to Downloads folder — no picker needed
      const filename = `burnerpad_backup_${Date.now()}.bparchive`;
      const destPath = `${RNFS.DownloadDirectoryPath}/${filename}`;
      await RNFS.copyFile(archivePath, destPath);
      await RNFS.unlink(archivePath).catch(() => {});

      setExportPassword(''); setExportConfirm('');
      Alert.alert('Backup saved', `"${filename}" saved to your Downloads folder.`);
    } catch (e) {
      setExportError(e.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  }

  // ── Restore (pick from SAF) ───────────────────────────────────────────────

  async function handleRestore() {
    setRestoreError('');
    setRestoreProgress('');
    if (!restorePassword) { setRestoreError('Enter the archive password.'); return; }

    let archivePath;
    setSuppressLock(true);
    try {
      const [result] = await pick({type: [types.allFiles]});
      const [localCopy] = await keepLocalCopy({
        files: [{uri: result.uri, fileName: result.name ?? 'backup.bparchive'}],
        destination: 'cachesDirectory',
      });
      archivePath = localCopy.localUri;
    } catch (e) {
      setSuppressLock(false);
      if (!isCancel(e)) setRestoreError('Could not open file.');
      return;
    } finally {
      setSuppressLock(false);
    }

    Alert.alert(
      'Restore archive?',
      'Existing notes with the same names may be replaced or renamed.',
      [
        {text: 'Restore', onPress: () => doRestore(archivePath)},
        {text: 'Cancel', style: 'cancel'},
      ],
    );
  }

  async function doRestore(archivePath) {
    setIsRestoring(true);
    let globalResolution = null;

    try {
      await StorageManager.restoreArchive(
        archivePath,
        restorePassword,
        ({path}) => new Promise(resolve => {
          if (globalResolution) { resolve({action: globalResolution, applyToAll: false}); return; }
          Alert.alert(
            'Conflict',
            `A note already exists at:\n${path}`,
            [
              {
                text: 'Replace', style: 'destructive',
                onPress: () => Alert.alert('Apply to all?', '', [
                  {text: 'All conflicts', onPress: () => { globalResolution = 'replace'; resolve({action: 'replace', applyToAll: true}); }},
                  {text: 'Just this one', onPress: () => resolve({action: 'replace', applyToAll: false})},
                ]),
              },
              {
                text: 'Rename import',
                onPress: () => Alert.alert('Apply to all?', '', [
                  {text: 'All conflicts', onPress: () => { globalResolution = 'rename'; resolve({action: 'rename', applyToAll: true}); }},
                  {text: 'Just this one', onPress: () => resolve({action: 'rename', applyToAll: false})},
                ]),
              },
              {
                text: 'Skip', style: 'cancel',
                onPress: () => Alert.alert('Apply to all?', '', [
                  {text: 'All conflicts', onPress: () => { globalResolution = 'skip'; resolve({action: 'skip', applyToAll: true}); }},
                  {text: 'Just this one', onPress: () => resolve({action: 'skip', applyToAll: false})},
                ]),
              },
            ],
          );
        }),
        msg => setRestoreProgress(msg),
      );
      setRestorePassword(''); setRestoreProgress('');
      Alert.alert('Restore complete.');
    } catch (e) {
      setRestoreError(e.message || 'Restore failed.');
      setRestoreProgress('');
    } finally {
      setIsRestoring(false);
    }
  }

  async function handleSetDuress() {
    setFormError('');
    if (duressPin.length < MIN_PIN)     { setFormError(`Duress PIN must be at least ${MIN_PIN} characters.`); return; }
    if (duressPin !== confirmDuressPin) { setFormError('Duress PINs do not match.'); setConfirmDuressPin(''); return; }
    if (confirmPhrase !== DURESS_PHRASE){ setFormError(`You must type "${DURESS_PHRASE}" exactly.`); return; }

    setIsProcessing(true);
    try {
      await CryptoManager.setDuressPin(duressPin);
      setHasDuress(true);
      setDuressPin(''); setConfirmDuressPin(''); setConfirmPhrase('');
      Alert.alert('Duress PIN set.', 'Entering this PIN will silently wipe all notes and open a blank app.');
    } catch { setFormError('Failed to set duress PIN.'); }
    finally { setIsProcessing(false); }
  }

  async function handleRemoveDuress() {
    setFormError('');
    if (confirmPhrase !== DURESS_PHRASE) { setFormError(`You must type "${DURESS_PHRASE}" exactly.`); return; }
    setIsProcessing(true);
    try {
      await CryptoManager.removeDuressPin();
      setHasDuress(false); setConfirmPhrase(''); setMode('set');
      Alert.alert('Duress PIN removed.');
    } catch { setFormError('Failed to remove duress PIN.'); }
    finally { setIsProcessing(false); }
  }

  if (!isUnlocked) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.inner}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>↑ back</Text>
          </TouchableOpacity>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Text style={styles.gateLabel}>Enter your PIN to continue</Text>
          <TextInput
            style={styles.input}
            value={gatePin}
            onChangeText={text => {setGatePin(text); setGateError('');}}
            placeholder="PIN" placeholderTextColor={t.textGhost}
            secureTextEntry autoFocus autoCapitalize="none" autoCorrect={false}
            returnKeyType="go" onSubmitEditing={handleGateSubmit}
          />
          {gateError ? <Text style={styles.error}>{gateError}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={handleGateSubmit}>
            <Text style={styles.buttonText}>continue →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.privacyLink}
            onPress={() => Linking.openURL('https://zaegan.github.io/BurnerPad/privacy.html')}>
            <Text style={styles.privacyLinkText}>privacy policy</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner}>
        <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>↑ back</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>Settings</Text>

        {/* Theme */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Theme</Text>
          <View style={styles.themeRow}>
            {['dark', 'light', 'system'].map(m => (
              <TouchableOpacity key={m} onPress={() => handleThemeChange(m)} style={styles.themeOption}>
                <Text style={[styles.themeOptionText, themeMode === m && styles.themeOptionActive]}>
                  {m}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Autosave */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Text style={styles.cardTitle}>Autosave</Text>
              <Text style={styles.cardBody}>
                When on, edits are saved immediately. No recovery files are created.
                When off, edits go to a shadow copy until you save manually.
              </Text>
            </View>
            <Switch
              value={autosave} onValueChange={handleAutosaveToggle}
              trackColor={{false: t.border, true: t.borderStrong}}
              thumbColor={autosave ? t.textMuted : t.textGhost}
            />
          </View>
        </View>

        {/* Change PIN */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change PIN</Text>
          <Text style={styles.cardBody}>
            All notes will be re-encrypted with a key derived from your new PIN.
            Minimum {MIN_PIN} characters.
          </Text>
          {[
            {label: 'Current PIN',     value: currentPin,   set: setCurrentPin,   ref: null,           next: () => newPinRef.current?.focus(),        placeholder: 'current PIN'},
            {label: 'New PIN',         value: newPin,       set: setNewPin,       ref: newPinRef,       next: () => confirmNewPinRef.current?.focus(), placeholder: 'new PIN'},
            {label: 'Confirm new PIN', value: confirmNewPin,set: setConfirmNewPin,ref: confirmNewPinRef,next: handleChangePin,                         placeholder: 'repeat new PIN'},
          ].map(field => (
            <View key={field.label}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                ref={field.ref}
                style={styles.input}
                value={field.value}
                onChangeText={text => { field.set(text); setPinChangeError(''); }}
                placeholder={field.placeholder} placeholderTextColor={t.textGhost}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                returnKeyType={field.ref === confirmNewPinRef ? 'done' : 'next'}
                onSubmitEditing={field.next}
              />
            </View>
          ))}
          {pinChangeError    ? <Text style={styles.error}>{pinChangeError}</Text> : null}
          {pinChangeProgress ? <Text style={styles.progress}>{pinChangeProgress}</Text> : null}
          <TouchableOpacity
            style={[styles.button, isChangingPin && styles.buttonDisabled]}
            onPress={handleChangePin} disabled={isChangingPin}>
            {isChangingPin ? <ActivityIndicator color={t.textDimmer} /> : <Text style={styles.buttonText}>change PIN</Text>}
          </TouchableOpacity>
        </View>

        {/* Backup */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backup</Text>
          <Text style={styles.cardBody}>
            Creates an encrypted archive saved to your Downloads folder.
            Use a strong password — min 12 chars, upper, lower, number, symbol.
          </Text>
          {[
            {label: 'Archive password', value: exportPassword, set: setExportPassword, visible: exportPasswordVisible, setVisible: setExportPasswordVisible},
            {label: 'Confirm password', value: exportConfirm,  set: setExportConfirm,  visible: exportConfirmVisible,  setVisible: setExportConfirmVisible},
          ].map(field => (
            <View key={field.label}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={field.value}
                  onChangeText={text => { field.set(text); setExportError(''); }}
                  secureTextEntry={!field.visible}
                  autoCapitalize="none" autoCorrect={false}
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => field.setVisible(v => !v)}>
                  <Text style={styles.eyeText}>{field.visible ? '🙈' : '👁'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
          <TouchableOpacity
            style={[styles.button, isExporting && styles.buttonDisabled]}
            onPress={handleExport} disabled={isExporting}>
            {isExporting ? <ActivityIndicator color={t.textDimmer} /> : <Text style={styles.buttonText}>create backup</Text>}
          </TouchableOpacity>
        </View>

        {/* Restore */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Restore</Text>
          <Text style={styles.cardBody}>Restore notes from a BurnerPad backup archive.</Text>
          <Text style={styles.fieldLabel}>Archive password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={restorePassword}
              onChangeText={text => { setRestorePassword(text); setRestoreError(''); }}
              secureTextEntry={!restorePasswordVisible}
              autoCapitalize="none" autoCorrect={false} returnKeyType="done"
              onSubmitEditing={handleRestore}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setRestorePasswordVisible(v => !v)}>
              <Text style={styles.eyeText}>{restorePasswordVisible ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
          {restoreError    ? <Text style={styles.error}>{restoreError}</Text> : null}
          {restoreProgress ? <Text style={styles.progress}>{restoreProgress}</Text> : null}
          <TouchableOpacity
            style={[styles.button, isRestoring && styles.buttonDisabled]}
            onPress={handleRestore} disabled={isRestoring}>
            {isRestoring ? <ActivityIndicator color={t.textDimmer} /> : <Text style={styles.buttonText}>choose archive file</Text>}
          </TouchableOpacity>
        </View>

        {/* Duress PIN */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Duress PIN{hasDuress ? '  ·  active' : ''}</Text>
          <Text style={styles.cardBody}>
            A duress PIN looks like your real PIN to anyone watching. When entered,
            it silently and permanently destroys all notes, then opens a blank
            BurnerPad as if nothing happened.{'\n\n'}
            Minimum {MIN_PIN} characters. Only set this if you understand what it does.
            There is no undo.
          </Text>

          {hasDuress && (
            <View style={styles.modeRow}>
              {['set', 'remove'].map(m => (
                <TouchableOpacity key={m} onPress={() => { setMode(m); setFormError(''); }}>
                  <Text style={[styles.modeBtn, mode === m && styles.modeBtnActive]}>
                    {m === 'set' ? 'change' : 'remove'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {mode === 'set' && (
            <>
              <Text style={styles.fieldLabel}>Duress PIN</Text>
              <TextInput
                ref={duressRef}
                style={styles.input}
                value={duressPin}
                onChangeText={text => { setDuressPin(text); setFormError(''); }}
                placeholder="choose a duress PIN" placeholderTextColor={t.textGhost}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                returnKeyType="next" onSubmitEditing={() => confirmDuressRef.current?.focus()}
              />
              <Text style={styles.fieldLabel}>Confirm duress PIN</Text>
              <TextInput
                ref={confirmDuressRef}
                style={styles.input}
                value={confirmDuressPin}
                onChangeText={text => { setConfirmDuressPin(text); setFormError(''); }}
                placeholder="repeat duress PIN" placeholderTextColor={t.textGhost}
                secureTextEntry autoCapitalize="none" autoCorrect={false}
                returnKeyType="next" onSubmitEditing={() => phraseRef.current?.focus()}
              />
            </>
          )}

          <Text style={styles.fieldLabel}>
            Type <Text style={styles.mono}>ONLY FOR DURESS</Text> to confirm
          </Text>
          <TextInput
            ref={phraseRef}
            style={styles.input}
            value={confirmPhrase}
            onChangeText={text => { setConfirmPhrase(text); setFormError(''); }}
            placeholder="ONLY FOR DURESS" placeholderTextColor={t.textGhost}
            autoCapitalize="characters" autoCorrect={false} returnKeyType="done"
            onSubmitEditing={mode === 'set' ? handleSetDuress : handleRemoveDuress}
          />

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <TouchableOpacity
            style={[styles.button, styles.buttonDanger, isProcessing && styles.buttonDisabled]}
            onPress={mode === 'set' ? handleSetDuress : handleRemoveDuress}
            disabled={isProcessing}>
            <Text style={styles.buttonText}>
              {isProcessing ? '...' : mode === 'set' ? (hasDuress ? 'update duress PIN' : 'set duress PIN') : 'remove duress PIN'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            You cannot view the current duress PIN. To change it, set a new one.
            The duress PIN must differ from your real PIN.
          </Text>
        </View>

        {/* Rate This App */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Enjoying BurnerPad?</Text>
          <Text style={styles.cardBody}>
            A review on the Play Store helps others find a private, no-nonsense notepad.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              Linking.openURL('market://details?id=com.github.zaegan.burnerpad').catch(() =>
                Linking.openURL('https://play.google.com/store/apps/details?id=com.github.zaegan.burnerpad'),
              )
            }>
            <Text style={styles.buttonText}>rate this app</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.privacyLink}
          onPress={() => Linking.openURL('https://zaegan.github.io/BurnerPad/privacy.html')}>
          <Text style={styles.privacyLinkText}>privacy policy</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    container:        {flex: 1, backgroundColor: t.bg},
    inner:            {flexGrow: 1, paddingHorizontal: 28, paddingTop: 56, paddingBottom: 48},
    backRow:          {marginBottom: 32},
    backButton:       {color: t.textFaint, fontFamily: 'Courier New', fontSize: 13, letterSpacing: 1},
    sectionTitle:     {color: t.textGhost, fontSize: 11, letterSpacing: 4, fontFamily: 'Courier New', marginBottom: 32},
    gateLabel:        {color: t.textDimmer, fontFamily: 'Courier New', fontSize: 13, marginBottom: 20},
    card:             {borderWidth: 1, borderColor: t.border, padding: 24, marginBottom: 24},
    toggleRow:        {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16},
    toggleLabel:      {flex: 1},
    cardTitle:        {color: t.textDim, fontFamily: 'Courier New', fontSize: 12, letterSpacing: 2, marginBottom: 10},
    cardBody:         {color: t.textFaint, fontFamily: 'Courier New', fontSize: 12, lineHeight: 20},
    themeRow:         {flexDirection: 'row', gap: 24, marginTop: 4},
    themeOption:      {paddingVertical: 4},
    themeOptionText:  {color: t.textGhost, fontFamily: 'Courier New', fontSize: 12, letterSpacing: 2},
    themeOptionActive:{color: t.text},
    modeRow:          {flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 16, gap: 12},
    modeBtn:          {color: t.textGhost, fontFamily: 'Courier New', fontSize: 12, letterSpacing: 1},
    modeBtnActive:    {color: t.textMuted},
    fieldLabel:       {color: t.textFaint, fontFamily: 'Courier New', fontSize: 11, letterSpacing: 1, marginBottom: 8, marginTop: 16},
    input:            {borderBottomWidth: 1, borderBottomColor: t.border, color: t.textSub, fontSize: 14, paddingVertical: 8, fontFamily: 'Courier New', letterSpacing: 1},
    passwordRow:      {flexDirection: 'row', alignItems: 'center'},
    passwordInput:    {flex: 1},
    eyeBtn:           {paddingHorizontal: 8, paddingVertical: 8},
    eyeText:          {fontSize: 16},
    mono:             {color: t.textDimmer, fontFamily: 'Courier New'},
    error:            {color: t.errorMuted, fontFamily: 'Courier New', fontSize: 12, marginTop: 12},
    progress:         {color: t.textDimmer, fontFamily: 'Courier New', fontSize: 11, marginTop: 8, letterSpacing: 1},
    button:           {marginTop: 24, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: t.borderMid, alignSelf: 'flex-start'},
    buttonDanger:     {borderColor: t.errorMuted},
    buttonDisabled:   {opacity: 0.4},
    buttonText:       {color: t.textMuted, fontFamily: 'Courier New', fontSize: 12, letterSpacing: 2},
    footnote:         {color: t.textMicro, fontFamily: 'Courier New', fontSize: 11, lineHeight: 18, marginTop: 20},
    privacyLink:      {alignSelf: 'center', marginTop: 32, paddingVertical: 8},
    privacyLinkText:  {color: t.textBody, fontFamily: 'Courier New', fontSize: 14, letterSpacing: 2},
  });
}
