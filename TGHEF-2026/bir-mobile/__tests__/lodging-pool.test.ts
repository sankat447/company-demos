/**
 * B2a: loadPool reads the admin-hospitality pool from the backend when
 * mockLodging is off, and the bundled fixture when it's on.
 */
jest.mock('@/config/flags', () => ({ isEnabled: jest.fn() }));
jest.mock('@/api/graphql', () => ({ gqlClient: jest.fn(), LODGING_POOL: 'LODGING_POOL_DOC' }));

import { gqlClient } from '@/api/graphql';
import { isEnabled } from '@/config/flags';
import { loadPool } from '@/features/lodging/allocation';

const mockEnabled = isEnabled as jest.Mock;
const mockClient = gqlClient as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it('mock off → fetches the pool from the backend query', async () => {
  mockEnabled.mockReturnValue(false);
  const graphql = jest.fn().mockResolvedValue({
    data: {
      lodgingPool: [
        {
          regId: 'reg:p1:him-queen-2026:na',
          name: 'Anita Thakur',
          competitionId: 'him-queen-2026',
          gender: 'female',
          nights: ['2026-11-21'],
          needsLodging: true,
        },
      ],
    },
  });
  mockClient.mockReturnValue({ graphql });
  const pool = await loadPool();
  expect(graphql).toHaveBeenCalledWith({ query: 'LODGING_POOL_DOC' });
  expect(pool).toHaveLength(1);
  expect(pool[0].name).toBe('Anita Thakur');
});

it('mock on → returns the fixture with no network call', async () => {
  mockEnabled.mockReturnValue(true);
  const pool = await loadPool();
  expect(pool.length).toBeGreaterThan(0);
  expect(mockClient).not.toHaveBeenCalled();
});

it('empty backend → empty pool', async () => {
  mockEnabled.mockReturnValue(false);
  mockClient.mockReturnValue({
    graphql: jest.fn().mockResolvedValue({ data: { lodgingPool: [] } }),
  });
  expect(await loadPool()).toEqual([]);
});
