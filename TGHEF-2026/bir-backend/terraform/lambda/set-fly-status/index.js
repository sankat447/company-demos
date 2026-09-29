/**
 * B10: setFlyStatus resolver (AppSync → Lambda) — SAFETY-OFFICER guarded.
 * Declares the official paragliding fly-status (flying / hold / closed), which:
 *   1. writes the single FLYSTATUS/current row (drives the app banner + the
 *      onFlyStatusChanged GraphQL subscription — AppSync fans the return value
 *      out to subscribed devices),
 *   2. when the sky is CLOSED, auto-queues refunds for affected flight bookings
 *      (a REFUNDQ job row the settlement process consumes) and flags
 *      refundsAutoQueued,
 *   3. publishes to the fly-status SNS topic for the push fan-out.
 *
 * Invoked with the full AppSync $context (lambda-invoke.req.vtl): identity +
 * arguments arrive as event.identity / event.arguments. Returns the FlyStatus
 * shape so the subscription payload is complete.
 * @aws-sdk clients ship in the Node.js 20 Lambda runtime — no bundle.
 */
'use strict';
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const ddb = new DynamoDBClient({});
const sns = new SNSClient({});
const TABLE = process.env.TABLE;
const TOPIC = process.env.FLY_TOPIC_ARN;

/** States that ground flights → refunds for that window get auto-queued. */
const NO_FLY = new Set(['closed', 'no-fly', 'grounded']);

exports.handler = async (event) => {
  const identity = event && event.identity;
  const groups = (identity && identity.groups) || [];
  if (!Array.isArray(groups) || !groups.includes('safety-officer')) {
    throw new Error('Unauthorized: safety-officer only');
  }

  const input = (event && event.arguments && event.arguments.input) || {};
  const state = String(input.state || '').toLowerCase();
  if (!state) throw new Error('state is required');

  const now = Math.floor(Date.now() / 1000);
  const refundsAutoQueued = NO_FLY.has(state);

  // 1) The current-status row (banner + subscription source of truth).
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: 'FLYSTATUS' },
        sk: { S: 'current' },
        state: { S: state },
        reasonEn: { S: String(input.reasonEn || '') },
        reasonHi: { S: String(input.reasonHi || '') },
        updatedAt: { N: String(now) },
        declaredBy: { S: String(input.declaredBy || identity.sub || 'safety-officer') },
        refundsAutoQueued: { BOOL: refundsAutoQueued },
      },
    }),
  );

  // 2) Refund auto-queue when the sky closes. The job row is idempotent on the
  //    declaration's idempotencyKey, so a re-drained mutation won't double-queue.
  if (refundsAutoQueued) {
    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          pk: { S: 'REFUNDQ' },
          sk: { S: String(input.idempotencyKey || `fly:${now}`) },
          trigger: { S: `fly-status:${state}` },
          reasonEn: { S: String(input.reasonEn || '') },
          declaredBy: { S: String(input.declaredBy || identity.sub || 'safety-officer') },
          queuedAt: { N: String(now) },
          status: { S: 'QUEUED' },
        },
      }),
    );
  }

  // 3) Push fan-out signal (best-effort — never fail the declaration on this).
  if (TOPIC) {
    try {
      await sns.send(
        new PublishCommand({
          TopicArn: TOPIC,
          Subject: `Fly-status: ${state}`,
          Message: JSON.stringify({
            type: 'FLY_STATUS',
            state,
            reasonEn: input.reasonEn || '',
            reasonHi: input.reasonHi || '',
            refundsAutoQueued,
            updatedAt: now,
          }),
          MessageAttributes: { state: { DataType: 'String', StringValue: state } },
        }),
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('fly-status SNS publish failed:', (e && e.message) || e);
    }
  }

  // Return the full FlyStatus so onFlyStatusChanged subscribers get the payload.
  return {
    state,
    reasonEn: input.reasonEn || null,
    reasonHi: input.reasonHi || null,
    updatedAt: now,
    refundsAutoQueued,
  };
};
