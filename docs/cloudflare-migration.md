# Cloudflare 迁移决策记录（组合 B）

状态：**已决策，执行中** ｜ 决策人：用户（"按推荐来"）｜ 依据：技术方案评审团 task-1/2/3 + 主理人官方文档核验
基线提交：`67dc8c8`（迁移前快照，可用于整体回滚）

---

## 1. 已锁定的决策

| # | 决策 | 理由 | 被推翻的条件 |
|---|---|---|---|
| **D-1** | **单源单部署单元**：`Workers + Static Assets`（`assets` binding + `run_worker_first: ["/api/*"]`）。前端静态资源与 `/api/*` 同源同单元。**否决**"pages.dev 前端 + 独立 workers.dev 后端" | 三条独立证据同时要求同源：① [trpc.tsx](../app/src/providers/trpc.tsx) 相对路径 `/api/trpc` + `credentials:"include"`；② [neteaseSession.ts](../app/api/neteaseSession.ts) `SameSite=Lax`；③ [AudioEngine.ts](../app/src/audio/AudioEngine.ts) `crossOrigin='anonymous'` + `AnalyserNode`（跨源则频谱恒 0）。三方成员独立收敛 | 无。除非接受重建会话机制（`SameSite=None` + CORS 白名单 + CSRF Token + 重解频谱） |
| **D-2** | **保留 `node:crypto`**（`createCipheriv('aes-128-cbc')` + `randomBytes`），不迁 WebCrypto；通过兼容标志启用 | 官方文档核验：*"All `node:crypto` APIs are fully supported in Workers"*，例外仅 generateKeyPair(DSA/DH)/argon2/ed448/x448/FIPS。**取消整条 WebCrypto 工作流**（连带取消 `subtle` 异步化传染与"无填充 RSA 无对应原语"困境） | `wrangler dev` 实测 `createCipheriv` 行为异常 |
| **D-3** | **安全加固纳入首发**（H1）：`netease_cookie` AES-GCM 加密、session token 只存 SHA-256 | 安全侧定论"当作一次安全加固窗口而非纯搬家"；项目尚无线上用户 | — |
| **D-4** | 回滚 = **全员重新扫码**（D-3 的代价），写入文档接受 | 无存量线上会话；比"数据库快照泄露即账号接管"的窗口期更划算 | 若出现需保留旧会话的线上流量 |
| **D-5** | 静态资源经由 **Static Assets**（免费且请求不限量），**不使用** catch-all `_redirects` 做 SPA fallback | catch-all 会遮蔽 `/api/*` 返回 HTML（`superjson` 直接崩）；免费档 `run_worker_first` 超额返回 429 而非回落静态，故 `/api/*` 必须精确限定 | — |
| **D-6** | `qrcode`：先探针实测打包入口；若走 browser 入口或 CPU 超限 → 改 `QRCode.toString(type:"svg")`，**契约字段 `qrDataUrl` 不变** | 架构 R6 / 验收 A-03 独立同结论；契约零 diff 是硬约束 | 探针显示 PNG 路径可用且 CPU 有余量（可保留 PNG，但 SVG 仍更省） |
| **D-7** | zod 升级到 **≥ 4.5.0**（lockfile 现锁 4.3.5） | 官方内存限制页要求 Workers 上使用 zod ≥ 4.5.0（更早版本每个 schema 占用显著更多内存），而免费档 isolate 仅 128 MB | — |

---

## 2. 免费档硬边界（官方当日核验，来源见文末）

| 项 | Free 上限 | 本项目判定 |
|---|---|---|
| Workers 请求 | 100,000/天 | **主闸门之一**（音频代理 Range 请求是主要消耗方） |
| Workers CPU | **10 ms/请求** | **真正的闸门**。官方原文：鉴权类较重负载通常 10–20 ms |
| Workers 其它 | 内存 128 MB、50 子请求/请求、6 并发出站、体积 64 MiB、启动 1 s | 够用；server bundle 需瘦身（不得打包前端依赖） |
| Cron Triggers | **5 个/账号（免费可用）** | 可用于会话懒清理 |
| D1 | 10 库、账号 5 GB、Time Travel **7 天**、**50 查询/Worker 调用**、单库单线程 | 不触限（每会话 1 读 1 写）。**每库上限官方表格 500 MB 与同页 FAQ 10 GB 冲突** → 以控制台为准 |
| 静态资源 | 请求**免费不限量** | 前端流量不吃 Workers 配额 |
| Pages（若改走 Pages） | 500 构建/月、20,000 文件、25 MiB/文件、`_redirects` 2,100、`_headers` 100 | 备选路径 |

---

## 3. 执行顺序（P0 → P1 → P2）

