/**
 * B9: registerDevice resolver (AppSync → Lambda). Records the signed-in user's
 * push token + preferences in the backend's own device registry so the backend
 * owns targeting (app only sends its native FCM/APNs token + prefs — see
 * src/features/notifications/push.ts). Quiet hours and per-user budgets are
 * enforced server-side; the fly-status/alert fan-out (B10) reads these rows.
 *
 * NOTE: we deliberately do NOT call Amazon Pinpoint UpdateEndpoint here — AWS is
 * retiring Pinpoint's engagement endpoint APIs (they already return Forbidden on
 * this account, sunset 2026-10-30). The registry is a plain DynamoDB partition
 * (DEVICE#<sub> / <platform>), which the SNS fan-out consumes. push.pinpointAppId
 * is still emitted for contract compatibility.
 *
 * Invoked with the full AppSync $context (lambda-invoke.req.vtl): identity and
 * arguments arrive as event.identity / event.arguments. Returns Ack { accepted }.
 * @aws-sdk/client-dynamodb ships in the Node.js 20 Lambda runtime — no bundle.
 */
'use strict';
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;

exports.handler = async (event) => {
  const sub = event && event.identity && event.identity.sub;
  const input = (event && event.arguments && event.arguments.input) || {};
  if (!sub || !input.token) return { accepted: false };

  const platform = String(input.platform).toUpperCase() === 'APNS' ? 'APNS' : 'FCM';
  const roles = Array.isArray(input.roles) ? input.roles.map(String) : [];
  const nowMs = Date.now();

  const item = {
    pk: { S: `DEVICE#${sub}` },
    sk: { S: platform },
    token: { S: String(input.token) },
    platform: { S: platform },
    locale: { S: String(input.locale || 'en') },
    roles: roles.length ? { SS: roles } : { NULL: true },
    updatedAt: { N: String(nowMs) },
    idempotencyKey: { S: String(input.idempotencyKey || `${sub}:${platform}:${nowMs}`) },
  };
  if (Number.isInteger(input.quietStartHour)) item.quietStartHour = { N: String(input.quietStartHour) };
  if (Number.isInteger(input.quietEndHour)) item.quietEndHour = { N: String(input.quietEndHour) };

  try {
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));
    return { accepted: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('registerDevice PutItem failed:', (e && e.message) || e);
    return { accepted: false };
  }
};
