/**
 * Role resolution from Cognito groups (P1.2). One binary; partner/volunteer
 * surfaces render only when the group claim is present (ARCHITECTURE.md §4).
 */
import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { useEffect, useState } from 'react';

import { isDemoSession } from '@/demo/demo';
import { kvStore } from '@/offline/db';

// admin-hospitality (CO-003): organiser family — the client gate is UX only;
// the server enforces the group on every lodging/badge mutation (ASK #27).
export type Role =
  'visitor' | 'partner' | 'volunteer' | 'organiser-lite' | 'admin-hospitality' | 'safety-officer';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  roles: Role[];
  demo?: boolean;
}

const KNOWN_ROLES: Role[] = [
  'visitor',
  'partner',
  'volunteer',
  'organiser-lite',
  'admin-hospitality',
  'safety-officer',
];

/**
 * Read the demo flag, tolerating a transient kv error. Returns the boolean the
 * store actually holds, or 'error' only if every attempt threw — never a bare
 * `false`, so a momentary "database is locked" can't masquerade as "no demo
 * session" and evict a signed-in demo user.
 */
async function readDemoSession(): Promise<boolean | 'error'> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await isDemoSession(kvStore);
    } catch {
      // retry immediately — getDb() now shares one open, so the next await wins
    }
  }
  return 'error';
}

const DEMO_ROLES: Role[] = [
  'visitor',
  'partner',
  'volunteer',
  'organiser-lite',
  'admin-hospitality',
  'safety-officer',
];

export async function resolveAuthState(): Promise<AuthState> {
  // Demo session first: evaluation builds run without any backend. Demo
  // sessions include admin-hospitality so the CO-003 lodging flow is
  // evaluable end-to-end without a backend (mock fixtures).
  const demo = await readDemoSession();
  if (demo === true) return { status: 'signedIn', roles: DEMO_ROLES, demo: true };
  // A transient kv failure must NOT downgrade to signedOut (that boots the
  // user back to OTP). Report 'loading' so useAuth keeps the current UI and
  // retries. Only a definitive `false` proceeds to the real session check.
  if (demo === 'error') return { status: 'loading', roles: [] };
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
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void resolveAuthState().then((s) => {
        if (!mounted) return;
        setState(s);
        // A resolve of 'loading' after mount means a transient kv error, not a
        // real state — retry (bounded) so it self-heals without a Hub event.
        if (s.status === 'loading' && retries < 8) {
          retries += 1;
          timer = setTimeout(refresh, 300);
        } else {
          retries = 0;
        }
      });
    };
    refresh();
    const unsubscribe = Hub.listen('auth', refresh);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return state;
}

export function hasRole(state: AuthState, role: Role): boolean {
  return state.roles.includes(role);
}
