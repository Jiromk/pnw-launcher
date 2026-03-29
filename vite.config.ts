import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",                 // chemins relatifs en prod
  build: {
    outDir: "dist",           // doit correspondre à distDir ci-dessus
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: false,
    /** Proxy GTS : évite le blocage CORS en `vite` seul (sans shell Tauri). */
    proxy: {
      "/gts-proxy": {
        target: "http://gts.kawasemi.de",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gts-proxy/, ""),
      },
    },
  },
  clearScreen: false
});
