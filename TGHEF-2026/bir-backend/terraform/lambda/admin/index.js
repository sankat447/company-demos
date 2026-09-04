/**
 * Admin analytics API for the ops console. Organiser-guarded, read-only
 * aggregation across the single table so an organiser sees the whole festival
 * (the partner consoles are scoped to each partner's own sub; this is the
 * festival-wide view). Behind the HTTP API (Cognito authorizer):
 *   GET /admin/summary · /visitors · /stalls · /lodging · /incidents · /volunteers
 * @aws-sdk/client-dynamodb ships in the Node.js 20 runtime — no bundle.
 */
'use strict';
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;
const OPS = ['organiser-lite', 'safety-officer', 'admin-hospitality'];

/* ---- minimal DynamoDB unmarshalling ---- */
function uv(a) {
  if (a == null) return null;
  if ('S' in a) return a.S;
  if ('N' in a) return Number(a.N);
  if ('BOOL' in a) return a.BOOL;
  if ('NULL' in a) return null;
  if ('L' in a) return a.L.map(uv);
  if ('M' in a) return uo(a.M);
  if ('SS' in a) return a.SS;
  if ('NS' in a) return a.NS.map(Number);
  return null;
}
function uo(m) {
  const o = {};
  for (const k in m) o[k] = uv(m[k]);
  return o;
}

