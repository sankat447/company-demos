/**
 * Amplify v6 configured at RUNTIME from the stack contract — never from
 * hardcoded IDs, never via `amplify pull` (CLAUDE.md fixed decision).
 *
 * Tokens persist in the device Keychain/Keystore via expo-secure-store when it
 * works, and fall back to app-private AsyncStorage when it doesn't — some
 * Android devices/emulators throw a Keystore SYSTEM_ERROR, and SecureStore also
 * caps values at ~2 KB, either of which would otherwise silently drop the
 * session so sign-in "succeeds" server-side but never persists. The fallback
 * keeps sign-in reliable everywhere; SecureStore stays the primary secure path.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import * as SecureStore from 'expo-secure-store';

import { getStack } from './stack';

const FB = 'amp.fb.'; // AsyncStorage fallback namespace

const secureKeyValueStorage = {
  async setItem(key: string, value: string): Promise<void> {
    const k = sanitize(key);
    try {
      await SecureStore.setItemAsync(k, value);
      await AsyncStorage.removeItem(FB + k).catch(() => {}); // drop any stale fallback
    } catch {
      await AsyncStorage.setItem(FB + k, value);
    }
  },
  async getItem(key: string): Promise<string | null> {
    const k = sanitize(key);
    try {
      const v = await SecureStore.getItemAsync(k);
      if (v != null) return v;
    } catch {
      // Keystore unavailable — fall through to the AsyncStorage copy.
    }
    return AsyncStorage.getItem(FB + k);
  },
  async removeItem(key: string): Promise<void> {
    const k = sanitize(key);
    await SecureStore.deleteItemAsync(k).catch(() => {});
    await AsyncStorage.removeItem(FB + k).catch(() => {});
  },
  async clear(): Promise<void> {
    // SecureStore has no clear(); Amplify only calls this on full sign-out,
    // where removeItem is invoked per key first.
  },
};

// SecureStore keys must be alphanumeric plus ._-
function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

let configured = false;

export function configureAmplify(): void {
  if (configured) return;
  const stack = getStack();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: stack.auth.userPoolId,
        userPoolClientId: stack.auth.userPoolClientId,
        identityPoolId: stack.auth.identityPoolId,
      },
    },
    API: {
      GraphQL: {
        endpoint: stack.api.graphqlEndpoint,
        region: stack.region,
        defaultAuthMode: 'userPool',
      },
      REST: {
        bir: { endpoint: stack.api.restBase, region: stack.region },
      },
    },
  });

  cognitoUserPoolsTokenProvider.setKeyValueStorage(secureKeyValueStorage);
  configured = true;
}
