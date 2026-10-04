# 交接文档：光路·歌词 → Cloudflare 免费栈（组合 B）

> 本文件用于**跨对话交接**：新对话无需任何历史上下文，读完这一份即可接手。
> 生成时间：本次会话结束前 ｜ 仓库：`E:\AIwork\Kimi_Agent` ｜ 主工程：`app/`

---

## 0. 30 秒速览

| 项目 | 状态 |
|---|---|
| **线上地址** | https://guanglu-lyric.1663988203.workers.dev |
| **当前 Worker 版本** | `8ddf40c7-d850-4cdd-a12f-7e972237ceca`（2026-10-04 首次由 CI 发布，gzip 218.87 KiB / startup 21 ms）。**注意：此后每次 master push 都会由 CI 自动重新发布，最新版本以 `wrangler deployments list` 为准** |
| Cloudflare 账号 | `1663988203@qq.com's Account` / account id `c5b214ba182d8c1a2880bff2613c2bb8`（OAuth 已登录，凭据存于本机 wrangler 配置） |
| D1 数据库 | `guanglu-lyric-db` / id `a8f4b230-1181-4d24-9aaf-bc15a55f70d1`；远端已应用迁移 `0000_init_netease_sessions.sql` |
| Secrets | `COOKIE_ENC_KEY`、`PROXY_SIGN_KEY` 已在 CF 侧设置（本地副本在 `app/.dev.vars`，已 gitignore） |
| Cron | `23 4 * * *`（每天清理过期会话） |
| Git | 已推送到 **https://github.com/SWBX29/guanglu-lyric**（Public，master，含全部历史）；本地工作树 clean |
| 质量门 | `tsc -b` exit 0 ｜ `vitest` **44/44** ｜ `vite build` OK ｜ `wrangler deploy --dry-run` OK ｜ bundle 无 Node-only 残留 ｜ **GitHub Actions CI**：verify 38–39s 全绿、deploy 32s 实发成功 |
| 代码状态 | **可直接使用**；剩 2 条非阻断待办（自定义域名、审计日志）+ 1 项需人工用手机扫码验证 |

**一句话结论**：原 MySQL/Node 全栈工程已完整迁移到 Cloudflare 免费档（Workers + Static Assets + D1），全部评审阻断项已关闭并逐项实测；唯一未人工验证的是"真人扫码登录 + 播放频谱"（需要手机与浏览器）。

---

## 1. 项目本体（迁移前原状）

