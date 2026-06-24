// Model Training / MLOps console — a SEPARATE function at its own route
// (/model-training), intentionally NOT part of the Intake » Compare » Analyze
// workflow stage bar. The live training pipeline is wired in a later step.
const PHASES = [
  { n: 1, t: "Stop", d: "Take the current PII model offline (scale the KServe predictor to 0)." },
  { n: 2, t: "Decompose", d: "Build the training set — org documents → token-level BIO labels from accepted PII spans, then tokenize." },
  { n: 3, t: "Train", d: "Fine-tune the PII model on the custom NPI data (CPU)." },
  { n: 4, t: "Compose", d: "Package the fine-tuned model (weights + tokenizer + config) → MinIO as model vN." },
  { n: 5, t: "Provision", d: "Re-create the KServe InferenceService on OpenShift AI pointing at vN — back online." },
];

export function ModelTraining() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink">Model Training · MLOps console</h1>
        <p className="text-[14px] text-slate mt-1">
          Retrain the PII/NPI detection model on the organization's own data and re-provision it on
          OpenShift AI — a separate console from the document workflow.
        </p>
      </div>

      <div className="rounded-card border border-[#e8d9a8] bg-[#fdf6e3] px-3 py-2 text-[12.5px] text-[#8a6d1f]">
        Console route established (<span className="font-mono">/model-training</span>). The live training
        pipeline is configured next — the phases below will run here with live status.
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {PHASES.map((p) => (
          <div key={p.n} className="bg-surface border border-line rounded-card shadow-card p-3">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center h-6 w-6 rounded-full bg-navy text-white text-[12px] font-bold">{p.n}</span>
              <span className="font-bold text-ink text-[14px]">{p.t}</span>
            </div>
            <p className="text-[12px] text-slate mt-2 leading-snug">{p.d}</p>
          </div>
        ))}
      </div>

      <button disabled
        className="rounded-full bg-navy text-white text-[13px] font-bold px-5 py-2 opacity-50 cursor-not-allowed"
        title="Training pipeline configuration pending">
        Start training (configuration pending)
      </button>
    </div>
  );
}
