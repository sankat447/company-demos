#!/usr/bin/env node
/**
 * Bridges `cdk deploy --outputs-file cdk-outputs.json` into the mobile app's
 * contract file (config/stack-outputs.json). Run after deploy:
 *   npm run deploy && npm run emit-contract
 * This is the ONLY place the two projects touch — the app validates the
 * result against schemas/stack-contract.schema.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cdkOutputs = JSON.parse(readFileSync(join(here, '..', 'cdk-outputs.json'), 'utf8'));
const o = cdkOutputs.BirFestival2026Backend ?? {};

const contract = {
  region: o.region,
  auth: {
    userPoolId: o.authUserPoolId,
    userPoolClientId: o.authUserPoolClientId,
    identityPoolId: o.authIdentityPoolId,
    otpChannel: 'sms',
  },
  api: {
    graphqlEndpoint: o.apiGraphqlEndpoint,
    graphqlRealtime: o.apiGraphqlRealtime,
    restBase: o.apiRestBase ?? 'https://REPLACE.execute-api.amazonaws.com/v1',
  },
  storage: {
    mediaBucket: o.storageMediaBucket,
    cdnDomain: o.storageCdnDomain,
    appDistBucket: o.storageAppDistBucket,
    appDistDomain: o.storageAppDistDomain,
  },
  push: { pinpointAppId: o.pushPinpointAppId ?? 'REPLACE', fcmSenderId: o.pushFcmSenderId ?? 'REPLACE' },
  ai: {
    assistantPath: '/ai/assistant',
    plannerPath: '/ai/planner',
    translatePath: '/ai/translate',
    queuePredictPath: '/ai/queue',
  },
  payments: { provider: 'razorpay', orderPath: '/pay/order', webhookVerified: true },
  passes: { issuerKid: o.passesIssuerKid, jwksPath: '/.well-known/bir-passes/jwks.json', alg: 'ES256' },
  realtime: { alertTopicArnParam: '/bir/sns/emergency' },
  geo: { geofenceCollection: 'bir-venues', shuttleTrackerName: 'bir-shuttles' },
  flags: { festivalMode: true, experiencesMarketplace: true },
};

const target = join(here, '..', '..', 'bir-mobile', 'config', 'stack-outputs.json');
writeFileSync(target, JSON.stringify(contract, null, 2) + '\n');
console.log(`✔ wrote ${target}`);
console.log('  Next: cd ../bir-mobile && npm run contract:check');
