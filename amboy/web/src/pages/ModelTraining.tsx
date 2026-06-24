import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getServedModel, getTrainingStatus, listModelVersions, startTraining, switchModel, trainingCmd } from "../lib/api";
import type { TermLine, TrainingStatus } from "../lib/types";
import { toast } from "../lib/toast";

const BUSY = ["pretraining", "interactive", "finalizing"];

// Render a terminal line, colorizing [TYPE]…[/TYPE] entity tags.
function renderLine(t: string) {
  const parts: (string | { type: string; text: string })[] = [];
  const re = /\[([A-Z_]+)\]([\s\S]*?)\[\/\1\]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push(t.slice(last, m.index));
    parts.push({ type: m[1], text: m[2] });
    last = re.lastIndex;
  }
  if (last < t.length) parts.push(t.slice(last));
  return parts.map((p, i) =>
    typeof p === "string" ? <span key={i}>{p}</span> : (
      <span key={i} className="rounded px-1"
        style={{ background: p.type === "ACCOUNT" ? "rgba(45,212,191,.22)" : "rgba(96,165,250,.22)",
                 color: p.type === "ACCOUNT" ? "#5eead4" : "#bfdbfe" }}>
        {p.text}<sub className="opacity-60 ml-0.5">{p.type}</sub>
      </span>
    ));
}