- `E:\AIwork\Kimi_Agent\plan.md`：上一轮迭代计划（歌词书写特效 + 粒子性能 + 天气 + 新地图），**已实现**。
- `E:\AIwork\Kimi_Agent\app\`：主工程。
  - 前端：React 19.2 + Vite 7 + TS 5.9 + Tailwind 3.4 + shadcn/ui（57 个组件）+ three 0.186
  - 后端：Hono 4 + tRPC 11 + superjson + zod 4 + Drizzle 0.45 + mysql2 + qrcode（**原为 MySQL**）
  - 功能：3D 体素世界（5 主题 × 8 天气、GPU 驱动粒子）+ 网易云扫码登录/搜索/歌单/播放 + LRC 精确同步 + 频谱驱动场景 + 歌词逐字书写特效
  - 关键文件：`src/scene/VoxelWorld.ts`（2277 行）、`src/pages/Home.tsx`（653 行）、`api/neteaseClient.ts`（自实现 weapi 协议）
- `E:\AIwork\Kimi_Agent\project-summary\`：静态总结页（也被复制进 `app/public/summary/`，随构建发布）。

**迁移前的真实状态（重要）**：`app/node_modules`、`app/dist`、`app/.env` 均不存在；**不是 git 仓库**；`db/migrations` 只有 `.gitkeep`；**零测试文件**（`npm test` 必红）；无任何 CI/Dockerfile/wrangler 配置 → **该工程从未构建、类型检查或运行过一次**。

---

## 2. 对话时间线与产出

| 阶段 | 用户诉求 | 我做了什么 | 产出 |
|---|---|---|---|
| ① 浏览项目 | "浏览项目" | 通读 114 个文件，产出架构报告；发现工程从未构建、无 git、无测试 | 项目结构/技术栈/plan.md 对照分析 |
| ② 云端方案 | "有什么云端构建方案？"→"免费的" | 给出三套方案对比（组合 A/B/C）+ 免费额度表 | A=Render+TiDB、**B=Cloudflare、C=自家机器+Tunnel** |
| ③ 方案评审 | "@专家团：技术方案评审团 推荐组合 B" | 调专家团（架构/安全/验收三名专家）并行评审，主理人独立核验官方文档后汇总 | 风险清单 + 放行条件 + 验收清单（见 §4/§6） |
| ④ 执行 | "按推荐来，你可以自己调用专家或专家团" | 执行 P0→P2，边做边测 | 7 次提交、44 个测试、线上部署 |
| ⑤ 排障 | 用户实操 `npm run deploy` 报错 | 修构建临时目录竞态 + 配置重复 D1 绑定，替他完成部署 | 上线 + G9 验证通过 |
| ⑥ 加固 | "继续" | P2(2/2)：登录 CSRF 绑定、CSP/安全头、默认关闭鉴权、Cron | 线上版本 `324cfeba` |
| ⑦ 交接 | 本文档 | 整理全部发现与操作 | `docs/HANDOFF.md`（本文件） |

---

## 3. 决策记录（D-1..D-7，含理由与被推翻条件）

| # | 决策 | 理由 | 被推翻条件 |
|---|---|---|---|
| **D-1** | **单源单部署单元**：Workers + Static Assets（`run_worker_first: ["/api/*"]`）。**否决**"pages.dev 前端 + 独立 workers.dev 后端" | 三条独立证据同时要求同源：① `trpc.tsx` 相对路径 `/api/trpc` + `credentials:"include"`；② 会话 cookie `SameSite=Lax`；③ `AudioEngine` 的 `crossOrigin='anonymous'` + `AnalyserNode`（跨源则频谱恒 0） | 除非接受重建会话机制（`SameSite=None`+CORS+CSRF Token）并重解频谱 |
| **D-2** | **保留 `node:crypto`**，不迁 WebCrypto；用 `nodejs_compat` | 官方文档核验：`node:crypto` 除 generateKeyPair(DSA/DH)/argon2/ed448/x448/FIPS 外**全量支持**。省掉整条异步化工作流与"无填充 RSA 无 WebCrypto 原语"困境 | 实测 `createCipheriv` 异常（已实测正常） |
| **D-3** | **安全加固纳入首发**：网易云 cookie 用 AES-GCM 加密落库；session token 只存 SHA-256 | 安全专家定论"当一次安全加固窗口，而非纯搬家" | — |
| **D-4** | 回滚 = 全员重新扫码（D-3 的代价），写入文档接受 | 无存量线上会话 | 出现需保留旧会话的线上流量 |
| **D-5** | 静态资源走 Static Assets（免费不限量），**不用** catch-all `_redirects` 做 SPA fallback | catch-all 会遮蔽 `/api/*` 返回 HTML（superjson 直接崩）；免费档 `run_worker_first` 超额返回 429 而非回落静态 | — |
| **D-6** | `qrcode` 改 `QRCode.toString({type:"svg"})` + 自行转 data URL | **实测确证**：`qrcode` 的 package.json `browser` 字段把入口映射到 `lib/browser.js`，其 `toDataURL` 绑定 CanvasRenderer（需 DOM）→ Worker 无 DOM 必挂；同文件 `toString` 走纯字符串 SVG 渲染器 | 无（已实测可行） |
| **D-7** | zod 升到 **≥4.5.0**（实际 `^4.6.5`） | 官方内存页要求 Workers 上用 zod ≥4.5.0（更早版本每个 schema 占用显著更多内存），免费档 isolate 仅 128 MB | — |

---

## 4. 代码改动清单（逐文件）

### 新增

| 文件 | 作用 |
|---|---|
| `app/scripts/run.mjs` | **所有 npm 脚本的统一入口**：把 `TEMP/TMP/TMPDIR` 指向项目内 `.tmp/`、把 `WRANGLER_LOG_PATH` 指到 `.tmp/wrangler-logs`、把 `node_modules/.bin` 注入 PATH、Windows 下自行转义参数。根因见 §8 陷阱 2/3/12 |
| `app/wrangler.jsonc` | 单源部署配置：`main=api/boot.ts`、`compatibility_flags:["nodejs_compat"]`、`assets`（`directory`/`run_worker_first`/`not_found_handling`）、`triggers.crons`、`d1_databases`（binding `DB`）、`observability` |
| `app/tsconfig.worker.json` | API 层编译目标（`types:["node"]` + `worker-configuration.d.ts` 提供 Workers 运行时类型） |
| `app/worker-configuration.d.ts` | `wrangler types` 生成（含 workerd 运行时类型 + 由 wrangler.jsonc 推导的 `Env`）。**改动 wrangler.jsonc 后必须重新生成** |
| `app/api/lib/proxyToken.ts` | 音频代理 HMAC 短时效签名（TTL 6h；`signAudioToken`/`verifyAudioToken`/`buildProxyUrl`/`hmacSign`/`constantTimeEqual`） |
| `app/api/lib/loginBind.ts` | 扫码登录浏览器绑定 `qr_bind`（H2：阻断跨站登录 CSRF/会话注入） |
| `app/api/lib/cookies.ts` | 统一 cookie 解析（畸形百分号不抛错） |
| `app/api/__golden__/weapiVector.ts` | weapi 黄金向量常量（固化真实实现输出的字节） |
| `app/api/neteaseClient.test.ts` | 13 例：weapi 加密回归（黄金向量/回环解密/中文负载/随机密钥形态） |
| `app/api/neteaseSession.test.ts` | 13 例：token 哈希、AES-GCM 加解密、篡改检测、Set-Cookie 属性、畸形 cookie |
| `app/api/proxyToken.test.ts` | 9 例：签名/过期/篡改 id/篡改 exp/换密钥/URL 回解 |
| `app/api/loginBind.test.ts` | 9 例：绑定签名、跨站无 cookie 被拒、key 不匹配被拒、cookie 属性 |
| `app/public/_headers` | 静态资源安全响应头 + 完整 CSP（放行 Google Fonts 与内联样式） |
| `app/db/migrations/0000_init_netease_sessions.sql` | **D1 首次迁移**（由 drizzle-kit 重新生成，7 列，毫秒时间戳） |
| `docs/cloudflare-migration.md` | 迁移决策记录 + 免费档硬边界 + P0/P1/P2 状态 + **验证矩阵 V1–V24** |
| `docs/HANDOFF.md` | 本文件 |

### 修改

| 文件 | 改动 |
|---|---|
| `app/api/boot.ts` | 从"node-server 入口"改为**纯 Workers 入口**：安全响应头中间件、音频代理（**先验签再做 weapi** + `Sec-Fetch-Site` 校验 + 无 Range 时限 8 MiB 分片 + HEAD 短路 + 不通传 `content-length` 当有 `content-encoding` + 删 `ACAO:*`）、tRPC 挂载（注入 env）、`/api/*` JSON 404、默认导出增加 `scheduled`（Cron） |
| `app/api/context.ts` | `createContext` → **闭包工厂** `createContextFactory(env)`，注入 `db`/`cookieKey`/`proxyKey`（tRPC 签名本身拿不到 `c.env`） |
| `app/api/middleware.ts` | 新增 **`protectedQuery`**（默认失败关闭，会话挂 `ctx.session`）；公开 procedure 必须显式声明 |
| `app/api/neteaseRouter.ts` | `qrcodeCreate` 改 SVG + 签发 `qr_bind`；`qrcodeCheck` 先验绑定；`myPlaylists`/`playlistTracks` 改 `protectedQuery`；`songUrl` 返回**签名后的 proxyUrl**；`key`/`keyword` 加上限；删除手工 `requireNeteaseSession` |
| `app/api/neteaseSession.ts` | 全面重写：**AES-GCM 加密 cookie 落库**、**token 只存 SHA-256**、`getSession(db, cookieKey, req)`、**无条件 `Secure`**、去 `NODE_ENV` 依赖、`purgeExpiredSessions()`、cookie 解析走 `lib/cookies` |
| `app/api/queries/connection.ts` | mysql2 单例 → **`drizzle-orm/d1` 按请求工厂** `createDb(env.DB)`（禁止模块级缓存请求相关状态） |
| `app/api/lib/env.ts` | 删 `dotenv` 与 `APP_ID/APP_SECRET/DATABASE_URL` 死配置 → **`Bindings` 类型 + `requireBindings()` 启动即校验** |
| `app/api/neteaseClient.ts` | 加密原语加 `export`（仅用于测试）；`weapiEncrypt` 支持注入 secretKey 以产出确定性黄金向量；**实现本身未改** |
| `app/db/schema.ts` | `mysql-core` → `sqlite-core`；**`token_hash` 主键**、`netease_cookie` 存密文、两列时间统一 `{mode:"timestamp_ms"}`、`created_at` 显式 `(unixepoch()*1000)` |
| `app/drizzle.config.ts` | `dialect: "sqlite"`，去 `dotenv`/`DATABASE_URL` |
| `app/db/seed.ts` | MySQL 播种桩 → D1 说明（`wrangler d1 execute --file`） |
| `app/package.json` | 脚本全面改造（`dev:worker`/`build`/`deploy`/`db:apply:local|remote`/`cf-typegen`），全部经 `scripts/run.mjs`；`zod → ^4.6.5`；新增 devDeps `wrangler`、移除 `@cloudflare/workers-types` |
| `app/tsconfig.json` / `tsconfig.app.json` | 引用 `tsconfig.worker.json`；app 侧 include `worker-configuration.d.ts`（因为前端类型图经 `AppRouter` 拉入 api/） |
| `app/vitest.config.ts` | 补 `@db` alias |
| `app/src/components/NeteasePanel.tsx` | 扫码轮询 2s → **3s 且最多 60s**（省免费档请求配额） |
| `app/.env.example` | 重写为 wrangler secret 说明（原文错误的 MySQL/JWT 描述已删） |
| `app/.gitignore` | 取消忽略 `db/migrations/*.sql`（迁移须入库）；新增忽略 `.dev.vars*`、`.wrangler/`、`.cloudflare/` |
| 根 `.gitignore` / `.gitattributes` | 忽略 DSH 工具产物与 `.tmp/`/`.npm-cache/`；统一 LF |
| `app/package-lock.json` | **137 个内网镜像 tarball 地址归一化到 `registry.npmjs.org`**（原地址 `npm.mirrors.msh.team` 不可达，任何 CI 都装不上） |

### 删除

| 文件 | 原因 |
|---|---|
| `app/api/lib/vite.ts` | `node:fs`/`node:path`/serve-static —— Worker 不能用（**删除而非 shim**） |
| `app/api/lib/http.ts` | 全仓无引用（死代码） |
| `app/db/relations.ts` | 改用 D1 后不再使用关系查询 API |
| `app/tsconfig.server.json` | 被 `tsconfig.worker.json` 取代 |

---

## 5. 提交历史

| 提交 | 内容 |
|---|---|
| `67dc8c8` | baseline：迁移前快照 + 仓库治理（可整体回滚的锚点） |
| `4b30633` | P0-2/P0-3/P0-4：首次构建成功 + weapi 黄金向量回归网 + Worker 目标静态预演 |
| `fa6a09b` | P1：全栈落到 Workers + Static Assets + D1（含 H1 加固） |
| `749d999` | P2(1/2)：音频代理签名令牌 |
| `afe7662` | P3：完成生产部署 + 线上验证；修构建临时目录竞态与包装器引号缺陷 |
| `386cee0` | P2(2/2)：登录 CSRF 绑定、CSP/安全头、默认关闭鉴权、Cron 清理 |
| `a43f32b` | docs：补 V24（无头浏览器渲染验证） |
| `a1ae6df` | docs：新增跨对话交接文档 HANDOFF.md（并据实测补 V25） |
| `7c80af4` | fix：run.mjs 注入 `WRANGLER_LOG_PATH`——修掉沙箱内 wrangler 因日志写入被拒而退出码为 1 的假失败（§8 陷阱 12） |
| `2971ff4` | fix：Vite dev 改 `/api` 代理到 8787——修复本地全栈开发绑定全丢（§8 陷阱 10） |
| `a40d94d` | ci：GitHub Actions 工作流（检查/测试/构建 + 门控部署 Cloudflare Workers）；仓库推送至 GitHub |

---

## 6. 验证矩阵（V1–V27，全部实际执行过）

| # | 检查 | 命令/方法 | 结果 |
|---|---|---|---|
| V1 | 类型检查 | `tsc -b` | ✅ exit 0（前端 + Worker 双目标） |
| V2/V13/V19 | 回归测试 | `vitest run` | ✅ **44/44**（weapi 13 + 会话 13 + 代理令牌 9 + 登录绑定 9） |
| V3 | 前端构建 | `vite build` | ✅ 1052 kB JS / 292 kB gzip |
| V4 | Worker 打包 | `wrangler deploy --dry-run` | ✅ gzip 216.88 KiB（早期）→ 线上 218.87 KiB |
| V5 | **G6 残留扫描** | grep bundle | ✅ `mysql2/dotenv/@hono/node-server/import.meta.dirname/node:fs/node:path/node:net/node:tls/serve-static` **全 0** |
| V6 | D1 迁移（本地） | `wrangler d1 migrations apply DB --local` | ✅ 表结构含毫秒默认值 |
| V7 | 本地冒烟 | `wrangler dev` + curl | ✅ health/ping/me/proxy-400/JSON-404/静态首页 全部符合预期 |
| V8 | **二维码在无 DOM Worker 可用**（A-03/R6 判定点） | curl `qrcodeCreate` | ✅ 真实 unikey + `data:image/svg+xml;base64`（3226 字符） |
| V9 | 会话全链路 | 注入会话行 + curl 带 cookie | ✅ 有效→`loggedIn:true`；过期→`false`；畸形 `%`→200 不 500 |
| V10 | 库内数据形态 | `node:sqlite` 直读本地库 | ✅ cookie 为 97 字符密文；过期行被懒清理；`created_at` 毫秒语义正确（无 1970） |
| V11 | 代理验签 | curl | ✅ 无签名 403 `missing token`；伪造 403 `bad signature`；cross-site 403 |
| V12 | 代理取流 + 分片上限 | curl | ✅ **206 + 8388608 字节**（8 MiB 精确生效）+ 真实 MP3 |
| V14 | **生产部署** | `npm run deploy` | ✅ Worker gzip 217.84 KiB、startup 23 ms、6 资产上传 |
| V15 | **G9 网易云从 CF 边缘出口可达**（最大未知项） | 线上 curl `qrcodeCreate` | ✅ 真实 unikey + SVG 二维码 → weapi 从 CF 出口完全可用 |
| V16 | 线上匿名搜索 | 线上 curl `searchSongs` | ✅ 200，返回真实《稻香》结果 |
| V17 | 线上路由/安全 | 线上 curl | ✅ health ok、`/api/nope` JSON 404、`/summary/` 200、代理无签名 403 |
| V18 | **G5 免费档 CPU**（`wrangler tail`） | 生产采样 | ⚠️ **全程无 1102**；health 2 / me 11 / qrcodeCreate 101 / searchSongs 82 / songUrl 123（**单位 ms**，已用 wallTime 与 curl 耗时交叉确认）。高于文档 10 ms 名义值但被容忍 → **持续观察项** |
| V20 | 登录绑定 | 生产 curl（cookie jar） | ✅ 下发 `qr_bind=…;HttpOnly;SameSite=Lax;Secure;Max-Age=600`；无 cookie 被拒；key 不匹配被拒；带匹配 cookie → 网易云真实 `801 waiting` |
| V21 | 安全头/CSP | 生产 curl -D | ✅ API 侧 HSTS/nosniff/Referrer-Policy/X-Frame-Options/CORP；静态侧额外完整 CSP + Permissions-Policy |
| V22 | 默认关闭鉴权 | 生产 curl | ✅ 未登录 `myPlaylists` → `UNAUTHORIZED` 401 |
| V23 | Cron/部署形态 | 部署输出 | ✅ `schedule: 23 4 * * *` 已注册；代理回归 403 |
| V24 | **CSP 是否打死前端** | 无头 Edge `--dump-dom` | ✅ `#root` 已挂载、`canvas` 存在（three.js 已初始化）、面板文案已渲染 → CSP 未阻断资源 |
| V25 | Vite dev 下的 API 行为（交接前补测） | `npm run dev` + curl | ⚠️ `/api/health` 返回 `{"ok":false,"storage":false,"key":false}` —— **Vite dev 的 `/api/*` 没有绑定**（`@hono/vite-dev-server` 不传 `env`）。已写入 §8 陷阱 10；该修法已于 2026-10-04 实施（见 V26） |
| V26 | 本地双服务代理（陷阱 10 修复后） | `npm run dev:worker` + `npm run dev` 双后台 + curl | ✅ `localhost:3000/api/health` → `{"ok":true,"storage":true,"key":true}`；`/api/proxy/audio` 无签名 403、`/api/nope` JSON 404 均经 Vite 代理正确透传（修复前 health 全 false） |
| V27 | **GitHub Actions CI 端到端** | 共 3 次运行：push 首跑 / 手动触发 / 推送文档再触发 | ✅ verify 32–39s 全绿；deploy 25–32s 实发成功（首版 `8ddf40c7`，gzip 218.87 KiB / startup 21 ms）；未配 token 时 deploy 正确跳过并打 notice |

---

## 7. 官方事实与依据（本会话亲自 web_fetch 核验）

| 事实 | 来源 |
|---|---|
| Workers Free：**100,000 请求/天、CPU 10 ms/请求**、内存 128 MB、子请求 50、并发出站 6、体积 64 MiB、启动 1 s、**Cron Triggers 5 个/账号** | `developers.cloudflare.com/workers/platform/limits/` |
| `node:crypto` **全量支持**（例外：generateKeyPair DSA/DH、argon2、ed448/x448、FIPS）；兼容日期 ≥2026-08-04 时 `nodejs_compat` 默认开启 | `.../workers/runtime-apis/nodejs/crypto/` |
| 静态资源请求**免费且不限量**；免费档用 `run_worker_first` 超额时返回 **429 而非回落静态** | `.../workers/static-assets/billing-and-limitations/` |
| zod 需 **≥4.5.0**（更早版本内存显著更高） | Workers 内存限制页 |
| D1 Free：10 库、账号 5 GB、Time Travel **7 天**、**50 查询/Worker 调用**、单库单线程；**每库上限表格写 500 MB，同页 FAQ 写 10 GB（官方自相矛盾，以控制台为准）** | `.../d1/platform/limits/` |
| Pages Free（备选路径）：500 构建/月、20,000 文件、25 MiB/文件、`_redirects` 2,100、`_headers` 100 条 | `.../pages/platform/limits/` |

---

## 8. 环境陷阱与解法（**本机特有，新对话最容易踩**）

1. **`package-lock.json` 里的内网镜像**：137 个 tarball 指向 `npm.mirrors.msh.team`（ECONNRESET）。已归一化到 `registry.npmjs.org`。若重新生成 lockfile，l'hôte 可能又被写回内网地址。
2. **npm 生命周期脚本被拦**：esbuild 的 postinstall 走 `child_process.spawn` + 管道 → `EPERM`。**安装用 `npm ci --ignore-scripts`**（`@esbuild/win32-x64` 作为 optionalDependency 会正常落盘）。
3. **esbuild 服务进程需要命名管道**：vite/vitest 的 JS API 以管道启动 esbuild → 受限模式下 `spawn EPERM`；esbuild **CLI**（继承 stdio）不受影响。这是本项目内一条可复用规律。
4. **系统 `%TEMP%` 会拒绝删除**：esbuild 写 `%TEMP%\esbuild-*` 后立即删除 → `Access is denied`（占用式拒绝/ACL 残留）。**解法：所有命令走 `app/scripts/run.mjs`**（TEMP 指到项目内 `.tmp/`）。用户实测 `npm run deploy` 报错即此原因。
5. **workerd 起不来**：`wrangler dev` / `d1 execute` 偶发 `CreateDirectory: #5 拒绝访问; path = miniflare-email-store`。**解法：经 `scripts/run.mjs` 启动**（TEMP 重定向后正常）。若仍失败，可用 **Node 24 内置 `node:sqlite` 直读** `.wrangler/state/v3/d1/**/*.sqlite`（V10 即此法）。
6. **PowerShell 的 `Invoke-WebRequest -Headers @{Cookie=…}` 不会真正发出 Cookie 头** → 冒烟测试**必须用 `curl.exe -H "Cookie: …"` 或 `-b jar`**（曾因此误判为"会话读不回来"，实际是测试方法问题）。
7. **`wrangler d1 create` 会偷偷往 wrangler.jsonc 追加第二个 D1 绑定**（会与代码用的 `DB` 冲突）→ 必须删掉重复条目。
8. **`_headers` 语法**：只支持 `#` 注释，`/* */` 会被当成路径模式导致部署失败（`Invalid _headers configuration`）。
9. **`wrangler types` 生成物必须与 wrangler.jsonc 同步**；改了绑定/配置要重跑 `npm run cf-typegen`，否则类型与配置漂移。
10. **Vite dev（3000）曾丢绑定** —— **已修复**：原 `@hono/vite-dev-server` 调 `app.fetch()` 不传 Worker `env`，`/api/health` 曾返回 `{"ok":false,"storage":false,"key":false}`。现 `vite.config.ts` 已去掉该插件，改为 `server.proxy`：`/api/* → http://127.0.0.1:8787`。
   → **本地全栈开发 = 两个终端**：先 `npm run dev:worker`（8787：绑定 + 本地 D1 + secrets），再 `npm run dev`（3000：前端 HMR）。已实测 `localhost:3000/api/health` 返回 `{"ok":true,"storage":true,"key":true}`，且 `/api/proxy/audio` 403、`/api/nope` JSON 404 均经代理正确透传。
   → 只跑 `npm run dev` 而 8787 未启动时，`/api/*` 会因代理目标不可达而报错（预期行为，不是 bug）。
