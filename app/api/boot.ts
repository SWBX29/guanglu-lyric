import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContextFactory } from "./context";
import { requireBindings, type Bindings } from "./lib/env";
import { verifyAudioToken } from "./lib/proxyToken";
import { ncm } from "./neteaseClient";
import { getSession } from "./neteaseSession";
import { createDb } from "./queries/connection";

/**
 * 单源部署的 Worker 入口（决策 D-1）：
 * 静态资源由 Workers Static Assets 提供，本 Worker 只承接 /api/*（wrangler 中
 * `run_worker_first = ["/api/*"]`）。因此这里不再有 node-server 启动分支，
 * 也不再需要 `node:fs` 静态文件服务（评审 R3/R5：删除而不是 shim）。
 */
const app = new Hono<{ Bindings: Bindings }>();

/** 健康检查：用于部署后冒烟与保活，不回显任何绑定内容 */
app.get("/api/health", (c) => {
  const hasDb = Boolean(c.env.DB);
  const hasKey = Boolean(c.env.COOKIE_ENC_KEY);
  return c.json({ ok: hasDb && hasKey, storage: hasDb, key: hasKey, ts: Date.now() });
});

// 音频流式代理：解决网易云 mp3 无 CORS、Web Audio AnalyserNode 读不到频谱的问题
// 透传 Range 头以支持拖动进度条；必须携带 songUrl 下发的签名（评审 B1/D5）
app.on(["GET", "HEAD"], "/api/proxy/audio", async (c) => {
  const id = c.req.query("id");
  if (!id || !/^\d+$/.test(id) || id.length > 20) {
    return c.json({ error: "invalid id" }, 400);
  }
  const env = requireBindings(c.env);
  // ① 同源校验：现代浏览器从第三方页面发起的媒体请求会带 Sec-Fetch-Site: cross-site
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return c.json({ error: "forbidden", reason: "cross-site" }, 403);
  }
  // ② 验签必须在 weapi 之前：一次 HMAC 远比"先做双层 AES + BigInt 模幂再出站"便宜
  const token = await verifyAudioToken(
    id,
    c.req.query("exp"),
    c.req.query("sig"),
    env.PROXY_SIGN_KEY ?? env.COOKIE_ENC_KEY,
  );
  if (!token.ok) {
    return c.json({ error: "forbidden", reason: token.reason }, 403);
  }
  const session = await getSession(createDb(env.DB), env.COOKIE_ENC_KEY, c.req.raw);
  const urlRes = await ncm.songUrlV1(id, session?.neteaseCookie);
  const data = urlRes.body?.data?.[0];
  if (!data?.url) {
    return c.json({ error: "unplayable", reason: data?.message ?? "no url" }, 404);
  }
  const isHead = c.req.method === "HEAD";
  const upstreamHeaders: Record<string, string> = {};
  const range = c.req.header("range");
  // ③ 单请求字节上限：没有 Range 时主动限定首个分片，避免一次拉走整首文件（评审 M7）
  upstreamHeaders["Range"] = range ?? "bytes=0-8388607";
  const upstream = await fetch(data.url, {
    method: isHead ? "HEAD" : "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: "upstream error", status: upstream.status }, 502);
  }
  const headers = new Headers();
  for (const h of ["content-type", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // 仅在响应未被压缩时透传 content-length：边缘自动解压会使它与实际字节数不符（评审 R12）
  if (!upstream.headers.get("content-encoding")) {
    const len = upstream.headers.get("content-length");
    if (len) headers.set("content-length", len);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  // 同源部署下不需要 CORS 头；不再下发 `access-control-allow-origin: *`（评审 M1）
  if (isHead) return new Response(null, { status: upstream.status, headers });
  return new Response(upstream.body, { status: upstream.status, headers });
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: createContextFactory(requireBindings(c.env)),
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
