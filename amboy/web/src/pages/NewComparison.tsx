import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { comparability, indexComparison } from "../lib/api";
import { toast } from "../lib/toast";
import type { Comparability } from "../lib/types";
import { ArtifactExplorer } from "../components/ArtifactExplorer";

// Function 2 — New Comparison: pick two artifacts, let the model judge if they're
// comparable + extract comparable fields, human accepts/rejects, then index.
export function NewComparison() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cmp, setCmp] = useState<Comparability | null>(null);
  const [name, setName] = useState("");
  const [acc, setAcc] = useState<Set<number>>(new Set());

  function toggle(id: string) {
    setSel((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else { if (n.size >= 2) return c; n.add(id); }
      return n;
    });
  }

  async function check() {
    const [a, b] = [...sel];
    setBusy(true);
    try {
      const r = await comparability(a, b);
      setCmp(r); setName(r.suggested_name || "Comparison");
      setAcc(new Set(r.fields.map((_, i) => i)));
      setStep(2);
    } catch (e) { toast(`Comparability check failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function index() {
    if (!cmp) return;
    const cid = name.trim().replace(/[:%/]/g, "").slice(0, 60) || `cmp-${Date.now().toString(36)}`;
    setBusy(true);
    try {
      await indexComparison({
        comparison_id: cid, label: name, artifact_a: cmp.artifact_a, artifact_b: cmp.artifact_b,
        accepted_fields: cmp.fields.filter((_, i) => acc.has(i)),
      });
      toast("Comparison indexed");
      nav(`/c/${encodeURIComponent(cid)}`);
    } catch (e) { toast(`Indexing failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="font-display text-[28px] font-bold text-ink">Compare and Vectorize Documents</h1>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[14px] text-slate">Select <b>two</b> de-identified artifacts to compare.</p>
          <ArtifactExplorer selectable selected={sel} onToggle={toggle} />
          <button onClick={check} disabled={busy || sel.size !== 2}
            className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
            {busy ? "Checking comparability…" : "Check comparability ▸"}
          </button>
        </div>
      )}

      {step === 2 && cmp && (
        <div className="space-y-3">
          <div className={`rounded-card border p-3 text-[13px] ${cmp.comparable ? "border-[#a7f3d0] bg-[#ecfdf5] text-teal" : "border-[#e8d9a8] bg-[#fdf6e3] text-[#8a6d1f]"}`}>
            <b>{cmp.comparable ? "Comparable" : "May not be directly comparable"}</b> — {cmp.reason}
          </div>
          <label className="block max-w-md">
            <span className="text-[13px] text-ink font-bold">Comparison name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-card border border-line bg-paper px-3 py-2 text-[14px]" />
          </label>
          <div className="text-[12px] text-slate">Comparable fields the model found (accept the ones to keep):</div>
          <div className="overflow-x-auto border border-line rounded-card">
            <table className="w-full text-[12px]">
              <thead className="bg-paper"><tr>
                <th className="px-2 py-1.5 text-left">Keep?</th><th className="px-2 py-1.5 text-left">Field</th>
                <th className="px-2 py-1.5 text-left">A</th><th className="px-2 py-1.5 text-left">B</th>
                <th className="px-2 py-1.5 text-left">Unit</th></tr></thead>
              <tbody>
                {cmp.fields.map((f, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1.5"><input type="checkbox" checked={acc.has(i)}
                      onChange={() => setAcc((c) => { const n = new Set(c); n.has(i) ? n.delete(i) : n.add(i); return n; })} /></td>
                    <td className="px-2 py-1.5">{f.label}</td>
                    <td className="px-2 py-1.5 font-mono text-navy">{f.a}{f.unit}</td>
                    <td className="px-2 py-1.5 font-mono text-teal">{f.b}{f.unit}</td>
                    <td className="px-2 py-1.5">{f.unit}</td>
                  </tr>
                ))}
                {cmp.fields.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-slate">No comparable fields detected — you can still index for chat.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setStep(1); setCmp(null); }} className="rounded-full border border-line text-slate text-[13px] font-bold px-4 py-2">Back</button>
            <button onClick={index} disabled={busy}
              className="rounded-full bg-navy text-white text-[13px] font-bold px-4 py-2 disabled:opacity-50">
              {busy ? "Indexing…" : "Accept & index comparison ▸"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
