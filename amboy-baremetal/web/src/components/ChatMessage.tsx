import type { ChatMeta } from "../lib/types";
import { Markdown } from "./Markdown";
import { TokenChip } from "./TokenChip";
import { CitationPill, DraftBadge, NoSourceWarning } from "./ui";

export function ChatMessage({ role, text, meta, onProject }: {
  role: "user" | "assistant";
  text: string;
  meta?: ChatMeta;
  onProject?: () => void;
}) {
  if (role === "user") {
    return (
      <div className="ml-auto max-w-[85%] bg-navy text-white rounded-card px-3 py-2 text-[14px]">
        {text}
      </div>
    );
  }

  const noCite = meta && meta.citations.length === 0;
  const draftInText = /DRAFT/.test(text);
  return (
    <div className="max-w-[95%] bg-surface border border-line rounded-card px-3.5 py-3 shadow-card space-y-2">
      <Markdown text={text || "…"} />

      {meta && (
        <div className="space-y-2 pt-1">
          {/* Sealed references — interactive reveal (signature element) */}
          {meta.tokens.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate">Sealed references:</span>
              {meta.tokens.map((t) => <TokenChip key={t} token={t} />)}
            </div>
          )}

          {/* Citations */}
          {noCite ? <NoSourceWarning /> : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate">Sources:</span>
              {meta.citations.map((c) => <CitationPill key={c.id} c={c} />)}
            </div>
          )}

          {meta.draft && !draftInText && <DraftBadge />}

          <div className="flex items-center gap-3 pt-0.5">
            {onProject && (
              <button onClick={onProject}
                      className="text-[11px] text-teal font-bold hover:underline"
                      aria-label="Project this answer to the dashboard panel">
                ⤢ Project to panel
              </button>
            )}
            {meta.latency_ms != null && (
              <span className="text-[10px] text-slate font-mono">{meta.latency_ms} ms</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
