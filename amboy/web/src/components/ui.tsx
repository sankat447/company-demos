import type { Citation, Flag } from "../lib/types";

export function DraftBadge() {
  return (
    <span className="inline-block rounded-full bg-red/10 text-red text-[11px] font-bold px-2 py-0.5">
      DRAFT — requires human sign-off
    </span>
  );
}

export function CitationPill({ c }: { c: Citation }) {
  return (
    <span className="inline-flex items-center font-mono text-[11px] text-[#0369a1] bg-[#eff6ff] border border-[#bae6fd] rounded-full px-2 py-0.5"
          title={c.id}>
      {c.source}
    </span>
  );
}

export function NoSourceWarning() {
  return (
    <div className="text-[12px] text-red bg-red/10 rounded px-2 py-1">
      No source cited — treat with caution.
    </div>
  );
}

const sevColor: Record<string, string> = { high: "#C0392B", medium: "#C8A24B", low: "#0E7C86" };

export function RiskFlags({ flags }: { flags: Flag[] }) {
  if (!flags.length)
    return <div className="text-[13px] text-teal">No policy thresholds breached.</div>;
  return (
    <ul className="space-y-2">
      {flags.map((f) => (
        <li key={f.code + f.metric} className="flex items-start gap-2 text-[13px]">
          <span aria-hidden className="mt-1.5 h-2 w-2 rounded-full"
                style={{ background: sevColor[f.severity] || "#5A6B86" }} />
          <span className="text-slate">
            {f.message} <span className="font-mono text-ink">({f.value} vs {f.threshold})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function KpiTile({ label, value, delta, dir }: {
  label: string; value: string; delta: string; dir: "up" | "down" | "flat";
}) {
  const good = dir === "down"; // for risk metrics, down is improvement (teal)
  return (
    <div className="bg-paper border border-line rounded-card shadow-card p-3">
      <div className="text-[12px] text-slate">{label}</div>
      <div className="font-mono text-[21px] font-bold text-navy mt-1">{value}</div>
      <div className="font-mono text-[12px] font-bold mt-1" style={{ color: good ? "#0E7C86" : dir === "up" ? "#0E7C86" : "#5A6B86" }}>
        {dir === "down" ? "▼" : dir === "up" ? "▲" : "—"} {delta}
      </div>
    </div>
  );
}
