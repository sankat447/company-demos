#!/usr/bin/env bash
# =============================================================================
#  Build the Bir Festival 2026 STORE Android App Bundle (.aab) for Google Play.
#
#  Unlike build-eval-apk.sh (self-contained demo, example contract, debug-
#  signed APK), this builds against the LIVE stack contract
#  (config/stack-outputs.json, mock* flags OFF -> real backend), APP_CHANNEL=
#  store, and signs the release with the UPLOAD keystore in credentials/ (see
#  credentials/keystore.env). Output is a Play-uploadable .aab.
#
#  Prereq: credentials/upload.keystore + credentials/keystore.env exist.
#  Output: android/app/build/outputs/bundle/release/app-release.aab
# =============================================================================
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export APP_CHANNEL=store

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

CONTRACT="config/stack-outputs.json"
[[ -f "$CONTRACT" ]] || { echo "no live contract at $CONTRACT — a store build needs the real stack outputs"; exit 1; }
[[ -f credentials/keystore.env ]] || { echo "missing credentials/keystore.env — run keystore setup first"; exit 1; }
# shellcheck disable=SC1091
source credentials/keystore.env

MOCKS="$(node -e "const f=require('./config/stack-outputs.json').flags||{}; console.log(Object.keys(f).filter(k=>k.startsWith('mock')&&f[k]).join(',')||'none')")"
echo "live contract userPool: $(node -e "console.log(require('./config/stack-outputs.json').auth.userPoolId)")  (mock flags on: $MOCKS)"

echo "=== expo prebuild (regenerate android/) ==="
npx expo prebuild -p android --clean --no-install

echo "=== inject upload signing into android/app/build.gradle ==="
node - "$BIR_UPLOAD_STORE_FILE" "$BIR_UPLOAD_KEY_ALIAS" "$BIR_UPLOAD_STORE_PASSWORD" "$BIR_UPLOAD_KEY_PASSWORD" <<'NODE'
const fs = require('fs');
const [storeFile, alias, storePw, keyPw] = process.argv.slice(2);
const p = 'android/app/build.gradle';
let g = fs.readFileSync(p, 'utf8');
if (!g.includes('signingConfigs.upload')) {
  // add an `upload` signingConfig right after `signingConfigs {`
  g = g.replace(/signingConfigs\s*\{/, (m) => `${m}
        upload {
            storeFile file(BIR_UPLOAD_STORE_FILE)
            storePassword BIR_UPLOAD_STORE_PASSWORD
            keyAlias BIR_UPLOAD_KEY_ALIAS
            keyPassword BIR_UPLOAD_KEY_PASSWORD
        }`);
  // point ONLY the release buildType at it: match from `release {` to the first
  // `signingConfig signingConfigs.debug` after it (the debug buildType's own
  // reference appears earlier and is left untouched).
  g = g.replace(/(release\s*\{[^]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.upload');
  fs.writeFileSync(p, g);
}
// credentials live in gradle.properties (values, not committed — android/ is gitignored)
const gp = 'android/gradle.properties';
let props = fs.existsSync(gp) ? fs.readFileSync(gp, 'utf8') : '';
props += `\nBIR_UPLOAD_STORE_FILE=${storeFile}\nBIR_UPLOAD_KEY_ALIAS=${alias}\nBIR_UPLOAD_STORE_PASSWORD=${storePw}\nBIR_UPLOAD_KEY_PASSWORD=${keyPw}\n`;
fs.writeFileSync(gp, props);
console.log('patched build.gradle + gradle.properties');
NODE

echo "=== gradlew bundleRelease ==="
( cd android && ./gradlew bundleRelease --no-daemon -x lint )

AAB="android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$AAB" ]] || { echo "bundle failed"; exit 1; }
echo "✔ built $HERE/$AAB"
# verify it is signed with the upload key (not debug)
echo "=== signer ==="
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs --min-sdk-version 24 "$AAB" 2>/dev/null | grep -iE "Signer #1 certificate DN|SHA-256" | head -3 || \
  keytool -printcert -jarfile "$AAB" 2>/dev/null | grep -iE "Owner|SHA256" | head -2
