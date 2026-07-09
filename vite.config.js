import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "client/public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // used when vite runs standalone; main path uses middlewareMode via express
    proxy: {
      "/api": "http://localhost:3000",
      "/token": "http://localhost:3000",
    },
  },
});
