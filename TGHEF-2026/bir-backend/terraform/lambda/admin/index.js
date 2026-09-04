/**
 * Admin API for the ops console — self-contained username/password auth (no
 * OTP), a 4-tier admin hierarchy, festival-wide analytics, and the festival
 * actions the console needs. Behind the HTTP API (routes are authorization_type
 * NONE; this Lambda verifies its own admin JWT and enforces tier capabilities).
 *
 * Admin records: pk=ADMIN / sk=<username> { name, tier, pwHash, active, createdBy }.
 * Tiers: 1 Superadmin · 2 Admin · 3 Manager · 4 Coordinator.
 *   - manage admins strictly below your tier (Superadmin also manages peers)
 *   - capabilities gate festival actions by tier (see CAPS)
 * JWT is HS256 signed with a secret in SSM. Passwords are scrypt-hashed.
 * @aws-sdk clients ship in the Node.js 20 runtime — no bundle.
 */
'use strict';
const crypto = require('crypto');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const {
  DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand,
  UpdateItemCommand, DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const ssm = new SSMClient({});
const lambda = new LambdaClient({});
const TABLE = process.env.TABLE;
const JWT_PARAM = process.env.JWT_PARAM;
const SET_FLY_FN = process.env.SET_FLY_FN;
const AI_FN = process.env.AI_FN;
const TOKEN_TTL = 12 * 3600;

const TIER_NAMES = { 1: 'Superadmin', 2: 'Admin', 3: 'Manager', 4: 'Coordinator' };
// Capability → tiers that hold it. Tier 1 Superadmin · 2 Admin · 3 Manager ·
// 4 Coordinator (ground staff). Read is universal; write actions widen down the
// hierarchy only as far as the role that owns that job on the ground.
const CAPS = {
  'analytics.read': [1, 2, 3, 4],
  'admin.manage': [1, 2, 3],
  'faq.write': [1, 2, 3],
  'pass.revoke': [1, 2],
  'flystatus.set': [1, 2],
  // festival control plane (added for the ops console + Staff mode)
  'schedule.manage': [1, 2, 3],
  'stalls.manage': [1, 2, 3],
  'lodging.manage': [1, 2, 3],
  'volunteers.manage': [1, 2, 3],
  'incidents.manage': [1, 2, 3, 4], // coordinators triage incidents on the ground
  'announce.write': [1, 2],
  // money-sensitive — Superadmin/Admin only
  'pricing.manage': [1, 2],
  'orders.manage': [1, 2],
  // child-safety tool — every staff tier can register + look up a wristband
  'wristband.manage': [1, 2, 3, 4],
};
const can = (tier, cap) => (CAPS[cap] || []).includes(tier);
// A caller may create/manage a target at a strictly-lower tier; Superadmin (1)
// also manages peers.
const canManageTier = (callerTier, targetTier) =>
  callerTier === 1 ? targetTier >= 1 : targetTier > callerTier;

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/* --------------------------- crypto: pw + jwt --------------------------- */
function hashPw(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${dk.toString('base64')}`;
}
function verifyPw(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const hash = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(password, salt, hash.length, { N: +N, r: +r, p: +p });
    return dk.length === hash.length && crypto.timingSafeEqual(dk, hash);
  } catch {
    return false;
  }
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let cachedSecret = null;
async function secret() {
  if (cachedSecret) return cachedSecret;
  const out = await ssm.send(new GetParameterCommand({ Name: JWT_PARAM, WithDecryption: true }));
  cachedSecret = out.Parameter.Value;
  return cachedSecret;
}
async function signJwt(payload) {
  const s = await secret();
  const now = Math.floor(Date.now() / 1000);
  const p1 = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p2 = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL }));
  const sig = b64url(crypto.createHmac('sha256', s).update(`${p1}.${p2}`).digest());
  return `${p1}.${p2}.${sig}`;
}
async function verifyJwt(token) {
  const s = await secret();
  const [p1, p2, sig] = String(token || '').split('.');
  if (!p1 || !p2 || !sig) throw new Error('bad token');
  const expect = b64url(crypto.createHmac('sha256', s).update(`${p1}.${p2}`).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
  const body = JSON.parse(Buffer.from(p2.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  if (body.exp && body.exp < Math.floor(Date.now() / 1000)) throw new Error('token expired');
  return body;
}

/* ------------------------------ DDB helpers ----------------------------- */
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
function uo(m) { const o = {}; for (const k in m) o[k] = uv(m[k]); return o; }
// JS value → DynamoDB AttributeValue (inverse of uv). Empty strings are dropped
// by callers; here an empty string still marshals to {S:''} — guard upstream.
function mv(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(mv) };
  if (typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mv(x)])) };
  return { NULL: true };
}
function mo(obj) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, mv(v)])); }
const nowSec = () => Math.floor(Date.now() / 1000);
// slugify for generated ids
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
async function items(pk) {
  const out = []; let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': { S: pk } }, ExclusiveStartKey,
    }));
    (r.Items || []).forEach((i) => out.push(uo(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
async function count(pk, indexName, keyAttr) {
  let n = 0; let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE, IndexName: indexName, Select: 'COUNT',
      KeyConditionExpression: `${keyAttr || 'pk'} = :p`,
      ExpressionAttributeValues: { ':p': { S: pk } }, ExclusiveStartKey,
    }));
    n += r.Count || 0; ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return n;
}
const tally = (arr, key) => arr.reduce((m, x) => {
  const k = (typeof key === 'function' ? key(x) : x[key]) || 'unknown';
  m[k] = (m[k] || 0) + 1; return m;
}, {});

/* ------------------------------ admin store ----------------------------- */
const CLEAN_USER = (u) => String(u || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
async function getAdmin(username) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: 'ADMIN' }, sk: { S: username } } }));
  return r.Item ? uo(r.Item) : null;
}
async function listAdmins() {
  return (await items('ADMIN')).map((a) => ({
    username: a.sk, name: a.name, tier: a.tier, active: a.active !== false,
    createdBy: a.createdBy || '', createdAt: a.createdAt || 0,
  }));
}
async function putAdmin(a) {
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk: { S: 'ADMIN' }, sk: { S: a.username },
      name: { S: a.name }, tier: { N: String(a.tier) },
      pwHash: { S: a.pwHash }, active: { BOOL: a.active !== false },
      createdBy: { S: a.createdBy || 'system' },
      createdAt: { N: String(a.createdAt || Math.floor(Date.now() / 1000)) },
    },
  }));
}

/* ------------------------------ auth routes ----------------------------- */
async function bootstrap(body) {
  const existing = await items('ADMIN');
  if (existing.length) return json(409, { error: 'already initialised' });
  const username = CLEAN_USER(body.username);
  const password = String(body.password || '');
  if (!username || password.length < 8) return json(400, { error: 'username and a password (min 8 chars) are required' });
  await putAdmin({ username, name: body.name || 'Master Admin', tier: 1, pwHash: hashPw(password), active: true, createdBy: 'bootstrap' });
  return json(200, { ok: true, username, tier: 1 });
}
async function login(body) {
  const username = CLEAN_USER(body.username);
  if ((await loginFailCount(username)) >= LOGIN_MAX) {
    return json(429, { error: 'too many attempts — try again in a few minutes' });
  }
  const a = await getAdmin(username);
  if (!a || a.active === false || !verifyPw(String(body.password || ''), a.pwHash)) {
    await bumpLoginFail(username);
    return json(401, { error: 'invalid username or password' });
  }
  await clearLoginFail(username);
  const token = await signJwt({ sub: username, tier: a.tier, name: a.name });
  return json(200, { token, admin: { username, name: a.name, tier: a.tier, tierName: TIER_NAMES[a.tier] } });
}

/* --------------------------- admin management --------------------------- */
async function adminsList(me) {
  if (!can(me.tier, 'admin.manage')) return json(403, { error: 'not permitted' });
  const all = await listAdmins();
  const manageable = all.filter((a) => canManageTier(me.tier, a.tier) && a.username !== me.sub);
  return json(200, {
    me: { username: me.sub, tier: me.tier, tierName: TIER_NAMES[me.tier] },
    tiers: TIER_NAMES,
    admins: all.map((a) => ({ ...a, tierName: TIER_NAMES[a.tier], manageable: manageable.some((m) => m.username === a.username) })),
  });
}
async function adminCreate(me, body) {
  if (!can(me.tier, 'admin.manage')) return json(403, { error: 'not permitted' });
  const tier = Number(body.tier);
  if (![1, 2, 3, 4].includes(tier)) return json(400, { error: 'tier must be 1–4' });
  if (!canManageTier(me.tier, tier)) return json(403, { error: `your tier can't create a ${TIER_NAMES[tier] || tier}` });
  const username = CLEAN_USER(body.username);
  const password = String(body.password || '');
  if (!username || password.length < 8) return json(400, { error: 'username and a password (min 8 chars) are required' });
  if (await getAdmin(username)) return json(409, { error: 'that username already exists' });
  await putAdmin({ username, name: body.name || username, tier, pwHash: hashPw(password), active: true, createdBy: me.sub });
  await audit(me, 'admin.create', `${username} (tier ${tier})`);
  return json(200, { ok: true, admin: { username, name: body.name || username, tier, tierName: TIER_NAMES[tier] } });
}
async function guardTarget(me, username) {
  const target = await getAdmin(username);
  if (!target) return { err: json(404, { error: 'admin not found' }) };
  if (username === me.sub) return { err: json(400, { error: "you can't modify your own account here" }) };
  if (!canManageTier(me.tier, target.tier)) return { err: json(403, { error: 'not permitted for this admin' }) };
  return { target };
}
async function adminSetPassword(me, username, body) {
  if (!can(me.tier, 'admin.manage')) return json(403, { error: 'not permitted' });
  const { err, target } = await guardTarget(me, username);
  if (err) return err;
  const password = String(body.password || '');
  if (password.length < 8) return json(400, { error: 'password must be at least 8 chars' });
  target.pwHash = hashPw(password);
  await putAdmin({ ...target, username });
  await audit(me, 'admin.password_reset', username);
  return json(200, { ok: true, username });
}
async function adminSetActive(me, username, body) {
  if (!can(me.tier, 'admin.manage')) return json(403, { error: 'not permitted' });
  const { err, target } = await guardTarget(me, username);
  if (err) return err;
  const active = body.active !== false;
  if (!active && target.tier === 1) {
    const supers = (await listAdmins()).filter((a) => a.tier === 1 && a.active);
    if (supers.length <= 1) return json(400, { error: 'cannot disable the last active Superadmin' });
  }
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'ADMIN' }, sk: { S: username } },
    UpdateExpression: 'SET active = :a', ExpressionAttributeValues: { ':a': { BOOL: active } },
  }));
  await audit(me, active ? 'admin.enable' : 'admin.disable', username);
  return json(200, { ok: true, username, active });
}
async function adminDelete(me, username) {
  if (!can(me.tier, 'admin.manage')) return json(403, { error: 'not permitted' });
  const { err, target } = await guardTarget(me, username);
  if (err) return err;
  if (target.tier === 1) {
    const supers = (await listAdmins()).filter((a) => a.tier === 1 && a.active);
    if (supers.length <= 1) return json(400, { error: 'cannot delete the last active Superadmin' });
  }
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: { S: 'ADMIN' }, sk: { S: username } } }));
  await audit(me, 'admin.delete', username);
  return json(200, { ok: true, username, deleted: true });
}

