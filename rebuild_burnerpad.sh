#!/bin/bash
set -e

# Usage:
#   bash rebuild_burnerpad.sh          — incremental build (syncs source, skips init/npm)
#   bash rebuild_burnerpad.sh --clean  — full teardown and reinit (use when changing RN
#                                        version, adding/removing npm packages, or if the
#                                        project directory is broken)

PROJECT_DIR=~/BurnerPad/BurnerPadApp
KOTLIN_DIR=$PROJECT_DIR/android/app/src/main/java/com/github/zaegan/burnerpad
SRC_DIR=~/BurnerPad/BurnerPad

FULL_BUILD=false
if [ "${1}" = "--clean" ]; then
  FULL_BUILD=true
fi
if [ ! -d "$PROJECT_DIR" ]; then
  echo "==> No existing project found — running full initialisation..."
  FULL_BUILD=true
fi

# ── Full initialisation (first run or --clean) ────────────────────────────────

if [ "$FULL_BUILD" = true ]; then
  echo "==> Removing old BurnerPadApp..."
  rm -rf $PROJECT_DIR

  echo "==> Initializing fresh React Native project..."
  cd ~/BurnerPad
  npx @react-native-community/cli init BurnerPadApp --version 0.84.1

  echo "==> Patching package name and app display name..."
  sed -i 's/namespace "com.burnerpadapp"/namespace "com.github.zaegan.burnerpad"/' \
    $PROJECT_DIR/android/app/build.gradle
  sed -i 's/applicationId "com.burnerpadapp"/applicationId "com.github.zaegan.burnerpad"/' \
    $PROJECT_DIR/android/app/build.gradle
  sed -i 's|<string name="app_name">BurnerPadApp</string>|<string name="app_name">BurnerPad</string>|' \
    $PROJECT_DIR/android/app/src/main/res/values/strings.xml
  OLD_PKG_DIR=$PROJECT_DIR/android/app/src/main/java/com/burnerpadapp
  mkdir -p $KOTLIN_DIR
  mv $OLD_PKG_DIR/*.kt $KOTLIN_DIR/
  sed -i 's/^package com.burnerpadapp/package com.github.zaegan.burnerpad/' $KOTLIN_DIR/*.kt

  echo "==> Removing App.tsx..."
  rm $PROJECT_DIR/App.tsx

  echo "==> Creating source directories..."
  mkdir -p $PROJECT_DIR/src/crypto
  mkdir -p $PROJECT_DIR/src/storage
  mkdir -p $PROJECT_DIR/src/screens

  echo "==> Registering CryptoPackage in MainApplication.kt..."
  MAIN_APP=$KOTLIN_DIR/MainApplication.kt
  sed -i 's/import com.facebook.react.PackageList/import com.facebook.react.PackageList\nimport com.github.zaegan.burnerpad.CryptoPackage/' $MAIN_APP
  sed -i 's|          // add(MyReactNativePackage())|          add(CryptoPackage())|' $MAIN_APP
  grep -q "CryptoPackage" $MAIN_APP && echo "    Patch OK" || { echo "    PATCH FAILED — check MainApplication.kt manually"; exit 1; }

  echo "==> Installing npm dependencies..."
  cd $PROJECT_DIR
  npm install \
    react-native-encrypted-storage \
    react-native-fs \
    @react-navigation/native \
    @react-navigation/native-stack \
    react-native-screens \
    react-native-safe-area-context \
    react-native-zip-archive \
    @react-native-documents/picker

  echo "==> Patching react-native-zip-archive (double switch selector bug)..."
  sed -i 's/switch (compressionLevel)/switch ((int) compressionLevel)/' \
    $PROJECT_DIR/node_modules/react-native-zip-archive/android/src/main/java/com/rnziparchive/RNZipArchiveModule.java

  echo "==> Setting app icons..."
  ICON_SRC=$SRC_DIR/icon-512.png
  RES_DIR=$PROJECT_DIR/android/app/src/main/res
  if [ ! -f "$ICON_SRC" ]; then
    echo "    WARNING: icon-512.png not found — using default icon"
  elif ! command -v convert &> /dev/null; then
    echo "    WARNING: ImageMagick not found — using default icon"
    echo "    Install with: sudo apt install imagemagick"
  else
    echo "    Generating icon sizes..."
    for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
      case $density in
        mdpi)    size=48  ;;
        hdpi)    size=72  ;;
        xhdpi)   size=96  ;;
        xxhdpi)  size=144 ;;
        xxxhdpi) size=192 ;;
      esac
      dir=$RES_DIR/mipmap-$density
      mkdir -p $dir
      convert "$ICON_SRC" -resize ${size}x${size} $dir/ic_launcher.png
      convert "$ICON_SRC" -resize ${size}x${size} \
        \( +clone -alpha extract \
           -draw "fill black polygon 0,0 0,${size} ${size},0 fill white circle $((size/2)),$((size/2)) $((size/2)),0" \
           \( +clone -flip \) -compose Multiply -composite \
           \( +clone -flop \) -compose Multiply -composite \
        \) -alpha off -compose CopyOpacity -composite \
        $dir/ic_launcher_round.png
    done
    echo "    Icons generated OK"
  fi
fi

# ── Source sync (every run) ───────────────────────────────────────────────────

echo "==> Syncing JS source files..."
cp $SRC_DIR/App.js               $PROJECT_DIR/App.js
cp $SRC_DIR/CryptoManager.js     $PROJECT_DIR/src/crypto/
cp $SRC_DIR/MigrationManager.js  $PROJECT_DIR/src/crypto/
cp $SRC_DIR/StorageManager.js    $PROJECT_DIR/src/storage/
cp $SRC_DIR/OnboardingScreen.js  $PROJECT_DIR/src/screens/
cp $SRC_DIR/PinScreen.js         $PROJECT_DIR/src/screens/
cp $SRC_DIR/FileBrowserScreen.js $PROJECT_DIR/src/screens/
cp $SRC_DIR/EditorScreen.js      $PROJECT_DIR/src/screens/
cp $SRC_DIR/SettingsScreen.js    $PROJECT_DIR/src/screens/

echo "==> Syncing native Kotlin modules..."
cp $SRC_DIR/CryptoModule.kt  $KOTLIN_DIR/
cp $SRC_DIR/CryptoPackage.kt $KOTLIN_DIR/

# ── Build (every run) ─────────────────────────────────────────────────────────

echo "==> Building release APK and AAB..."
cd $PROJECT_DIR/android
./gradlew clean assembleRelease bundleRelease

echo ""
echo "==> BUILD COMPLETE"
echo "    APK (sign before GitHub release): $PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"
echo "    AAB (upload to Play Store):       $PROJECT_DIR/android/app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "    Next steps:"
echo "      1. Sign the APK:  ./sign_release.sh burnerpad <path-to-app-release.apk>"
echo "      2. Publish signed APK to GitHub releases"
echo "      3. Upload AAB to Play Console closed test track"
