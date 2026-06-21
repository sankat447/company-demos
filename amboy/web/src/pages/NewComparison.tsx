import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, uploadDocument } from "../lib/api";
import type { ComparisonStatus } from "../lib/types";
import { toast } from "../lib/toast";

const ACCEPT = ".pdf,.docx,.txt,.md,.json";

// A real drag-and-drop target (module-level so its drag state survives re-renders).
function DropZone({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={`flex-1 cursor-pointer rounded-card border-2 border-dashed p-6 text-center block transition-colors
        ${over ? "border-navy bg-[#eef2fb]" : "border-line bg-paper hover:border-navy"}`}
    >
      <div className="text-[14px] text-ink font-bold">{label}</div>
      <div className="text-[12px] text-slate mt-1">
        {file ? file.name : "Drag a file here, or click to choose"}
      </div>
      <div className="text-[11px] text-slate mt-0.5">PDF · DOCX · TXT · MD · JSON</div>
      <input type="file" accept={ACCEPT} className="hidden"
             onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </label>
  );
}

// S3 — new comparison. Upload two documents; each is de-identified + indexed.
export function NewComparison() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [summary, setSummary] = useState<ComparisonStatus | null>(null);

  // Stop the browser from opening a file dropped outside the drop zones (it would
  // otherwise navigate away / open the file in a new tab).
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  async function indexUploads() {
    if (!fileA || !fileB) { toast("Choose both documents (A and B)"); return; }
    // The report name becomes the indexed comparison id (sanitized); falls back
    // to a generated id only if left blank.
    const cid = name.trim().replace(/[:%/]/g, "").slice(0, 60) || `cmp-${Date.now().toString(36)}`;
    setBusy(true);
    try {
      for (const [side, f] of [["A", fileA], ["B", fileB]] as const) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("comparison_id", cid);
        fd.append("side", side);
        fd.append("actor", "ui");
        await uploadDocument(fd);
      }
      const s = await api.get<ComparisonStatus>(`/comparisons/${encodeURIComponent(cid)}/status`);
      setSummary(s);
      toast("Both documents de-identified and indexed");
      setTimeout(() => nav(`/c/${encodeURIComponent(cid)}`), 700);
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

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="font-display text-[28px] font-bold text-ink">New comparison</h1>
      <p className="text-[14px] text-slate">
        Drop two reports to compare. Each is de-identified in-cluster before indexing —
        NPI never reaches the model. PDF and DOCX are extracted to text first.
      </p>
      <label className="block">
        <span className="text-[13px] text-ink font-bold">Report name</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="e.g. Q2 Portfolio Review"
               className="mt-1 w-full rounded-card border border-line bg-paper px-3 py-2 text-[14px]" />
        <span className="text-[11px] text-slate">This name is used to index the comparison.</span>
      </label>
      <div className="flex gap-3">
        <DropZone label="Report A" file={fileA} onPick={setFileA} />
        <DropZone label="Report B" file={fileB} onPick={setFileB} />
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
