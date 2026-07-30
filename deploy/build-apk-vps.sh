#!/usr/bin/env bash
#
# Build the Android APK on the VPS (no Expo/EAS), then publish it for download at
# https://piotask.com/downloads/techpioasset.apk.
#
# Prerequisites (one-time, already installed on this server — see /opt/android-setup.sh):
#   - JDK 17, Node 22 in /opt/node22, pnpm, Android SDK in /opt/android-sdk
#     (platform-35, build-tools 35.0.0, ndk 26.1.10909125, cmake 3.22.1)
#   - env in /opt/android-build.env
#
# Re-run this whenever mobile code changes to produce a fresh APK.
set -euo pipefail

source /opt/android-build.env
APP_DIR="${APP_DIR:-/opt/techpioasset}"
PUBLISH_TO="${PUBLISH_TO:-/var/www/piotask-downloads/techpioasset.apk}"
API_URL="${EXPO_PUBLIC_API_URL:-https://piotask.com}"

cd "$APP_DIR"
echo "[1/4] install workspace deps + build mobile's workspace packages"
pnpm install --frozen-lockfile
pnpm --filter "@techpioasset/mobile^..." build   # domain/contracts/ui-tokens -> dist

echo "[2/4] expo prebuild (regenerate android/)"
cd "$APP_DIR/apps/mobile"
export EXPO_NO_TELEMETRY=1
pnpm exec expo prebuild --platform android --no-install

echo "[3/4] gradle assembleRelease (arm only; API baked = $API_URL)"
export EXPO_PUBLIC_API_URL="$API_URL"
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon

echo "[4/4] publish APK"
APK="$(find "$APP_DIR/apps/mobile/android/app/build/outputs/apk/release" -name '*.apk' | head -1)"
mkdir -p "$(dirname "$PUBLISH_TO")"
cp "$APK" "$PUBLISH_TO"
chmod 644 "$PUBLISH_TO"
echo "done: $APK -> $PUBLISH_TO ($(du -h "$PUBLISH_TO" | cut -f1))"