11. **`localhost` vs `127.0.0.1`**：Vite/部分工具默认只绑 `localhost`（IPv6 `::1`），用 `127.0.0.1` 访问会得到 `HTTP 000`。冒烟时优先用 `localhost`。
12. **沙箱内 wrangler 写日志被拒 → exit 1（后果其实已成功）**：wrangler 启动时会先写调试日志到 `%APPDATA%\xdg.config\.wrangler\logs\`（源码默认值 `getGlobalConfigPath()/logs`，**与 TEMP 无关**，所以 `scripts/run.mjs` 的临时目录重定向管不到它）。TRAE 沙箱拒绝写该路径 → 打印 `X [ERROR] Failed to write to log file … EPERM` 加 `TRAE Sandbox Error`；**命令的真实输出完整有效，但进程以 exit 1 结束** —— 这是纯日志文件问题，不是命令失败，却会让 `&&` 链/脚本误判。
   → **解法（已实测并已固化）**：`scripts/run.mjs` 已统一注入 `WRANGLER_LOG_PATH` 到项目内 `.tmp/wrangler-logs`（与 TEMP 重定向同处），凡经它启动的 wrangler 命令日志正常落地、exit 0（wrangler 用它作日志目录，默认才是全局配置目录）。手工等效：`$env:WRANGLER_LOG_PATH = "<app>\.tmp\wrangler-logs"`。
   → 备选：沙箱外执行该命令，或在 TRAE「设置 → 权限与审批 → 自定义配置」放行该目录。
13. **推送到 GitHub（github.com）需两件套：代理 + 集成 token**：① `github.com` 的 TLS 在本网络被干扰（TCP 能连、握手被打断；对照 `api.github.com` 完全正常）→ 推送必须走本机代理 `http://127.0.0.1:7900`（实测 7890/7897 不通、7900 通）；② keyring 里的 OAuth token 缺 `workflow` 作用域，推 `.github/workflows/*` 会被拒（`refusing to allow an OAuth App to create or update workflow`），而 TRAE 注入的 `GH_TOKEN`（集成 App token，`ghu_` 前缀）对新仓库有 admin/push 且**可以写 workflow 文件**（实测全量推送成功）。
   → **可用推送命令（本机实测成功）**：`git -c "http.proxy=http://127.0.0.1:7900" -c "https.proxy=http://127.0.0.1:7900" -c credential.helper= -c "credential.helper=!gh auth git-credential" push -u origin master`（保持 `GH_TOKEN` 在环境中 → 用集成 token；若清空 `GH_TOKEN` 会退回 keyring token，推含 workflow 的提交会被拒）。
   → 备选：给 keyring OAuth 账号补作用域 `gh auth refresh -h github.com -s workflow`（需浏览器设备码确认）。
   → 另注意：`gh repo create` 用集成 token 会报 `Resource not accessible by integration` —— 把 `$env:GH_TOKEN` 清空后用 keyring token 创建即可。

