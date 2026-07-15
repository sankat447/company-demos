import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { DocCompare, DocFlag, DocMetric } from "../lib/types";

// Structured dashboard for UPLOADED documents — same layout as the seeded
// comparison (KPI tiles + movers chart + A/B bars + observations) but driven by
// figures the model EXTRACTED from the de-identified text. Labeled "extracted ·
// review before use" (amber) to keep it distinct from the deterministic
// "verified · computed in code" path. Deltas are computed in code.
const fmtVal = (v: number, unit?: string) => {
  const u = unit || "";
  if (u === "$M" || u === "$B" || u === "$") return `${u.startsWith("$") ? "$" : ""}${v}${u.replace("$", "")}`;
  return `${v}${u}`;
};
const deltaPct = (a: number, b: number) => (a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 1000) / 10);

export function DocCompareCharts({ comparisonId }: { comparisonId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["compare_docs", comparisonId],
    queryFn: () => api.post<DocCompare>("/compare_docs", { comparison_id: comparisonId }),
    staleTime: 5 * 60 * 1000,
  });

  const metrics = data?.metrics ?? [];
  const flags = data?.flags ?? [];

  return (
    <div className="space-y-3">
      {/* Provenance banner — NOT the verified path */}
      <div className="rounded-card bg-[#fdf6e3] border border-[#e8d9a8] px-3 py-2 text-[12px] text-[#8a6d1f]">
        <span className="font-bold">EXTRACTED FROM DOCUMENTS · review before use</span> — figures read
        from the uploaded text by the model (not the deterministic engine); deltas computed in code.
      </div>

      {isLoading && <div className="bg-surface border border-line rounded-card shadow-card p-6 text-[14px] text-slate">Extracting a structured comparison from the documents…</div>}
      {error && <div className="bg-surface border border-line rounded-card shadow-card p-6 text-[14px] text-red">Couldn’t extract a structure — ask questions in the chat instead.</div>}

      {data && metrics.length === 0 && (
        <div className="bg-surface border border-line rounded-card shadow-card p-6 text-[14px] text-slate">
          {data.note || "No directly comparable figures detected in both documents."} Ask questions in the chat — answers are grounded in the indexed text.
        </div>
      )}

      {metrics.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {metrics.slice(0, 4).map((m) => <ExtractedTile key={m.label} m={m} />)}
          </div>
          <div className="bg-surface border border-line rounded-card shadow-card p-4">
            <div className="text-[13px] font-bold text-ink mb-1">Movers · change A → B</div>
            <Movers metrics={metrics} />
          </div>
          <div className="bg-surface border border-line rounded-card shadow-card p-4">
            <div className="flex items-center gap-3 text-[11px] text-slate mb-2">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: "#CADCFC" }} /> A</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: "#0E7C86" }} /> B</span>
            </div>
            <GroupedBars metrics={metrics} />
          </div>
        </>
      )}

      {flags.length > 0 && (
        <div className="bg-surface border border-line rounded-card shadow-card p-4">
          <div className="text-[13px] font-bold text-ink mb-2">Observations stated in the documents</div>
          <Observations flags={flags} />
        </div>
      )}
    </div>
  );
}

function ExtractedTile({ m }: { m: DocMetric }) {
  const d = deltaPct(m.a, m.b);
  const arrow = d == null ? "—" : d > 0 ? "▲" : d < 0 ? "▼" : "—";
  const color = d == null || d === 0 ? "#5A6B86" : d > 0 ? "#0E7C86" : "#C0392B";
  return (
    <div className="bg-paper border border-line rounded-card shadow-card p-3">
      <div className="text-[12px] text-slate truncate" title={m.label}>{m.label}</div>
      <div className="font-mono text-[18px] font-bold text-navy mt-1">{fmtVal(m.b, m.unit)}</div>
      <div className="font-mono text-[12px] mt-0.5" style={{ color }}>
        {arrow} {d == null ? "n/a" : `${d > 0 ? "+" : ""}${d}%`} <span className="text-slate">vs {fmtVal(m.a, m.unit)}</span>
      </div>
    </div>
  );
}

function Movers({ metrics }: { metrics: DocMetric[] }) {
  const rows = metrics
    .map((m) => ({ label: m.label, d: deltaPct(m.a, m.b) }))
    .filter((r): r is { label: string; d: number } => r.d != null)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (!rows.length) return <p className="text-slate text-[13px]">No percentage changes to chart.</p>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.d)), 1);
  const W = 520, mid = 250, span = 210, H = 28;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * H + 12}`} className="w-full" role="img" aria-label="Percentage change by metric">
      <line x1={mid} y1="4" x2={mid} y2={rows.length * H + 4} stroke="#cbd5e1" />
      {rows.map((r, i) => {
        const y = i * H + 8, len = (Math.abs(r.d) / maxAbs) * span;
        const up = r.d > 0, color = up ? "#0E7C86" : "#C0392B";
        const x = up ? mid : mid - len;
        return (
          <g key={r.label + i}>
            <text x={mid - span - 6} y={y + 13} fontSize="11" fill="#14193D" textAnchor="start">{r.label.slice(0, 24)}</text>
            <rect x={x} y={y} width={len} height={16} rx="3" fill={color} />
            <text x={up ? x + len + 5 : x - 5} y={y + 13} fontSize="11" fontFamily="ui-monospace, monospace" fontWeight="700" fill={color} textAnchor={up ? "start" : "end"}>
              {r.d > 0 ? "+" : ""}{r.d}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GroupedBars({ metrics }: { metrics: DocMetric[] }) {
  const H = 46, X0 = 175, SPAN = 290;
  return (
    <svg viewBox={`0 0 520 ${metrics.length * H + 12}`} className="w-full" role="img" aria-label="Document A versus B bars">
      {metrics.map((m, i) => {
        const y = i * H + 8;
        const max = Math.max(Math.abs(m.a), Math.abs(m.b), 1);
        const wa = (Math.abs(m.a) / max) * SPAN, wb = (Math.abs(m.b) / max) * SPAN;
        const u = m.unit || "";
        return (
          <g key={m.label + i}>
            <text x={10} y={y + 16} fontSize="11" fill="#14193D">{m.label.slice(0, 26)}</text>
            <rect x={X0} y={y} width={wa} height={14} rx="3" fill="#CADCFC" />
            <text x={X0 + wa + 5} y={y + 11} fontSize="10" fontFamily="ui-monospace, monospace" fill="#1E2761">{m.a}{u}</text>
            <rect x={X0} y={y + 18} width={wb} height={14} rx="3" fill="#0E7C86" />
            <text x={X0 + wb + 5} y={y + 29} fontSize="10" fontFamily="ui-monospace, monospace" fill="#0E7C86">{m.b}{u}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Observations({ flags }: { flags: DocFlag[] }) {
  const sev: Record<string, string> = { high: "#C0392B", medium: "#C8A24B", low: "#0E7C86" };
  return (
    <ul className="space-y-2">
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          <span aria-hidden className="mt-1.5 h-2 w-2 rounded-full" style={{ background: sev[f.severity || "low"] || "#5A6B86" }} />
          <span className="text-slate">{f.text}{f.cite && <span className="font-mono text-[11px] text-[#0369a1]"> [{f.cite}]</span>}</span>
        </li>
      ))}
    </ul>
  );
}