/* ------------------------------ festival actions ------------------------ */
async function faqList() {
  return json(200, { items: (await items('KB#FAQ')).map((i) => ({ id: i.sk, question: i.question || '', answer: i.answer || '' })) });
}
async function faqUpsert(me, body) {
  if (!can(me.tier, 'faq.write')) return json(403, { error: 'not permitted' });
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();
  if (!question || !answer) return json(400, { error: 'question and answer are required' });
  const id = String(body.id || `faq-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9._:-]/g, '');
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk: { S: 'KB#FAQ' }, sk: { S: id }, question: { S: question }, answer: { S: answer },
      updatedAt: { N: String(Math.floor(Date.now() / 1000)) }, updatedBy: { S: `admin:${me.sub}` },
    },
  }));
  return json(200, { id, question, answer });
}
async function faqDelete(me, id) {
  if (!can(me.tier, 'faq.write')) return json(403, { error: 'not permitted' });
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: { S: 'KB#FAQ' }, sk: { S: id } } }));
  return json(200, { id, deleted: true });
}
async function revoke(me, body) {
  if (!can(me.tier, 'pass.revoke')) return json(403, { error: 'not permitted' });
  const jti = String(body.jti || '').trim();
  if (!jti) return json(400, { error: 'jti is required' });
  const now = String(Math.floor(Date.now() / 1000));
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk: { S: `REV#${jti}` }, sk: { S: 'REV' }, jti: { S: jti }, revokedAt: { N: now },
      gsi1pk: { S: 'REVOCATION' }, gsi1sk: { S: now }, revokedBy: { S: `admin:${me.sub}` },
    },
  }));
  await audit(me, 'pass.revoke', jti);
  return json(200, { jti, accepted: true });
}
async function fly(me, body) {
  if (!can(me.tier, 'flystatus.set')) return json(403, { error: 'not permitted' });
  const event = {
    identity: { sub: `admin:${me.sub}`, groups: ['safety-officer'] },
    arguments: { input: {
      state: body.state, reasonEn: body.reasonEn || '', reasonHi: body.reasonHi || '',
      declaredBy: me.sub, idempotencyKey: `fly:admin:${Date.now()}`,
    } },
  };
  const out = await lambda.send(new InvokeCommand({ FunctionName: SET_FLY_FN, Payload: Buffer.from(JSON.stringify(event)) }));
  const res = JSON.parse(Buffer.from(out.Payload).toString() || '{}');
  if (res.errorMessage) return json(502, { error: 'fly-status failed', detail: res.errorMessage });
  await audit(me, 'flystatus.set', str(body.state));
  return json(200, res);
}
async function ask(me, body) {
  const event = {
    requestContext: { http: { path: '/ai/assistant', method: 'POST' }, authorizer: { jwt: { claims: { sub: `admin:${me.sub}` } } } },
    body: JSON.stringify({ message: String(body.message || '') }),
  };
  const out = await lambda.send(new InvokeCommand({ FunctionName: AI_FN, Payload: Buffer.from(JSON.stringify(event)) }));
  const res = JSON.parse(Buffer.from(out.Payload).toString() || '{}');
  try { return json(res.statusCode || 200, JSON.parse(res.body || '{}')); }
  catch { return json(502, { error: 'assistant failed' }); }
}

