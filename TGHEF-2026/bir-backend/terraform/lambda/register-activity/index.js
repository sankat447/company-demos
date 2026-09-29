/**
 * createRegistration (server-authoritative entitlement). Replaces the old
 * VTL-direct resolver that trusted the client. A confirmed REG row is THE
 * entitlement the gate scanner reads, so it is written here only when it is
 * genuinely earned:
 *   - the registrant's `sub` comes from the VERIFIED identity, not the client
 *     key (closes the impersonation hole),
 *   - PAID items (ITEMCFG.feeInr > 0) are NEVER confirmed here — they are
 *     confirmed exclusively by the payment webhook after a real order,
 *   - FREE items confirm immediately (or waitlist when at capacity),
 *   - unknown items are rejected (never auto-confirmed).
 * Idempotent: the REG sort key is deterministic (reg:<sub>:<itemId>:<slot>).
 */
'use strict';
const { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;
const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(v) });

exports.handler = async (event) => {
  const sub = event.sub;
  const input = event.input || {};
  const itemId = String(input.itemId || '');
  const slotId = String(input.slotId || 'na');
  if (!sub) throw new Error('unauthenticated');
  if (!itemId) throw new Error('itemId is required');

  const sk = `reg:${sub}:${itemId}:${slotId}`;

  // Server-side item config is the ONLY source of fee/gate truth.
  const cfgRes = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: S('ITEMCFG'), sk: S(itemId) } }));
  if (!cfgRes.Item) return { registrationId: sk, status: 'rejected' }; // unknown item

  const feeInr = Number((cfgRes.Item.feeInr && cfgRes.Item.feeInr.N) || 0);
  const capacity = Number((cfgRes.Item.capacity && cfgRes.Item.capacity.N) || 0);

  // Paid → confirmed only by the payment webhook. Never grant a free seat here.
  if (feeInr > 0) return { registrationId: sk, status: 'payment_required' };

  // Free item → confirm, or waitlist when full (an existing seat for this sub
  // keeps its confirmation on a re-drain).
  let status = 'confirmed';
  if (capacity > 0) {
    const { others, mine } = await countConfirmed(itemId, sub);
    if (!mine && others >= capacity) status = 'waitlisted';
  }

  let answers = null;
  try { answers = input.answers ? (typeof input.answers === 'string' ? JSON.parse(input.answers) : input.answers) : null; } catch { answers = null; }

  const item = {
    pk: S('REG'), sk: S(sk), registrationId: S(sk),
    sub: S(sub), itemId: S(itemId), slotId: S(slotId),
    status: S(status), source: S('free'),
    createdAt: N(Math.floor(Date.now() / 1000)),
  };
  if (answers && typeof answers === 'object') {
    item.answers = S(JSON.stringify(answers));
    if (answers.needsLodging === 'yes' || answers.needsLodging === true) item.needsLodging = { BOOL: true };
    if (answers.gender) item.gender = S(String(answers.gender));
  }
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));
  return { registrationId: sk, status };
};

async function countConfirmed(itemId, sub) {
  let others = 0;
  let mine = false;
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :p',
      FilterExpression: 'itemId = :i AND #s = :c',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': S('REG'), ':i': S(itemId), ':c': S('confirmed') },
      ExclusiveStartKey,
    }));
    (r.Items || []).forEach((it) => {
      if (it.sub && it.sub.S === sub) mine = true;
      else others += 1;
    });
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { others, mine };
}
