import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrainingStatus, listModelVersions, startTraining } from "../lib/api";
import { toast } from "../lib/toast";

// Model Training / MLOps console — separate route (/model-training), not in the
// workflow stage bar. Runs a real, CPU-bounded NPI-tagger fine-tune and visualizes
// every lifecycle stage with live progress.
export function ModelTraining() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["training-status"],
    queryFn: getTrainingStatus,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false),
  });
  const versions = useQuery({ queryKey: ["model-versions"], queryFn: listModelVersions });

  const running = data?.status === "running";
  const stages = data?.stages ?? [];
  const doneCount = stages.filter((s) => s.status === "done").length;
  const overall = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;

  async function start() {
    const r = await startTraining();
    if (!r.ok) { toast(r.reason || "A run is already in progress"); return; }
    toast("Training run started");
    setTimeout(() => { qc.invalidateQueries({ queryKey: ["training-status"] }); }, 200);
  }
  // refresh the versions table when a run completes
  if (data?.status === "complete") {
    qc.invalidateQueries({ queryKey: ["model-versions"] });
  }

  const dot = (st: string) =>
    st === "done" ? "#0E7C86" : st === "running" ? "#1E2761" : st === "failed" ? "#C0392B" : "#CBD5E1";

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-ink">Model Training · MLOps console</h1>
          <p className="text-[14px] text-slate mt-1">
            Retrain the NPI/PII detector on the organization's data and re-provision it on OpenShift AI.
            Trains a real NPI tagger (incl. an <span className="font-mono">ACCOUNT</span> class) on CPU.
          </p>
        </div>
        <button onClick={start} disabled={running}
          className="rounded-full bg-navy text-white text-[13px] font-bold px-5 py-2 disabled:opacity-50 whitespace-nowrap">
          {running ? "Training…" : "▸ Start training"}
        </button>
      </div>

      {/* overall progress */}
      <div className="bg-surface border border-line rounded-card shadow-card p-4">
        <div className="flex items-center justify-between text-[12px] mb-2">
          <span className="font-bold tracking-wide text-navy">PIPELINE PROGRESS</span>
          <span className="text-slate">
            {data?.status === "idle" ? "ready" : data?.status} · {doneCount}/{stages.length || 10} stages
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-paper border border-line overflow-hidden">
          <div className="h-full bg-teal transition-all duration-500" style={{ width: `${overall}%` }} />
        </div>
      </div>

      {/* stage stepper */}
      <div className="grid sm:grid-cols-2 gap-3">
        {(stages.length ? stages : DEFAULT_STAGES).map((s, i) => (
          <div key={s.key || i} className="bg-surface border border-line rounded-card shadow-card p-3">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center h-6 w-6 rounded-full text-white text-[12px] font-bold"
                    style={{ background: dot(s.status) }}>
                {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : i + 1}
              </span>
              <span className="font-bold text-ink text-[14px]">{s.title}</span>
              <span className="ml-auto text-[11px] font-mono uppercase" style={{ color: dot(s.status) }}>
                {s.status}
              </span>
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

      {/* metrics + version */}
      {(data?.metrics?.eval_accuracy != null || data?.version) && (
        <div className="flex flex-wrap gap-3">
          {data?.metrics?.eval_accuracy != null && (
            <div className="bg-surface border border-line rounded-card shadow-card p-3">
              <div className="text-[11px] text-slate">Held-out accuracy</div>
              <div className="font-mono text-[20px] font-bold text-teal">{Math.round(data.metrics.eval_accuracy * 100)}%</div>
            </div>
          )}
          {data?.version && (
            <div className="bg-surface border border-line rounded-card shadow-card p-3">
              <div className="text-[11px] text-slate">Registered version</div>
              <div className="font-mono text-[15px] font-bold text-navy">{data.version}</div>
            </div>
          )}
        </div>
      )}

      {/* live log */}
      {data?.log && data.log.length > 0 && (
        <div className="bg-ink rounded-card p-3">
          <div className="text-[11px] text-white/50 mb-1 font-mono">live log</div>
          <pre className="text-[11px] text-[#9fe8d8] font-mono whitespace-pre-wrap max-h-44 overflow-auto">
            {data.log.slice(-14).join("\n")}
          </pre>
        </div>
      )}

      {/* model registry */}
      <div>
        <h2 className="text-[12px] font-bold tracking-wide text-navy mb-2">MODEL REGISTRY</h2>
        <div className="overflow-x-auto bg-surface border border-line rounded-card">
          <table className="w-full text-[12px]">
            <thead className="bg-paper"><tr>
              <th className="text-left px-3 py-2">Version</th><th className="text-left px-3 py-2">Base</th>
              <th className="text-left px-3 py-2">Accuracy</th><th className="text-left px-3 py-2">Classes</th>
              <th className="text-left px-3 py-2">Created</th></tr></thead>
            <tbody>
              {versions.data?.versions.map((v) => (
                <tr key={v.version} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-navy">{v.version}</td>
                  <td className="px-3 py-2">{v.name}</td>
                  <td className="px-3 py-2 font-mono text-teal">{Math.round((v.accuracy || 0) * 100)}%</td>
                  <td className="px-3 py-2">{v.classes}</td>
                  <td className="px-3 py-2 text-slate">{v.created_at?.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
              {versions.data && versions.data.versions.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-3 text-slate">No model versions yet — run a training to register one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_STAGES = [
  { key: "stop", title: "Stop serving", desc: "Take the current PII model offline on OpenShift AI", status: "pending", pct: 0 },
  { key: "load", title: "Load base model", desc: "Load the base encoder + label space", status: "pending", pct: 0 },
  { key: "ingest", title: "Ingest NPI data", desc: "Gather the organization's NPI training corpus", status: "pending", pct: 0 },
  { key: "decompose", title: "Decompose (tokenize + label)", desc: "Tokenize and assign BIO labels per token", status: "pending", pct: 0 },
  { key: "train", title: "Train", desc: "Fine-tune the NPI tagger (gradient descent)", status: "pending", pct: 0 },
  { key: "evaluate", title: "Evaluate", desc: "Score precision/recall on a held-out split", status: "pending", pct: 0 },
  { key: "compress", title: "Compress (quantize)", desc: "Quantize + shrink the model for CPU serving", status: "pending", pct: 0 },
  { key: "register", title: "Register version", desc: "Push the model artifact to MinIO + registry", status: "pending", pct: 0 },
  { key: "provision", title: "Provision on OpenShift AI", desc: "Re-deploy the KServe InferenceService", status: "pending", pct: 0 },
  { key: "smoke", title: "Online smoke test", desc: "Verify the served model answers /detect", status: "pending", pct: 0 },
];
