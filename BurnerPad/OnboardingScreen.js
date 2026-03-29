/**
 * OnboardingScreen.js
 *
 * First launch PIN setup.
 * Minimum PIN length: 5 characters.
 * 12345 is a valid PIN that bypasses the lock screen silently.
 */

import React, {useState, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import CryptoManager from '../crypto/CryptoManager';
import StorageManager from '../storage/StorageManager';

const MIN_PIN_LENGTH = CryptoManager.MIN_PIN_LENGTH;

export default function OnboardingScreen({navigation}) {
  const [step, setStep]           = useState('welcome');
  const [pin, setPin]             = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError]         = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const confirmRef = useRef(null);

  async function handleFinish() {
    if (isProcessing) return;
    setError('');
    if (pin.length < MIN_PIN_LENGTH) {
      setError(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.');
      setConfirmPin('');
      return;
    }
    setIsProcessing(true);
    try {
      await CryptoManager.initialize(pin);
      await StorageManager.createDefaultNote();
      navigation.replace('FileBrowser', {path: ''});
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setIsProcessing(false);
    }
  }

  if (step === 'welcome') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.logo}>BurnerPad</Text>
          <Text style={styles.tagline}>encrypted. plain. private.</Text>
          <View style={styles.section}>
            <Text style={styles.body}>
              Your notes are encrypted on this device. No cloud. No tracking.
              No formatting. Just text.
            </Text>
            <Text style={styles.body}>
              You'll set a PIN to open the app. Without it, your notes are
              unreadable — even to us.
            </Text>
            <Text style={styles.body}>
              If you don't want a PIN, use{' '}
              <Text style={styles.mono}>12345</Text>. We won't judge you.
            </Text>
            <Text style={styles.warning}>
              There is no PIN recovery. If you forget your PIN, a full
              reinstall is the only option — and it destroys everything.
            </Text>
          </View>
          <TouchableOpacity style={styles.button} onPress={() => setStep('setpin')}>
            <Text style={styles.buttonText}>Set my PIN →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>BurnerPad</Text>
        <Text style={styles.tagline}>set your PIN</Text>
        <View style={styles.section}>
          <Text style={styles.label}>Choose a PIN</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={text => {setPin(text); setError('');}}
            placeholder="PIN (numbers, letters, symbols)"
            placeholderTextColor="#444"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <Text style={styles.label}>Confirm PIN</Text>
          <TextInput
            ref={confirmRef}
            style={styles.input}
            value={confirmPin}
            onChangeText={text => {setConfirmPin(text); setError('');}}
            placeholder="repeat PIN"
            placeholderTextColor="#444"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleFinish}
          />
          <Text style={styles.hint}>
            Minimum {MIN_PIN_LENGTH} characters. Numbers only is fine.
            Letters and symbols make it stronger. Don't want a PIN?{' '}
            Use <Text style={styles.mono}>12345</Text>.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <TouchableOpacity
          style={[styles.button, isProcessing && styles.buttonDisabled]}
          onPress={handleFinish}
          disabled={isProcessing}>
          <Text style={styles.buttonText}>
            {isProcessing ? 'Setting up...' : 'Create BurnerPad →'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      {flex: 1, backgroundColor: '#0d0d0d'},
  inner:          {flexGrow: 1, justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 60},
  logo:           {fontSize: 32, fontWeight: '200', color: '#e8e8e8', letterSpacing: 6, marginBottom: 6, fontFamily: 'Courier New'},
  tagline:        {fontSize: 11, color: '#444', letterSpacing: 3, marginBottom: 48, fontFamily: 'Courier New'},
  section:        {marginBottom: 40},
  body:           {color: '#999', fontSize: 14, lineHeight: 22, marginBottom: 16, fontFamily: 'Courier New'},
  warning:        {color: '#7a3a3a', fontSize: 13, lineHeight: 20, marginTop: 8, fontFamily: 'Courier New', borderLeftWidth: 2, borderLeftColor: '#7a3a3a', paddingLeft: 12},
  label:          {color: '#555', fontSize: 11, letterSpacing: 2, marginBottom: 8, marginTop: 20, fontFamily: 'Courier New'},
  input:          {borderBottomWidth: 1, borderBottomColor: '#2a2a2a', color: '#e8e8e8', fontSize: 16, paddingVertical: 10, fontFamily: 'Courier New', letterSpacing: 2, marginBottom: 4},
  hint:           {color: '#444', fontSize: 11, lineHeight: 17, marginTop: 12, fontFamily: 'Courier New'},
  mono:           {color: '#666', fontFamily: 'Courier New'},
  error:          {color: '#c0392b', fontSize: 13, marginTop: 12, fontFamily: 'Courier New'},
  button:         {paddingVertical: 14, paddingHorizontal: 32, borderWidth: 1, borderColor: '#2a2a2a', alignSelf: 'flex-start'},
  buttonDisabled: {opacity: 0.4},
  buttonText:     {color: '#e8e8e8', fontSize: 13, letterSpacing: 2, fontFamily: 'Courier New'},
});
