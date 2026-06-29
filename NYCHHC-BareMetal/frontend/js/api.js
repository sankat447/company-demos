// Backend client. On-cluster the frontend (iis-ai-ui) talks to the backend
// (iis-ai-ai) SAME-ORIGIN: nginx proxies /api/* to nychhc-backend.iis-ai-ai.svc
// (avoids the cross-namespace route derivation + CORS). For local dev fall back to
// localhost:8000. Override with ?backend=.
const params = new URLSearchParams(location.search);
export const BACKEND = (params.get("backend")
  || ((location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://localhost:8000" : "")).replace(/\/$/, "");

async function unwrap(r) {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const j = await r.json();
  return j.data !== undefined ? j.data : j;
}

// Dev-mode role context (DR-01 / BR-9). The SPA sets window.__ROLE on role switch;
// every request carries it as X-NYCHHC-Roles so the backend can gate tools/actions.
function roleHeaders(extra = {}) {
  const role = (typeof window !== "undefined" && window.__ROLE) || "Scheduler";
  const user = (typeof window !== "undefined" && window.__USER) || "demo:" + role;
  return { "X-NYCHHC-Roles": role, "X-NYCHHC-User": user, ...extra };
}

export const get = (path, q = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "")).toString();
  return fetch(`${BACKEND}${path}${qs ? "?" + qs : ""}`, { headers: roleHeaders() }).then(unwrap);
};
export const post = (path, body = {}) =>
  fetch(`${BACKEND}${path}`, { method: "POST", headers: roleHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) }).then(unwrap);

// Copilot SSE stream → async iterator of text chunks.
export async function* streamChat(message, role) {
  const r = await fetch(`${BACKEND}/api/chat`, {
    method: "POST", headers: roleHeaders({ "content-type": "application/json" }),
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
