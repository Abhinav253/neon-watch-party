import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3847", ws: true },
      "/uploads": { target: "http://localhost:3847" },
      "/api": { target: "http://localhost:3847" },
    },
  },
});