async function items(pk) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': { S: pk } },
        ExclusiveStartKey,
      }),
    );
    (r.Items || []).forEach((i) => out.push(uo(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
async function count(pk, indexName, keyAttr) {
  let n = 0;
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: indexName,
        Select: 'COUNT',
        KeyConditionExpression: `${keyAttr || 'pk'} = :p`,
        ExpressionAttributeValues: { ':p': { S: pk } },
        ExclusiveStartKey,
      }),
    );
    n += r.Count || 0;
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return n;
}
const tally = (arr, key) =>
  arr.reduce((m, x) => {
    const k = (typeof key === 'function' ? key(x) : x[key]) || 'unknown';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/* ---- aggregations ---- */
async function summary() {
  const [regs, orders, stalls, rooms, hosp, vols, incs, scans, faqs, sched, tiers, revs, votes] =
    await Promise.all([
      items('REG'), items('ORDER'), items('STALL'), items('ROOM'), items('HOSP'), items('VOL'),
      items('INC'), count('SCAN'), items('KB#FAQ'), items('SCHEDULE'), items('TIER'),
      count('REVOCATION', 'gsi1', 'gsi1pk'), count('VOTE'),
    ]);
  const fly = (await items('FLYSTATUS')).find((f) => f.state) || null;
  const confirmedOrders = orders.filter((o) => o.status === 'CONFIRMED');
  const revenueInr = confirmedOrders.reduce((s, o) => s + (o.amountInr || 0), 0);
  const roomCap = rooms.reduce((s, r) => s + (r.capacity || 0), 0);
  const compRooms = hosp.reduce((s, h) => s + (h.complimentaryRooms || 0), 0);
  const checkedIn = hosp.reduce((s, h) => s + (h.allocations || []).filter((a) => a.checkedIn).length, 0);
  const allocations = hosp.reduce((s, h) => s + (h.allocations || []).length, 0);
  return json(200, {
    fly: fly ? { state: fly.state, refundsAutoQueued: !!fly.refundsAutoQueued, updatedAt: fly.updatedAt } : null,
    registrations: {
      total: regs.length,
      byStatus: tally(regs, 'status'),
      needLodging: regs.filter((r) => r.needsLodging).length,
    },
    orders: {
      total: orders.length,
      confirmed: confirmedOrders.length,
      pending: orders.filter((o) => o.status === 'PENDING').length,
      revenueInr,
    },
    stalls: {
      total: stalls.length,
      byStage: tally(stalls, 'stage'),
      paid: stalls.filter((s) => s.paid).length,
      feeInr: stalls.reduce((s, x) => s + (x.feeInr || 0), 0),
    },
    lodging: {
      rooms: rooms.length,
      activeRooms: rooms.filter((r) => r.status === 'active').length,
      capacity: roomCap,
      hotels: new Set(rooms.map((r) => r.hotelName)).size,
      hospitalityPartners: hosp.length,
      complimentaryRooms: compRooms,
      allocations,
      checkedIn,
    },
    volunteers: {
      total: vols.length,
      idVerified: vols.filter((v) => v.idVerified).length,
      shifts: vols.reduce((s, v) => s + (v.shifts || []).length, 0),
    },
    incidents: { total: incs.length, byCategory: tally(incs, 'category') },
    engagement: { scans, votes },
    content: { faqs: faqs.length, schedule: sched.length, tiers: tiers.length, revocations: revs },
  });
}

async function visitors() {
  const [regs, orders, tiers] = await Promise.all([items('REG'), items('ORDER'), items('TIER')]);
  const tierName = Object.fromEntries(tiers.map((t) => [t.sk, t.titleEn]));
  const byItem = {};
  regs.forEach((r) => {
    const k = r.itemId || r.competitionId || 'other';
    byItem[k] = byItem[k] || { item: k, total: 0, confirmed: 0, needLodging: 0 };
    byItem[k].total++;
    if (r.status === 'confirmed') byItem[k].confirmed++;
    if (r.needsLodging) byItem[k].needLodging++;
  });
  const revByTier = {};
  orders.filter((o) => o.status === 'CONFIRMED').forEach((o) => {
    const k = o.itemId || 'other';
    revByTier[k] = revByTier[k] || { tier: tierName[k] || k, count: 0, revenueInr: 0 };
    revByTier[k].count++;
    revByTier[k].revenueInr += o.amountInr || 0;
  });
  return json(200, {
    registrations: { total: regs.length, byStatus: tally(regs, 'status'), byItem: Object.values(byItem) },
    tickets: {
      total: orders.length,
      confirmed: orders.filter((o) => o.status === 'CONFIRMED').length,
      byTier: Object.values(revByTier),
      revenueInr: orders.filter((o) => o.status === 'CONFIRMED').reduce((s, o) => s + (o.amountInr || 0), 0),
    },
  });
}

async function stalls() {
  const rows = await items('STALL');
  return json(200, {
    items: rows.map((s) => {
      const a = s.analytics || [];
      const orders = a.reduce((n, d) => n + (d.ordersEstimate || 0), 0);
      const foot = a.length ? Math.round(a.reduce((n, d) => n + (d.footfallIndex || 0), 0) / a.length) : 0;
      return {
        stallName: s.stallName, category: s.category, stage: s.stage,
        allocationLabel: s.allocationLabel, feeInr: s.feeInr || 0, paid: !!s.paid,
        ordersEstimate: orders, footfallIndex: foot,
      };
    }),
  });
}

async function lodging() {
  const [rooms, hosp, regs] = await Promise.all([items('ROOM'), items('HOSP'), items('REG')]);
  const byHotel = {};
  rooms.forEach((r) => {
    const k = r.hotelName || 'unknown';
    byHotel[k] = byHotel[k] || { hotel: k, rooms: 0, capacity: 0, active: 0 };
    byHotel[k].rooms++;
    byHotel[k].capacity += r.capacity || 0;
    if (r.status === 'active') byHotel[k].active++;
  });
  return json(200, {
    hotels: Object.values(byHotel),
    partners: hosp.map((h) => ({
      hotelName: h.hotelName, complimentaryRooms: h.complimentaryRooms || 0,
      allocations: (h.allocations || []).length,
      checkedIn: (h.allocations || []).filter((a) => a.checkedIn).length,
    })),
    pool: { needLodging: regs.filter((r) => r.needsLodging).length, total: regs.length },
  });
}

async function incidents() {
  const rows = (await items('INC')).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return json(200, {
    total: rows.length,
    byCategory: tally(rows, 'category'),
    items: rows.slice(0, 50).map((i) => ({
      category: i.category, note: i.note, zone: i.zone || '', ts: i.ts, reportedBy: i.reportedBy,
    })),
  });
}

async function volunteers() {
  const [vols, att] = await Promise.all([items('VOL'), count('ATT')]);
  return json(200, {
    total: vols.length,
    idVerified: vols.filter((v) => v.idVerified).length,
    attendanceRecords: att,
    items: vols.map((v) => ({
      name: v.name, team: v.team, idVerified: !!v.idVerified, shifts: (v.shifts || []).length,
    })),
  });
}

const ROUTES = {
  '/admin/summary': summary,
  '/admin/visitors': visitors,
  '/admin/stalls': stalls,
  '/admin/lodging': lodging,
  '/admin/incidents': incidents,
  '/admin/volunteers': volunteers,
};

exports.handler = async (event) => {
  const path = (event.requestContext && event.requestContext.http && event.requestContext.http.path) || event.rawPath || '';
  const claims =
    (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt &&
      event.requestContext.authorizer.jwt.claims) || {};
  if (!claims.sub) return json(401, { error: 'unauthenticated' });
  let groups = claims['cognito:groups'] || [];
  if (!Array.isArray(groups)) groups = String(groups).replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  if (!groups.some((g) => OPS.includes(g))) return json(403, { error: 'organiser role required' });

  const fn = ROUTES[Object.keys(ROUTES).find((r) => path.endsWith(r)) || ''];
  if (!fn) return json(404, { error: 'unknown admin path' });
  try {
    return await fn();
  } catch (e) {
    return json(502, { error: 'admin query failed', detail: String((e && e.message) || e) });
  }
};
