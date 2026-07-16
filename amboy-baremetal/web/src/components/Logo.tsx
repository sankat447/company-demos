// Generic bank brand mark — inline SVG (blue triangle + three white waves) so
// it ships self-contained (no external image / CSP concerns). Deliberately
// unbranded: this is a demo for ANY bank, not a specific institution.
const BLUE = "#1B9DD9";

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Demo Bank">
      <polygon points="50,7 93,91 7,91" fill={BLUE} />
      <g fill="none" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round">
        <path d="M25,55 q12.5,-9 25,0 t25,0" />
        <path d="M25,66 q12.5,-9 25,0 t25,0" />
        <path d="M25,77 q12.5,-9 25,0 t25,0" />
      </g>
    </svg>
  );
}

// Full lockup: mark + "DEMO" (heavy sans) + "Bank" (serif) — a generic bank.
export function Logo({ variant = "dark", size = 30 }: { variant?: "dark" | "light"; size?: number }) {
  const name = variant === "dark" ? "#FFFFFF" : "#14193D";
  const bank = variant === "dark" ? "#CBD5E1" : "#5A6B86";
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <LogoMark size={size} />
      <span className="leading-none">
        <span className="font-body font-extrabold tracking-tight" style={{ color: name, fontSize: size * 0.66 }}>
          DEMO
        </span>{" "}
        <span className="font-display" style={{ color: bank, fontSize: size * 0.6 }}>Bank</span>
      </span>
    </span>
  );
}

// "AI solution by IIS" attribution.
export function IISAttribution({ className = "" }: { className?: string }) {
  return (
    <span className={`text-[12px] text-slate ${className}`}>
      AI solution by{" "}
      <a href="https://www.iistech.com" target="_blank" rel="noreferrer"
         className="font-bold text-teal hover:underline">IIS</a>{" "}
      · iistech.com
    </span>
  );
}
