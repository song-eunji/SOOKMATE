import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 /api 와 /ws 를 백엔드(8000번)로 넘깁니다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
