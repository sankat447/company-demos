import { authHeaders } from "../lib/api";
import type { ChatMeta } from "../lib/types";

export type StreamEvent =
  | { type: "delta"; t: string }
  | { type: "meta"; meta: ChatMeta };

// Consume the compare-agent /chat SSE stream (event: delta | meta).
export async function* streamChat(body: object): AsyncGenerator<StreamEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const e of events) {
      const ev = /event: (\w+)/.exec(e)?.[1];
      const data = /data: (.*)/s.exec(e)?.[1];
      if (!data) continue;
      if (ev === "delta") yield { type: "delta", t: JSON.parse(data).t };
      if (ev === "meta") yield { type: "meta", meta: JSON.parse(data) as ChatMeta };
    }
  }
}
