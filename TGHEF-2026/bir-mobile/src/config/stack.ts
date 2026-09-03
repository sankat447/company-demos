/**
 * Typed accessor for the stack contract — the ONLY binding to the AWS project.
 * All AWS-touching code goes through this module (CLAUDE.md hard rule 1).
 * `npm run contract:check` validates the JSON against schemas/stack-contract.schema.json.
 */
import raw from '../../config/stack-outputs.json';

export interface StackContract {
  region: string;
  auth: {
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
    otpChannel: 'sms';
  };
  api: {
    graphqlEndpoint: string;
    graphqlRealtime: string;
    restBase: string;
  };
  storage: {
    mediaBucket: string;
    cdnDomain: string;
    appDistBucket: string;
    appDistDomain: string;
  };
  push: { pinpointAppId: string; fcmSenderId: string };
  ai: {
    assistantPath: string;
    plannerPath: string;
    translatePath: string;
    queuePredictPath: string;
  };
  payments: { provider: 'razorpay' | 'cashfree'; orderPath: string; webhookVerified: true };
  passes: { issuerKid: string; jwksPath: string; alg: 'ES256' };
  realtime: { alertTopicArnParam: string };
  geo: { geofenceCollection: string; shuttleTrackerName: string };
  flags: { festivalMode: boolean; experiencesMarketplace: boolean } & Record<string, boolean>;
  observability?: { sentryDsn?: string };
  /** CO-002 / B1: server-driven Highlights catalog (absolute CDN URL). */
  highlights?: { catalogPath?: string };
}

const stack = raw as unknown as StackContract;

export function getStack(): StackContract {
  return stack;
}

/** Origin of the REST API (restBase minus its base path), e.g. https://api.bir.example */
export function restOrigin(): string {
  const m = stack.api.restBase.match(/^https:\/\/[^/]+/);
  if (!m) throw new Error(`contract api.restBase is not an https URL: ${stack.api.restBase}`);
  return m[0];
}

/** Absolute URL for a contract-declared REST path (paths always start with "/"). */
export function restUrl(path: string): string {
  return `${stack.api.restBase.replace(/\/$/, '')}${path}`;
}

/**
 * JWKS for offline pass verification. The contract exports a path;
 * we resolve it against the REST origin (see docs/BACKEND_ASKS.md #2
 * asking the backend to confirm/export an absolute URL).
 */
export function jwksUrl(): string {
  return `${restOrigin()}${stack.passes.jwksPath}`;
}

export function cdnUrl(path: string): string {
  return `https://${stack.storage.cdnDomain}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Absolute URL of the server-driven Highlights catalog (B1). Prefers the
 * contract's `highlights.catalogPath` when present; otherwise resolves the
 * conventional CDN key so a stack that hasn't exported the path yet still works.
 */
export function highlightsCatalogUrl(): string {
  return stack.highlights?.catalogPath ?? cdnUrl('/config/highlights/catalog.json');
}