---

## 9. 尚未验证 / 剩余风险

| 项 | 说明 |
|---|---|
| **真人扫码登录** | 接口层已验证（801/错误分支/D1 读写/加密解密），但**没人用手机真扫过**。这是唯一需要人工的验证 |
| **播放 + 频谱 + 拖动 seek** | 逻辑与代理已验证（206 + 8 MiB + MP3 字节），但没在浏览器里听过 |
| **iOS/Safari 兼容** | `AudioContext` 手势要求、`crossOrigin` + Range 行为未实测 |
| **G5 CPU 持续观察** | 102–123 ms 峰值高于文档 10 ms 名义值却未被拒（isolate 弹性）；若流量增大出现 `1102`，瘦身顺序：① `songUrl`/`lyric` 加平台缓存 ② 二维码改前端渲染（需与 H2 绑定一起评估）③ weapi 链路去 zod |
| **`workers.dev` 在墙内可达性** | 大陆访问常被干扰；要面向墙内用户需绑自定义域名 |
| **未做（非阻断）** | 结构化审计日志、上游错误文案收敛、`chart.tsx` 的 `dangerouslySetInnerHTML`（静态输入）、会话滑动续期/批量撤销 |

---

## 10. 操作手册（新对话接手必读）

### 必用命令（**不要绕过 `scripts/run.mjs`**）

