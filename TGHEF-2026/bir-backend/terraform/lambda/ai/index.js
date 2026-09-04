/**
 * B8: AI endpoints (REST → Bedrock). One Lambda behind /ai/assistant,
 * /ai/planner, /ai/translate and /ai/queue on the HTTP API (Cognito-authorized).
 * The app NEVER holds model keys or calls Bedrock directly — it goes through
 * here. Uses the Bedrock Converse API with a cross-region inference profile.
 */
'use strict';
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const client = new BedrockRuntimeClient({});
const MODEL = process.env.BEDROCK_MODEL;

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

async function converse(system, text, maxTokens) {
  const out = await client.send(
    new ConverseCommand({
      modelId: MODEL,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: text || '' }] }],
      inferenceConfig: { maxTokens, temperature: 0.3 },
    }),
  );
  return (out.output.message.content || [])
    .map((c) => c.text)
    .filter(Boolean)
    .join('')
    .trim();
}

exports.handler = async (event) => {
  const path = (event.requestContext && event.requestContext.http && event.requestContext.http.path) || event.rawPath || '';
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
    if (path.endsWith('/ai/assistant')) {
      return json(200, { reply: await converse(ASSISTANT_SYS, String(body.message || ''), 600) });
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
      const prompt =
        `Stall: ${body.stall || 'a food stall'}. Signals: ${body.context || 'busy festival evening'}.`;
      return json(200, { estimate: await converse(QUEUE_SYS, prompt, 120) });
    }
    return json(404, { error: 'unknown ai path' });
  } catch (e) {
    return json(502, { error: 'ai unavailable', detail: String((e && e.message) || e) });
  }
};
