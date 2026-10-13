import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist-demo", assetsInlineLimit: 100_000_000, rollupOptions: { input: "index.demo.html" }, chunkSizeWarningLimit: 4000 },
});
