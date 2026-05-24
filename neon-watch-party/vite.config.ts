import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "https://neon-watch-party.onrender.com", ws: true },
      "/uploads": { target: "https://neon-watch-party.onrender.com" },
      "/api": { target: "https://neon-watch-party.onrender.com" },
    },
  },
});
