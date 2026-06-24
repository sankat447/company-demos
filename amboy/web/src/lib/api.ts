import { useAuth, DEV_MODE } from "../store/auth";

// All calls are same-origin /api/* — nginx (cluster) or vite proxy (dev) forward
// to the in-cluster amboy services. Auth: Bearer (OIDC) or X-Amboy-Roles (dev).
export function authHeaders(): Record<string, string> {
  const { roles, getToken } = useAuth.getState();
  if (DEV_MODE) return { "X-Amboy-Roles": roles.join(",") };
  return { Authorization: `Bearer ${getToken()}` };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body: unknown) => req<T>(p, { method: "POST", body: JSON.stringify(body) }),
};

// Step 2: detect PII in an uploaded doc (no tokenizing). Returns spans + a
// downloadable highlighted document for human review.
export async function detectDocument(file: File): Promise<import("./types").DetectResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/detect", { method: "POST", headers: authHeaders(), body: fd });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Step 3: tokenize ONLY the accepted spans, then index.
export function commitDocument(body: object) {
  return api.post<{ chunks_indexed: number; tokens_stored: number }>("/commit", body);
}

// Function 1 — store a de-identified artifact + explorer.
export function commitArtifact(body: object) {
  return api.post<{ artifact_id: string; name: string; entities: number }>("/commit_artifact", body);
}
export function listArtifacts() {
  return api.get<{ artifacts: import("./types").Artifact[] }>("/artifacts");
}
export function getArtifact(id: string) {
  return api.get<import("./types").ArtifactDetail>(`/artifacts/${encodeURIComponent(id)}`);
}
export async function deleteArtifact(id: string) {
  const r = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Model Training console.
export function startTraining() { return api.post<{ ok: boolean; reason?: string }>("/training/start", {}); }
export function getTrainingStatus() { return api.get<import("./types").TrainingStatus>("/training/status"); }
export function trainingCmd(command: string) {
  return api.post<{ ok: boolean; reason?: string } & import("./types").TrainingStatus>("/training/cmd", { command });
}
export function listModelVersions() { return api.get<{ versions: import("./types").ModelVersion[] }>("/training/versions"); }
export function getServedModel() { return api.get<{ ok: boolean; base_version?: string; head_version?: string }>("/training/served"); }
export function switchModel(version: string) {
  return api.post<{ ok: boolean; version?: string; head_version?: string | null; error?: string }>("/training/switch", { version });
}
export function detectText(text: string) {
  return api.post<{ spans: { type: string; text: string; source: string }[] }>("/detect_text", { text });
}

// Function 2 — comparability + indexing.
export function comparability(a: string, b: string) {
  return api.post<import("./types").Comparability>("/comparability", { artifact_a: a, artifact_b: b });
}
export function indexComparison(body: object) {
  return api.post<{ comparison_id: string; chunks_indexed: number }>("/index_comparison", body);
}

// Upload a document (PDF/DOCX/TXT/MD) for de-identification + indexing.
// No Content-Type header — the browser sets the multipart boundary.
export async function uploadDocument(form: FormData): Promise<{ chunks_indexed: number; tokens_stored: number }> {
  const res = await fetch("/api/ingest_document", { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Purge a comparison's index rows + facts + stored objects (free space).
export function purgeComparison(comparisonId: string) {
  return api.post<{ chunks_deleted: number; objects_deleted: number }>(
    "/purge_comparison", { comparison_id: comparisonId });
}

// Reveal a sealed token via deid-gateway (never an LLM). Returns token->value map.
export async function detokenize(token: string, reason: string): Promise<string | null> {
  const res = await fetch(`/api/detokenize?reason=${encodeURIComponent(reason)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ token }),
  });
  if (res.status === 403) throw new Error("403");
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.value ?? null;
}
