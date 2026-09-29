/**
 * B2c: lodgingOccupancy(hotelName) — admin-hospitality guarded. Computes the
 * per-room × per-night occupancy grid from the latest committed allocation +
 * source-of-truth rooms + pool. Returns OccupancyCell[].
 */
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;

async function queryAll(pk, filter) {
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

exports.handler = async (event) => {
  const identity = event.identity || {};
  const isIam = Boolean(identity.userArn || identity.accountId);
  const groups = identity.groups || (identity.claims && identity.claims['cognito:groups']) || [];
  if (!isIam && !groups.includes('admin-hospitality')) {
    throw new Error('Unauthorized: admin-hospitality required');
  }
  const hotelName = event.arguments && event.arguments.hotelName;

  const [rooms, pool, allocs] = await Promise.all([
    queryAll('ROOM'),
    queryAll('REG', { expr: 'needsLodging = :t', values: { ':t': { BOOL: true } } }),
    queryAll('ALLOC'),
  ]);
  const poolById = Object.fromEntries(pool.map((p) => [p.sk, p]));
  const latest = allocs.sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  const assignments = latest ? latest.assignments || [] : [];

  const cells = [];
  for (const room of rooms.filter((r) => r.hotelName === hotelName)) {
    const nights = (room.availability && room.availability.nights) || [];
    for (const night of nights) {
      const occupied = assignments
        .filter((a) => a.roomId === room.sk)
        .map((a) => poolById[a.regId])
        .filter((p) => p && (p.nights || []).includes(night)).length;
      cells.push({ roomId: room.sk, night, occupied, capacity: room.capacity });
    }
  }
  return cells;
};
