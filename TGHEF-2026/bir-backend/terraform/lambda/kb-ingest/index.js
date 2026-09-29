/**
 * RAG ingestion: S3 → DynamoDB knowledge chunks. Fires on the KB bucket.
 *   ObjectCreated  → read the doc, chunk it, replace that doc's KB#DOC rows.
 *   ObjectRemoved  → delete that doc's KB#DOC rows.
 *
 * Supports Markdown / plain text / JSON today (the formats organisers drop for
 * festival rules & instructions). PDFs would need a parser (a bundled dep) —
 * out of scope for the lexical KB; convert to .md/.txt for now.
 *
 * Chunks are keyed pk=KB#DOC, sk=<docId>#<index>, so re-ingesting a doc is
 * idempotent (old chunks for the docId are cleared first). @aws-sdk clients
 * ship in the Node.js 20 runtime — no bundled deps.
 */
'use strict';
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const s3 = new S3Client({});
const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE;
const MAX_CHARS = parseInt(process.env.KB_CHUNK_CHARS || '1100', 10);
const OVERLAP = parseInt(process.env.KB_CHUNK_OVERLAP || '150', 10);

/** A stable, readable doc id from the S3 key (e.g. kb/rules/paragliding.md). */
function docIdFor(key) {
  return key.replace(/[^A-Za-z0-9._/-]/g, '_');
}

async function readObject(bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await out.Body.transformToString('utf-8');
  if (key.toLowerCase().endsWith('.json')) {
    // A JSON doc may be {title, text} or {chunks:[...]} or an array of {title,text}.
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j)) return j.map((x) => ({ title: x.title || '', text: String(x.text || '') }));
      if (Array.isArray(j.chunks)) return j.chunks.map((x) => ({ title: x.title || j.title || '', text: String(x.text || x) }));
      return [{ title: j.title || '', text: String(j.text || body) }];
    } catch {
      return [{ title: '', text: body }];
    }
  }
  return null; // signal: plain text/markdown, chunk below
}

/** Split markdown/text into ~MAX_CHARS chunks on paragraph boundaries, carrying
 *  the current heading as the chunk title, with a little overlap for context. */
function chunkText(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let heading = '';
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) blocks.push({ title: heading, text: t });
    buf = '';
  };
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1].trim();
      continue;
    }
    if (!line.trim()) {
      if (buf.length >= MAX_CHARS) flush();
      else buf += '\n';
      continue;
    }
    if (buf.length + line.length > MAX_CHARS) {
      const tail = buf.slice(-OVERLAP);
      flush();
      buf = tail;
    }
    buf += line + '\n';
  }
  flush();
  return blocks;
}

async function clearDoc(docId) {
  const existing = [];
  let ExclusiveStartKey;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :d)',
        ExpressionAttributeValues: { ':p': { S: 'KB#DOC' }, ':d': { S: `${docId}#` } },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey,
      }),
    );
    (out.Items || []).forEach((i) => existing.push(i));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  await batchWrite(existing.map((i) => ({ DeleteRequest: { Key: { pk: i.pk, sk: i.sk } } })));
  return existing.length;
}

async function batchWrite(requests) {
  for (let i = 0; i < requests.length; i += 25) {
    const slice = requests.slice(i, i + 25);
    if (slice.length) await ddb.send(new BatchWriteItemCommand({ RequestItems: { [TABLE]: slice } }));
  }
}

exports.handler = async (event) => {
  for (const rec of event.Records || []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));
    const docId = docIdFor(key);
    const removed = (rec.eventName || '').startsWith('ObjectRemoved');

    if (removed) {
      const n = await clearDoc(docId);
      // eslint-disable-next-line no-console
      console.log(`KB: removed ${n} chunks for ${docId}`);
      continue;
    }

    const preParsed = await readObject(bucket, key);
    let blocks = preParsed;
    if (!blocks) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const raw = await out.Body.transformToString('utf-8');
      blocks = chunkText(raw);
    }
    blocks = blocks.filter((b) => b.text && b.text.trim());

    await clearDoc(docId);
    const now = String(Math.floor(Date.now() / 1000));
    const puts = blocks.map((b, idx) => ({
      PutRequest: {
        Item: {
          pk: { S: 'KB#DOC' },
          sk: { S: `${docId}#${String(idx).padStart(4, '0')}` },
          docId: { S: docId },
          title: { S: (b.title || key.split('/').pop() || docId).slice(0, 200) },
          text: { S: b.text.slice(0, 8000) },
          source: { S: key },
          updatedAt: { N: now },
        },
      },
    }));
    await batchWrite(puts);
    // eslint-disable-next-line no-console
    console.log(`KB: ingested ${puts.length} chunks from ${key} (docId ${docId})`);
  }
  return { ok: true };
};
