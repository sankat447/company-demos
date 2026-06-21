import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, uploadDocument } from "../lib/api";
import type { ComparisonStatus } from "../lib/types";
import { toast } from "../lib/toast";

const ACCEPT = ".pdf,.docx,.txt,.md,.json";

// S3 — new comparison. Upload two documents (PDF/DOCX/TXT/MD/JSON); each is
// de-identified + indexed, then the workspace chats across both. The seeded
// Amboy 2024/2025 reports (structured, with verified metrics) are one click.
export function NewComparison() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [summary, setSummary] = useState<ComparisonStatus | null>(null);

  async function indexUploads() {
    if (!fileA || !fileB) { toast("Choose both documents (A and B)"); return; }
    setBusy(true);
    const cid = `cmp-${Date.now().toString(36)}`;
    try {
      for (const [side, f] of [["A", fileA], ["B", fileB]] as const) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("comparison_id", cid);
        fd.append("side", side);
        fd.append("actor", "ui");
        await uploadDocument(fd);
      }
      const s = await api.get<ComparisonStatus>(`/comparisons/${cid}/status`);
      setSummary(s);
      toast("Both documents de-identified and indexed");
      setTimeout(() => nav(`/c/${cid}`), 700); // chat-only workspace (no verified metrics)
    } catch (e) {
      toast(`Indexing failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function ingestSeeded() {
    setBusy(true);
    try {
      for (const key of ["report_2024.json", "report_2025.json"])
        await api.post("/ingest", { bucket: "amboy-raw", raw_key: key, actor: "ui" });
      const s = await api.get<ComparisonStatus>("/comparisons/AMB-2024-2025/status");
      setSummary(s);
      toast("Seeded reports indexed");
    } catch { toast("Indexing failed — is the de-id gateway up?"); }
    finally { setBusy(false); }
  }

  const Drop = ({ label, file, set }: { label: string; file: File | null; set: (f: File) => void }) => (
    <label className="flex-1 cursor-pointer rounded-card border-2 border-dashed border-line bg-paper p-6 text-center hover:border-navy block">
      <div className="text-[14px] text-ink font-bold">{label}</div>
      <div className="text-[12px] text-slate mt-1">{file ? file.name : "PDF · DOCX · TXT · MD · JSON"}</div>
      <input type="file" accept={ACCEPT} className="hidden"
             onChange={(e) => e.target.files?.[0] && set(e.target.files[0])} />
    </label>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="font-display text-[28px] font-bold text-ink">New comparison</h1>
      <p className="text-[14px] text-slate">
        Drop two reports to compare. Each is de-identified in-cluster before indexing —
        NPI never reaches the model. PDF and DOCX are extracted to text first.
      </p>
      <div className="flex gap-3">
        <Drop label="Report A" file={fileA} set={setFileA} />
        <Drop label="Report B" file={fileB} set={setFileB} />
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={indexUploads} disabled={busy || !fileA || !fileB}
                className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
          {busy ? "De-identifying & indexing…" : "Index & open ▸"}
        </button>
        <button onClick={ingestSeeded} disabled={busy}
                className="rounded-full border border-line text-navy text-[13px] font-bold px-4 py-2 disabled:opacity-60">
          Use seeded Amboy reports (2024 + 2025)
        </button>
      </div>

      {summary && (
        <div className="rounded-card border border-[#a7f3d0] bg-[#ecfdf5] p-4 space-y-1">
          <div className="font-bold text-teal">De-identification summary</div>
          <div className="text-[13px] text-slate font-mono">
            {summary.entities_tokenized} NPI entities tokenized · {summary.npi_left_in_index} left in index
          </div>
          <div className="text-[13px] text-slate font-mono">
            {summary.chunks_indexed} de-id chunks indexed · ready to chat
          </div>
        </div>
      )}
    </div>
  );
}