// InstructLab-style interactive training terminal.
function Terminal({ data }: { data?: TrainingStatus }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const lines = data?.terminal ?? [];
  const active = data?.status === "interactive";

  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [lines.length]);

  async function send(cmd: string) {
    const c = cmd.trim();
    if (!c || busy || !active) return;
    setBusy(true); setInput(""); setHist((h) => [...h, c]); setHi(-1);
    try {
      const r = await trainingCmd(c);
      qc.setQueryData(["training-status"], r);          // instant echo of the returned terminal
      qc.invalidateQueries({ queryKey: ["training-status"] });
    } catch { toast("command failed"); } finally { setBusy(false); }
  }

  const colour: Record<TermLine["k"], string> = {
    in: "#5eead4", out: "#d7dee8", sys: "#93a4bd", ok: "#34d399", warn: "#fca5a5",
  };

  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-bold tracking-wide text-navy">TRAINING TERMINAL · InstructLab-style</div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: active ? "rgba(14,124,134,.12)" : "#eef1f6", color: active ? "#0E7C86" : "#64748b" }}>
          {data?.status === "interactive" ? "● live" : data?.status === "pretraining" ? "preparing…"
            : data?.status === "finalizing" ? "serving…" : data?.status ?? "idle"}
        </span>
      </div>

      <div ref={boxRef} className="bg-ink rounded-card p-3 h-72 overflow-auto font-mono text-[12px] leading-relaxed">
        {lines.length === 0 && (
          <div className="text-white/40">Click “Start training” to begin a session, then type commands here.</div>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ color: colour[l.k] }} className="whitespace-pre-wrap">
            {l.k === "in" ? <span className="text-teal">› {l.t}</span> : renderLine(l.t)}
          </div>
        ))}
        {busy && <div className="text-white/40">…</div>}
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-teal text-[13px]">›</span>
        <input
          value={input} disabled={!active || busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send(input);
            else if (e.key === "ArrowUp") { e.preventDefault(); const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1); setHi(n); setInput(hist[n] ?? ""); }
            else if (e.key === "ArrowDown") { e.preventDefault(); const n = hi < 0 ? -1 : Math.min(hist.length - 1, hi + 1); setHi(n); setInput(n < 0 ? "" : hist[n] ?? ""); }
          }}
          placeholder={active ? 'try:  probe   ·   train account   ·   done' : "start a session to enable the terminal"}
          className="flex-1 rounded-card border border-line bg-paper px-3 py-1.5 text-[12px] font-mono disabled:opacity-50" />
      </div>
      <div className="flex flex-wrap gap-2">
        {["probe", "train account", "done", "help"].map((c) => (
          <button key={c} onClick={() => send(c)} disabled={!active || busy}
            className="rounded-full border border-line text-navy text-[11px] font-mono px-2.5 py-1 disabled:opacity-40 hover:bg-paper">
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

// Model Training / MLOps console — separate route (/model-training).
export function ModelTraining() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["training-status"],
    queryFn: getTrainingStatus,
    refetchInterval: (q) => (BUSY.includes(q.state.data?.status ?? "") ? 1200 : false),
  });
  const versions = useQuery({ queryKey: ["model-versions"], queryFn: listModelVersions });
  const served = useQuery({
    queryKey: ["served-model"],
    queryFn: getServedModel,
    refetchInterval: () => (BUSY.includes(data?.status ?? "") ? 2500 : false),
  });

  const busy = BUSY.includes(data?.status ?? "");
  const stages = data?.stages ?? [];
  const doneCount = stages.filter((s) => s.status === "done").length;
  const overall = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;

  const [switching, setSwitching] = useState<string | null>(null);

  async function start() {
    const r = await startTraining();
    if (!r.ok) { toast(r.reason || "A session is already in progress"); return; }
    toast("Training session started");
    setTimeout(() => qc.invalidateQueries({ queryKey: ["training-status"] }), 200);
  }
  async function doSwitch(version: string) {
    setSwitching(version);
    try {
      const r = await switchModel(version);
      if (!r.ok) { toast(r.error || "switch failed"); return; }
      toast(`Switched serving to ${version}`);
      qc.invalidateQueries({ queryKey: ["served-model"] });
    } catch { toast("switch failed"); } finally { setSwitching(null); }
  }
  if (data?.status === "complete") {
    qc.invalidateQueries({ queryKey: ["model-versions"] });
    qc.invalidateQueries({ queryKey: ["served-model"] });
  }

  const dot = (st: string) =>
    st === "done" ? "#0E7C86" : st === "running" ? "#1E2761" : st === "failed" ? "#C0392B" : "#CBD5E1";

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-ink">Model Training · MLOps console</h1>
          <p className="text-[14px] text-slate mt-1">
            Teach the NPI/PII detector interactively (probe → train → probe), then re-provision it on
            OpenShift AI. Trains a real NPI tagger (incl. an <span className="font-mono">ACCOUNT</span> class) on CPU.
          </p>
        </div>
        <button onClick={start} disabled={busy}
          className="rounded-full bg-navy text-white text-[13px] font-bold px-5 py-2 disabled:opacity-50 whitespace-nowrap">
          {busy ? "Session active…" : "▸ Start training"}
        </button>
      </div>

      {/* currently-served model on OpenShift AI */}
      <div className="bg-surface border border-line rounded-card shadow-card p-3 flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="text-[11px] font-bold tracking-wide text-navy">CURRENTLY SERVED · OpenShift AI</span>
        <span className="text-[12px] text-slate">base <span className="font-mono text-navy">{served.data?.base_version ?? "…"}</span></span>
        <span className="text-[12px] text-slate">head{" "}
          <span className="font-mono" style={{ color: served.data?.head_version ? "#0E7C86" : "#C0392B" }}>
            {served.data?.ok ? served.data?.head_version ?? "none (base only)" : "unreachable"}
          </span>
        </span>
      </div>

      {/* two-pane: LEFT = pipeline stages · RIGHT = terminal + progress + metrics */}
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* LEFT — pipeline stages */}
        <div className="space-y-3">
          <div className="text-[12px] font-bold tracking-wide text-navy">PIPELINE STAGES</div>
          <div className="grid grid-cols-1 gap-3">
            {(stages.length ? stages : DEFAULT_STAGES).map((s, i) => (
              <div key={s.key || i} className="bg-surface border border-line rounded-card shadow-card p-3">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center h-6 w-6 rounded-full text-white text-[12px] font-bold" style={{ background: dot(s.status) }}>
                    {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : i + 1}
                  </span>
                  <span className="font-bold text-ink text-[14px]">{s.title}</span>
                  <span className="ml-auto text-[11px] font-mono uppercase" style={{ color: dot(s.status) }}>{s.status}</span>
                </div>
                <p className="text-[12px] text-slate mt-1.5 leading-snug">{s.desc}</p>
                {s.status === "running" && (
                  <div className="h-1.5 rounded-full bg-paper border border-line overflow-hidden mt-2">
                    <div className="h-full bg-navy transition-all duration-300" style={{ width: `${s.pct}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — terminal + pipeline progress + metrics */}
        <div className="space-y-5">
          <Terminal data={data} />

          <div className="bg-surface border border-line rounded-card shadow-card p-4">
            <div className="flex items-center justify-between text-[12px] mb-2">
              <span className="font-bold tracking-wide text-navy">PIPELINE PROGRESS</span>
              <span className="text-slate">{data?.status === "idle" ? "ready" : data?.status} · {doneCount}/{stages.length || 10} stages</span>
            </div>
            <div className="h-2.5 rounded-full bg-paper border border-line overflow-hidden">
              <div className="h-full bg-teal transition-all duration-500" style={{ width: `${overall}%` }} />
            </div>
          </div>

          {(data?.metrics?.eval_accuracy != null || data?.version) && (
            <div className="flex flex-wrap gap-3">
              {data?.metrics?.eval_accuracy != null && (
                <div className="flex-1 bg-surface border border-line rounded-card shadow-card p-3">
                  <div className="text-[11px] text-slate">Held-out accuracy</div>
                  <div className="font-mono text-[20px] font-bold text-teal">{Math.round(data.metrics.eval_accuracy * 100)}%</div>
                </div>
              )}
              {data?.version && (
                <div className="flex-1 bg-surface border border-line rounded-card shadow-card p-3">
                  <div className="text-[11px] text-slate">Registered version</div>
                  <div className="font-mono text-[15px] font-bold text-navy">{data.version}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* model registry */}
      <div>
        <h2 className="text-[12px] font-bold tracking-wide text-navy mb-2">MODEL REGISTRY</h2>
        <div className="overflow-x-auto bg-surface border border-line rounded-card">
          <table className="w-full text-[12px]">
            <thead className="bg-paper"><tr>
              <th className="text-left px-3 py-2">Version</th><th className="text-left px-3 py-2">Base</th>
              <th className="text-left px-3 py-2">Accuracy</th><th className="text-left px-3 py-2">Classes</th>
              <th className="text-left px-3 py-2">Created</th><th className="text-left px-3 py-2">Status</th></tr></thead>
            <tbody>
              {versions.data?.versions.map((v) => {
                const sd = served.data;
                const serving = !!sd?.ok && (v.version === sd.head_version || (!sd.head_version && v.version === sd.base_version));
                return (
                <tr key={v.version} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-navy">{v.version}</td>
                  <td className="px-3 py-2">{v.name}</td>
                  <td className="px-3 py-2 font-mono text-teal">{Math.round((v.accuracy || 0) * 100)}%</td>
                  <td className="px-3 py-2">{v.classes}</td>
                  <td className="px-3 py-2 text-slate">{v.created_at?.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2">
                    {serving ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-teal whitespace-nowrap">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal" /> Serving · KServe
                      </span>
                    ) : (
                      <button onClick={() => doSwitch(v.version)} disabled={busy || switching === v.version}
                        className="rounded-full border border-navy text-navy text-[11px] font-bold px-2.5 py-1 disabled:opacity-40 hover:bg-paper whitespace-nowrap">
                        {switching === v.version ? "switching…" : "Switch"}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
              {versions.data && versions.data.versions.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-3 text-slate">No model versions yet — run a training to register one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_STAGES = [
  { key: "init", title: "Initialize session", desc: "Spin up a training session (model stays online)", status: "pending", pct: 0 },
  { key: "load", title: "Load base model", desc: "Load the base encoder + label space", status: "pending", pct: 0 },
  { key: "ingest", title: "Ingest NPI data", desc: "Gather the organization's NPI training corpus", status: "pending", pct: 0 },
  { key: "decompose", title: "Decompose (tokenize + embed)", desc: "Tokenize and embed features per token", status: "pending", pct: 0 },
  { key: "interactive", title: "Interactive training", desc: "Teach from the terminal: probe → train → probe", status: "pending", pct: 0 },
  { key: "evaluate", title: "Evaluate", desc: "Score accuracy on a held-out split", status: "pending", pct: 0 },
  { key: "compress", title: "Compress (quantize)", desc: "Quantize + shrink the model for CPU serving", status: "pending", pct: 0 },
  { key: "register", title: "Register version", desc: "Push the model artifact to MinIO + registry", status: "pending", pct: 0 },
  { key: "provision", title: "Stop → Provision on OpenShift AI", desc: "Take offline, load new head, bring back online", status: "pending", pct: 0 },
  { key: "smoke", title: "Online smoke test", desc: "Verify the served model answers /detect", status: "pending", pct: 0 },
];
