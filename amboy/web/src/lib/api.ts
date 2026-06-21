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
