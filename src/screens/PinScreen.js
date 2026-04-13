/**
 * PinScreen.js
 *
 * Lock screen. Shown on every launch and every return from background.
 *
 * - Silently tries 12345 on mount — if correct, skips to FileBrowser
 * - Wrong attempts counted; after 5, reinstall hint shown
 * - Unlimited attempts always allowed
 * - On duress PIN: wipes everything, reinitializes with duress PIN as new PIN
 */

import React, {useState, useRef, useEffect} from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import CryptoManager from '../crypto/CryptoManager';
import StorageManager from '../storage/StorageManager';

const WRONG_ATTEMPTS_BEFORE_HINT = 5;
const NO_PIN = '12345';

export default function PinScreen({navigation}) {
  const [pin, setPin]                   = useState('');
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [showHint, setShowHint]         = useState(false);
  const [error, setError]               = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isChecking, setIsChecking]     = useState(true);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const inputRef  = useRef(null);

  useEffect(() => {
    (async () => {
      const result = await CryptoManager.verifyPin(NO_PIN);
      if (result === 'correct') {
        navigation.replace('FileBrowser', {path: ''});
        return;
      }
      setIsChecking(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    })();
  }, []);

  function shake() {
    Animated.sequence([
      Animated.timing(shakeAnim, {toValue: 10,  duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: -10, duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 8,   duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: -8,  duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 0,   duration: 60, useNativeDriver: true}),
    ]).start();
  }

  async function handleSubmit() {
    if (!pin || isProcessing) return;
    setIsProcessing(true);
    setError('');
    try {
      const result = await CryptoManager.verifyPin(pin);
      if (result === 'correct') {
        setPin('');
        navigation.replace('FileBrowser', {path: ''});
      } else if (result === 'duress') {
        await CryptoManager.wipeKeys();
        await StorageManager.wipeAllNotes();
        await CryptoManager.initialize(pin);
        await StorageManager.createDefaultNote();
        setPin('');
        navigation.replace('FileBrowser', {path: ''});
      } else {
        const newCount = wrongAttempts + 1;
        setWrongAttempts(newCount);
        if (newCount >= WRONG_ATTEMPTS_BEFORE_HINT) setShowHint(true);
        setError('Incorrect PIN.');
        setPin('');
        shake();
      }
    } catch (e) {
      setError('Something went wrong. Try again.');
      setPin('');
    } finally {
      setIsProcessing(false);
    }
  }

  if (isChecking) return <View style={styles.container} />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
        <Text style={styles.logo}>BurnerPad</Text>
        <Text style={styles.tagline}>encrypted. plain. private.</Text>
        <Animated.View style={[styles.inputRow, {transform: [{translateX: shakeAnim}]}]}>
          <TextInput
            ref={inputRef}
            style={styles.pinInput}
            value={pin}
            onChangeText={setPin}
            onSubmitEditing={handleSubmit}
            placeholder="enter PIN"
            placeholderTextColor="#555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
          />
        </Animated.View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, isProcessing && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isProcessing}>
          <Text style={styles.buttonText}>{isProcessing ? '...' : 'Unlock'}</Text>
        </TouchableOpacity>
        {showHint && (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              Forgotten your PIN?{'\n'}
              A full reinstall will permanently wipe BurnerPad and all its
              notes. There is no other recovery option.
            </Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    {flex: 1, backgroundColor: '#0d0d0d'},
  inner:        {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40},
  logo:         {fontSize: 36, fontWeight: '200', color: '#e8e8e8', letterSpacing: 6, marginBottom: 6, fontFamily: 'Courier New'},
  tagline:      {fontSize: 11, color: '#444', letterSpacing: 3, marginBottom: 60, fontFamily: 'Courier New'},
  inputRow:     {width: '100%', marginBottom: 16},
  pinInput:     {width: '100%', borderBottomWidth: 1, borderBottomColor: '#333', color: '#e8e8e8', fontSize: 18, paddingVertical: 12, textAlign: 'center', fontFamily: 'Courier New', letterSpacing: 4},
  error:        {color: '#c0392b', fontSize: 13, marginBottom: 16, fontFamily: 'Courier New'},
  button:       {marginTop: 8, paddingVertical: 12, paddingHorizontal: 40, borderWidth: 1, borderColor: '#333'},
  buttonDisabled: {opacity: 0.4},
  buttonText:   {color: '#e8e8e8', fontSize: 13, letterSpacing: 3, fontFamily: 'Courier New'},
  hintBox:      {position: 'absolute', bottom: 48, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#1e1e1e', paddingTop: 16},
  hintText:     {color: '#444', fontSize: 11, lineHeight: 18, textAlign: 'center', fontFamily: 'Courier New'},
});