/* ------------------------------ analytics ------------------------------- */
async function summary() {
  const [regs, orders, stalls, rooms, hosp, vols, incs, scans, faqs, sched, tiers, revs, votes] = await Promise.all([
    items('REG'), items('ORDER'), items('STALL'), items('ROOM'), items('HOSP'), items('VOL'),
    items('INC'), count('SCAN'), items('KB#FAQ'), items('SCHEDULE'), items('TIER'),
    count('REVOCATION', 'gsi1', 'gsi1pk'), count('VOTE'),
  ]);
  const fly = (await items('FLYSTATUS')).find((f) => f.state) || null;
  const confirmed = orders.filter((o) => o.status === 'CONFIRMED');
  return json(200, {
    fly: fly ? { state: fly.state, refundsAutoQueued: !!fly.refundsAutoQueued, updatedAt: fly.updatedAt } : null,
    registrations: { total: regs.length, byStatus: tally(regs, 'status'), needLodging: regs.filter((r) => r.needsLodging).length },
    orders: { total: orders.length, confirmed: confirmed.length, pending: orders.filter((o) => o.status === 'PENDING').length, revenueInr: confirmed.reduce((s, o) => s + (o.amountInr || 0), 0) },
    stalls: { total: stalls.length, byStage: tally(stalls, 'stage'), paid: stalls.filter((s) => s.paid).length, feeInr: stalls.reduce((s, x) => s + (x.feeInr || 0), 0) },
    lodging: { rooms: rooms.length, activeRooms: rooms.filter((r) => r.status === 'active').length, capacity: rooms.reduce((s, r) => s + (r.capacity || 0), 0), hotels: new Set(rooms.map((r) => r.hotelName)).size, hospitalityPartners: hosp.length, complimentaryRooms: hosp.reduce((s, h) => s + (h.complimentaryRooms || 0), 0), allocations: hosp.reduce((s, h) => s + (h.allocations || []).length, 0), checkedIn: hosp.reduce((s, h) => s + (h.allocations || []).filter((a) => a.checkedIn).length, 0) },
    volunteers: { total: vols.length, idVerified: vols.filter((v) => v.idVerified).length, shifts: vols.reduce((s, v) => s + (v.shifts || []).length, 0) },
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
    byItem[k].total++; if (r.status === 'confirmed') byItem[k].confirmed++; if (r.needsLodging) byItem[k].needLodging++;
  });
  const revByTier = {};
  orders.filter((o) => o.status === 'CONFIRMED').forEach((o) => {
    const k = o.itemId || 'other';
    revByTier[k] = revByTier[k] || { tier: tierName[k] || k, count: 0, revenueInr: 0 };
    revByTier[k].count++; revByTier[k].revenueInr += o.amountInr || 0;
  });
  return json(200, {
    registrations: { total: regs.length, byStatus: tally(regs, 'status'), byItem: Object.values(byItem) },
    tickets: { total: orders.length, confirmed: orders.filter((o) => o.status === 'CONFIRMED').length, byTier: Object.values(revByTier), revenueInr: orders.filter((o) => o.status === 'CONFIRMED').reduce((s, o) => s + (o.amountInr || 0), 0) },
  });
}
async function stallsView() {
  return json(200, {
    items: (await items('STALL')).map((s) => {
      const a = s.analytics || [];
      return {
        stallName: s.stallName, category: s.category, stage: s.stage, allocationLabel: s.allocationLabel,
        feeInr: s.feeInr || 0, paid: !!s.paid,
        ordersEstimate: a.reduce((n, d) => n + (d.ordersEstimate || 0), 0),
        footfallIndex: a.length ? Math.round(a.reduce((n, d) => n + (d.footfallIndex || 0), 0) / a.length) : 0,
      };
    }),
  });
}
async function lodgingView() {
  const [rooms, hosp, regs] = await Promise.all([items('ROOM'), items('HOSP'), items('REG')]);
  const byHotel = {};
  rooms.forEach((r) => {
    const k = r.hotelName || 'unknown';
    byHotel[k] = byHotel[k] || { hotel: k, rooms: 0, capacity: 0, active: 0 };
    byHotel[k].rooms++; byHotel[k].capacity += r.capacity || 0; if (r.status === 'active') byHotel[k].active++;
  });
  return json(200, {
    hotels: Object.values(byHotel),
    partners: hosp.map((h) => ({ hotelName: h.hotelName, complimentaryRooms: h.complimentaryRooms || 0, allocations: (h.allocations || []).length, checkedIn: (h.allocations || []).filter((a) => a.checkedIn).length })),
    pool: { needLodging: regs.filter((r) => r.needsLodging).length, total: regs.length },
  });
}
async function incidentsView() {
  const rows = (await items('INC')).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const withStatus = rows.map((i) => ({ ...i, status: i.status || 'open' }));
  return json(200, {
    total: rows.length,
    byCategory: tally(rows, 'category'),
    byStatus: tally(withStatus, 'status'),
    open: withStatus.filter((i) => i.status !== 'resolved').length,
    items: withStatus.slice(0, 100).map((i) => ({
      id: i.sk, category: i.category, note: i.note, zone: i.zone || '', ts: i.ts,
      reportedBy: i.reportedBy, photoUri: i.photoUri || '',
      status: i.status, assignee: i.assignee || '', resolutionNote: i.resolutionNote || '',
      updatedAt: i.updatedAt || 0, updatedBy: i.updatedBy || '',
    })),
  });
}
async function volunteersView() {
  const [vols, att] = await Promise.all([items('VOL'), count('ATT')]);
  return json(200, { total: vols.length, idVerified: vols.filter((v) => v.idVerified).length, attendanceRecords: att, items: vols.map((v) => ({ name: v.name, team: v.team, idVerified: !!v.idVerified, shifts: (v.shifts || []).length })) });
}
async function revocationsView() {
  const out = []; let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :p',
      ExpressionAttributeValues: { ':p': { S: 'REVOCATION' } }, ScanIndexForward: false, ExclusiveStartKey,
    }));
    (r.Items || []).forEach((i) => { const o = uo(i); out.push({ jti: o.jti, revokedAt: o.revokedAt, revokedBy: o.revokedBy || '' }); });
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return json(200, { total: out.length, items: out });
}

/* ===================== festival control plane (CRUD) ===================== */
// A thin, uniform CRUD layer over the single table. Each manager guards on its
// capability, whitelists writable fields, stamps updatedAt/By, and returns the
// stored row. Ids are the sort key; generated when the client doesn't supply one.
async function putRow(pk, sk, fields, me) {
  const item = mo({ ...fields, updatedAt: nowSec(), updatedBy: `admin:${me.sub}` });
  item.pk = { S: pk };
  item.sk = { S: sk };
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));
  return { id: sk, ...fields };
}
async function getRow(pk, sk) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: pk }, sk: { S: sk } } }));
  return r.Item ? uo(r.Item) : null;
}
async function delRow(pk, sk) {
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: { S: pk }, sk: { S: sk } } }));
}
const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => (Number.isFinite(+v) ? +v : 0);