```powershell
cd E:\AIwork\Kimi_Agent\app

npm run check        # tsc -b（前端 + Worker 双目标）
npm run test         # vitest，应为 44/44
npm run build        # vite build → dist/public
npm run dev          # 前端 HMR（/api/* 由 Vite 代理转发到 8787，需先起 dev:worker → 见 §8 陷阱 10）
npm run dev:worker   # ★ 全栈本地开发用这个：Worker + 本地 D1 + secrets，端口 8787
npm run deploy       # 构建 + 发布（幂等，可反复执行）
npm run cf-typegen   # 改过 wrangler.jsonc 后必须跑
npm run db:apply:local / db:apply:remote   # 应用 D1 迁移
npm run db:generate  # 改过 db/schema.ts 后生成迁移
```

### 直接调 wrangler（需要带引号参数时，避免 shell 拆参数）

```powershell
node scripts/run.mjs wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM netease_sessions"
node scripts/run.mjs wrangler tail guanglu-lyric --format json     # 看 CPU/错误（G5）
```

### 推送代码到 GitHub（本机必须带代理与集成 token，详见 §8 陷阱 13）

```powershell
git -c "http.proxy=http://127.0.0.1:7900" -c "https.proxy=http://127.0.0.1:7900" -c credential.helper= -c "credential.helper=!gh auth git-credential" push
```

