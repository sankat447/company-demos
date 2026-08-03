/**
 * Minimal SSE reader for the AI assistant stream (ai.assistantPath).
 * RN's fetch lacks readable streams, so we parse XHR progress chunks.
 * All model calls stay server-side (API GW → Lambda → Bedrock) — the app
 * only ever posts text/audio and renders the streamed tokens.
 */
export interface SseHandle {
  cancel(): void;
}

export function streamSse(
  url: string,
  options: {
    body: unknown;
    headers: Record<string, string>;
    onToken(data: string): void;
    onDone(): void;
    onError(err: Error): void;
  },
): SseHandle {
  const xhr = new XMLHttpRequest();
  let seen = 0;

  xhr.open('POST', url);
  for (const [k, v] of Object.entries(options.headers)) xhr.setRequestHeader(k, v);
  xhr.setRequestHeader('Accept', 'text/event-stream');

  xhr.onprogress = () => {
    const chunk = xhr.responseText.slice(seen);
    seen = xhr.responseText.length;
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') options.onDone();
      else options.onToken(data);
    }
  };
  xhr.onload = () => {
    if (xhr.status >= 400) options.onError(new Error(`assistant stream failed: ${xhr.status}`));
    else options.onDone();
  };
  xhr.onerror = () => options.onError(new Error('assistant stream network error'));
  xhr.send(JSON.stringify(options.body));

  return { cancel: () => xhr.abort() };
}
