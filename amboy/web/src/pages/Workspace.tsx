import { useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChatMeta, CompareResult, Flag } from "../lib/types";
import { streamChat } from "../hooks/useChatStream";
import { ChatMessage } from "../components/ChatMessage";
import { KpiTile, RiskFlags } from "../components/ui";

interface Msg { role: "user" | "assistant"; text: string; meta?: ChatMeta; }
const SUGGESTED = ["What changed in NPAs?", "Top movers", "Is concentration a worry?"];
const fmt = (v: number, unit: string | null) =>
  unit === "USD" ? `$${(v / 1e6).toFixed(1)}M` : unit === "pct" ? `${v}%` : `${v}`;

// S4 — the hero. LEFT verified comparison; RIGHT grounded chat.
export function Workspace() {
  const { id = "AMB-2024-2025" } = useParams();
  const [sp] = useSearchParams();
  const yearA = Number(sp.get("ya") || 2024);
  const yearB = Number(sp.get("yb") || 2025);
  const ridA = `AMB-FY${yearA}`, ridB = `AMB-FY${yearB}`;

  const compare = useQuery({
    queryKey: ["compare", id],
    queryFn: () => api.post<CompareResult>("/compare",
      { report_id_a: ridA, report_id_b: ridB, year_a: yearA, year_b: yearB }),
  });
  const flags = useQuery({
    queryKey: ["flags", id],
    queryFn: () => api.post<{ flags: Flag[] }>("/flag_policy", { report_id: ridB }),
  });

  const kpis = useMemo(() => {
    const rows = compare.data?.comparison || [];
    const want = ["npa_ratio_pct", "net_charge_off_rate_pct", "tier1_capital_ratio_pct", "total_loans_usd"];
    const label: Record<string, string> = {
      npa_ratio_pct: "NPA ratio", net_charge_off_rate_pct: "Net charge-offs",
      tier1_capital_ratio_pct: "Tier-1 capital", total_loans_usd: "Total loans",
    };
    return want.map((m) => {
      const r = rows.find((x) => x.metric === m);
      if (!r) return null;
      return {
        label: label[m],
        value: fmt(r[`y${yearB}`] as number, r.unit),
        delta: `${r.pct_change ?? 0}% YoY`,
        dir: r.direction,
      };
    }).filter(Boolean) as { label: string; value: string; delta: string; dir: "up" | "down" | "flat" }[];
  }, [compare.data, yearB]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* LEFT — verified comparison */}
      <section aria-label="Verified comparison">
        <h2 className="text-[12px] font-bold tracking-wide text-navy mb-2">
          VERIFIED COMPARISON · computed in code
        </h2>
        {compare.isLoading && <p className="text-slate text-[14px]">Loading verified figures…</p>}
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
        </div>
        <div className="mt-4 bg-surface border border-line rounded-card shadow-card p-4">
          <div className="text-[13px] font-bold text-ink mb-2">Year-over-year</div>
          <YoY rows={compare.data?.comparison || []} ya={yearA} yb={yearB} />
        </div>
        <div className="mt-4 bg-surface border border-line rounded-card shadow-card p-4">
          <div className="text-[13px] font-bold text-ink mb-2">Risk flags</div>
          <RiskFlags flags={flags.data?.flags || []} />
        </div>
      </section>

      {/* RIGHT — chat */}
      <Chat id={id} yearA={yearA} yearB={yearB} />
    </div>
  );
}

function YoY({ rows, ya, yb }: { rows: CompareResult["comparison"]; ya: number; yb: number }) {
  const metrics = ["npa_ratio_pct", "net_charge_off_rate_pct"];
  const data = metrics.map((m) => rows.find((r) => r.metric === m)).filter(Boolean) as CompareResult["comparison"];
  if (!data.length) return <p className="text-slate text-[13px]">No chartable metrics yet.</p>;
  const max = Math.max(...data.flatMap((r) => [r[`y${ya}`] as number, r[`y${yb}`] as number]), 1);
  return (
    <svg viewBox="0 0 320 120" className="w-full" role="img" aria-label="Year over year bars">
      {data.map((r, i) => {
        const x = 20 + i * 150;
        const va = r[`y${ya}`] as number, vb = r[`y${yb}`] as number;
        const ha = (va / max) * 80, hb = (vb / max) * 80;
        return (
          <g key={r.metric}>
            <rect x={x} y={100 - ha} width="34" height={ha} fill="#CADCFC" />
            <rect x={x + 40} y={100 - hb} width="34" height={hb} fill="#0E7C86" />
            <text x={x + 37} y={114} textAnchor="middle" fontSize="8" fill="#5A6B86">
              {r.metric.replace(/_pct|_usd/, "")}
            </text>
          </g>
        );
      })}
      <line x1="10" y1="100" x2="310" y2="100" stroke="#cbd5e1" />
    </svg>
  );
}

function Chat({ id, yearA, yearB }: { id: string; yearA: number; yearB: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      for await (const ev of streamChat({ comparison_id: id, year_a: yearA, year_b: yearB, message: text, history })) {
        if (ev.type === "delta")
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + ev.t }; return c; });
        if (ev.type === "meta")
          setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], meta: ev.meta }; return c; });
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: "The chat stream dropped — please ask again." }; return c; });
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Chat" className="flex flex-col bg-surface border border-line rounded-card shadow-card min-h-[560px]">
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[12px] font-bold tracking-wide text-navy">CHAT · ask about these reports</div>
        <div className="text-[11px] text-slate">grounded in indexed, de-identified data + verified numbers</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy}
                    className="rounded-full bg-[#eef2fb] border border-[#c7d2fe] text-navy text-[12px] px-2.5 py-1 disabled:opacity-60">
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {msgs.length === 0 && (
          <p className="text-slate text-[14px]">Ask how the two reports differ — try a suggested question.</p>
        )}
        {msgs.map((m, i) => <ChatMessage key={i} role={m.role} text={m.text} meta={m.meta} />)}
        <div ref={endRef} />
      </div>
      <form className="p-3 border-t border-line flex gap-2"
            onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
               placeholder="Ask a comparison question…" aria-label="Ask a comparison question"
               className="flex-1 rounded-full border border-line bg-paper px-4 py-2 text-[14px]" />
        <button type="submit" disabled={busy || !input.trim()}
                aria-label="Send"
                className="h-9 w-9 grid place-items-center rounded-full bg-gold text-navy font-bold disabled:opacity-50">↑</button>
      </form>
    </section>
  );
}
