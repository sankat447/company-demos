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

/** AppSync subscriptions return an observable, not a promise. */
export interface GqlSubscription {
  subscribe(handlers: { next(value: unknown): void; error(err: unknown): void }): {
    unsubscribe(): void;
  };
}

let raw: unknown = null;

function rawClient(): unknown {
  if (!raw) raw = generateClient();
  return raw;
}

export function gqlClient(): GqlClient {
  return rawClient() as GqlClient;
}

export function gqlSubscribe(op: GqlOperation): GqlSubscription {
  return (rawClient() as { graphql(o: GqlOperation): GqlSubscription }).graphql(op);
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

export const TICKET_TIERS = /* GraphQL */ `
  query TicketTiers {
    ticketTiers {
      items {
        id
        titleEn
        titleHi
        priceInr
        description
      }
    }
  }
`;

// Recovery path for app-killed-between-pay-and-confirm (BACKEND_ASKS #15).
export const GET_ORDER = /* GraphQL */ `
  query GetOrder($orderId: ID!) {
    getOrder(orderId: $orderId) {
      orderId
      status
      passTokens
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
