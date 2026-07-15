import type { CompareResult, Flag } from "../lib/types";

// Visual-only projection for the left panel: a diverging "movers" bar chart of
// every verified metric's % change (teal = improved, red = worsened), sorted by
// magnitude, with bars the latest answer mentioned highlighted in gold.
const LABEL: Record<string, string> = {
  npa_ratio_pct: "NPA ratio",
  net_charge_off_rate_pct: "Net charge-off rate",
  tier1_capital_ratio_pct: "Tier-1 capital ratio",
  loan_loss_reserve_usd: "Loan-loss reserve",
  net_income_usd: "Net income",
  total_deposits_usd: "Total deposits",
  total_assets_usd: "Total assets",
  total_loans_usd: "Total loans",
  num_loans: "Number of loans",
};
// Metrics where a DECREASE is the favorable direction.
const LOWER_IS_BETTER = new Set(["npa_ratio_pct", "net_charge_off_rate_pct"]);

function improved(metric: string, pct: number) {
  return LOWER_IS_BETTER.has(metric) ? pct < 0 : pct > 0;
}

export function InsightCharts({ compare, flags, highlight }: {
  compare?: CompareResult; flags?: { flags: Flag[] }; highlight?: string;
}) {
  if (!compare) {
    return <div className="bg-surface border border-line rounded-card shadow-card p-6 text-[14px] text-slate">
      Loading the verified comparison to visualize…
    </div>;
  }
  const rows = [...compare.comparison]
    .filter((r) => r.pct_change != null)
    .sort((a, b) => Math.abs(b.pct_change!) - Math.abs(a.pct_change!));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pct_change!)), 1);

  const H = 30, W = 520, mid = 250, span = 210;
  const hl = (label: string) => highlight && highlight.toLowerCase().includes(label.toLowerCase());

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-line rounded-card shadow-card p-4">
        <div className="text-[12px] font-bold tracking-wide text-navy">MOVERS · % change {compare.years[0]} → {compare.years[1]}</div>
        <div className="text-[11px] text-slate mb-2">teal = improved · red = worsened · gold ring = referenced in the latest answer</div>
        <svg viewBox={`0 0 ${W} ${rows.length * H + 16}`} className="w-full" role="img"
             aria-label="Diverging bar chart of percentage change by metric">
          <line x1={mid} y1="6" x2={mid} y2={rows.length * H + 6} stroke="#cbd5e1" />
          {rows.map((r, i) => {
            const label = LABEL[r.metric] || r.metric;
            const pct = r.pct_change!;
            const good = improved(r.metric, pct);
            const len = (Math.abs(pct) / maxAbs) * span;
            const y = i * H + 10;
            const color = pct === 0 ? "#5A6B86" : good ? "#0E7C86" : "#C0392B";
            // favorable bars point right, adverse point left (reads as good/bad)
            const x = good ? mid : mid - len;
            const w = pct === 0 ? 2 : len;
            return (
              <g key={r.metric}>
                <text x={mid - span - 6} y={y + 13} fontSize="11" fill="#14193D" textAnchor="start">{label}</text>
                <rect x={x} y={y} width={w} height={18} rx="3" fill={color}
                      stroke={hl(label) ? "#C8A24B" : "none"} strokeWidth={hl(label) ? 2.5 : 0} />
                <text x={good ? x + w + 5 : x - 5} y={y + 13} fontSize="11"
                      fontFamily="ui-monospace, monospace" fontWeight="700"
                      fill={color} textAnchor={good ? "start" : "end"}>
                  {pct > 0 ? "+" : ""}{pct}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {flags && (
        <div className="bg-surface border border-line rounded-card shadow-card p-4">
          <div className="text-[12px] font-bold tracking-wide text-navy mb-2">RISK FLAGS</div>
          <FlagBars flags={flags.flags} />
        </div>
      )}
    </div>
  );
}

function FlagBars({ flags }: { flags: Flag[] }) {
  if (!flags.length) return <div className="text-[13px] text-teal">No policy thresholds breached.</div>;
  const sev: Record<string, string> = { high: "#C0392B", medium: "#C8A24B", low: "#0E7C86" };
  return (
    <div className="space-y-2">
      {flags.map((f) => {
        const ratio = Math.min(f.value / (f.threshold * 1.6), 1);
        return (
          <div key={f.code + f.metric}>
            <div className="flex justify-between text-[12px]">
              <span className="text-slate">{f.message}</span>
              <span className="font-mono text-ink">{f.value} / {f.threshold}</span>
            </div>
            <div className="h-2 rounded-full bg-paper border border-line overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: sev[f.severity] || "#5A6B86" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
