import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    // 本地全栈开发：先跑 `npm run dev:worker`（8787：绑定 + 本地 D1 + secrets），再跑本命令。
    // /api/* 原样转发给 Worker。不用 @hono/vite-dev-server —— 它调 app.fetch() 时不传 env，
    // 绑定会全部丢失（见 docs/HANDOFF.md §8 陷阱 10）。
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
