/**
 * App mode (CO-004 live): the launch picker splits the app into the Visitor
 * experience (Cognito phone/OTP) and Staff (admin username/password + scanner).
 * Persisted locally so a returning user lands straight in their last mode; the
 * "switch mode" affordance clears it to show the picker again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppMode = 'visitor' | 'staff';
const KEY = 'bir.appMode.v1';

export async function getMode(): Promise<AppMode | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'visitor' || v === 'staff' ? v : null;
  } catch {
    return null;
  }
}

export async function setMode(mode: AppMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // Non-fatal: the picker just shows again next launch.
  }
}

export async function clearMode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
