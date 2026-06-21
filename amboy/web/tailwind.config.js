/** Design tokens — "instrument panel for a credit desk". */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14193D",
        navy: "#1E2761",
        amboyblue: "#1B9DD9", // brand mark blue (Amboy Bank logo)
        gold: "#C8A24B",
        teal: "#0E7C86", // positive deltas / improvement
        red: "#C0392B",  // flags & sealed NPI
        paper: "#F7F8FB",
        surface: "#FFFFFF",
        line: "#E2E8F0",
        slate: "#5A6B86",
      },
      fontFamily: {
        display: ['"Source Serif 4"', "Georgia", "serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { card: "10px" },
      boxShadow: { card: "0 1px 3px rgba(20,25,61,0.08), 0 1px 2px rgba(20,25,61,0.06)" },
      keyframes: {
        unseal: {
          "0%": { transform: "scale(0.96)", filter: "blur(2px)", opacity: "0.4" },
          "100%": { transform: "scale(1)", filter: "blur(0)", opacity: "1" },
        },
      },
      animation: { unseal: "unseal 320ms ease-out" },
    },
  },
  plugins: [],
};
