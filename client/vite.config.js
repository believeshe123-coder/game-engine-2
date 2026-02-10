import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/game-engine-2/",
  server: {
    host: true,
    port: 5173,
    strictPort: true
  }
});