### P0 · 前置（不依赖迁移决策，先做）
- [x] **P0-1** `git init` + 基线提交 `67dc8c8`；`.gitignore` 治理（取消忽略 `db/migrations/*.sql`、忽略 `.dev.vars*`/`.wrangler/`/`.cloudflare/`/`.tmp/`/`.npm-cache/`）；新增 `.gitattributes` 统一 LF
- [x] **P0-2** 建立**迁移前**绿色基线（此前该工程从未构建过）：
  - `tsc -b` → **exit 0，零类型错误**
  - `vite build` → **exit 0**，20.2s，产出 `dist/public/index.html` + `assets/index-*.js` 1052 kB（gzip 292 kB）+ `assets/index-*.css` 91.7 kB + `summary/*`
  - `esbuild api/boot.ts --platform=node --bundle` → **exit 0**，`dist/boot.js` 2.44 MB（node 目标产物，迁移后重做）
- [x] **P0-3** weapi 黄金向量回归网：新增 [api/neteaseClient.test.ts](../app/api/neteaseClient.test.ts) + [api/__golden__/weapiVector.ts](../app/api/__golden__/weapiVector.ts)；`vitest run` → **13/13 通过**（此前 `npm test` 必定失败：零测试文件）；顺带补 [vitest.config.ts](../app/vitest.config.ts) 缺失的 `@db` alias（架构 R16）
  - **P0-3 实测结论**：`rsaEncrypt` 用 `padStart(256)`（跟随参考实现 `zfill(256)` 惯例），而 2048-bit 密文的十六进制长度为 511~512 位 → `encSecKey` 长度在 **256–512 间浮动**（实测 511/510）。上游以 `BigInt('0x'+…)` 解析，前导零不参与数值，**功能等价**；但该语义已写进测试注释与断言，防止迁移时被"顺手改成 512"当作修 bug。
- [x] **P0-4（静态预演，无需 CF 账号）** 以 worker 语义打包 `api/boot.ts`（`--platform=browser --external:node:*`）：
  - **`qrcode` 必挂（确证，非假设）**：`qrcode/package.json` 的 `"browser": {"./lib/index.js": "./lib/browser.js"}` 使 wrangler 的 browser 目标解析到 `lib/browser.js`，其中 `toDataURL = CanvasRenderer.renderToDataURL`（需真实 DOM canvas）→ Worker 无 DOM → **扫码登录面板整体不可用**。同一文件 `toString` 走 `SvgRenderer`（纯字符串）→ **改用 `QRCode.toString(type:"svg")` 是确定可行的修法**（D-6 从"待探针"升级为"确定要改"）。
  - **Node-only 依赖被实测证实**：报错定位到 `api/lib/vite.ts:4 fs`、`api/lib/vite.ts:5 path`、`api/neteaseSession.ts:5 crypto`（裸 specifier）、以及 mysql2 引入的 `http`（→ 实际为 `node:net`/`node:tls`）。R3/R5 由推断转为事实。
  - 待补：`wrangler dev` 实跑以取得 CPU 实测值与 `/api/*` vs 静态资源的路由命中证据（需安装 wrangler，尚未执行）。

### 环境适配记录（本机执行 P0 时踩到并解决，供 CI/他机复用）
1. **lockfile 不可移植**：`package-lock.json` 中 137 个 tarball 地址指向内网镜像 `npm.mirrors.msh.team`（此处 ECONNRESET）→ 703 个 resolved 地址已全部归一化到 `registry.npmjs.org`（137 行改动，integrity 不变）。
2. **npm 生命周期脚本被沙箱拦住**：esbuild 的 postinstall 走 `child_process.spawn` + 管道 → `EPERM`；`npm ci --ignore-scripts` 可完成安装（`@esbuild/win32-x64` 作为 optionalDependency 正常落盘，二进制可用）。
3. **esbuild 服务进程需要命名管道**：vite/vitest 的 JS API 以管道启动 esbuild 服务 → 受限模式下 `spawn EPERM`；esbuild **CLI**（继承 stdio）不受影响 —— 这是本项目内一条可复用的规律。
4. **临时目录必须落在工作区内**：esbuild 在 `%TEMP%` 写临时文件后删除会被 ACL 拒绝 → 构建前设 `TEMP/TMP=<workspace>/.tmp`。

