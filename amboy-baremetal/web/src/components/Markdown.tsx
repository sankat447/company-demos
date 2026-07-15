import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Render the agent's markdown with the design tokens (instrument-panel look:
// mono figures, clean tables, DRAFT as a red callout). Inline citation markers
// ([chunk:..]/[metric:..]) are stripped here and shown as pills by the caller.
const CITE = /\s*\[(?:chunk|metric):[^\]]+\]/g;

// Color +deltas teal and −deltas red inside emphasized cells.
function deltaClass(s: string) {
  if (/^[+▲]|increase|\bup\b/i.test(s) || /\+\d/.test(s)) return "text-teal";
  if (/^[−▼-]|decrease|\bdown\b/i.test(s) || /[-−]\d/.test(s)) return "text-red";
  return "text-ink";
}

export function Markdown({ text }: { text: string }) {
  const clean = text.replace(CITE, "");
  return (
    <div className="space-y-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="font-display text-[20px] font-bold text-ink mt-3 mb-1" {...p} />,
          h2: (p) => <h2 className="font-display text-[17px] font-bold text-navy mt-3 mb-1" {...p} />,
          h3: (p) => <h3 className="text-[14px] font-bold text-ink mt-2 mb-1" {...p} />,
          p: (p) => <p className="text-[14px] text-ink leading-relaxed my-1.5" {...p} />,
          strong: ({ children }) => {
            const s = String(children);
            return <strong className={`font-mono font-bold ${deltaClass(s)}`}>{children}</strong>;
          },
          em: (p) => <em className="text-slate" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 space-y-1 text-[14px] my-1.5 text-ink" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 space-y-1 text-[14px] my-1.5 text-ink" {...p} />,
          hr: () => <hr className="my-3 border-line" />,
          code: (p) => <code className="font-mono text-[12px] bg-paper px-1 py-0.5 rounded text-ink" {...p} />,
          a: (p) => <a className="text-teal underline" {...p} />,
          blockquote: ({ children }) => (
            <div className="my-2 rounded-card border-l-4 border-red bg-red/10 px-3 py-2 text-[13px] text-red font-bold">
              {children}
            </div>
          ),
          table: (p) => (
            <div className="my-2 overflow-x-auto rounded-card border border-line">
              <table className="w-full text-[13px] border-collapse" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-paper" {...p} />,
          th: (p) => <th className="text-left font-bold text-slate border-b border-line px-2.5 py-1.5 whitespace-nowrap" {...p} />,
          td: (p) => <td className="font-mono text-ink border-b border-line px-2.5 py-1.5 align-top" {...p} />,
          tr: (p) => <tr className="even:bg-paper/40" {...p} />,
        }}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
}
