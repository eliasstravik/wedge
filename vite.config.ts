import path from "path";

import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import manifest from "./src/manifest";

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@dnd-kit/")) {
            return "vendor-dnd"
          }
          if (id.includes("node_modules/react-dom/")) {
            return "vendor-react"
          }
          if (id.includes("node_modules/react/")) {
            return "vendor-react"
          }
        }
      }
    }
  }
});
