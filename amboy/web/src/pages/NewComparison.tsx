import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, commitDocument, detectDocument } from "../lib/api";
import type { ComparisonStatus, DetectResult, DetectSpan } from "../lib/types";
import { toast } from "../lib/toast";

const ACCEPT = ".pdf,.docx,.txt,.md,.json";
type Side = "A" | "B";

function DropZone({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
      className={`flex-1 cursor-pointer rounded-card border-2 border-dashed p-6 text-center block transition-colors
        ${over ? "border-navy bg-[#eef2fb]" : "border-line bg-paper hover:border-navy"}`}>
      <div className="text-[14px] text-ink font-bold">{label}</div>
      <div className="text-[12px] text-slate mt-1">{file ? file.name : "Drag a file here, or click to choose"}</div>
      <div className="text-[11px] text-slate mt-0.5">PDF · DOCX · TXT · MD · JSON</div>
      <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </label>
  );
}

// Render the document text with accepted spans highlighted (red) and rejected
// ones struck-through (so the reviewer sees what will stay exposed).
function Highlighted({ text, spans, accepted }: { text: string; spans: DetectSpan[]; accepted: Set<string> }) {
  const out: JSX.Element[] = [];
  let cur = 0;
  [...spans].sort((a, b) => a.start - b.start).forEach((s, i) => {
    if (s.start < cur) return;
    out.push(<Fragment key={`t${i}`}>{text.slice(cur, s.start)}</Fragment>);
    const on = accepted.has(s.id);
    out.push(
      <mark key={`m${i}`} title={`${s.type} · ${s.source} · ${s.score}`}
        className={on ? "bg-red/10 text-red rounded px-0.5" : "line-through text-slate decoration-slate/60"}>
        {text.slice(s.start, s.end)}<sub className="text-[8px] ml-0.5">{s.type}</sub>
      </mark>);
    cur = s.end;
  });
  out.push(<Fragment key="tail">{text.slice(cur)}</Fragment>);
  return <pre className="whitespace-pre-wrap font-mono text-[11px] bg-paper border border-line rounded-card p-3 max-h-72 overflow-auto">{out}</pre>;
}

