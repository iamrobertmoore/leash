import { defineConfig } from "vite";
export default defineConfig({ root: "app", build: { outDir: "../dist", emptyOutDir: true }, server: { proxy: { "/api": "http://localhost:8787" } } });
