import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ALL_ROLES, DEV_MODE, useAuth } from "../store/auth";
import type { Role } from "../lib/types";
import { Logo, IISAttribution } from "../components/Logo";

// S1 — sign in. DEV_MODE shows a role picker (maps to X-Amboy-Roles); with OIDC
// configured this would redirect to Keycloak.
export function SignIn() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [roles, setRoles] = useState<Role[]>(["npi-analyst", "npi-user"]);

  function toggle(r: Role) {
    setRoles((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]);
  }

  return (
    <div className="min-h-full grid place-items-center bg-paper p-4">
      <div className="w-full max-w-md bg-surface rounded-card shadow-card border border-line">
        <div className="bg-navy text-white px-5 py-5 rounded-t-card">
          <Logo variant="dark" size={36} />
          <div className="text-[12px] text-white/70 mt-2">NPI-Safe Report Comparison &amp; Chat</div>
        </div>
        <div className="p-5 space-y-4">
          {DEV_MODE ? (
            <>
              <p className="text-[13px] text-slate">
                Demo sign-in — choose the roles to act with. (Keycloak OIDC is wired but
                its realm isn’t provisioned on this cluster, so the app runs in dev mode.)
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-[13px] font-mono">
                    <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
                    {r}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-slate">Redirecting to Keycloak…</p>
          )}
          <button
            onClick={() => { signIn(roles); nav("/"); }}
            disabled={!roles.length}
            className="w-full rounded-full bg-gold text-navy font-bold py-2 disabled:opacity-50">
            Sign in
          </button>
          <div className="pt-1 text-center"><IISAttribution /></div>
        </div>
      </div>
    </div>
  );
}
