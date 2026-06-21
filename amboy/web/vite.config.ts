import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: /api/* -> compare-agent on localhost:8080 (local dev only).
// In the cluster, nginx does the proxying (web/nginx/default.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
