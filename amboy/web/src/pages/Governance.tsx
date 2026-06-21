import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface AuditRow {
  ts: string; actor: string; action: string; resource: string | null;
  outcome: string; detail: Record<string, unknown>;
}

// S6 — governance / audit (read-only). Append-only trail; no NPI in detail.
export function Governance() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<{ rows: AuditRow[] }>("/audit?limit=100"),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[28px] font-bold text-ink">Governance &amp; audit</h1>
      <p className="text-[13px] text-slate">
        Append-only trail of ingest, chat, reveal and sign-off. Detail fields contain
        tokens only — never NPI. Grafana reads this same table.
      </p>
      {isLoading && <p className="text-slate text-[14px]">Loading audit trail…</p>}
      {error && <p className="text-red text-[14px]">Couldn’t load the audit trail — retry shortly.</p>}
      <div className="overflow-x-auto bg-surface border border-line rounded-card shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-paper text-slate">
            <tr>
              <th className="text-left px-3 py-2 font-mono">ts</th>
              <th className="text-left px-3 py-2">actor</th>
              <th className="text-left px-3 py-2">action</th>
              <th className="text-left px-3 py-2">resource</th>
              <th className="text-left px-3 py-2">outcome</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-slate">{r.ts?.replace("T", " ").slice(0, 19)}</td>
                <td className="px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2 font-mono">{r.action}</td>
                <td className="px-3 py-2 font-mono text-slate">{r.resource}</td>
                <td className="px-3 py-2">{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