### 回滚

- **代码**：`git revert <commit>` 或 checkout 到任意提交；CF 侧可在 dashboard 回退到上一版本（历史版本可见）。
- **数据**：D1 Time Travel（免费档 **7 天**）`wrangler d1 time-travel`；或 `wrangler d1 export` 备份。
- **注意**：D-3 上线后，回滚代码会导致旧版本读不到新格式会话 → 等价于"全员重新扫码"（已接受）。

### 密钥位置（**不要提交、不要打印**）

- 生产：CF 侧 `wrangler secret`（`COOKIE_ENC_KEY`、`PROXY_SIGN_KEY`）
- 本地 dev：`app/.dev.vars`（已 gitignore）

### 当前 npm 依赖要点

- `wrangler ^4.147.0`（devDep）、`zod ^4.6.5`、`drizzle-orm 0.45` + `drizzle-kit`
- 已移除 `@cloudflare/workers-types`（被 `wrangler types` 生成物取代）
- **不再被服务端代码使用**：`mysql2`、`dotenv`（代码引用已全部删除，bundle 扫描为 0）
- `@hono/node-server` 仍在 `dependencies`，但只被 `@hono/vite-dev-server`（devDep）在本地 dev 时使用；生产 Worker 不再引用它（bundle 扫描为 0）

