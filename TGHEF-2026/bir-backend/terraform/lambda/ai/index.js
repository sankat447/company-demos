/**
 * B8 + RAG: AI endpoints (REST → Anthropic Messages API) with a festival
 * knowledge base. One Cognito-authorized Lambda behind:
 *   POST /ai/assistant · /planner · /translate · /queue   (model calls)
 *   POST /ai/faq  · GET /ai/faq · DELETE /ai/faq/{id}      (live FAQ admin)
 *
 * The assistant is retrieval-augmented: every question loads ALL curated FAQs
 * (organisers add/edit these live during the event) plus the top-matching
 * chunks of the rules/instructions dropped in the KB bucket (ingested into
 * KB#DOC), and answers ONLY from that knowledge. Retrieval is lexical today
 * (term scoring — no extra key); retrieve() is the single seam to swap in
 * semantic embeddings later. See docs/AI_ENDPOINTS.md.
 *
 * The app never holds the model key — it lives in SSM (SecureString), read at
 * runtime. @aws-sdk clients ship in the Node.js 20 runtime; the model call uses
 * global fetch. No bundled dependencies.
 */
'use strict';
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const {
  DynamoDBClient,
  UpdateItemCommand,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const ssm = new SSMClient({});
const ddb = new DynamoDBClient({});
const KEY_PARAM = process.env.ANTHROPIC_KEY_PARAM;
const MODEL = process.env.ANTHROPIC_MODEL;
const TABLE = process.env.TABLE;
const RATE_PER_MIN = parseInt(process.env.AI_RATE_PER_MIN || '0', 10);
const TOP_K = parseInt(process.env.AI_KB_TOP_K || '6', 10);
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

let cachedKey = null;
async function apiKey() {
  if (cachedKey) return cachedKey;
  const out = await ssm.send(new GetParameterCommand({ Name: KEY_PARAM, WithDecryption: true }));
  const val = out.Parameter && out.Parameter.Value;
  if (!val || val.startsWith('REPLACE')) {
    const e = new Error('Anthropic API key is not configured for this stack');
    e.notConfigured = true;
    throw e;
  }
  cachedKey = val;
  return cachedKey;
}

const ASSISTANT_SYS =
  'You are the friendly assistant for the Bir Festival 2026 (21–23 November, Bir–Billing, ' +
  'Himachal Pradesh — India\'s paragliding capital). Help visitors with the schedule, ' +
  'paragliding & fly-status, food stalls, lodging, tickets, safety/SOS and getting around. ' +
  'Be concise and warm. Reply in the same language the visitor uses (English or Hindi). ' +
  'If you are unsure or it is a safety matter, tell them to check the official fly-status or ' +
  'contact the help desk. Never invent prices, times or medical advice.';

const PLANNER_SYS =
  'You are a festival itinerary planner for Bir Festival 2026 (21–23 November). Given the ' +
  'visitor\'s interests, days and notes, produce a short, realistic day-by-day plan using ' +
  'festival activities (tandem paragliding in the morning window, cultural nights in the ' +
  'evening at Chogan, food street, bookable experiences). Keep it practical and brief; note ' +
  'that flying depends on the official weather call. Match the visitor\'s language.';

const QUEUE_SYS =
  'You estimate the current wait time for a Bir Festival food stall from the signals given. ' +
  'Answer in one short line: an estimate in minutes and a one-clause reason. Be realistic ' +
  '(5–45 min). Match the language of the request.';

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

// ------------------------------- auth helpers -------------------------------
function callerGroups(claims) {
  const g = claims && claims['cognito:groups'];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  // The HTTP API JWT authorizer flattens the array to e.g. "[organiser-lite volunteer]".
  return String(g)
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}
function isOrganiser(claims) {
  const g = callerGroups(claims);
  return g.includes('organiser-lite') || g.includes('safety-officer');
}

// ------------------------------ rate limiting -------------------------------
async function withinRate(sub) {
  if (!RATE_PER_MIN || RATE_PER_MIN <= 0) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / 60);
  try {
    const out = await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: `AIRL#${sub}` }, sk: { S: String(bucket) } },
        UpdateExpression: 'ADD #n :one SET #ttl = :ttl',
        ExpressionAttributeNames: { '#n': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': { N: '1' }, ':ttl': { N: String(nowSec + 120) } },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return parseInt(out.Attributes.count.N, 10) <= RATE_PER_MIN;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('rate-limit counter failed (fail-open):', (e && e.message) || e);
    return true;
  }
}

// ------------------------------- knowledge base -----------------------------
async function queryAll(pk) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': { S: pk } },
        ExclusiveStartKey,
      }),
    );
    (out.Items || []).forEach((i) => items.push(i));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function loadFaqs() {
  return (await queryAll('KB#FAQ')).map((i) => ({
    id: i.sk.S,
    question: (i.question && i.question.S) || '',
    answer: (i.answer && i.answer.S) || '',
  }));
}
async function loadChunks() {
  return (await queryAll('KB#DOC')).map((i) => ({
    id: i.sk.S,
    title: (i.title && i.title.S) || '',
    text: (i.text && i.text.S) || '',
  }));
}

