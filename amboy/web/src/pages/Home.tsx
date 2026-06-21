import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Comparison } from "../lib/types";

// S2 — workspace home: list comparisons + index status.
export function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["comparisons"],
    queryFn: () => api.get<{ comparisons: Comparison[] }>("/comparisons"),
  });

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
          <Link key={c.id} to={`/c/${c.id}?ya=${c.year_a}&yb=${c.year_b}`}
                className="block bg-surface border border-line rounded-card shadow-card p-4 hover:border-navy">
            <div className="font-bold text-ink">{c.label}</div>
            <div className="mt-1 text-[12px] font-mono">
              <span className={c.status === "indexed" ? "text-teal" : "text-gold"}>● {c.status}</span>
            </div>
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
