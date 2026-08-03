/**
 * Amplify v6 configured at RUNTIME from the stack contract — never from
 * hardcoded IDs, never via `amplify pull` (CLAUDE.md fixed decision).
 * Tokens persist in Keychain/Keystore via expo-secure-store.
 */
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import * as SecureStore from 'expo-secure-store';

import { getStack } from './stack';

const secureKeyValueStorage = {
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(sanitize(key), value);
  },
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(sanitize(key));
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(sanitize(key));
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
