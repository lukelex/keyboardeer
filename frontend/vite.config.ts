import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Wails discovers this server from Vite's ready output. A fixed private
    // loopback port prevents an unrelated browser-preview Vite process from
    // being mistaken for the desktop frontend.
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
