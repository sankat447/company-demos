import { Fragment } from "react";
import type { ChatMeta } from "../lib/types";
import { TokenChip } from "./TokenChip";
import { CitationPill, DraftBadge, NoSourceWarning } from "./ui";

// token = [ENTITY:hex] (uppercase entity); citation = [chunk:..]/[metric:..]
const PART = /(\[[A-Z_]+:[0-9a-fA-F]+\]|\[(?:chunk|metric):[^\]]+\])/g;
const TOKEN = /^\[[A-Z_]+:[0-9a-fA-F]+\]$/;

function render(text: string) {
  return text.split(PART).map((part, i) => {
    if (TOKEN.test(part)) return <TokenChip key={i} token={part} />;
    if (/^\[(?:chunk|metric):/.test(part))
      return <span key={i} className="font-mono text-[11px] text-[#0369a1]">{part}</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function ChatMessage({ role, text, meta }: {
  role: "user" | "assistant"; text: string; meta?: ChatMeta;
}) {
  if (role === "user") {
    return (
      <div className="ml-auto max-w-[85%] bg-navy text-white rounded-card px-3 py-2 text-[14px]">
        {text}
      </div>
    );
  }
  const noCite = meta && meta.citations.length === 0;
  return (
    <div className="max-w-[92%] bg-paper border border-line rounded-card px-3 py-2 space-y-2">
      <div className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed">{render(text)}</div>
      {meta && (
        <>
          {noCite ? <NoSourceWarning /> : (
            <div className="flex flex-wrap gap-1.5">
              {meta.citations.map((c) => <CitationPill key={c.id} c={c} />)}
            </div>
          )}
          {meta.draft && <div><DraftBadge /></div>}
          {meta.latency_ms != null && (
            <div className="text-[10px] text-slate font-mono">first answer · {meta.latency_ms} ms</div>
          )}
        </>
      )}
    </div>
  );
}