### P1 · 迁移主体（已完成，全部经本机实跑验证）
1. [x] [db/schema.ts](../app/db/schema.ts) 迁 `sqlite-core`；时间列统一 `{mode:"timestamp_ms"}`，`created_at` 显式 `(unixepoch()*1000)` 默认值
2. [x] [drizzle.config.ts](../app/drizzle.config.ts) → `dialect: "sqlite"`（去 dotenv/DATABASE_URL）；**首次迁移已重新生成**：[db/migrations/0000_init_netease_sessions.sql](../app/db/migrations/0000_init_netease_sessions.sql)
3. [x] [connection.ts](../app/api/queries/connection.ts) → `drizzle-orm/d1` 的**按请求**工厂 `createDb(env.DB)`；[context.ts](../app/api/context.ts) → 闭包工厂注入 `env`；[boot.ts](../app/api/boot.ts) 传入 `c.env`
4. [x] [neteaseSession.ts](../app/api/neteaseSession.ts)：`getSession(db, cookieKey, req)`、**AES-GCM 加密 cookie**、**token 只存 SHA-256**、**无条件 `Secure`**、去 `NODE_ENV`、Cookie 解析 try/catch、`purgeExpiredSessions()` 供 Cron
5. [x] 删除 [api/lib/vite.ts](../app/api/lib/vite.ts) 与 [boot.ts](../app/api/boot.ts) 的 node-server 分支；[lib/env.ts](../app/api/lib/env.ts) 去 dotenv、删死配置，改为 `Bindings` + `requireBindings()` 启动即校验
6. [x] 单源部署配置：[wrangler.jsonc](../app/wrangler.jsonc)（Static Assets + `run_worker_first:["/api/*"]` + `not_found_handling: single-page-application` + `nodejs_compat` + D1 binding + `migrations_dir`）；[package.json](../app/package.json) 脚本改造（`dev:worker` / `build:worker` / `deploy` / `db:apply:local|remote` / `cf-typegen`）
7. [x] [tsconfig.worker.json](../app/tsconfig.worker.json)（Workers 目标）+ [worker-configuration.d.ts](../app/worker-configuration.d.ts)（由 `wrangler types` 生成；改 wrangler.jsonc 后需重新生成）
8. [x] 音频代理：HEAD 短路、`content-encoding` 时不再透传 `content-length`、**删除 `ACAO:*`**、id 限长
9. [x] zod 升到 `^4.6.5`（≥4.5.0，官方对 Workers 内存的要求）；移除冗余的 `@cloudflare/workers-types`（已被 `wrangler types` 产物取代）

### P2 · 加固与清理
- [x] 音频代理 **HMAC 短时效签名令牌**（D5/B1）：新增 [api/lib/proxyToken.ts](../app/api/lib/proxyToken.ts)；`songUrl` 下发带签名代理地址，代理路由**先验签再做 weapi**；叠加 `Sec-Fetch-Site: cross-site` 拒绝；无 Range 时主动限定 8 MiB 单请求分片（M7）。TTL 取 6 小时（媒体元素整首歌持续发 Range 请求，过短 TTL 会中途断流）
- [ ] 登录绑定 `qr_bind`（H2：跨站 `qrcodeCheck` 可致会话注入）
- [ ] `_headers` 安全头与 CSP（放行 Google Fonts）、`protectedQuery` 中间件（M2）、Cron 会话清理（免费档 5 个/账号）、审计日志（不记 cookie）、前端轮询降频、删 [api/lib/http.ts](../app/api/lib/http.ts) 死代码、`.env.example` 修正（无 JWT）、上游错误文案收敛（L3）

---

## 3.5 验证矩阵（**已执行**，P0+P1）

| # | 检查 | 命令 | 结果 |
|---|---|---|---|
| V1 | 类型检查 | `tsc -b` | ✅ exit 0（前端 + Worker 双目标） |
| V2 | 回归测试 | `vitest run` | ✅ **26/26 通过**（weapi 黄金向量 13 + 会话安全原语 13） |
| V3 | 前端构建 | `vite build` | ✅ 6.9s，`dist/public` 1052 kB JS / 292 kB gzip |
| V4 | Worker 打包 | `wrangler deploy --dry-run` | ✅ 1214.58 KiB / **gzip 216.88 KiB**，bindings: `env.DB` + `env.ENVIRONMENT` |
| V5 | **G6 残留扫描** | grep bundle | ✅ `mysql2 / dotenv / @hono/node-server / import.meta.dirname / node:fs / node:path / node:net / node:tls / serve-static` 全部 **0** |
| V6 | D1 迁移 | `wrangler d1 migrations apply DB --local` | ✅ 1 个迁移应用成功，表结构含毫秒默认值 |
| V7 | 本地冒烟 | `wrangler dev` + curl | ✅ `/api/health`→`{ok:true}`；`trpc.ping`→200；`netease.me`→`loggedIn:false`；`proxy?id=abc`→400；`/api/nope`→JSON 404；`/`→静态 index.html（API 与静态资源同源共存，`run_worker_first` 未遮蔽） |
| V8 | **二维码在无 DOM Worker 中可用**（A-03/R6 判定点） | curl `netease.qrcodeCreate` | ✅ HTTP 200，真实 unikey + `data:image/svg+xml;base64,…`（3226 字符）→ **SVG 路径确证可行** |
| V9 | 会话全链路（D1 读 + AES-GCM 解密） | 注入会话行 + curl 带 cookie | ✅ 有效会话→`{loggedIn:true,userId:"90001",nickname:"e2e-user"}`；过期→`false`；畸形 `%`→HTTP 200（不 500，M3）；无 cookie→`false` |
| V10 | 库内数据形态（H1 + 时间单位） | `node:sqlite` 直读本地库 | ✅ cookie 为 97 字符密文（`iv.ciphertext`）；过期行**已被懒清理**（仅剩 1 行）；`created_at=1791099700382` → `datetime(created_at/1000,'unixepoch')` = `2026-10-04 07:41:40`（无 1970/秒毫秒错配） |
| V11 | 代理验签（B1/D5） | curl 代理端点 | ✅ 无签名→403 `missing token`；伪造签名→403 `bad signature`；有效签名但 `Sec-Fetch-Site: cross-site`→403 `cross-site`；非法 id→400 |
| V12 | 代理取流 + 单请求上限（M7） | curl 有效签名 + 同源 | ✅ HTTP **206**，`size_download=8388608`（8 MiB 上限精确生效），正文为真实 MP3（ID3 头） |
| V13 | 回归网规模 | `vitest run` | ✅ **35/35**（weapi 13 + 会话 13 + 代理令牌 9） |

