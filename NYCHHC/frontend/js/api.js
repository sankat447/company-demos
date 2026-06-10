// Backend client. Derives the backend route from the frontend host on-cluster;
// falls back to localhost for `python3 -m http.server` dev. Override with ?backend=.
const params = new URLSearchParams(location.search);
export const BACKEND = (params.get("backend")
  || (location.hostname.includes("nychhc-frontend")
        ? location.origin.replace("nychhc-frontend", "nychhc-copilot")
        : "http://localhost:8088")).replace(/\/$/, "");

async function unwrap(r) {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const j = await r.json();
  return j.data !== undefined ? j.data : j;
}

export const get = (path, q = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "")).toString();
  return fetch(`${BACKEND}${path}${qs ? "?" + qs : ""}`).then(unwrap);
};
export const post = (path, body = {}) =>
  fetch(`${BACKEND}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(unwrap);

// Copilot SSE stream → async iterator of text chunks.
export async function* streamChat(message, role) {
  const r = await fetch(`${BACKEND}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, role }),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", event = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ") && event === "token") {
        try { yield JSON.parse(line.slice(6)).text || ""; } catch {}
      }
    }
  }
}
