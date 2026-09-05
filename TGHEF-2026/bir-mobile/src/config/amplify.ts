/**
 * Amplify v6 configured at RUNTIME from the stack contract — never from
 * hardcoded IDs, never via `amplify pull` (CLAUDE.md fixed decision).
 *
 * Tokens persist in app-private AsyncStorage. We deliberately do NOT use
 * expo-secure-store for the Cognito tokens: its ~2 KB per-item cap is smaller
 * than a Cognito ID/access token (which carries the group claims), and on some
 * Android devices/emulators its Keystore path throws — either of which left
 * sign-in "succeeding" in memory but persisting nothing, so the app bounced the
 * user straight back to the OTP screen on the next launch. AsyncStorage has no
 * size cap and is sandboxed to the app. (For production, revisit hardware-backed
 * storage — it must chunk values across the 2 KB cap to hold real tokens.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

import { getStack } from './stack';

const tokenStorage = {
  setItem: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  getItem: (key: string): Promise<string | null> => AsyncStorage.getItem(key),
  removeItem: (key: string): Promise<void> => AsyncStorage.removeItem(key),
  async clear(): Promise<void> {
    // No-op on purpose: AsyncStorage.clear() would wipe the whole app store
    // (outbox, kv, i18n). Amplify removes each token key via removeItem on
    // sign-out, so a blanket clear is neither needed nor safe here.
  },
};

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

  cognitoUserPoolsTokenProvider.setKeyValueStorage(tokenStorage);
  configured = true;
}
