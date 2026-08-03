/**
 * AppSync client. Documents below are hand-written against the backend's
 * published schema; `npm run codegen` regenerates typed operations into
 * src/api/generated/ once the backend exports its SDL
 * (docs/BACKEND_ASKS.md #3).
 */
import { generateClient } from 'aws-amplify/api';

// Narrow surface: avoids Amplify's schema-generic types (which explode tsc
// without codegen) and is all the sync/outbox layers need.
export interface GqlOperation {
  query: string;
  variables?: Record<string, unknown>;
}
export interface GqlClient {
  graphql(op: GqlOperation): Promise<unknown>;
}

let client: GqlClient | null = null;

export function gqlClient(): GqlClient {
  if (!client) client = generateClient() as unknown as GqlClient;
  return client;
}

export const RECORD_SCAN = /* GraphQL */ `
  mutation RecordScan($input: RecordScanInput!) {
    recordScan(input: $input) {
      jti
      gate
      accepted
    }
  }
`;

export const SCHEDULE_DELTA = /* GraphQL */ `
  query ScheduleDelta($since: AWSTimestamp) {
    scheduleDelta(since: $since) {
      items {
        id
        day
        venue
        startsAt
        endsAt
        titleEn
        titleHi
        data
      }
      cursor
    }
  }
`;

export const REVOCATIONS_DELTA = /* GraphQL */ `
  query RevocationsDelta($since: AWSTimestamp) {
    revocationsDelta(since: $since) {
      items {
        jti
        revokedAt
      }
      cursor
    }
  }
`;

export const ON_ORDER_CONFIRMED = /* GraphQL */ `
  subscription OnOrderConfirmed($orderId: ID!) {
    onOrderConfirmed(orderId: $orderId) {
      orderId
      status
      passTokens
    }
  }
`;
