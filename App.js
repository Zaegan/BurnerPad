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
 * - setAppTheme(mode): update active theme ('dark'|'light'|'system')
 */

import React, {useEffect, useState, useRef, useMemo} from 'react';
import {AppState, View, ActivityIndicator, StyleSheet, useColorScheme} from 'react-native';
import {NavigationContainer, StackActions} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import CryptoManager from './src/crypto/CryptoManager';
import MigrationManager from './src/crypto/MigrationManager';
import {ThemeProvider} from './src/theme/ThemeContext';
import {dark, light} from './src/theme/themes';
import OnboardingScreen from './src/screens/OnboardingScreen';
import WalkthroughScreen from './src/screens/WalkthroughScreen';
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
    // Push Pin on top of the current stack so the underlying screen is
    // preserved and visible behind the lock screen. Guard against double-push
    // in case requirePin() is called while Pin is already the top screen.
    if (_navigationRef.getCurrentRoute()?.name !== 'Pin') {
      _navigationRef.dispatch(StackActions.push('Pin'));
    }
  }
}

// ── Global theme setter ───────────────────────────────────────────────────────

let _setThemeModeFn = null;

export function setAppTheme(mode) {
  CryptoManager.setTheme(mode);
  if (_setThemeModeFn) _setThemeModeFn(mode);
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [themeMode, setThemeMode]       = useState('dark');
  const navigationRef                   = useRef(null);
  const appState                        = useRef(AppState.currentState);
  const systemScheme                    = useColorScheme();

  const theme = useMemo(() => {
    if (themeMode === 'system') return systemScheme === 'light' ? light : dark;
    return themeMode === 'light' ? light : dark;
  }, [themeMode, systemScheme]);

  useEffect(() => {
    _setThemeModeFn = setThemeMode;
    return () => { _setThemeModeFn = null; };
  }, []);

  useEffect(() => {
    (async () => {
      const [initialized, savedMode] = await Promise.all([
        CryptoManager.isInitialized(),
        CryptoManager.getTheme(),
      ]);
      setThemeMode(savedMode);
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
            if (_navigationRef.getCurrentRoute()?.name !== 'Pin') {
              _navigationRef.dispatch(StackActions.push('Pin'));
            }
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
      <View style={[styles.loading, {backgroundColor: theme.bg}]}>
        <ActivityIndicator color={theme.textDimmer} />
      </View>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <NavigationContainer ref={navigationRef} onReady={onNavigationReady}>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown:  false,
            animation:    'fade',
            contentStyle: {backgroundColor: theme.bg},
          }}>
          <Stack.Screen name="Onboarding"  component={OnboardingScreen} />
          <Stack.Screen name="Walkthrough" component={WalkthroughScreen} />
          <Stack.Screen name="Pin"         component={PinScreen} />
          <Stack.Screen name="FileBrowser" component={FileBrowserScreen} />
          <Stack.Screen name="Editor"      component={EditorScreen} />
          <Stack.Screen name="Settings"    component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
  },
});
