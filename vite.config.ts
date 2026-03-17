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
    strictPort: false
  },
  clearScreen: false
});
