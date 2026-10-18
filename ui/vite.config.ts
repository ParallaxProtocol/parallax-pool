import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` proxies the API of a pool running on localhost:4000 (override with POOL_API)
const api = process.env.POOL_API ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": api,
      "/notifications": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
