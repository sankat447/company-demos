/**
 * REST client for the API Gateway endpoints in the contract (payments, AI).
 * All calls carry the Cognito access token; paths come from the contract only.
 */
import { fetchAuthSession } from 'aws-amplify/auth';

import { restUrl } from '@/config/stack';

async function authHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function restPost<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const res = await fetch(restUrl(path), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as TResponse;
}

export async function restGet<TResponse>(path: string): Promise<TResponse> {
  const res = await fetch(restUrl(path), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as TResponse;
}