/* ---- audit log (M1): append-only record of sensitive admin actions ------ */
async function audit(me, action, detail) {
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: 'AUDIT' }, sk: { S: `${Date.now()}#${me.sub}` },
        actor: { S: String(me.sub) }, tier: { N: String(me.tier || 0) },
        action: { S: String(action) }, detail: { S: String(detail || '') },
        ts: { N: String(nowSec()) },
        // keep ~13 months (past the 30 Nov close-out), then self-expire
        ttl: { N: String(nowSec() + 60 * 60 * 24 * 400) },
      },
    }));
  } catch {
    /* audit must never break the action it records */
  }
}
async function auditList(me) {
  if (me.tier > 2) return json(403, { error: 'not permitted' }); // Superadmin/Admin only
  const rows = (await items('AUDIT')).sort((a, b) => String(b.sk).localeCompare(String(a.sk)));
  return json(200, {
    items: rows.slice(0, 300).map((r) => ({
      ts: r.ts || 0, actor: r.actor || '', tier: r.tier || 0,
      action: r.action || '', detail: r.detail || '',
    })),
  });
}

/* ---- login throttle (M1): lock a username after repeated failures -------- */
const LOGIN_MAX = 8;
const LOGIN_WINDOW = 900; // 15 min sliding window
async function loginFailCount(username) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: 'LOGINFAIL' }, sk: { S: username } } }));
  if (!r.Item) return 0;
  const exp = Number((r.Item.ttl && r.Item.ttl.N) || 0);
  if (exp && exp < nowSec()) return 0; // window elapsed (TTL cleanup is eventual)
  return Number((r.Item.count && r.Item.count.N) || 0);
}
async function bumpLoginFail(username) {
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'LOGINFAIL' }, sk: { S: username } },
    UpdateExpression: 'ADD #c :one SET #t = :ttl',
    ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
    ExpressionAttributeValues: { ':one': { N: '1' }, ':ttl': { N: String(nowSec() + LOGIN_WINDOW) } },
  }));
}
async function clearLoginFail(username) {
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: { S: 'LOGINFAIL' }, sk: { S: username } } })).catch(() => {});
}

/* ---- schedule (sessions/agenda) --------------------------------------- */
async function scheduleList() {
  const rows = (await items('SCHEDULE')).sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0));
  return json(200, {
    items: rows.map((s) => ({
      id: s.sk, day: s.day || '', venue: s.venue || '',
      titleEn: s.titleEn || '', titleHi: s.titleHi || '', startsAt: s.startsAt || 0,
    })),
  });
}
async function scheduleUpsert(me, body) {
  if (!can(me.tier, 'schedule.manage')) return json(403, { error: 'not permitted' });
  const titleEn = str(body.titleEn);
  const day = str(body.day);
  if (!titleEn || !day) return json(400, { error: 'day and titleEn are required' });
  const id = str(body.id) || `${day}#${slug(titleEn)}`;
  const row = await putRow('SCHEDULE', id, {
    day, venue: str(body.venue), titleEn, titleHi: str(body.titleHi), startsAt: num(body.startsAt),
  }, me);
  return json(200, row);
}
async function scheduleDelete(me, id) {
  if (!can(me.tier, 'schedule.manage')) return json(403, { error: 'not permitted' });
  await delRow('SCHEDULE', id);
  return json(200, { id, deleted: true });
}

/* ---- stalls ------------------------------------------------------------ */
async function stallsManageList() {
  return json(200, {
    items: (await items('STALL')).map((s) => ({
      id: s.sk, stallName: s.stallName || '', category: s.category || '', stage: s.stage || 'pending',
      allocationLabel: s.allocationLabel || '', feeInr: s.feeInr || 0, paid: !!s.paid,
      paidMethod: s.paidMethod || '', paidAt: s.paidAt || 0,
    })),
  });
}
async function stallUpsert(me, body) {
  if (!can(me.tier, 'stalls.manage')) return json(403, { error: 'not permitted' });
  const stallName = str(body.stallName);
  if (!stallName) return json(400, { error: 'stallName is required' });
  const id = str(body.id) || `stall-${slug(stallName)}-${nowSec().toString(36)}`;
  // Preserve fields we don't manage here (analytics, rules) on edit.
  const prev = (await getRow('STALL', id)) || {};
  const paid = !!body.paid;
  // Honest manual fee record — not a payment, but auditable: how/when/by whom the
  // fee was collected offline. (Real vendor self-payment comes in the vendor step.)
  const paidMeta = paid
    ? {
      paidMethod: str(body.paidMethod) || prev.paidMethod || 'cash/offline',
      paidAt: prev.paid && prev.paidAt ? prev.paidAt : nowSec(),
      paidBy: prev.paid && prev.paidBy ? prev.paidBy : `admin:${me.sub}`,
    }
    : {};
  const row = await putRow('STALL', id, {
    stallName, category: str(body.category), stage: str(body.stage) || 'pending',
    allocationLabel: str(body.allocationLabel), feeInr: num(body.feeInr), paid,
    ...paidMeta,
    ...(prev.analytics ? { analytics: prev.analytics } : {}),
    ...(prev.rules ? { rules: prev.rules } : {}),
    ...(prev.rulesHi ? { rulesHi: prev.rulesHi } : {}),
  }, me);
  return json(200, row);
}
async function stallDelete(me, id) {
  if (!can(me.tier, 'stalls.manage')) return json(403, { error: 'not permitted' });
  await delRow('STALL', id);
  return json(200, { id, deleted: true });
}

/* ---- rooms (lodging inventory + allocation) ---------------------------- */
async function roomsList() {
  const rooms = (await items('ROOM')).sort((a, b) => str(a.hotelName).localeCompare(str(b.hotelName)));
  return json(200, {
    items: rooms.map((r) => ({
      id: r.sk, hotelName: r.hotelName || '', roomLabel: r.roomLabel || '', type: r.type || '',
      capacity: r.capacity || 0, status: r.status || 'active',
      assignedTo: r.assignedTo || '', guestName: r.guestName || '', checkedIn: !!r.checkedIn,
    })),
  });
}
async function roomUpsert(me, body) {
  if (!can(me.tier, 'lodging.manage')) return json(403, { error: 'not permitted' });
  const hotelName = str(body.hotelName);
  const roomLabel = str(body.roomLabel);
  if (!hotelName || !roomLabel) return json(400, { error: 'hotelName and roomLabel are required' });
  const id = str(body.id) || `room-${slug(hotelName)}-${slug(roomLabel)}`;
  const prev = (await getRow('ROOM', id)) || {};
  const row = await putRow('ROOM', id, {
    hotelName, roomLabel, type: str(body.type) || 'twin', capacity: num(body.capacity) || 2,
    status: str(body.status) || 'active',
    assignedTo: prev.assignedTo || '', guestName: prev.guestName || '', checkedIn: !!prev.checkedIn,
    ...(prev.availability ? { availability: prev.availability } : {}),
    ...(prev.contactPhone ? { contactPhone: prev.contactPhone } : {}),
  }, me);
  return json(200, row);
}
async function roomAllocate(me, id, body) {
  if (!can(me.tier, 'lodging.manage')) return json(403, { error: 'not permitted' });
  const room = await getRow('ROOM', id);
  if (!room) return json(404, { error: 'room not found' });
  // Clear allocation when guestName is blank; toggle check-in otherwise.
  const guestName = str(body.guestName);
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'ROOM' }, sk: { S: id } },
    UpdateExpression: 'SET assignedTo = :a, guestName = :g, checkedIn = :c, updatedAt = :u, updatedBy = :b',
    ExpressionAttributeValues: {
      ':a': { S: str(body.assignedTo) }, ':g': { S: guestName },
      ':c': { BOOL: guestName ? !!body.checkedIn : false },
      ':u': { N: String(nowSec()) }, ':b': { S: `admin:${me.sub}` },
    },
  }));
  return json(200, { id, assignedTo: str(body.assignedTo), guestName, checkedIn: guestName ? !!body.checkedIn : false });
}
async function roomDelete(me, id) {
  if (!can(me.tier, 'lodging.manage')) return json(403, { error: 'not permitted' });
  await delRow('ROOM', id);
  return json(200, { id, deleted: true });
}