const STOP = new Set(
  'the a an of to in for on at is are was were be and or how do does did i you my your we our can could what when where which who why with from this that these those it its as by at into about not no yes please'.split(
    ' ',
  ),
);
function tokens(s) {
  return (String(s).toLowerCase().match(/[a-z0-9ऀ-ॿ]+/g) || []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}
/**
 * Lexical retrieval: score each chunk by query-term overlap (with a small tf
 * bonus) and return the top K. This is the ONE function to replace with a
 * vector search when embeddings are added — everything else stays the same.
 */
function retrieve(question, chunks, k) {
  const q = [...new Set(tokens(question))];
  if (!q.length) return [];
  return chunks
    .map((c) => {
      const tf = {};
      tokens(`${c.title} ${c.text}`).forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      let s = 0;
      for (const term of q) if (tf[term]) s += 1 + Math.min(tf[term], 3) * 0.2;
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.c);
}

async function assistantReply(question) {
  const [faqs, chunks] = await Promise.all([loadFaqs(), loadChunks()]);
  const top = retrieve(question, chunks, TOP_K);
  let ctx = '';
  if (faqs.length) {
    ctx +=
      'FESTIVAL FAQ (authoritative — prefer these for a direct match):\n' +
      faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n') +
      '\n\n';
  }
  if (top.length) {
    ctx +=
      'FESTIVAL RULES & INFO (excerpts):\n' +
      top.map((c) => `[${c.title || c.id}]\n${c.text}`).join('\n---\n') +
      '\n\n';
  }
  const grounded = faqs.length + top.length > 0;
  const sys = grounded
    ? `${ASSISTANT_SYS}\n\nAnswer using ONLY the festival knowledge below. Prefer an FAQ entry for a direct match. If the answer is not in this knowledge, say you are not certain and point them to the official fly-status or the help desk — do not invent. Match the visitor's language.\n\n${ctx}`
    : ASSISTANT_SYS;
  return { reply: await converse(sys, question, 600), grounded };
}

// ------------------------------- FAQ admin ----------------------------------
function faqIdFromPath(path) {
  const m = path.match(/\/ai\/faq\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function upsertFaq(sub, body) {
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();
  if (!question || !answer) return json(400, { error: 'question and answer are required' });
  const id = String(body.id || `faq-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9._:-]/g, '');
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: 'KB#FAQ' },
        sk: { S: id },
        question: { S: question },
        answer: { S: answer },
        updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
        updatedBy: { S: sub },
      },
    }),
  );
  return json(200, { id, question, answer });
}
async function listFaqs() {
  return json(200, { items: await loadFaqs() });
}
async function deleteFaq(id) {
  if (!id) return json(400, { error: 'faq id required' });
  await ddb.send(
    new DeleteItemCommand({ TableName: TABLE, Key: { pk: { S: 'KB#FAQ' }, sk: { S: id } } }),
  );
  return json(200, { id, deleted: true });
}

// ------------------------------- model call ---------------------------------
async function converse(system, text, maxTokens) {
  const key = await apiKey();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: text || '' }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .map((c) => (c && c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('')
    .trim();
}

exports.handler = async (event) => {
  const http = (event.requestContext && event.requestContext.http) || {};
  const path = http.path || event.rawPath || '';
  const method = http.method || 'POST';
  const claims =
    (event.requestContext &&
      event.requestContext.authorizer &&
      event.requestContext.authorizer.jwt &&
      event.requestContext.authorizer.jwt.claims) ||
    {};
  if (!claims.sub) return json(401, { error: 'unauthenticated' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'bad json' });
  }

  try {
    // ---- FAQ admin (organiser-lite / safety-officer) ----
    if (path.match(/\/ai\/faq(\/|$)/)) {
      if (!isOrganiser(claims)) return json(403, { error: 'organiser role required' });
      if (method === 'POST') return await upsertFaq(claims.sub, body);
      if (method === 'GET') return await listFaqs();
      if (method === 'DELETE') return await deleteFaq(faqIdFromPath(path));
      return json(405, { error: 'method not allowed' });
    }

    // ---- model routes (rate-limited) ----
    if (!(await withinRate(claims.sub))) {
      return json(429, {
        error: 'rate limited',
        detail: `Up to ${RATE_PER_MIN} AI requests per minute. Please try again shortly.`,
      });
    }

    if (path.endsWith('/ai/assistant')) {
      return json(200, await assistantReply(String(body.message || '')));
    }
    if (path.endsWith('/ai/planner')) {
      const prompt =
        `Interests: ${(body.interests || []).join(', ') || 'anything'}. ` +
        `Days: ${(body.days || []).join(', ') || '21–23 Nov'}. ` +
        `Notes: ${body.notes || 'none'}.`;
      return json(200, { plan: await converse(PLANNER_SYS, prompt, 800) });
    }
    if (path.endsWith('/ai/translate')) {
      const to = body.to || 'English';
      const sys = `Translate the text to ${to}. Output ONLY the translation, nothing else.`;
      return json(200, { translation: await converse(sys, String(body.text || ''), 400) });
    }
    if (path.endsWith('/ai/queue')) {
      const prompt = `Stall: ${body.stall || 'a food stall'}. Signals: ${body.context || 'busy festival evening'}.`;
      return json(200, { estimate: await converse(QUEUE_SYS, prompt, 120) });
    }
    return json(404, { error: 'unknown ai path' });
  } catch (e) {
    if (e && e.notConfigured) return json(503, { error: 'ai not configured', detail: String(e.message) });
    return json(502, { error: 'ai unavailable', detail: String((e && e.message) || e) });
  }
};
