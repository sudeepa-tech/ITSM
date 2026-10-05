import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { react: ["react", "react-dom", "react-router-dom"], charts: ["recharts"] } } } },
  server: { port: 5173, proxy: { "/api": "http://localhost:4000", "/socket.io": { target: "http://localhost:4000", ws: true } } },
});
