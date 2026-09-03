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

// Official "Can I fly today?" status (P3.3, CO-001 E3). The safety officer's
// call is final; the app renders state and notifies — refund queueing is
// backend-driven (refunds.autoQueueFlag, BACKEND_ASKS #13).
export const FLY_STATUS = /* GraphQL */ `
  query FlyStatus {
    flyStatus {
      state
      reasonEn
      reasonHi
      updatedAt
      refundsAutoQueued
    }
  }
`;

export const ON_FLY_STATUS_CHANGED = /* GraphQL */ `
  subscription OnFlyStatusChanged {
    onFlyStatusChanged {
      state
      reasonEn
      reasonHi
      updatedAt
      refundsAutoQueued
    }
  }
`;

// SOS location report (P3.3) — fired once per SOS with consent; the call
// itself goes through the dialer and never depends on connectivity.
export const REPORT_SOS = /* GraphQL */ `
  mutation ReportSos($input: ReportSosInput!) {
    reportSos(input: $input) {
      accepted
    }
  }
`;

// Push registration (P3.4) — the backend owns the Pinpoint endpoint; the
// client only registers token + prefs. Quiet hours enforced server-side.
// Highlights standard registration (CO-002, ASK #22) — free items arrive via
// outbox drain; backend dedupes on idempotencyKey (one per user+item+slot).
export const CREATE_REGISTRATION = /* GraphQL */ `
  mutation CreateRegistration($input: CreateRegistrationInput!) {
    createRegistration(input: $input) {
      registrationId
      status
    }
  }
`;

// Lodging pool (CO-003, ASK #28 / B2a): confirmed participants who need lodging.
// admin-hospitality-guarded server-side. gender is lodging-only (never on badges).
export const LODGING_POOL = /* GraphQL */ `
  query LodgingPool {
    lodgingPool {
      regId
      name
      competitionId
      gender
      coupleGroupId
      nights
      needsLodging
    }
  }
`;

// Lodging allocation commit (CO-003, ASK #29): server re-validates the §3
// hard constraints, audit-logs (actorNote on overrides), notifies participants.
export const COMMIT_ALLOCATION = /* GraphQL */ `
  mutation CommitAllocation($input: CommitAllocationInput!) {
    commitAllocation(input: $input) {
      version
      accepted
      violations
    }
  }
`;

// Cancel where policy allows (CO-002, ASK #24); response carries refund state.
export const CANCEL_REGISTRATION = /* GraphQL */ `
  mutation CancelRegistration($input: CancelRegistrationInput!) {
    cancelRegistration(input: $input) {
      registrationId
      status
      refundState
    }
  }
`;

export const SET_FLY_STATUS = /* GraphQL */ `
  mutation SetFlyStatus($input: SetFlyStatusInput!) {
    setFlyStatus(input: $input) {
      state
      accepted
    }
  }
`;

export const RECORD_ATTENDANCE = /* GraphQL */ `
  mutation RecordAttendance($input: RecordAttendanceInput!) {
    recordAttendance(input: $input) {
      shiftId
      kind
      accepted
    }
  }
`;

export const REPORT_INCIDENT = /* GraphQL */ `
  mutation ReportIncident($input: ReportIncidentInput!) {
    reportIncident(input: $input) {
      incidentId
      accepted
    }
  }
`;

export const REGISTER_DEVICE = /* GraphQL */ `
  mutation RegisterDevice($input: RegisterDeviceInput!) {
    registerDevice(input: $input) {
      accepted
    }
  }
`;

// Audience-favourite voting (P3.2) — votes power the award ceremonies;
// backend dedupes on idempotencyKey (one vote per user per event).
export const CAST_VOTE = /* GraphQL */ `
  mutation CastVote($input: CastVoteInput!) {
    castVote(input: $input) {
      eventId
      accepted
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
