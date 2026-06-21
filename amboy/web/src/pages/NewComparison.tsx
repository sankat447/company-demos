import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { ComparisonStatus } from "../lib/types";
import { toast } from "../lib/toast";

// S3 — new comparison: ingest (de-identify + index) then show the summary.
// Reports are seeded in MinIO; uploading a JSON ingests it inline as well.
export function NewComparison() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ComparisonStatus | null>(null);

  async function ingestSeeded() {
    setBusy(true);
    try {
      for (const key of ["report_2024.json", "report_2025.json"]) {
        await api.post("/ingest", { bucket: "amboy-raw", raw_key: key, actor: "ui" });
      }
      const s = await api.get<ComparisonStatus>("/comparisons/AMB-2024-2025/status");
      setSummary(s);
      toast("Reports de-identified and indexed");
    } catch {
      toast("Indexing failed — is the de-id gateway up?");
    } finally { setBusy(false); }
  }

  async function ingestFile(file: File) {
    setBusy(true);
    try {
      const report = JSON.parse(await file.text());
      await api.post("/ingest", { report, actor: "ui" });
      const s = await api.get<ComparisonStatus>("/comparisons/AMB-2024-2025/status");
      setSummary(s);
      toast(`Indexed ${file.name}`);
    } catch {
      toast("Couldn’t read that file — expected a report JSON.");
    } finally { setBusy(false); }
  }

  const Drop = ({ label, year }: { label: string; year: number }) => (
    <label className="flex-1 cursor-pointer rounded-card border-2 border-dashed border-line bg-paper p-6 text-center hover:border-navy">
      <div className="text-[14px] text-ink">{label}</div>
      <div className="text-[12px] text-slate">{year} · .json (or use seeded)</div>
      <input type="file" accept="application/json" className="hidden"
             onChange={(e) => e.target.files?.[0] && ingestFile(e.target.files[0])} />
    </label>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="font-display text-[28px] font-bold text-ink">New comparison</h1>
      <div className="flex gap-3">
        <Drop label="Drop Report A" year={2024} />
        <Drop label="Drop Report B" year={2025} />
      </div>

      <button onClick={ingestSeeded} disabled={busy}
              className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-60">
        {busy ? "Indexing…" : "Use seeded reports (2024 + 2025)"}
      </button>

      {summary && (
        <div className="rounded-card border border-[#a7f3d0] bg-[#ecfdf5] p-4 space-y-1">
          <div className="font-bold text-teal">De-identification summary</div>
          <div className="text-[13px] text-slate font-mono">
            {summary.entities_tokenized} NPI entities tokenized · {summary.npi_left_in_index} left in index
          </div>
          <div className="text-[13px] text-slate font-mono">
            {summary.facts_extracted} verified facts · {summary.chunks_indexed} de-id chunks · ready to chat
          </div>
          <button onClick={() => nav("/c/AMB-2024-2025?ya=2024&yb=2025")}
                  className="mt-2 rounded-full bg-gold text-navy text-[13px] font-bold px-4 py-1.5">
            Open workspace ▸
          </button>
        </div>
      )}
    </div>
  );
}
