#!/usr/bin/env bash
#
# Build a release APK on this Windows machine, without Expo Application Services.
#
# Run from Git Bash:
#     bash apps/mobile/scripts/build-apk-local.sh
#
# Output: apps/mobile/android/app/build/outputs/apk/release/app-release.apk
#
# The APK is signed with the Android *debug* key, because that is what
# `expo prebuild` writes into android/app/build.gradle. It installs by sideload
# and is fine for internal testing, but it is not a distribution key: Play Store
# uploads and in-place upgrades from a differently-signed build both need a real
# keystore. Creating one requires a password that only the owner should choose.
#
# ---------------------------------------------------------------------------
# Why each setting below is here - all of these were failures, not precautions.
# ---------------------------------------------------------------------------
#
# JAVA_HOME / ANDROID_HOME
#   There is no standalone JDK or Android SDK installed. Unity's Android build
#   support ships both, but its SDK lives under "C:\Program Files\...", which is
#   read-only to Gradle and contains a space (see CMAKE below). So C:\Android\sdk
#   is a writable SDK assembled from it - see SDK LAYOUT.
#
# TMP / TEMP  (instead of JAVA_TOOL_OPTIONS)
#   Gradle's daemon cannot open its AF_UNIX socket under this machine's default
#   temp directory; it dies with "Unable to establish loopback connection". The
#   usual fix is JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Temp - but do
#   NOT use it here. JAVA_TOOL_OPTIONS is inherited by every child JVM, and each
#   one prints "Picked up JAVA_TOOL_OPTIONS: ..." to stderr. The Android plugin
#   treats *any* prefab stderr as failure and reports it as
#   "[CXX1210] No compatible library found" - an error about neither prefab nor
#   libraries, on a tool that exited 0. Setting TMP/TEMP moves the socket without
#   the banner. (GRADLE_OPTS and org.gradle.jvmargs both fail differently: they
#   fork a single-use daemon that then dies.)
#
# EXPO_NO_METRO_WORKSPACE_ROOT
#   Expo defaults Metro's server root to the *workspace* root in a monorepo,
#   while React Native's Gradle plugin writes --entry-file relative to
#   apps/mobile. In a pnpm workspace the entry resolves through ../../ into the
#   store, so the two disagree and the bundle step dies with "Unable to resolve
#   module ./../../node_modules/.../expo-router/entry.js". This pins the server
#   root to apps/mobile, matching what Gradle passes.
#
# reactNativeArchitectures=arm64-v8a
#   armeabi-v7a cannot be built here. Its prefab output sits at a 246-character
#   path inside the pnpm store, and ninja stats it via "armeabi-v7a\..\", which
#   crosses the 260-character Windows limit - so ninja reports a file that
#   exists as missing and loops until "manifest 'build.ninja' still dirty after
#   100 tries". arm64-v8a's paths are shorter and build cleanly. arm64-v8a
#   covers essentially every Android device sold since about 2017; a universal
#   APK needs either long-path support enabled on the machine or a much shorter
#   checkout path.
#
# android.buildToolsVersion=34.0.0
#   The Expo modules ask for build-tools 34 regardless of the root project's
#   setting, and Gradle will not install it for you without accepting the SDK
#   licence agreements.
#
# ---------------------------------------------------------------------------
# SDK LAYOUT - one-time setup, already done on this machine
# ---------------------------------------------------------------------------
#   C:\Android\sdk\platforms\android-34,-35   junctions into Unity's SDK
#   C:\Android\sdk\platform-tools             junction into Unity's SDK
#   C:\Android\sdk\build-tools\36.0.0         junction into Unity's SDK
#   C:\Android\sdk\build-tools\34.0.0         real copy (dl.google.com build-tools_r34)
#   C:\Android\sdk\ndk\26.1.10909125          real copy (dl.google.com android-ndk-r26b)
#   C:\Android\sdk\cmake\3.22.1               real COPY, not a junction
#
#   The NDK and build-tools 34 are unpacked rather than installed through
#   sdkmanager so that Gradle never has to install anything - a package that is
#   already present is not licence-checked, so no agreement has to be accepted
#   on the owner's behalf.
#
#   CMake must be a real copy. Through a junction, CMake resolves its own module
#   paths back to "C:\Program Files\Unity\...", and ninja cannot match dependency
#   paths containing an escaped space - the same "build.ninja still dirty" loop.
#
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${JAVA_HOME:=C:/Program Files/Unity/Hub/Editor/6000.3.20f1/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK}"
: "${ANDROID_HOME:=C:/Android/sdk}"
: "${GRADLE_BIN:=/c/Gradle/gradle-8.10.2/bin/gradle}"
: "${ANDROID_ABI:=arm64-v8a}"

export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export TMP='C:\Temp'
export TEMP='C:\Temp'
export EXPO_NO_METRO_WORKSPACE_ROOT=1
# Must not be set - see the note above.
unset JAVA_TOOL_OPTIONS GRADLE_OPTS

mkdir -p /c/Temp

if [ ! -d "$MOBILE_DIR/android" ]; then
  echo "==> android/ is not present; generating it with expo prebuild"
  ( cd "$MOBILE_DIR" && npx expo prebuild --platform android --no-install )
  # prebuild rewrites the android/ios package.json scripts for the bare
  # workflow. android/ is not committed, so keep the managed-workflow scripts.
  git -C "$MOBILE_DIR" checkout -- package.json 2>/dev/null || true
fi

printf 'sdk.dir=C\\:/Android/sdk\n' > "$MOBILE_DIR/android/local.properties"

cd "$MOBILE_DIR/android"
"$GRADLE_BIN" assembleRelease --no-daemon \
  -Pandroid.buildToolsVersion=34.0.0 \
  -PreactNativeArchitectures="$ANDROID_ABI"

APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
echo
echo "APK: $APK"
ls -la "$APK"
