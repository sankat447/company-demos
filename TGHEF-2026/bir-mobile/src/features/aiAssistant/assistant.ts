/**
 * Festival assistant (m1). Talks to the live, RAG-grounded /ai/assistant endpoint
 * (Cognito IdToken). Replaced the dead placeholder + unused SSE scaffolding — the
 * backend returns a single JSON {reply, grounded}, not a stream.
 */
import { fetchAuthSession } from 'aws-amplify/auth';

import { getStack, restUrl } from '@/config/stack';

export interface AssistantReply {
  reply: string;
  grounded: boolean;
}
export class RateLimitedError extends Error {}

export async function askAssistant(message: string): Promise<AssistantReply> {
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  if (!token) throw new Error('not authenticated');
  const res = await fetch(restUrl(getStack().ai.assistantPath), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (res.status === 429) throw new RateLimitedError('rate limited');
  if (!res.ok) throw new Error(`assistant unavailable (${res.status})`);
  const j = (await res.json()) as { reply?: string; grounded?: boolean };
  return { reply: String(j.reply || ''), grounded: !!j.grounded };
}
