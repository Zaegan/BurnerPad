/**
 * WalkthroughScreen.js
 *
 * First-launch walkthrough shown once after initial PIN setup.
 * 4 slides. Skip button always visible. Navigates to FileBrowser on finish.
 */

import React, {useState, useMemo} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import CryptoManager from '../crypto/CryptoManager';
import {useTheme} from '../theme/ThemeContext';

const SLIDES = [
  {
    title: 'welcome',
    body:  'BurnerPad keeps your notes encrypted on this device.\nNo accounts. No sync. No one else can read them.',
  },
  {
    title: 'how it works',
    body:  'Your PIN encrypts a key that locks every note.\nWithout your PIN, the data is unreadable — even to us.',
  },
  {
    title: 'duress PIN',
    body:  'In Settings you can set a duress PIN.\nEntering it silently wipes everything and opens a blank app. Only set one if you need it.',
  },
  {
    title: "you're ready",
    body:  "That's all there is to know.\nTap 'start' to open your notes.",
  },
];

export default function WalkthroughScreen({navigation}) {
  const [index, setIndex] = useState(0);
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const isLast = index === SLIDES.length - 1;

  async function finish() {
    await CryptoManager.setWalkthroughSeen();
    navigation.replace('FileBrowser', {path: ''});
  }

  function next() {
    if (isLast) {
      finish();
    } else {
      setIndex(i => i + 1);
    }
  }

  const slide = SLIDES[index];

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {/* Progress dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={finish} style={styles.skipBtn}>
            <Text style={styles.skipText}>skip</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={next} style={styles.nextBtn}>
            <Text style={styles.nextText}>{isLast ? 'start →' : 'next →'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    container: {flex: 1, backgroundColor: t.bg},
    inner:     {flex: 1, justifyContent: 'space-between', paddingHorizontal: 40, paddingTop: 80, paddingBottom: 56},
    dots:      {flexDirection: 'row', gap: 8},
    dot:       {width: 4, height: 4, borderRadius: 2, backgroundColor: t.textMicro},
    dotActive: {backgroundColor: t.textDimmer},
    content:   {flex: 1, justifyContent: 'center'},
    title:     {fontSize: 13, fontWeight: '200', color: t.textDim, letterSpacing: 4, fontFamily: 'Courier New', marginBottom: 28},
    body:      {fontSize: 14, color: t.textBody, lineHeight: 24, fontFamily: 'Courier New'},
    actions:   {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
    skipBtn:   {paddingVertical: 8, paddingRight: 8},
    skipText:  {color: t.textGhost, fontSize: 12, fontFamily: 'Courier New', letterSpacing: 2},
    nextBtn:   {paddingVertical: 8, paddingLeft: 8},
    nextText:  {color: t.text, fontSize: 13, fontFamily: 'Courier New', letterSpacing: 2},
  });
}
