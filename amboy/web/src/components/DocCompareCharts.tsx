import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { DocMetric } from "../lib/types";

// Visual-only left panel for UPLOADED documents: grouped A-vs-B bars of figures
// the model found in BOTH de-identified docs. Labeled document-stated (not
// independently verified) — the deterministic engine only covers structured reports.
export function DocCompareCharts({ comparisonId }: { comparisonId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["compare_docs", comparisonId],
    queryFn: () => api.post<{ metrics: DocMetric[]; note: string }>(
      "/compare_docs", { comparison_id: comparisonId }),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-4 space-y-2">
      <div className="text-[12px] font-bold tracking-wide text-navy">DOCUMENT COMPARISON</div>
      <div className="flex items-center gap-3 text-[11px] text-slate">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: "#CADCFC" }} /> A</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: "#0E7C86" }} /> B</span>
        <span>· figures stated in the uploads — not independently verified</span>
      </div>

      {isLoading && <p className="text-slate text-[13px]">Extracting comparable figures from the documents…</p>}
      {error && <p className="text-red text-[13px]">Couldn’t extract figures — ask questions in the chat instead.</p>}
      {data && data.metrics.length === 0 && (
        <p className="text-slate text-[13px]">
          {data.note || "No directly comparable figures detected in both documents."} Ask questions in the chat — answers are grounded in the indexed text.
        </p>
      )}
      {data && data.metrics.length > 0 && <GroupedBars metrics={data.metrics} />}
    </div>
  );
}

function GroupedBars({ metrics }: { metrics: DocMetric[] }) {
  const H = 46, X0 = 175, SPAN = 290;
  return (
    <svg viewBox={`0 0 520 ${metrics.length * H + 12}`} className="w-full" role="img"
         aria-label="Document A versus B comparison bars">
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
