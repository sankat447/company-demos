import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, purgeComparison } from "../lib/api";
import { toast } from "../lib/toast";
import type { Comparison } from "../lib/types";

// S2 — workspace home: list comparisons + index status; delete to free space.
export function Home() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["comparisons"],
    queryFn: () => api.get<{ comparisons: Comparison[] }>("/comparisons"),
  });

  async function remove(c: Comparison, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm(`Delete "${c.label}"? This removes its indexed chunks, facts, and stored files to free space. This cannot be undone.`))
      return;
    try {
      const r = await purgeComparison(c.id);
      toast(`Deleted "${c.label}" · ${r.chunks_deleted} chunks, ${r.objects_deleted} files freed`);
      qc.invalidateQueries({ queryKey: ["comparisons"] });
    } catch {
      toast("Delete failed — please retry.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-bold text-ink">Your comparisons</h1>
        <Link to="/new" className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2">
          + New comparison
        </Link>
      </div>

      {isLoading && <p className="text-slate text-[14px]">Loading comparisons…</p>}
      {error && (
        <p className="text-[14px] text-red">
          Couldn’t reach the comparison service. Check that the backend is running, then retry.
        </p>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.comparisons.map((c) => (
          <Link key={c.id} to={`/c/${encodeURIComponent(c.id)}?ya=${c.year_a}&yb=${c.year_b}`}
                className="relative block bg-surface border border-line rounded-card shadow-card p-4 hover:border-navy">
            <div className="font-bold text-ink pr-7">{c.label}</div>
            <div className="mt-1 text-[12px] font-mono">
              <span className={c.status === "indexed" ? "text-teal" : "text-gold"}>● {c.status}</span>
            </div>
            <button onClick={(e) => remove(c, e)} aria-label={`Delete ${c.label}`}
                    title="Delete & free space"
                    className="absolute top-3 right-3 h-7 w-7 grid place-items-center rounded-full text-slate hover:text-red hover:bg-red/10">
              🗑
            </button>
          </Link>
        ))}
        {data && data.comparisons.length === 0 && (
          <div className="text-slate text-[14px]">
            No comparisons yet — start one with “New comparison”.
          </div>
        )}
      </div>
    </div>
  );
}
