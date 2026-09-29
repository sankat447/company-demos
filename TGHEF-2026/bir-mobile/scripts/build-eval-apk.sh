#!/usr/bin/env bash
# =============================================================================
#  Build the Bir Festival 2026 EVALUATION Android APK (self-contained demo).
#
#  Bundles the EXAMPLE stack contract (placeholder Cognito -> demo fallback,
#  OTP 123456, all six roles, mock* flags on, payments disabled) so the app
#  runs with sample data and no backend. Any live config/stack-outputs.json is
#  backed up and restored afterwards.
#
#  Output: android/app/build/outputs/apk/release/app-release.apk
#  Then:   ./scripts/run-emulator.sh   (deploy to an emulator)
#     or:  node scripts/publish-demo-page.mjs --apk <that path> \
#              --profile rhoai-demo --region us-east-1 --version 0.4.0-demo
# =============================================================================
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

CONTRACT="config/stack-outputs.json"
EXAMPLE="config/stack-outputs.example.json"
BACKUP=""

cleanup() {
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    mv -f "$BACKUP" "$CONTRACT"
    echo "restored live contract -> $CONTRACT"
  fi
}
trap cleanup EXIT

# 1. Swap in the eval (example) contract for the bundle.
if [[ -f "$CONTRACT" ]]; then
  BACKUP="$(mktemp)"
  cp "$CONTRACT" "$BACKUP"
fi
cp "$EXAMPLE" "$CONTRACT"
echo "using eval contract: $(node -e "console.log(require('./config/stack-outputs.json').auth.userPoolId)")"

# 2. Build.
echo "=== expo prebuild (regenerate android/) ==="
npx expo prebuild -p android --clean --no-install
echo "=== gradlew assembleRelease ==="
( cd android && ./gradlew assembleRelease --no-daemon -x lint )

APK="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] && echo "✔ built $HERE/$APK" || { echo "build failed"; exit 1; }