/* ---- volunteers + shifts ---------------------------------------------- */
async function volunteersManageList() {
  return json(200, {
    items: (await items('VOL')).map((v) => ({
      id: v.sk, name: v.name || '', team: v.team || '', idVerified: !!v.idVerified,
      shifts: (v.shifts || []).map((s) => ({
        id: s.id || '', date: s.date || '', zone: s.zone || '', role: s.role || '',
        startsAtSec: s.startsAtSec || 0, endsAtSec: s.endsAtSec || 0,
      })),
    })),
  });
}
async function volunteerUpsert(me, body) {
  if (!can(me.tier, 'volunteers.manage')) return json(403, { error: 'not permitted' });
  const name = str(body.name);
  if (!name) return json(400, { error: 'name is required' });
  const id = str(body.id) || str(body.sub) || `vol-${slug(name)}-${nowSec().toString(36)}`;
  const prev = (await getRow('VOL', id)) || {};
  const row = await putRow('VOL', id, {
    sub: id, name, team: str(body.team), idVerified: !!body.idVerified,
    shifts: prev.shifts || [],
  }, me);
  return json(200, row);
}
async function volunteerShiftAdd(me, id, body) {
  if (!can(me.tier, 'volunteers.manage')) return json(403, { error: 'not permitted' });
  const vol = await getRow('VOL', id);
  if (!vol) return json(404, { error: 'volunteer not found' });
  const shift = {
    id: `sh-${nowSec().toString(36)}-${slug(str(body.zone)) || 'x'}`,
    date: str(body.date), zone: str(body.zone), role: str(body.role) || 'Steward',
    startsAtSec: num(body.startsAtSec), endsAtSec: num(body.endsAtSec),
  };
  const shifts = [...(vol.shifts || []), shift];
  await putRow('VOL', id, { sub: id, name: vol.name, team: vol.team || '', idVerified: !!vol.idVerified, shifts }, me);
  return json(200, { id, shift, shifts });
}
async function volunteerShiftDelete(me, id, shiftId) {
  if (!can(me.tier, 'volunteers.manage')) return json(403, { error: 'not permitted' });
  const vol = await getRow('VOL', id);
  if (!vol) return json(404, { error: 'volunteer not found' });
  const shifts = (vol.shifts || []).filter((s) => s.id !== shiftId);
  await putRow('VOL', id, { sub: id, name: vol.name, team: vol.team || '', idVerified: !!vol.idVerified, shifts }, me);
  return json(200, { id, shiftId, deleted: true, shifts });
}
async function volunteerDelete(me, id) {
  if (!can(me.tier, 'volunteers.manage')) return json(403, { error: 'not permitted' });
  await delRow('VOL', id);
  return json(200, { id, deleted: true });
}

/* ---- incidents (triage/resolve) --------------------------------------- */
const INC_STATUS = ['open', 'acknowledged', 'in-progress', 'resolved'];
async function incidentUpdate(me, id, body) {
  if (!can(me.tier, 'incidents.manage')) return json(403, { error: 'not permitted' });
  const inc = await getRow('INC', id);
  if (!inc) return json(404, { error: 'incident not found' });
  const sets = ['updatedAt = :u', 'updatedBy = :b'];
  const vals = { ':u': { N: String(nowSec()) }, ':b': { S: `admin:${me.sub}` } };
  if (body.status !== undefined) {
    const status = str(body.status);
    if (!INC_STATUS.includes(status)) return json(400, { error: `status must be one of ${INC_STATUS.join(', ')}` });
    sets.push('#s = :s'); vals[':s'] = { S: status };
  }
  if (body.assignee !== undefined) { sets.push('assignee = :a'); vals[':a'] = { S: str(body.assignee) }; }
  if (body.resolutionNote !== undefined) { sets.push('resolutionNote = :r'); vals[':r'] = { S: str(body.resolutionNote) }; }
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'INC' }, sk: { S: id } },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: vals,
    ...(body.status !== undefined ? { ExpressionAttributeNames: { '#s': 'status' } } : {}),
  }));
  return json(200, { id, status: str(body.status) || inc.status || 'open', assignee: body.assignee !== undefined ? str(body.assignee) : (inc.assignee || '') });
}

