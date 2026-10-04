import { Hono } from "hono";
import type { Context } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContextFactory } from "./context";
import { requireBindings, type Bindings } from "./lib/env";
import { purgeOldAuditEvents, recordAudit, recordProxyRejection } from "./lib/audit";
import { markApiFailed, outerSongUrl, OUTER_FETCH_HEADERS, shouldPreferOuter } from "./lib/songMedia";
import { verifyAudioToken } from "./lib/proxyToken";
import { ncm } from "./neteaseClient";
import { getSession, purgeExpiredSessions } from "./neteaseSession";
import { createDb } from "./queries/connection";

/**
 * 单源部署的 Worker 入口（决策 D-1）：
 * 静态资源由 Workers Static Assets 提供，本 Worker 只承接 /api/*（wrangler 中
 * `run_worker_first = ["/api/*"]`）。因此这里不再有 node-server 启动分支，
 * 也不再需要 `node:fs` 静态文件服务（评审 R3/R5：删除而不是 shim）。
 */
const app = new Hono<{ Bindings: Bindings }>();

/** 安全响应头（评审 L2）。静态资源侧的同等头由 public/_headers 下发。 */
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

/**
 * 审计辅助：代理拒绝事件（节流在 lib/audit.ts 内部；绑定缺失时静默跳过，
 * 绝不因审计改变响应）。waitUntil 不阻塞响应。
 */
function auditProxyRejection(c: Context<{ Bindings: Bindings }>, reason: string): void {
  const env = c.env;
  if (!env.DB || !env.COOKIE_ENC_KEY) return;
  c.executionCtx.waitUntil(
    recordProxyRejection(createDb(env.DB), env.COOKIE_ENC_KEY, c.req.raw, reason),
  );
}

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
    auditProxyRejection(c, "invalid id");
    return c.json({ error: "invalid id" }, 400);
  }
  const env = requireBindings(c.env);
  // ① 同源校验：现代浏览器从第三方页面发起的媒体请求会带 Sec-Fetch-Site: cross-site
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    auditProxyRejection(c, "cross-site");
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
    auditProxyRejection(c, token.reason);
    return c.json({ error: "forbidden", reason: token.reason }, 403);
  }
  const session = await getSession(createDb(env.DB), env.COOKIE_ENC_KEY, c.req.raw);
  // 解析媒体地址：API 直链优先；对 CF 出口被区域限制时回退外链端点（lib/songMedia.ts）
  let mediaUrl: string | null = null;
  if (!shouldPreferOuter(id)) {
    const urlRes = await ncm.songUrlV1(id, session?.neteaseCookie);
    const data = urlRes.body?.data?.[0];
    if (data?.url) {
      mediaUrl = data.url;
    } else if (data?.fee === 1 || data?.fee === 4 || data?.message) {
      return c.json({ error: "unplayable", reason: data?.message ?? "VIP/付费歌曲，暂无播放权限" }, 404);
    } else {
      markApiFailed(id); // 后续 Range 请求直接走外链，省掉一遍 weapi
    }
  }
  if (!mediaUrl) mediaUrl = outerSongUrl(id);
  const isHead = c.req.method === "HEAD";
  const upstreamHeaders: Record<string, string> = {};
  const range = c.req.header("range");
  // ③ 单请求字节上限：没有 Range 时主动限定首个分片，避免一次拉走整首文件（评审 M7）
  upstreamHeaders["Range"] = range ?? "bytes=0-8388607";
  const upstream = await fetch(mediaUrl, {
    method: isHead ? "HEAD" : "GET",
    // 外链端点在空 UA 下会返回 302 错误链，必须显式带 UA（见 lib/songMedia.ts）
    headers: { ...upstreamHeaders, ...OUTER_FETCH_HEADERS },
    redirect: "follow",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: "upstream error", status: upstream.status }, 502);
  }
  // 外链兜底对不可播歌曲可能重定向到非音频内容：明确拒绝，避免把 HTML 当音频推给播放器
  const upstreamType = upstream.headers.get("content-type") ?? "";
  if (!/audio|octet-stream/.test(upstreamType)) {
    return c.json({ error: "unplayable", reason: "not audio" }, 404);
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

/**
 * Worker 入口：既承接 HTTP，也承接 Cron。
 * Cron 用于懒清理过期会话，避免明文 cookie 长期驻留在 D1（评审 L4）；
 * 免费档每账号 5 个 Cron Triggers（官方文档核验）。
 */
export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const db = createDb(requireBindings(env).DB);
    ctx.waitUntil(
      (async () => {
        const purged = await purgeExpiredSessions(db);
        await recordAudit(db, "session_expired_purge", { meta: { purged } });
        await purgeOldAuditEvents(db); // 审计事件保留 90 天
      })(),
    );
  },
} satisfies ExportedHandler<Bindings>;