export function NewComparison() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<{ A: File | null; B: File | null }>({ A: null, B: null });
  const [det, setDet] = useState<{ A?: DetectResult; B?: DetectResult }>({});
  const [acc, setAcc] = useState<{ A: Set<string>; B: Set<string> }>({ A: new Set(), B: new Set() });
  const [side, setSide] = useState<Side>("A");
  const [summary, setSummary] = useState<ComparisonStatus | null>(null);

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent); window.addEventListener("drop", prevent);
    return () => { window.removeEventListener("dragover", prevent); window.removeEventListener("drop", prevent); };
  }, []);

  const cid = name.trim().replace(/[:%/]/g, "").slice(0, 60) || `cmp-${Date.now().toString(36)}`;

  async function runDetect() {
    if (!files.A || !files.B) { toast("Choose both documents (A and B)"); return; }
    setBusy(true);
    try {
      const [a, b] = [await detectDocument(files.A), await detectDocument(files.B)];
      setDet({ A: a, B: b });
      setAcc({ A: new Set(a.spans.map((s) => s.id)), B: new Set(b.spans.map((s) => s.id)) }); // default: accept all
      setStep(2); setSide("A");
    } catch (e) { toast(`Detection failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  function toggle(s: Side, id: string) {
    setAcc((cur) => { const n = new Set(cur[s]); n.has(id) ? n.delete(id) : n.add(id); return { ...cur, [s]: n }; });
  }
  function setAll(s: Side, on: boolean) {
    setAcc((cur) => ({ ...cur, [s]: on ? new Set(det[s]!.spans.map((x) => x.id)) : new Set() }));
  }
  function download(s: Side) {
    const blob = new Blob([det[s]!.highlighted_html], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${det[s]!.filename}-PII-review.html`; a.click(); URL.revokeObjectURL(a.href);
  }

  async function approve() {
    setBusy(true);
    try {
      for (const s of ["A", "B"] as Side[]) {
        const d = det[s]!;
        const accepted = d.spans.filter((sp) => acc[s].has(sp.id)).map((sp) => ({ start: sp.start, end: sp.end, type: sp.type }));
        await commitDocument({ comparison_id: cid, side: s, text: d.text, accepted, year: 0, actor: "ui" });
      }
      const st = await api.get<ComparisonStatus>(`/comparisons/${encodeURIComponent(cid)}/status`);
      setSummary(st); setStep(3);
      toast("Accepted PII tokenized & indexed");
      setTimeout(() => nav(`/c/${encodeURIComponent(cid)}`), 1200);
    } catch (e) { toast(`Indexing failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const Stepper = () => (
    <div className="flex items-center gap-2 text-[12px] font-bold mb-4">
      {[[1, "Upload"], [2, "Review PII"], [3, "Index & chat"]].map(([n, t], i) => (
        <Fragment key={n as number}>
          {i > 0 && <span className="text-line">—</span>}
          <span className={`px-2.5 py-1 rounded-full ${step === n ? "bg-navy text-white" : step > (n as number) ? "bg-teal/15 text-teal" : "bg-paper text-slate border border-line"}`}>
            {n as number}. {t}
          </span>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="font-display text-[28px] font-bold text-ink">New comparison</h1>
      <Stepper />

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-[14px] text-slate">
            Upload two reports. Each runs through the locally-hosted PII/NPI model so you can
            review and approve what gets de-identified before anything is indexed.
          </p>
          <label className="block">
            <span className="text-[13px] text-ink font-bold">Report name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q2 Portfolio Review"
              className="mt-1 w-full rounded-card border border-line bg-paper px-3 py-2 text-[14px]" />
          </label>
          <div className="flex gap-3">
            <DropZone label="Report A" file={files.A} onPick={(f) => setFiles((x) => ({ ...x, A: f }))} />
            <DropZone label="Report B" file={files.B} onPick={(f) => setFiles((x) => ({ ...x, B: f }))} />
          </div>
          <button onClick={runDetect} disabled={busy || !files.A || !files.B}
            className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
            {busy ? "Running PII model…" : "Detect PII & review ▸"}
          </button>
        </div>
      )}

      {step === 2 && det[side] && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(["A", "B"] as Side[]).map((s) => (
              <button key={s} onClick={() => setSide(s)}
                className={`px-3 py-1 rounded-full text-[12px] font-bold ${side === s ? "bg-navy text-white" : "bg-paper text-slate border border-line"}`}>
                Report {s} · {det[s]?.filename?.slice(0, 22)}
              </button>
            ))}
            <span className="ml-auto text-[12px] text-slate">
              {acc[side].size}/{det[side]!.spans.length} entities will be tokenized
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-[12px]">
            <button onClick={() => setAll(side, true)} className="text-teal font-bold hover:underline">Accept all</button>
            <button onClick={() => setAll(side, false)} className="text-slate font-bold hover:underline">Reject all</button>
            <button onClick={() => download(side)} className="ml-auto text-teal font-bold hover:underline">⤓ Download highlighted document</button>
          </div>

          <Highlighted text={det[side]!.text} spans={det[side]!.spans} accepted={acc[side]} />

          <div className="overflow-x-auto border border-line rounded-card max-h-72">
            <table className="w-full text-[12px]">
              <thead className="bg-paper sticky top-0"><tr>
                <th className="px-2 py-1.5 text-left">Tokenize?</th><th className="px-2 py-1.5 text-left">Text</th>
                <th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Score</th>
              </tr></thead>
              <tbody>
                {det[side]!.spans.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-2 py-1.5"><input type="checkbox" checked={acc[side].has(s.id)} onChange={() => toggle(side, s.id)} /></td>
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
            <button onClick={() => setStep(1)} className="rounded-full border border-line text-slate text-[13px] font-bold px-4 py-2">Back</button>
            <button onClick={approve} disabled={busy}
              className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
              {busy ? "Tokenizing & indexing…" : "Approve, tokenize & index ▸"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && summary && (
        <div className="rounded-card border border-[#a7f3d0] bg-[#ecfdf5] p-4 space-y-1">
          <div className="font-bold text-teal">De-identification complete</div>
          <div className="text-[13px] text-slate font-mono">{summary.entities_tokenized} entities tokenized · {summary.npi_left_in_index} left in index</div>
          <div className="text-[13px] text-slate font-mono">{summary.chunks_indexed} de-id chunks indexed · opening chat…</div>
        </div>
      )}
    </div>
  );
}