### 本地 dev 现状（已实测）

| 命令 | 端口 | 能做什么 | 不能做什么 |
|---|---|---|---|
| `npm run dev:worker` | 8787 | ★ 全栈：绑定 + 本地 D1 + secrets + 真实 Worker 运行时 | 前端无 HMR（静态产物来自 `dist/public`，改前端要看 `dist`） |
| `npm run dev` | 3000 | 前端 HMR；`/api/*` 经代理转发到 8787（**需先起 `dev:worker`**） | 单独跑时 `/api/*` 因代理目标不可达而报错 |

---

## 11. 新对话建议的接手顺序

1. 读 `docs/cloudflare-migration.md`（决策 + 免费档边界 + **V1–V24 验证矩阵**）。
2. 读 `app/api/boot.ts` + `app/api/lib/env.ts` + `app/wrangler.jsonc`（运行时入口与绑定契约）。
3. 读 `app/api/neteaseSession.ts` + `app/api/lib/proxyToken.ts` + `app/api/lib/loginBind.ts`（三条安全主线）。
4. 跑一遍 `npm run check && npm run test`，确认 44/44 与 tsc 绿（这是"当前基线"）。
5. 若要做功能迭代：**先跑 `npm run dev:worker` + `npm run dev`（双终端，见 §8 陷阱 10）**，改完再 `npm run deploy`。
6. 若遇到构建/运行报错：**优先查 §8 的 13 条陷阱**，尤其"是否忘了走 `scripts/run.mjs`"。

