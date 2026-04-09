/**
 * App.js
 *
 * Entry point and global state manager.
 *
 * AppState lock behavior:
 * - 'active' → 'inactive': app switcher or file picker opened.
 *   Lock UNLESS suppressLock is set (SAF file picker operation in progress).
 * - suppressLock is automatically cleared when app returns to 'active'.
 *
 * Exports:
 * - setSuppressLock(bool): suppress locking during SAF operations
 * - requirePin(): force PIN re-entry from any screen
 */

import React, {useEffect, useState, useRef} from 'react';
import {AppState, View, ActivityIndicator, StyleSheet} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import CryptoManager from './src/crypto/CryptoManager';
import MigrationManager from './src/crypto/MigrationManager';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PinScreen from './src/screens/PinScreen';
import FileBrowserScreen from './src/screens/FileBrowserScreen';
import EditorScreen from './src/screens/EditorScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();

// ── Global SAF lock suppression ───────────────────────────────────────────────

let _suppressLock = false;

export function setSuppressLock(value) {
  _suppressLock = value;
}

// ── Before-lock flush (used by EditorScreen to write shadow before lock) ──────

let _beforeLockFlush = null;

export function registerBeforeLock(fn)  { _beforeLockFlush = fn;   }
export function unregisterBeforeLock()  { _beforeLockFlush = null; }

// ── Global PIN requirement ────────────────────────────────────────────────────

let _navigationRef = null;

export function requirePin() {
  CryptoManager.clearSessionKey();
  if (_navigationRef) {
    _navigationRef.reset({
      index: 0,
      routes: [{name: 'Pin'}],
    });
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const navigationRef                   = useRef(null);
  const appState                        = useRef(AppState.currentState);

  useEffect(() => {
    (async () => {
      const initialized = await CryptoManager.isInitialized();
      if (!initialized) {
        setInitialRoute('Onboarding');
        return;
      }
      const needsMigration = await MigrationManager.needsMigration();
      if (needsMigration) await MigrationManager.runMigrations();
      setInitialRoute('Pin');
    })();

    const subscription = AppState.addEventListener('change', nextState => {
      const wasActive = appState.current === 'active';
      const goingAway = nextState === 'inactive' || nextState === 'background';

      if (wasActive && goingAway && !_suppressLock) {
        const doLock = () => {
          CryptoManager.clearSessionKey();
          if (_navigationRef) {
            _navigationRef.reset({
              index: 0,
              routes: [{name: 'Pin'}],
            });
          }
        };
        if (_beforeLockFlush) {
          _beforeLockFlush().catch(() => {}).finally(doLock);
        } else {
          doLock();
        }
      }

      // Clear suppress flag when returning to active — safety net
      // in case the picker was dismissed without explicitly clearing it.
      if (nextState === 'active') {
        _suppressLock = false;
      }

      appState.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  function onNavigationReady() {
    _navigationRef = navigationRef.current;
  }

  if (!initialRoute) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#333" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown:  false,
          animation:    'fade',
          contentStyle: {backgroundColor: '#0d0d0d'},
        }}>
        <Stack.Screen name="Onboarding"  component={OnboardingScreen} />
        <Stack.Screen name="Pin"         component={PinScreen} />
        <Stack.Screen name="FileBrowser" component={FileBrowserScreen} />
        <Stack.Screen name="Editor"      component={EditorScreen} />
        <Stack.Screen name="Settings"    component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex:            1,
    backgroundColor: '#0d0d0d',
    justifyContent:  'center',
    alignItems:      'center',
  },
});
