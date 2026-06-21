import { create } from "zustand";
import type { Role } from "../lib/types";

// OIDC is used when an issuer is configured; otherwise the app runs in dev mode
// (role picker -> X-Amboy-Roles header), matching the backend's AUTH_DEV_MODE.
const OIDC_ISSUER = import.meta.env.VITE_OIDC_ISSUER as string | undefined;
export const DEV_MODE = !OIDC_ISSUER;

const ALL_ROLES: Role[] = [
  "npi-user", "npi-analyst", "npi-compliance", "npi-audit", "npi-admin", "npi-reveal",
];

interface AuthState {
  authenticated: boolean;
  username: string;
  roles: Role[];
  token: string;
  signIn: (roles: Role[], username?: string) => void;
  signOut: () => void;
  hasRole: (r: Role) => boolean;
  getToken: () => string;
  stepUp: () => Promise<boolean>;
}

const saved = (() => {
  try { return JSON.parse(sessionStorage.getItem("amboy-auth") || "null"); }
  catch { return null; }
})();

export const useAuth = create<AuthState>((set, get) => ({
  authenticated: !!saved?.authenticated,
  username: saved?.username || "",
  roles: saved?.roles || [],
  token: saved?.token || "",
  signIn: (roles, username = "demo-user") => {
    const next = { authenticated: true, username, roles, token: "" };
    sessionStorage.setItem("amboy-auth", JSON.stringify(next));
    set(next);
  },
  signOut: () => {
    sessionStorage.removeItem("amboy-auth");
    set({ authenticated: false, username: "", roles: [], token: "" });
  },
  hasRole: (r) => get().roles.includes(r),
  getToken: () => get().token,
  // Step-up: in dev mode it's an explicit confirm; with OIDC, a fresh ACR/login.
  stepUp: async () => {
    if (DEV_MODE) return window.confirm("Step-up: confirm your identity to reveal a sealed value?");
    return true; // OIDC step-up would happen here
  },
}));

export { ALL_ROLES };
