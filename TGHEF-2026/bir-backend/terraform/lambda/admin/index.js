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
const CAPS = {
  'analytics.read': [1, 2, 3, 4],
  'faq.write': [1, 2, 3],
  'pass.revoke': [1, 2],
  'flystatus.set': [1, 2],
  'admin.manage': [1, 2, 3],
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
  const a = await getAdmin(username);
  if (!a || a.active === false || !verifyPw(String(body.password || ''), a.pwHash)) {
    return json(401, { error: 'invalid username or password' });
  }
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
  return json(200, { total: rows.length, byCategory: tally(rows, 'category'), items: rows.slice(0, 50).map((i) => ({ category: i.category, note: i.note, zone: i.zone || '', ts: i.ts, reportedBy: i.reportedBy })) });
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
  return { sub: parts[1], item: parts[2] || r.itemId || r.competitionId };
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
  const pp = event.pathParameters || {};
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

  try {
    if (method === 'GET' && path.endsWith('/admin/me')) return json(200, { username: me.sub, tier: me.tier, tierName: TIER_NAMES[me.tier], caps: Object.keys(CAPS).filter((c) => can(me.tier, c)) });

    // admin management
    if (method === 'GET' && path.endsWith('/admin/admins')) return adminsList(me);
    if (method === 'POST' && path.endsWith('/admin/admins')) return adminCreate(me, body);
    if (method === 'POST' && /\/admin\/admins\/[^/]+\/password$/.test(path)) return adminSetPassword(me, CLEAN_USER(pp.username), body);
    if (method === 'POST' && /\/admin\/admins\/[^/]+\/active$/.test(path)) return adminSetActive(me, CLEAN_USER(pp.username), body);
    if (method === 'DELETE' && /\/admin\/admins\/[^/]+$/.test(path)) return adminDelete(me, CLEAN_USER(pp.username));

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
    if (method === 'DELETE' && /\/admin\/faq\/[^/]+$/.test(path)) return faqDelete(me, decodeURIComponent(pp.id || ''));

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
