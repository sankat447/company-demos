import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-run festival introduction gate. Shown once, right after the first
 * successful sign-in (OTP or demo), then never again. Persisted locally so it
 * survives app restarts; a fresh install / cleared storage shows it again.
 */
const KEY = 'bir.intro.seen.v1';

export async function hasSeenIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // If storage is unreadable, don't trap the user on the intro — treat as seen.
    return true;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort; a failure here only means the intro may show once more.
  }
}
