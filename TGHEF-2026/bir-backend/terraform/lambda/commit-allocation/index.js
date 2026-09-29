/**
 * B2b: commitAllocation resolver (privileged). Never trusts the client:
 *  1. re-checks the admin-hospitality Cognito group (IAM callers = trusted server),
 *  2. loads the source-of-truth rooms + pool from DynamoDB,
 *  3. re-validates the CO-003 §3 hard constraints (mirrors src/features/lodging/
 *     engine.ts), and
 *  4. persists the committed allocation with an audit record (actorNote).
 * Returns CommitResult { version, accepted, violations }.
 */
const { DynamoDBClient, QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;

async function queryPartition(pk, filter) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: pk }, ...(filter?.values ?? {}) },
        ...(filter?.expr ? { FilterExpression: filter.expr } : {}),
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) items.push(unmarshall(it));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Mirror of engine.ts §3.1–3.4 — validates a whole committed assignment set. */
function validateAllocation(assignments, poolById, roomsById) {
  const violations = [];
  const byRoom = {};
  for (const a of assignments) {
    const p = poolById[a.regId];
    if (!p || !p.needsLodging) {
      violations.push(`unknown-participant:${a.regId}`);
      continue;
    }
    (byRoom[a.roomId] ||= []).push(p);
  }
  for (const [roomId, occ] of Object.entries(byRoom)) {
    const room = roomsById[roomId];
    if (!room || room.status !== 'active') {
      violations.push(`room-unavailable:${roomId}`);
      continue;
    }
    const nights = new Set((room.availability && room.availability.nights) || []);
    for (const p of occ) {
      if (!(p.nights || []).every((n) => nights.has(n))) {
        violations.push(`nights-unavailable:${roomId}:${p.regId}`);
      }
    }
    const couples = occ.filter((p) => p.coupleGroupId);
    if (couples.length) {
      // 3.3 couples → a doubleOccupancy room, exclusively theirs
      if (!room.doubleOccupancy) violations.push(`couple-split:${roomId}`);
      const gid = couples[0].coupleGroupId;
      if (!(occ.length === 2 && occ.every((p) => p.coupleGroupId === gid))) {
        violations.push(`couple-exclusive:${roomId}`);
      }
    } else {
      const undisclosed = occ.filter((p) => p.gender === 'other' || p.gender === 'undisclosed');
      if (undisclosed.length) {
        // 3.3 undisclosed/other → a room of their own for their nights
        for (const u of undisclosed) {
          const overlap = occ.some(
            (o) => o.regId !== u.regId && (o.nights || []).some((n) => (u.nights || []).includes(n)),
          );
          if (overlap) violations.push(`manual-needs-empty-room:${roomId}`);
        }
      } else if (new Set(occ.map((p) => p.gender)).size > 1) {
        // 3.1 / 3.2 same-gender sharing
        violations.push(`gender-mix:${roomId}`);
      }
    }
    // 3.4 per-night capacity
    const perNight = {};
    for (const p of occ) for (const n of p.nights || []) perNight[n] = (perNight[n] || 0) + 1;
    for (const [n, c] of Object.entries(perNight)) {
      if (c > room.capacity) violations.push(`capacity:${roomId}:${n}`);
    }
  }
  return [...new Set(violations)];
}

exports.handler = async (event) => {
  const identity = event.identity || {};
  const isIam = Boolean(identity.userArn || identity.accountId);
  const groups = identity.groups || (identity.claims && identity.claims['cognito:groups']) || [];
  if (!isIam && !groups.includes('admin-hospitality')) {
    throw new Error('Unauthorized: admin-hospitality required');
  }

  const input = (event.arguments && event.arguments.input) || {};
  const version = Number(input.version) || 1;
  const raw = input.assignments;
  const assignments = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  if (!Array.isArray(assignments)) throw new Error('assignments must be a list');

  const [rooms, pool] = await Promise.all([
    queryPartition('ROOM'),
    queryPartition('REG', { expr: 'needsLodging = :t', values: { ':t': { BOOL: true } } }),
  ]);
  const roomsById = Object.fromEntries(rooms.map((r) => [r.sk, r]));
  const poolById = Object.fromEntries(pool.map((p) => [p.sk, { ...p, regId: p.sk }]));

  const violations = validateAllocation(assignments, poolById, roomsById);
  if (violations.length) return { version, accepted: false, violations };

  // Persist the committed allocation + audit trail (actorNote on overrides).
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(
        {
          pk: 'ALLOC',
          sk: `v${version}`,
          version,
          assignments,
          actorNote: input.actorNote || null,
          committedBy: identity.username || identity.userArn || 'iam',
          committedAtSec: Math.floor(Date.now() / 1000),
          idempotencyKey: input.idempotencyKey || null,
        },
        { removeUndefinedValues: true },
      ),
    }),
  );
  return { version, accepted: true, violations: [] };
};