/* ---- announcements (festival-wide notices) ----------------------------- */
async function announcementsList() {
  const rows = (await items('ANNOUNCE')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return json(200, {
    items: rows.map((a) => ({
      id: a.sk, titleEn: a.titleEn || '', titleHi: a.titleHi || '',
      bodyEn: a.bodyEn || '', bodyHi: a.bodyHi || '', level: a.level || 'info',
      active: a.active !== false, updatedAt: a.updatedAt || 0, updatedBy: a.updatedBy || '',
    })),
  });
}
async function announcementUpsert(me, body) {
  if (!can(me.tier, 'announce.write')) return json(403, { error: 'not permitted' });
  const titleEn = str(body.titleEn);
  const bodyEn = str(body.bodyEn);
  if (!titleEn || !bodyEn) return json(400, { error: 'titleEn and bodyEn are required' });
  const id = str(body.id) || `ann-${nowSec().toString(36)}`;
  const row = await putRow('ANNOUNCE', id, {
    titleEn, titleHi: str(body.titleHi), bodyEn, bodyHi: str(body.bodyHi),
    level: ['info', 'alert'].includes(str(body.level)) ? str(body.level) : 'info',
    active: body.active !== false,
  }, me);
  return json(200, row);
}
async function announcementDelete(me, id) {
  if (!can(me.tier, 'announce.write')) return json(403, { error: 'not permitted' });
  await delRow('ANNOUNCE', id);
  return json(200, { id, deleted: true });
}

/* ---- pricing: activity fees/gating (ITEMCFG) + ticket tiers (TIER) ------ */
async function itemsList() {
  return json(200, {
    items: (await items('ITEMCFG')).map((i) => ({
      id: i.sk, titleEn: i.titleEn || '', titleHi: i.titleHi || '',
      feeInr: i.feeInr || 0, gateChecked: !!i.gateChecked,
      regMode: i.regMode || 'register', capacity: i.capacity || 0,
    })),
  });
}
async function itemUpsert(me, body) {
  if (!can(me.tier, 'pricing.manage')) return json(403, { error: 'not permitted' });
  const id = str(body.id || body.itemId);
  if (!id) return json(400, { error: 'itemId is required' });
  const prev = (await getRow('ITEMCFG', id)) || {};
  const row = await putRow('ITEMCFG', id, {
    itemId: id, titleEn: str(body.titleEn) || prev.titleEn || id, titleHi: str(body.titleHi) || prev.titleHi || '',
    feeInr: num(body.feeInr), gateChecked: !!body.gateChecked,
    regMode: str(body.regMode) || prev.regMode || 'register', capacity: num(body.capacity),
  }, me);
  return json(200, row);
}
async function tiersList() {
  return json(200, {
    items: (await items('TIER')).map((t) => ({
      id: t.sk, titleEn: t.titleEn || '', titleHi: t.titleHi || '', priceInr: t.priceInr || 0,
    })),
  });
}
async function tierUpsert(me, body) {
  if (!can(me.tier, 'pricing.manage')) return json(403, { error: 'not permitted' });
  const id = str(body.id) || slug(str(body.titleEn));
  if (!id) return json(400, { error: 'id or titleEn is required' });
  const row = await putRow('TIER', id, {
    titleEn: str(body.titleEn), titleHi: str(body.titleHi), priceInr: num(body.priceInr),
  }, me);
  return json(200, row);
}
async function tierDelete(me, id) {
  if (!can(me.tier, 'pricing.manage')) return json(403, { error: 'not permitted' });
  await delRow('TIER', id);
  return json(200, { id, deleted: true });
}

/* ---- orders + refund requests (manual settlement) ---------------------- */
// Refunds are a REQUEST an admin fulfils out-of-band (flight bookings/refunds are
// a manual process), then marks processed with a reference. No auto gateway call.
const ORDER_STATES = ['CONFIRMED', 'CANCELLED', 'COMP', 'PENDING'];
async function ordersList(me) {
  if (!can(me.tier, 'orders.manage')) return json(403, { error: 'not permitted' });
  const rows = (await items('ORDER')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json(200, {
    items: rows.slice(0, 300).map((o) => ({
      orderId: o.sk, sub: o.sub || '', kind: o.kind || '', itemId: o.itemId || '',
      amountInr: o.amountInr || 0, status: o.status || '', createdAt: o.createdAt || 0,
    })),
    revenueInr: rows.filter((o) => o.status === 'CONFIRMED').reduce((s, o) => s + (o.amountInr || 0), 0),
    confirmed: rows.filter((o) => o.status === 'CONFIRMED').length,
  });
}
async function orderSetStatus(me, orderId, body) {
  if (!can(me.tier, 'orders.manage')) return json(403, { error: 'not permitted' });
  const order = await getRow('ORDER', orderId);
  if (!order) return json(404, { error: 'order not found' });
  const status = str(body.status).toUpperCase();
  if (!ORDER_STATES.includes(status)) return json(400, { error: `status must be one of ${ORDER_STATES.join(', ')}` });
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'ORDER' }, sk: { S: orderId } },
    UpdateExpression: 'SET #s = :s, updatedAt = :u, updatedBy = :b',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': { S: status }, ':u': { N: String(nowSec()) }, ':b': { S: `admin:${me.sub}` } },
  }));
  await audit(me, 'order.status', `${orderId} → ${status}`);
  return json(200, { orderId, status });
}
async function refundRequest(me, orderId, body) {
  if (!can(me.tier, 'orders.manage')) return json(403, { error: 'not permitted' });
  const order = await getRow('ORDER', orderId);
  if (!order) return json(404, { error: 'order not found' });
  const row = await putRow('REFUNDREQ', orderId, {
    orderId, sub: order.sub || '', itemId: order.itemId || '', kind: order.kind || '',
    amountInr: order.amountInr || 0, reason: str(body.reason) || 'requested',
    status: 'REQUESTED', requestedBy: `admin:${me.sub}`, requestedAt: nowSec(),
  }, me);
  return json(200, row);
}
async function refundsList(me) {
  if (!can(me.tier, 'orders.manage')) return json(403, { error: 'not permitted' });
  const rows = (await items('REFUNDREQ')).sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  const open = rows.filter((r) => r.status !== 'PROCESSED');
  return json(200, {
    items: rows.map((r) => ({
      orderId: r.sk, sub: r.sub || '', itemId: r.itemId || '', amountInr: r.amountInr || 0,
      reason: r.reason || '', status: r.status || 'REQUESTED', requestedAt: r.requestedAt || 0,
      requestedBy: r.requestedBy || '', processedAt: r.processedAt || 0, processedRef: r.processedRef || '',
    })),
    pending: open.length, pendingInr: open.reduce((s, r) => s + (r.amountInr || 0), 0),
  });
}
async function refundProcess(me, orderId, body) {
  if (!can(me.tier, 'orders.manage')) return json(403, { error: 'not permitted' });
  const req = await getRow('REFUNDREQ', orderId);
  if (!req) return json(404, { error: 'refund request not found' });
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: 'REFUNDREQ' }, sk: { S: orderId } },
    UpdateExpression: 'SET #s = :s, processedRef = :r, processedNote = :n, processedAt = :a, processedBy = :b',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': { S: 'PROCESSED' }, ':r': { S: str(body.reference) }, ':n': { S: str(body.note) },
      ':a': { N: String(nowSec()) }, ':b': { S: `admin:${me.sub}` },
    },
  }));
  await audit(me, 'refund.process', `${orderId} ref=${str(body.reference)}`);
  return json(200, { orderId, status: 'PROCESSED', reference: str(body.reference) });
}

/* ---- wristbands (lost-child / attendee safety lookup) ------------------ */
// A band ties a short id (on a physical wristband) to a guardian contact so any
// staff member can reunite a lost child fast. The full list doubles as the
// device's offline snapshot (grab it on shift start). All staff tiers.
const bandId = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
async function wristbandsList(me) {
  if (!can(me.tier, 'wristband.manage')) return json(403, { error: 'not permitted' });
  return json(200, {
    version: nowSec(),
    items: (await items('WRISTBAND')).filter((b) => b.active !== false).map((b) => ({
      bandId: b.sk, childName: b.childName || '', ageBand: b.ageBand || '',
      guardianName: b.guardianName || '', guardianPhone: b.guardianPhone || '',
      notes: b.notes || '', zone: b.zone || '', createdAt: b.createdAt || 0,
    })),
  });
}
async function wristbandGet(me, id) {
  if (!can(me.tier, 'wristband.manage')) return json(403, { error: 'not permitted' });
  const b = await getRow('WRISTBAND', bandId(id));
  if (!b || b.active === false) return json(404, { error: 'wristband not found' });
  return json(200, {
    bandId: b.sk, childName: b.childName || '', ageBand: b.ageBand || '',
    guardianName: b.guardianName || '', guardianPhone: b.guardianPhone || '',
    notes: b.notes || '', zone: b.zone || '',
  });
}
async function wristbandUpsert(me, body) {
  if (!can(me.tier, 'wristband.manage')) return json(403, { error: 'not permitted' });
  const id = bandId(body.bandId || body.id);
  const childName = str(body.childName);
  const guardianPhone = str(body.guardianPhone);
  if (!id) return json(400, { error: 'bandId is required' });
  if (!childName || !guardianPhone) return json(400, { error: 'childName and guardianPhone are required' });
  const row = await putRow('WRISTBAND', id, {
    childName, ageBand: str(body.ageBand), guardianName: str(body.guardianName),
    guardianPhone, notes: str(body.notes), zone: str(body.zone), active: body.active !== false,
    createdAt: nowSec(),
  }, me);
  return json(200, { bandId: id, ...row });
}
async function wristbandDelete(me, id) {
  if (!can(me.tier, 'wristband.manage')) return json(403, { error: 'not permitted' });
  await delRow('WRISTBAND', bandId(id));
  return json(200, { bandId: bandId(id), deleted: true });
}

