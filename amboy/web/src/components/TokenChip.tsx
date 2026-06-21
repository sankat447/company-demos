import { useEffect, useRef, useState } from "react";
import { detokenize } from "../lib/api";
import { toast } from "../lib/toast";
import { useAuth } from "../store/auth";

// SIGNATURE ELEMENT — the sealed token chip. Sealed (red, lock) by default;
// a gated reveal "unseals" it to show the real value briefly, watermarked. The
// revealed value lives only in local state, clears on blur/navigation, and is
// never cached or logged (NPI-safe invariant 1; TC-32..36).
export function TokenChip({ token }: { token: string }) {
  const { hasRole, stepUp } = useAuth();
  const [value, setValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function start() {
    if (!hasRole("npi-reveal")) { toast("Requires the npi-reveal role"); return; }
    setReason(""); setOpen(true);
  }

  async function confirm() {
    if (!reason.trim()) { toast("A reason is required"); return; }
    setBusy(true);
    try {
      const ok = await stepUp();
      if (!ok) { setBusy(false); return; }
      const v = await detokenize(token, reason.trim());
      setValue(v ?? "(no value on file)");
      setOpen(false);
      toast("Revealed & logged");
      timer.current = window.setTimeout(() => setValue(null), 12000); // short-lived
    } catch (e) {
      toast((e as Error).message === "403" ? "Reveal denied (role required)" : "Reveal failed");
    } finally { setBusy(false); }
  }

  if (value) {
    return (
      <span
        tabIndex={0}
        onBlur={() => setValue(null)}
        className="relative inline-flex items-center font-mono text-[13px] text-ink bg-paper px-1.5 py-0.5 rounded animate-unseal"
        aria-label={`Revealed value, watermarked and short-lived`}
      >
        {value}
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-bold text-red/30 -rotate-12 select-none">
          REVEALED · AUDITED
        </span>
      </span>
    );
  }

  return (
    <>
      <button
        onClick={start}
        className="inline-flex items-center gap-1 font-mono text-[12px] text-red bg-red/10 hover:bg-red/15 px-1.5 py-0.5 rounded"
        aria-label={`Sealed value ${token}. Activate to reveal — gated, requires the reveal role and a reason.`}
      >
        <span aria-hidden>⬡</span>
        {token}
        <span aria-hidden>🔒</span>
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Reveal loan detail"
             className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
             onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="w-full max-w-md bg-surface rounded-card shadow-card border border-line">
            <div className="bg-[#7c3aed] text-white px-4 py-3 rounded-t-card font-display text-[18px] font-bold">
              Reveal loan detail — gated
            </div>
            <div className="p-4 space-y-3 text-[14px]">
              <p className="text-slate">
                Revealing <span className="font-mono text-ink">{token}</span> requires the{" "}
                <span className="font-mono">npi-reveal</span> role and a step-up.
              </p>
              <div className="rounded-card bg-[#f5f3ff] border border-[#ddd6fe] p-3">
                <div className="font-bold text-[#7c3aed]">Step-up authentication</div>
                <div className="text-slate text-[12px]">Confirm identity to decrypt this value just-in-time.</div>
              </div>
              <label className="block">
                <span className="text-ink">Reason for access (required, audited)</span>
                <textarea
                  autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. workout review of delinquent CRE loan"
                  className="mt-1 w-full rounded-card border border-line bg-paper p-2 text-[14px]"
                  rows={2}
                />
              </label>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setOpen(false)}
                        className="px-3 py-1.5 rounded-full border border-line text-slate text-[13px]">
                  Cancel
                </button>
                <button onClick={confirm} disabled={busy}
                        className="px-3 py-1.5 rounded-full bg-[#7c3aed] text-white text-[13px] font-bold disabled:opacity-60">
                  {busy ? "Revealing…" : "Reveal & log"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
