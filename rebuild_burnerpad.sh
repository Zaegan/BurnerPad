#!/bin/bash
set -e

echo "==> Removing old BurnerPadApp..."
rm -rf ~/BurnerPad/BurnerPadApp

echo "==> Initializing fresh React Native project..."
cd ~/BurnerPad
npx @react-native-community/cli init BurnerPadApp --version 0.84.1

echo "==> Removing App.tsx..."
rm ~/BurnerPad/BurnerPadApp/App.tsx

echo "==> Creating source directories..."
mkdir -p ~/BurnerPad/BurnerPadApp/src/crypto
mkdir -p ~/BurnerPad/BurnerPadApp/src/storage
mkdir -p ~/BurnerPad/BurnerPadApp/src/screens

echo "==> Copying JS source files..."
cp ~/BurnerPad/BurnerPad/App.js               ~/BurnerPad/BurnerPadApp/App.js
cp ~/BurnerPad/BurnerPad/CryptoManager.js     ~/BurnerPad/BurnerPadApp/src/crypto/
cp ~/BurnerPad/BurnerPad/MigrationManager.js  ~/BurnerPad/BurnerPadApp/src/crypto/
cp ~/BurnerPad/BurnerPad/StorageManager.js    ~/BurnerPad/BurnerPadApp/src/storage/
cp ~/BurnerPad/BurnerPad/OnboardingScreen.js  ~/BurnerPad/BurnerPadApp/src/screens/
cp ~/BurnerPad/BurnerPad/PinScreen.js         ~/BurnerPad/BurnerPadApp/src/screens/
cp ~/BurnerPad/BurnerPad/FileBrowserScreen.js ~/BurnerPad/BurnerPadApp/src/screens/
cp ~/BurnerPad/BurnerPad/EditorScreen.js      ~/BurnerPad/BurnerPadApp/src/screens/
cp ~/BurnerPad/BurnerPad/SettingsScreen.js    ~/BurnerPad/BurnerPadApp/src/screens/

echo "==> Copying native Kotlin modules..."
KOTLIN_DIR=~/BurnerPad/BurnerPadApp/android/app/src/main/java/com/burnerpadapp
cp ~/BurnerPad/BurnerPad/CryptoModule.kt  $KOTLIN_DIR/
cp ~/BurnerPad/BurnerPad/CryptoPackage.kt $KOTLIN_DIR/

echo "==> Registering CryptoPackage in MainApplication.kt..."
MAIN_APP=$KOTLIN_DIR/MainApplication.kt
sed -i 's/import com.facebook.react.PackageList/import com.facebook.react.PackageList\nimport com.burnerpadapp.CryptoPackage/' $MAIN_APP
sed -i 's|          // add(MyReactNativePackage())|          add(CryptoPackage())|' $MAIN_APP

echo "==> Verifying MainApplication.kt patch..."
grep -q "CryptoPackage" $MAIN_APP && echo "    Patch OK" || { echo "    PATCH FAILED — check MainApplication.kt manually"; exit 1; }

echo "==> Installing npm dependencies..."
cd ~/BurnerPad/BurnerPadApp
npm install \
  react-native-encrypted-storage \
  react-native-fs \
  @react-navigation/native \
  @react-navigation/native-stack \
  react-native-screens \
  react-native-safe-area-context \
  react-native-zip-archive \
  @react-native-documents/picker

echo "==> Setting app icons..."
ICON_SRC=~/BurnerPad/BurnerPad/icon-1024.png
RES_DIR=~/BurnerPad/BurnerPadApp/android/app/src/main/res

if [ ! -f "$ICON_SRC" ]; then
  echo "    WARNING: icon-1024.png not found in BurnerPad/BurnerPad/ — using default icon"
elif ! command -v convert &> /dev/null; then
  echo "    WARNING: ImageMagick not found — using default icon"
  echo "    Install with: sudo apt install imagemagick"
else
  echo "    Generating icon sizes from icon-1024.png..."
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

echo "==> Building release APK..."
cd ~/BurnerPad/BurnerPadApp/android
./gradlew assembleRelease

echo ""
echo "==> BUILD COMPLETE"
echo "    APK: ~/BurnerPad/BurnerPadApp/android/app/build/outputs/apk/release/app-release.apk"
