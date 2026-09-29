/**
 * Regression: a transient kv/SQLite error while reading the demo session must
 * NOT evict a signed-in demo user to 'signedOut' (which bounced them back to
 * the OTP screen at random). It reports 'loading' and retries instead.
 */
jest.mock('@/demo/demo', () => ({ isDemoSession: jest.fn() }));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn() }));
jest.mock('aws-amplify/utils', () => ({ Hub: { listen: jest.fn() } }));
jest.mock('@/offline/db', () => ({ kvStore: { get: jest.fn(), set: jest.fn() } }));

import { fetchAuthSession } from 'aws-amplify/auth';

import { resolveAuthState } from '@/auth/useAuth';
import { isDemoSession } from '@/demo/demo';

const mockDemo = isDemoSession as jest.Mock;
const mockSession = fetchAuthSession as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('resolveAuthState', () => {
  it('signs in with all demo roles when the demo flag is set', async () => {
    mockDemo.mockResolvedValue(true);
    const s = await resolveAuthState();
    expect(s.status).toBe('signedIn');
    expect(s.demo).toBe(true);
    expect(s.roles).toContain('admin-hospitality');
  });

  it('does NOT sign out on a transient kv error — reports loading', async () => {
    mockDemo.mockRejectedValue(new Error('database is locked'));
    const s = await resolveAuthState();
    expect(s.status).toBe('loading');
  });

  it('recovers when a retry of the demo read succeeds', async () => {
    mockDemo.mockRejectedValueOnce(new Error('locked')).mockResolvedValue(true);
    const s = await resolveAuthState();
    expect(s.status).toBe('signedIn');
  });

  it('falls through to the real session only on a definitive non-demo read', async () => {
    mockDemo.mockResolvedValue(false);
    mockSession.mockResolvedValue({ tokens: undefined });
    const s = await resolveAuthState();
    expect(s.status).toBe('signedOut');
  });
});