/* ------------------------- scanner (Phase 2) ---------------------------- */
// Default gate checkpoints (any valid pass grants entry). Event checkpoints are
// derived from what people actually register for (REG item ids).
const GATES = [
  { type: 'gate', id: 'gate:main', label: 'Main Gate' },
  { type: 'gate', id: 'gate:chogan', label: 'Chogan Ground' },
  { type: 'gate', id: 'gate:billing', label: 'Billing Landing' },
];
function regSubItem(r) {
  const parts = String(r.sk).split(':'); // reg:<sub>:<itemId>:<slot>
  // Prefer the top-level (server-written, authenticated) sub/itemId; fall back to
  // parsing the sk for older rows written before the server-authoritative resolver.
  return { sub: r.sub || parts[1], item: r.itemId || r.competitionId || parts[2] };
}

let jwksCache = null;
async function jwksKeys() {
  if (jwksCache) return jwksCache;
  const r = await fetch(process.env.JWKS_URL);
  jwksCache = (await r.json()).keys || [];
  return jwksCache;
}
async function verifyPass(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return { ok: false, reason: 'malformed' };
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString());
    claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header.alg !== 'ES256') return { ok: false, reason: 'bad-signature' };
  const key = (await jwksKeys()).find((k) => k.kid === header.kid && k.kty === 'EC');
  if (!key) return { ok: false, reason: 'bad-signature' };
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, format: 'jwk' });
  const valid = crypto.verify('SHA256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!valid) return { ok: false, reason: 'bad-signature' };
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < now) return { ok: false, reason: 'expired' };
  if (claims.nbf && claims.nbf > now + 60) return { ok: false, reason: 'not-yet-valid' };
  return { ok: true, claims };
}
const passId = (jti) => 'PASS-' + String(jti || '').slice(-8).toUpperCase();

async function checkpointsView() {
  const eventIds = [...new Set((await items('REG')).map((r) => regSubItem(r).item).filter(Boolean))];
  return json(200, {
    checkpoints: [...GATES, ...eventIds.map((id) => ({ type: 'event', id: `item:${id}`, label: id }))],
  });
}
/** Names-free: <sub> → [entitled event checkpoint ids]. Gates are universal, so
 *  they are NOT in the snapshot — the device grants any valid pass at a gate. */
async function entitlementsSnapshot() {
  const map = {};
  (await items('REG'))
    .filter((r) => r.status === 'confirmed')
    .forEach((r) => {
      const { sub, item } = regSubItem(r);
      if (!sub || !item) return;
      (map[sub] = map[sub] || []).push(`item:${item}`);
    });
  Object.keys(map).forEach((k) => (map[k] = [...new Set(map[k])]));
  return json(200, { version: Math.floor(Date.now() / 1000), entitlements: map });
}
async function scan(me, body) {
  const checkpoint = String(body.checkpoint || '');
  const v = await verifyPass(body.qrToken);
  if (!v.ok) {
    return json(200, { verdict: v.reason, accepted: false });
  }
  const { claims } = v;
  const now = Math.floor(Date.now() / 1000);
  // Revocation (the same feed offline verifiers pull).
  const rev = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `REV#${claims.jti}` }, sk: { S: 'REV' } } }));
  if (rev.Item) return json(200, { verdict: 'revoked', accepted: false, identity: identityOf(claims) });

  let verdict = 'valid';
  if (checkpoint.startsWith('item:')) {
    const entitled = (await items('REG'))
      .filter((r) => r.status === 'confirmed')
      .some((r) => {
        const { sub, item } = regSubItem(r);
        return sub === claims.sub && `item:${item}` === checkpoint;
      });
    if (!entitled) verdict = 'not-entitled';
  }
  // Record the scan (feeds the analytics scan count + the access log).
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk: { S: 'SCAN' }, sk: { S: `${claims.jti}:${checkpoint}:${body.ts || now}` },
      jti: { S: String(claims.jti) }, checkpoint: { S: checkpoint }, verdict: { S: verdict },
      ts: { N: String(body.ts || now) }, scannedBy: { S: `admin:${me.sub}` },
    },
  }));
  return json(200, { verdict, accepted: verdict === 'valid', identity: identityOf(claims) });
}
function identityOf(claims) {
  return { name: claims.name || '', ageBand: claims.ageBand || '', passId: passId(claims.jti), sub: claims.sub };
}