---

## 12. 收尾进展（按价值排序）

1. **GitHub CI —— ✅ 已完成（2026-10-04）**：仓库 `https://github.com/SWBX29/guanglu-lyric`（Public）；工作流 `.github/workflows/ci.yml`：
   - `verify`（push / PR / 手动）：`npm ci --ignore-scripts` → `tsc -b` → 44 测试 → `vite build` → `wrangler deploy --dry-run`；实测 **38–39s 全绿**。
   - `deploy`（仅 master push / 手动触发；门控在 `CLOUDFLARE_API_TOKEN` 是否存在，缺失时打 notice 跳过）：`npm run deploy`；实测 **32s 发布成功**（版本 `8ddf40c7`）。
   - Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 均已配置。**校验 token 要用账户级端点** `GET /client/v4/accounts/<id>/tokens/verify`（`/user/tokens/verify` 对账户 token 会误报 Invalid，别被误导）。
   - 本机 git push 的特殊要求见 §8 陷阱 13（走代理 + 用集成 token），命令见 §10。
2. **自定义域名**：解决墙内可达性（本网络实测 workers.dev 边缘 IP 被黑洞）；需用户提供域名（Cloudflare 免费支持，配置为 `wrangler.jsonc` 的 `routes` 或 dashboard 绑定）。
3. **审计日志**：会话建/毁、扫码成功、代理滥用四类事件结构化记录（D1 写入行数需留意免费额度，只记事件与哈希，不记 cookie）。
