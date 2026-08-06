/**
 * Role resolution from Cognito groups (P1.2). One binary; partner/volunteer
 * surfaces render only when the group claim is present (ARCHITECTURE.md §4).
 */
import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useEffect, useState } from 'react';

import { isDemoSession } from '@/demo/demo';
import { kvStore } from '@/offline/db';

export type Role = 'visitor' | 'partner' | 'volunteer' | 'organiser-lite';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  roles: Role[];
  demo?: boolean;
}

const KNOWN_ROLES: Role[] = ['visitor', 'partner', 'volunteer', 'organiser-lite'];

export async function resolveAuthState(): Promise<AuthState> {
  // Demo session first: evaluation builds run without any backend.
  try {
    if (await isDemoSession(kvStore)) {
      return { status: 'signedIn', roles: ['visitor'], demo: true };
    }
  } catch {
    // kv unavailable → fall through to the real session check
  }
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.idToken) return { status: 'signedOut', roles: [] };
    const groups = (session.tokens.idToken.payload['cognito:groups'] as string[] | undefined) ?? [];
    const roles = KNOWN_ROLES.filter((r) => groups.includes(r));
    return { status: 'signedIn', roles: roles.length ? roles : ['visitor'] };
  } catch {
    return { status: 'signedOut', roles: [] };
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading', roles: [] });

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void resolveAuthState().then((s) => {
        if (mounted) setState(s);
      });
    };
    refresh();
    const unsubscribe = Hub.listen('auth', refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}

export function hasRole(state: AuthState, role: Role): boolean {
  return state.roles.includes(role);
}
