import { Link, useLocation, useNavigate } from "react-router-dom";
import { Fragment, type ReactNode } from "react";
import { useAuth } from "../store/auth";
import { useToasts } from "../lib/toast";
import { Logo, IISAttribution } from "./Logo";

// Workflow stage bar — the three functions as a pipeline; active stage highlighted.
const STAGES = [
  { to: "/upload", n: 1, label: "Sensitive Document Intake", match: (p: string) => p.startsWith("/upload") },
  { to: "/new", n: 2, label: "Compare and Vectorize Documents", match: (p: string) => p.startsWith("/new") },
  { to: "/", n: 3, label: "AI Insights from Documents", match: (p: string) => p === "/" || p.startsWith("/c/") },
];

function StageBar() {
  const { pathname } = useLocation();
  return (
    <div className="bg-surface border-b border-line">
      <div className="mx-auto max-w-[1280px] px-4 py-3 flex items-center justify-center gap-2 flex-wrap">
        {STAGES.map((s, i) => {
          const active = s.match(pathname);
          return (
            <Fragment key={s.to}>
              {i > 0 && <span className="text-gold font-bold text-[18px] leading-none select-none" aria-hidden>»</span>}
              <Link to={s.to} aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold border transition
                  ${active ? "bg-navy text-white border-navy shadow-card"
                           : "bg-paper text-slate border-line hover:border-navy hover:text-navy"}`}>
                <span className={`grid place-items-center h-5 w-5 rounded-full text-[11px]
                  ${active ? "bg-gold text-navy" : "bg-white border border-line text-slate"}`}>{s.n}</span>
                {s.label}
              </Link>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Toaster() {
  const { toasts } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="bg-ink text-white text-[13px] rounded-card shadow-card px-3 py-2">
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { username, roles, hasRole, signOut } = useAuth();
  const nav = useNavigate();
  const canAudit = hasRole("npi-audit") || hasRole("npi-compliance") || hasRole("npi-admin");
  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-[1280px] px-4 h-14 flex items-center gap-4">
          <Link to="/" aria-label="Amboy Bank home"><Logo variant="dark" size={30} /></Link>
          <span className="hidden md:inline text-[12px] text-white/60 border-l border-white/20 pl-4">
            NPI-Safe Report Comparison
          </span>
          <nav className="ml-auto flex items-center gap-4 text-[13px]">
            <Link to="/model-training" className="hover:text-gold">Model Training</Link>
            {canAudit && <Link to="/governance" className="hover:text-gold">Governance</Link>}
            <span className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-white/70">
              {roles.map((r) => <span key={r} className="bg-white/10 rounded px-1.5 py-0.5">{r}</span>)}
            </span>
            <span className="text-white/80">{username}</span>
            <button onClick={() => { signOut(); nav("/signin"); }}
                    className="rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-1">Sign out</button>
          </nav>
        </div>
      </header>
      <StageBar />
      <main className="mx-auto max-w-[1280px] px-4 py-6 flex-1 w-full">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-slate">Amboy Bank · NPI-safe analytics</span>
          <IISAttribution />
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
