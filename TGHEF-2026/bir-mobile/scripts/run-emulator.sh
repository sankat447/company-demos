#!/usr/bin/env bash
# =============================================================================
#  Boot an Android emulator and deploy the Bir Festival 2026 evaluation APK,
#  so you can test on-screen without sideloading to a physical device.
#
#  Usage:   ./scripts/run-emulator.sh
#  Rebuild the APK first with:  ./scripts/build-eval-apk.sh   (or see docs)
#
#  Notes:
#   - Uses -gpu angle_indirect (ANGLE over Vulkan). On macOS 26 the default
#     host-OpenGL path shows a BLACK window (Apple deprecated OpenGL), and
#     plain swiftshader_indirect crashed with a color-buffer error here;
#     ANGLE renders complex SVG/graphics reliably and stays up.
#   - The AVD keeps its state, so the installed app + demo session persist
#     across restarts. Sign in with ANY 10-digit number + OTP 123456.
# =============================================================================
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/usr/local/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

AVD="${AVD:-bir_test}"
IMAGE="system-images;android-34;google_apis;x86_64"     # x86_64 host (Intel Mac)
PKG="org.birfestival.app"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${APK:-$HERE/android/app/build/outputs/apk/release/app-release.apk}"

[[ -f "$APK" ]] || { echo "APK not found: $APK  (build it first)"; exit 1; }

# 1. Create the AVD if it doesn't exist (points at the installed system image).
if ! avdmanager list avd 2>/dev/null | grep -q "Name: ${AVD}\$"; then
  echo "Creating AVD ${AVD}..."
  echo "no" | avdmanager create avd -n "$AVD" -k "$IMAGE" -d "pixel_5" --force
fi

# 2. Boot it (ANGLE) unless one is already attached. Fully detach it
# (own session via setsid if available, </dev/null, nohup, disown) so it
# survives after this script — and the launching shell — exits.
if ! adb devices | grep -q "emulator-.*device"; then
  echo "Booting emulator ${AVD} (ANGLE)..."
  DETACH=""; command -v setsid >/dev/null 2>&1 && DETACH="setsid"
  $DETACH nohup "$ANDROID_HOME/emulator/emulator" @"$AVD" \
    -no-boot-anim -no-snapshot -gpu angle_indirect \
    </dev/null >/tmp/bir-emulator.log 2>&1 &
  disown 2>/dev/null || true
fi

# 3. Wait for full boot.
echo "Waiting for boot..."
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
adb shell input keyevent 82 >/dev/null 2>&1 || true   # dismiss keyguard

# 4. Install + launch.
echo "Installing $(basename "$APK")..."
adb install -r "$APK"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

echo "✔ ${PKG} deployed and launched. Sign in: any 10-digit number, OTP 123456."
