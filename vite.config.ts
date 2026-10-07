import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  root: "app",
  build: { outDir: "../dist", emptyOutDir: true, rollupOptions: { input: { main: resolve(__dirname, "app/index.html"), brief: resolve(__dirname, "app/brief.html"), own: resolve(__dirname, "app/own.html") } } },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
