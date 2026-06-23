import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteArtifact, getArtifact, listArtifacts } from "../lib/api";
import { toast } from "../lib/toast";
import type { ArtifactDetail } from "../lib/types";

// Browsable S3 artifact explorer. Reused on Upload (manage) and New Comparison
// (select two). Viewing shows the de-identified, token-highlighted document.
export function ArtifactExplorer({ selectable, selected, onToggle }: {
  selectable?: boolean; selected?: Set<string>; onToggle?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["artifacts"], queryFn: listArtifacts });
  const [view, setView] = useState<ArtifactDetail | null>(null);

  async function open(id: string) {
    try { setView(await getArtifact(id)); } catch { toast("Couldn't open artifact"); }
  }
  async function del(id: string) {
    if (!window.confirm("Delete this artifact? (frees its S3 object)")) return;
    try { await deleteArtifact(id); qc.invalidateQueries({ queryKey: ["artifacts"] }); toast("Artifact deleted"); }
    catch { toast("Delete failed"); }
  }

  return (
    <div>
      {isLoading && <p className="text-slate text-[14px]">Loading artifacts…</p>}
      {data && data.artifacts.length === 0 && (
        <p className="text-slate text-[14px]">No artifacts yet — upload one above.</p>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.artifacts.map((a) => {
          const sel = selected?.has(a.id);
          return (
            <div key={a.id}
              onClick={() => selectable && onToggle?.(a.id)}
              className={`bg-surface border rounded-card shadow-card p-3 ${selectable ? "cursor-pointer" : ""} ${sel ? "border-navy ring-2 ring-navy/30" : "border-line"}`}>
              <div className="flex items-start gap-2">
                {selectable && <input type="checkbox" checked={!!sel} readOnly className="mt-1" />}
                <div className="min-w-0">
                  <div className="font-bold text-ink truncate" title={a.name}>{a.name}</div>
                  <div className="text-[11px] text-slate truncate">{a.filename || a.kind}</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] font-mono text-teal">⬡ {a.entities} entities tokenized</div>
              <div className="mt-2 flex gap-3 text-[11px]">
                <button onClick={(e) => { e.stopPropagation(); open(a.id); }} className="text-teal font-bold hover:underline">View</button>
                <button onClick={(e) => { e.stopPropagation(); del(a.id); }} className="text-red font-bold hover:underline">Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {view && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={() => setView(null)}>
          <div className="bg-surface rounded-card shadow-card w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="font-bold text-ink">{view.name} <span className="text-[11px] text-slate font-normal">· {view.entities} tokenized</span></div>
              <button onClick={() => setView(null)} className="text-slate hover:text-ink">✕</button>
            </div>
            <iframe title="artifact" sandbox="" srcDoc={view.highlighted_html} className="flex-1 w-full rounded-b-card" style={{ minHeight: 420 }} />
          </div>
        </div>
      )}
    </div>
  );
}
