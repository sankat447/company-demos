import { Fragment, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commitArtifact, detectDocument } from "../lib/api";
import { toast } from "../lib/toast";
import type { DetectResult, DetectSpan } from "../lib/types";
import { ArtifactExplorer } from "../components/ArtifactExplorer";

const ACCEPT = ".pdf,.docx,.txt,.md,.json";

function Highlighted({ text, spans, accepted }: { text: string; spans: DetectSpan[]; accepted: Set<string> }) {
  const out: JSX.Element[] = [];
  let cur = 0;
  [...spans].sort((a, b) => a.start - b.start).forEach((s, i) => {
    if (s.start < cur) return;
    out.push(<Fragment key={`t${i}`}>{text.slice(cur, s.start)}</Fragment>);
    out.push(
      <mark key={`m${i}`} title={`${s.type} · ${s.source} · ${s.score}`}
        className={accepted.has(s.id) ? "bg-red/10 text-red rounded px-0.5" : "line-through text-slate"}>
        {text.slice(s.start, s.end)}<sub className="text-[8px] ml-0.5">{s.type}</sub>
      </mark>);
    cur = s.end;
  });
  out.push(<Fragment key="tail">{text.slice(cur)}</Fragment>);
  return <pre className="whitespace-pre-wrap font-mono text-[11px] bg-paper border border-line rounded-card p-3 max-h-72 overflow-auto">{out}</pre>;
}

// Function 1 — Upload Artifact: detect PII with the model, accept/reject per
// entity, then store a de-identified (token-highlighted) artifact in S3.
export function UploadArtifact() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [det, setDet] = useState<DetectResult | null>(null);
  const [acc, setAcc] = useState<Set<string>>(new Set());

  useEffect(() => {
    const p = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", p); window.addEventListener("drop", p);
    return () => { window.removeEventListener("dragover", p); window.removeEventListener("drop", p); };
  }, []);

  function pick(f: File) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); }

  async function runDetect() {
    if (!file) return;
    setBusy(true);
    try {
      const d = await detectDocument(file);
      setDet(d); setAcc(new Set(d.spans.map((s) => s.id)));
    } catch (e) { toast(`Detection failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  function toggle(id: string) { setAcc((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function download() {
    const blob = new Blob([det!.highlighted_html], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${det!.filename}-PII-review.html`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function save() {
    if (!det) return;
    setBusy(true);
    try {
      const accepted = det.spans.filter((s) => acc.has(s.id)).map((s) => ({ start: s.start, end: s.end, type: s.type }));
      const r = await commitArtifact({ name: name || det.filename, filename: det.filename, kind: "document", text: det.text, accepted });
      toast(`Saved “${r.name}” · ${r.entities} entities tokenized`);
      setDet(null); setFile(null); setName("");
      qc.invalidateQueries({ queryKey: ["artifacts"] });
    } catch (e) { toast(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-bold text-ink">Sensitive Document Intake</h1>
        <p className="text-[14px] text-slate mt-1">
          Drag a document → the PII/NPI model highlights what it finds → you accept or reject each →
          a de-identified copy is stored (raw values never persisted).
        </p>
      </div>

      {!det ? (
        <div className="space-y-3 max-w-2xl">
          <label className="block">
            <span className="text-[13px] text-ink font-bold">Artifact name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amboy FY2024 report"
              className="mt-1 w-full rounded-card border border-line bg-paper px-3 py-2 text-[14px]" />
          </label>
          <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
            className={`block cursor-pointer rounded-card border-2 border-dashed p-8 text-center ${over ? "border-navy bg-[#eef2fb]" : "border-line bg-paper hover:border-navy"}`}>
            <div className="text-[14px] text-ink font-bold">{file ? file.name : "Drag a file here, or click to choose"}</div>
            <div className="text-[11px] text-slate mt-1">PDF · DOCX · TXT · MD · JSON</div>
            <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          <button onClick={runDetect} disabled={busy || !file}
            className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
            {busy ? "Running PII model…" : "Detect PII ▸"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="font-bold text-ink">{det.filename}</span>
            <span className="text-slate">{acc.size}/{det.spans.length} entities will be tokenized</span>
            <button onClick={() => setAcc(new Set(det.spans.map((s) => s.id)))} className="text-teal font-bold hover:underline">Accept all</button>
            <button onClick={() => setAcc(new Set())} className="text-slate font-bold hover:underline">Reject all</button>
            <button onClick={download} className="ml-auto text-teal font-bold hover:underline">⤓ Download highlighted</button>
          </div>
          <Highlighted text={det.text} spans={det.spans} accepted={acc} />
          <div className="overflow-x-auto border border-line rounded-card max-h-72">
            <table className="w-full text-[12px]">
              <thead className="bg-paper sticky top-0"><tr>
                <th className="px-2 py-1.5 text-left">Tokenize?</th><th className="px-2 py-1.5 text-left">Text</th>
                <th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Score</th></tr></thead>
              <tbody>
                {det.spans.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-2 py-1.5"><input type="checkbox" checked={acc.has(s.id)} onChange={() => toggle(s.id)} /></td>
                    <td className="px-2 py-1.5 font-mono">{s.text.slice(0, 40)}</td>
                    <td className="px-2 py-1.5 font-mono text-navy">{s.type}</td>
                    <td className="px-2 py-1.5 text-slate">{s.description}</td>
                    <td className="px-2 py-1.5">{s.source}</td>
                    <td className="px-2 py-1.5 font-mono">{s.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setDet(null); }} className="rounded-full border border-line text-slate text-[13px] font-bold px-4 py-2">Cancel</button>
            <button onClick={save} disabled={busy} className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
              {busy ? "Saving…" : "Accept & store de-identified artifact ▸"}
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-[12px] font-bold tracking-wide text-navy mb-2">ARTIFACT EXPLORER</h2>
        <ArtifactExplorer />
      </div>
    </div>
  );
}