**仍未验证（需真实 CF 账号或生产环境，无法在本机取得）**：`wrangler deploy` 实际上线、**免费档 10 ms CPU 实测**（G5，本地 dev 未采集 CPU 时间）、1027/1102 真实触发、**网易云从 CF 出口 IP 的可达性**（G9，本机是经代理的本地出口，不代表 CF 边缘出口）、真实 `AnalyserNode` 频谱与拖动、iOS 兼容性。

**本机环境注意事项（后续复现用）**：`wrangler dev` 可用；但 `wrangler d1 execute` 在部分时点会因 workerd 无法创建 `miniflare-email-store` 目录而启动失败 —— 此时改用 Node 24 内置 `node:sqlite` 直读 `.wrangler/state/v3/d1/**/*.sqlite`（本文件 V10 即此法）。另外 PowerShell 的 `Invoke-WebRequest -Headers@{Cookie=…}` **不会真正发出 Cookie 头**，冒烟测试必须用 `curl.exe -H "Cookie: …"`（曾因此误判为会话缺陷）。

---

## 4. 放行条件（Go / No-Go）

**Go 需全部满足**：G1 单源拓扑并实测四类路由互不遮蔽 ｜ G2 `wrangler d1 migrations apply` 从零成功且 DDL 单位核对 ｜ G3 端到端闭环（801/802/803 → `me` → 搜索 → `songUrl` → 代理 206 → **频谱非零** → 拖动 seek） ｜ G4 回滚演练（git + `d1 export`/Time Travel ≤7 天 + 部署回退） ｜ G5 CPU p95 < 10 ms 且无 1102、请求量余量 ≥ 2× 预期日活 ｜ G6 bundle 无 `mysql2|dotenv|@hono/node-server|import.meta.dirname` ｜ G7 契约零 diff + Worker 目标 `tsc -b` 绿 ｜ G8 安全门（代理签名、`Secure`、时间戳单测、跨站 `qrcodeCheck`/`logout` 被拒、输入 max、密钥仅存 secret） ｜ G9 **网易云从 CF 出口 IP 可用**（大陆 + 海外各实测）

**No-Go 触发器**：二维码不可生成 ｜ `me` 恒 false ｜ 频谱恒 0 ｜ 出现 1102/1027 ｜ 会话过期判定抛错或永不过期 ｜ 无法回滚 ｜ 无法解释的功能差异。

**放弃组合 B 的条件**：G9 失败（网易云风控境外出口）→ 方案不成立；10 ms CPU 瘦身后仍持续 1102 → 免费档不成立（退回组合 A/C，而非升级付费）。

---

## 5. 不可验证事项（诚实边界）

本环境无 CF 账号、无网易云真实联调、无浏览器自动化：`wrangler deploy`、1027/1102 真实触发、D1 真实读回值类型、801/802/803 真实时序、VIP 可播性、真实 `AnalyserNode` 频谱与 iOS 兼容性**均未验证**。构建/类型检查/单测正在本机执行（P0-2 起）。

来源：https://developers.cloudflare.com/workers/platform/limits/ ｜ https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/ ｜ https://developers.cloudflare.com/d1/platform/limits/ ｜ https://developers.cloudflare.com/pages/platform/limits/ ｜ https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