/* ------------------------------ router ---------------------------------- */
exports.handler = async (event) => {
  const http = (event.requestContext && event.requestContext.http) || {};
  const path = http.path || event.rawPath || '';
  const method = http.method || 'GET';
  // Ids are parsed from the path (the route is a greedy /admin/{proxy+}, so
  // named path-params aren't reliably present).
  const after = (re) => { const m = path.match(re); return m ? decodeURIComponent(m[1]) : ''; };
  const after2 = (re) => { const m = path.match(re); return m ? [decodeURIComponent(m[1]), decodeURIComponent(m[2])] : ['', '']; };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  // Public auth endpoints
  if (method === 'POST' && path.endsWith('/admin/auth/bootstrap')) return bootstrap(body);
  if (method === 'POST' && path.endsWith('/admin/auth/login')) return login(body);

  // Everything else needs a valid admin token
  let me;
  try {
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    me = await verifyJwt(auth.replace(/^Bearer\s+/i, ''));
  } catch (e) {
    return json(401, { error: 'unauthenticated', detail: String(e.message) });
  }
  // Session revocation (M1): a stateless JWT can't be revoked on its own, so
  // re-check the ADMIN row every request — a disabled or deleted admin loses
  // access immediately (not after the 12h TTL). Tier is refreshed from the row
  // too, so a demotion takes effect at once.
  try {
    const acct = await getAdmin(me.sub);
    if (!acct || acct.active === false) return json(401, { error: 'account disabled' });
    me.tier = acct.tier;
  } catch (e) {
    return json(502, { error: 'auth check failed', detail: String((e && e.message) || e) });
  }

  try {
    if (method === 'GET' && path.endsWith('/admin/me')) return json(200, { username: me.sub, tier: me.tier, tierName: TIER_NAMES[me.tier], caps: Object.keys(CAPS).filter((c) => can(me.tier, c)) });
    if (method === 'GET' && path.endsWith('/admin/audit')) return auditList(me);

    // admin management
    if (method === 'GET' && path.endsWith('/admin/admins')) return adminsList(me);
    if (method === 'POST' && path.endsWith('/admin/admins')) return adminCreate(me, body);
    if (method === 'POST' && /\/admin\/admins\/[^/]+\/password$/.test(path)) return adminSetPassword(me, CLEAN_USER(after(/\/admin\/admins\/([^/]+)\/password$/)), body);
    if (method === 'POST' && /\/admin\/admins\/[^/]+\/active$/.test(path)) return adminSetActive(me, CLEAN_USER(after(/\/admin\/admins\/([^/]+)\/active$/)), body);
    if (method === 'DELETE' && /\/admin\/admins\/[^/]+$/.test(path)) return adminDelete(me, CLEAN_USER(after(/\/admin\/admins\/([^/]+)$/)));

    // scanner (any signed-in staff, incl. Coordinators)
    if (method === 'GET' && path.endsWith('/admin/checkpoints')) return checkpointsView();
    if (method === 'GET' && path.endsWith('/admin/entitlements/snapshot')) return entitlementsSnapshot();
    if (method === 'POST' && path.endsWith('/admin/scan')) return scan(me, body);

    // festival actions
    if (method === 'POST' && path.endsWith('/admin/fly')) return fly(me, body);
    if (method === 'POST' && path.endsWith('/admin/revoke')) return revoke(me, body);
    if (method === 'POST' && path.endsWith('/admin/ask')) return ask(me, body);
    if (method === 'GET' && path.endsWith('/admin/faq')) return faqList();
    if (method === 'POST' && path.endsWith('/admin/faq')) return faqUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/faq\/[^/]+$/.test(path)) return faqDelete(me, after(/\/admin\/faq\/([^/]+)$/));

    // --- control plane: schedule ---
    if (method === 'GET' && path.endsWith('/admin/schedule')) return scheduleList();
    if (method === 'POST' && path.endsWith('/admin/schedule')) return scheduleUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/schedule\/[^/]+$/.test(path)) return scheduleDelete(me, after(/\/admin\/schedule\/([^/]+)$/));

    // --- control plane: stalls ---
    if (method === 'GET' && path.endsWith('/admin/stalls/list')) return stallsManageList();
    if (method === 'POST' && path.endsWith('/admin/stalls')) return stallUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/stalls\/[^/]+$/.test(path)) return stallDelete(me, after(/\/admin\/stalls\/([^/]+)$/));

    // --- control plane: rooms/lodging ---
    if (method === 'GET' && path.endsWith('/admin/rooms')) return roomsList();
    if (method === 'POST' && /\/admin\/rooms\/[^/]+\/allocate$/.test(path)) return roomAllocate(me, after(/\/admin\/rooms\/([^/]+)\/allocate$/), body);
    if (method === 'POST' && path.endsWith('/admin/rooms')) return roomUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/rooms\/[^/]+$/.test(path)) return roomDelete(me, after(/\/admin\/rooms\/([^/]+)$/));

    // --- control plane: volunteers + shifts ---
    if (method === 'GET' && path.endsWith('/admin/volunteers/list')) return volunteersManageList();
    if (method === 'POST' && /\/admin\/volunteers\/[^/]+\/shift$/.test(path)) return volunteerShiftAdd(me, after(/\/admin\/volunteers\/([^/]+)\/shift$/), body);
    if (method === 'DELETE' && /\/admin\/volunteers\/[^/]+\/shift\/[^/]+$/.test(path)) { const [v, s] = after2(/\/admin\/volunteers\/([^/]+)\/shift\/([^/]+)$/); return volunteerShiftDelete(me, v, s); }
    if (method === 'POST' && path.endsWith('/admin/volunteers')) return volunteerUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/volunteers\/[^/]+$/.test(path)) return volunteerDelete(me, after(/\/admin\/volunteers\/([^/]+)$/));

    // --- control plane: incidents (triage/resolve) ---
    if (method === 'POST' && /\/admin\/incidents\/[^/]+$/.test(path)) return incidentUpdate(me, after(/\/admin\/incidents\/([^/]+)$/), body);

    // --- control plane: announcements ---
    if (method === 'GET' && path.endsWith('/admin/announcements')) return announcementsList();
    if (method === 'POST' && path.endsWith('/admin/announcements')) return announcementUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/announcements\/[^/]+$/.test(path)) return announcementDelete(me, after(/\/admin\/announcements\/([^/]+)$/));

    // --- pricing: activity fees/gating + ticket tiers (money-sensitive) ---
    if (method === 'GET' && path.endsWith('/admin/items')) return itemsList();
    if (method === 'POST' && path.endsWith('/admin/items')) return itemUpsert(me, body);
    if (method === 'GET' && path.endsWith('/admin/tiers')) return tiersList();
    if (method === 'POST' && path.endsWith('/admin/tiers')) return tierUpsert(me, body);
    if (method === 'DELETE' && /\/admin\/tiers\/[^/]+$/.test(path)) return tierDelete(me, after(/\/admin\/tiers\/([^/]+)$/));

    // --- wristbands (child-safety lookup, all staff tiers) ---
    if (method === 'GET' && path.endsWith('/admin/wristbands')) return wristbandsList(me);
    if (method === 'POST' && path.endsWith('/admin/wristbands')) return wristbandUpsert(me, body);
    if (method === 'GET' && /\/admin\/wristbands\/[^/]+$/.test(path)) return wristbandGet(me, after(/\/admin\/wristbands\/([^/]+)$/));
    if (method === 'DELETE' && /\/admin\/wristbands\/[^/]+$/.test(path)) return wristbandDelete(me, after(/\/admin\/wristbands\/([^/]+)$/));

    // --- orders + refund requests (money-sensitive, manual settlement) ---
    if (method === 'GET' && path.endsWith('/admin/orders')) return ordersList(me);
    if (method === 'POST' && /\/admin\/orders\/[^/]+\/refund-request$/.test(path)) return refundRequest(me, after(/\/admin\/orders\/([^/]+)\/refund-request$/), body);
    if (method === 'POST' && /\/admin\/orders\/[^/]+\/status$/.test(path)) return orderSetStatus(me, after(/\/admin\/orders\/([^/]+)\/status$/), body);
    if (method === 'GET' && path.endsWith('/admin/refunds')) return refundsList(me);
    if (method === 'POST' && /\/admin\/refunds\/[^/]+\/process$/.test(path)) return refundProcess(me, after(/\/admin\/refunds\/([^/]+)\/process$/), body);

    // analytics
    if (!can(me.tier, 'analytics.read')) return json(403, { error: 'not permitted' });
    if (path.endsWith('/admin/summary')) return summary();
    if (path.endsWith('/admin/visitors')) return visitors();
    if (path.endsWith('/admin/stalls')) return stallsView();
    if (path.endsWith('/admin/lodging')) return lodgingView();
    if (path.endsWith('/admin/incidents')) return incidentsView();
    if (path.endsWith('/admin/volunteers')) return volunteersView();
    if (path.endsWith('/admin/revocations')) return revocationsView();

    return json(404, { error: 'unknown admin path' });
  } catch (e) {
    return json(502, { error: 'admin request failed', detail: String((e && e.message) || e) });
  }
};
