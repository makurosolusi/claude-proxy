import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { inspectorPlugin } from "./src/inspector-plugin";

export default defineConfig({
  root: "src",
  publicDir: false,
  plugins: [
    inspectorPlugin(),
    react(),
  ],
  server: {
    middlewareMode: true,
    hmr: { port: 24678 },
  },
  appType: "custom",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
