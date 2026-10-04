import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { ncm } from "./neteaseClient";
import { getSession } from "./neteaseSession";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// 音频流式代理：解决网易云 mp3 无 CORS、Web Audio AnalyserNode 读不到频谱的问题
// 透传 Range 头以支持拖动进度条
app.get("/api/proxy/audio", async (c) => {
  const id = c.req.query("id");
  if (!id || !/^\d+$/.test(id)) {
    return c.json({ error: "invalid id" }, 400);
  }
  const session = await getSession(c.req.raw);
  const urlRes = await ncm.songUrlV1(id, session?.neteaseCookie);
  const data = urlRes.body?.data?.[0];
  if (!data?.url) {
    return c.json({ error: "unplayable", reason: data?.message ?? "no url" }, 404);
  }
  const upstreamHeaders: Record<string, string> = {};
  const range = c.req.header("range");
  if (range) upstreamHeaders["Range"] = range;
  const upstream = await fetch(data.url, {
    headers: upstreamHeaders,
    redirect: "follow",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: "upstream error", status: upstream.status }, 502);
  }
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // 允许前端跨源读取（同源部署下无影响）
  headers.set("access-control-allow-origin", "*");
  return new Response(upstream.body, { status: upstream.status, headers });
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
