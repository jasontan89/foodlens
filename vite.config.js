import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In local dev, proxy /api calls to the Vercel dev server
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
