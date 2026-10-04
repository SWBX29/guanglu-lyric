# 交接文档：光路·歌词（Cloudflare 全栈）｜2026-10-04 重写版

> **本文件是跨对话交接的唯一入口**：新会话零上下文读完这一份即可接手。
> 本版为 2026-10-04 的**整体重写**（旧版已删除）。代码与 CI 中有多处按
> `§0 / §6 / §7 / §8 / §12`、`§8 陷阱 10 / 12`、`§6 V29` 引用本文档，
> **章节号、陷阱编号、V 编号必须保持稳定**，改动内容时不要动编号。

---

## 0. 30 秒速览

| 项目 | 状态 |
|---|---|
| **线上地址** | **https://lyric.swbx.cc.cd**（自定义域名，推荐）+ https://guanglu-lyric.1663988203.workers.dev（双入口实测可用） |
| **当前 Worker 版本** | `54bca6b3-31ee-4b78-b9f5-18ba557bdbbf`（2026-10-04 由 CI 发布）。此后每次 master push 都会由 CI 重新发布，**最新版本以 `wrangler deployments list` 为准** |
| Cloudflare 账号 | `1663988203@qq.com's Account` / account id `c5b214ba182d8c1a2880bff2613c2bb8`（本机 wrangler 已 OAuth 登录） |
| D1 数据库 | `guanglu-lyric-db` / id `a8f4b230-1181-4d24-9aaf-bc15a55f70d1`；迁移 `0000`（会话表）+ `0001`（audit_events）本地/远端均已应用 |
| Secrets | `COOKIE_ENC_KEY`、`PROXY_SIGN_KEY`（CF 侧 `wrangler secret`；本地副本 `app/.dev.vars`，已 gitignore） |
| Cron | `23 4 * * *`（清理过期会话 + 90 天前审计事件） |
| 仓库 | **https://github.com/SWBX29/guanglu-lyric**（Public，master；**push 即 CI 自动部署**）；本机工作树 clean |
| 质量门 | `tsc -b` exit 0 ｜ `vitest` **57/57** ｜ `vite build` OK ｜ `wrangler deploy --dry-run` OK ｜ CI verify + deploy 全绿 ｜ `eslint` 26 项均为既有历史问题（无新增） |
| 当前状态 | 功能完整可用。生产播放走**直连模式**（无频谱）且已完成 CSP/混合内容修复；歌词栏"糊团"已修复。**待人工验证**：真机扫码登录、真机直连出声、歌词修复真机确认、iOS/Safari |

**一句话结论**：原 MySQL/Node 工程已完整迁移到 Cloudflare 免费档（Workers + Static Assets + D1），安全加固、结构化审计、GitHub CI、自定义域名全部落地并实测；生产播放因网易云对云出口风控改为"客户端直连外链"降级方案（代码/网络层已验证，真机出声待确认）。

---

## 1. 项目与架构总览

**定位**：一个会随音乐律动的治愈系像素 3D 场景 + 网易云扫码点歌 + LRC 精确同步 + 歌词书写/扫光特效 + 频谱驱动。

### 1.1 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19.2 + Vite 7 + TS 5.9 + Tailwind 3.4 + shadcn/ui（57 组件）+ three.js 0.186 + @tanstack/react-query 5 + tRPC 11 客户端 |
| 后端 | Hono 4 + tRPC 11 + superjson + zod 4（≥4.5 是 Workers 内存要求）+ Drizzle 0.45（drizzle-orm/d1）+ qrcode（SVG 渲染器） |
| 运行时 | Cloudflare Workers（`nodejs_compat`）+ Static Assets + D1；Node 24 工具链（本机 v24.14.1，CI 同版本） |
| 测试 | vitest 4（`app/api/**/*.test.ts`，57 例） |

### 1.2 目录结构

```
E:\AIwork\Kimi_Agent\
├─ docs\            HANDOFF.md（本文档）、cloudflare-migration.md（迁移决策+免费档边界）
├─ plan.md          上一轮迭代计划（歌词书写特效/粒子性能/天气/新地图，已实现）
├─ project-summary\ 静态总结页（同时复制到 app/public/summary/ 随构建发布）
└─ app\             主工程（CI 工作目录）
   ├─ src\          前端：pages/Home.tsx、scene/VoxelWorld.ts、audio/AudioEngine.ts、
   │                components/{NeteasePanel,LyricParticles,ui/*}.tsx、lib/{themes,lrc}.ts、index.css
   ├─ api\          Worker：boot.ts（入口）、neteaseRouter.ts、neteaseClient.ts（自实现 weapi）、
   │                neteaseSession.ts、lib/{proxyToken,loginBind,audit,cookies,env,songMedia}.ts
   ├─ contracts\    前后端共享类型（types.ts / errors.ts）——改契约先改这里
   ├─ db\           schema.ts（sqlite-core）+ migrations/（0000/0001）
   ├─ public\       _headers（静态资源 CSP/安全头）、summary\（静态总结页）
   ├─ scripts\run.mjs  ★ 所有 npm 脚本的统一入口（见 §8 陷阱 2/3/4/12）
   ├─ wrangler.jsonc  部署形态唯一配置（绑定/路由/Cron/资产）
   └─ worker-configuration.d.ts  wrangler types 生成物（改配置后必须重跑 cf-typegen）
```

### 1.3 部署形态（单源单部署单元）

- `wrangler.jsonc`：`main = api/boot.ts`、`assets.directory = ./dist/public`、
  `run_worker_first: ["/api/*"]`（静态资源请求免费且不计 Workers 配额）、
  `not_found_handling: single-page-application`（`/api/*` 已先入 Worker，不会被遮蔽）。
- **三条同源约束**（决定了必须单源部署，不可拆 pages.dev + 独立后端）：
  ① 前端 tRPC 用相对路径 `/api/trpc` + `credentials:"include"`；
  ② 会话 cookie `SameSite=Lax`；
  ③ WebAudio 频谱要求音频同源（`crossOrigin='anonymous'` + AnalyserNode）。
- 自定义域名 `lyric.swbx.cc.cd`（`routes[].custom_domain`）+ 显式 `workers_dev: true` 双入口；`preview_urls: false`。

### 1.4 关键文件速查（行数为约值）

| 文件 | 职责 |
|---|---|
| `src/pages/Home.tsx`（约 710 行） | UI 编排：启动浮层、播放状态机、歌词同步/书写/扫光、主题×天气切换、面板折叠 |
| `src/scene/VoxelWorld.ts`（两千余行） | 3D 体素世界；契约：`update(dt,isPlaying,bands)` / `setTheme` / `setWeather` / `resize` / `dispose` / `project` / `getCharZ` / `getMapKind`；update 由 Home 的 rAF 驱动，**无内部定时器** |
| `src/index.css`（约 350 行） | 歌词特效/面板布局；**特效实现约定见 §2.3，不要回退到旧写法（§8 陷阱 16）** |
| `src/components/NeteasePanel.tsx` | 扫码登录（3s 轮询、60s 超时+刷新）、搜索、歌单两级导航 |
| `src/audio/AudioEngine.ts` | 文件/URL 播放、WebAudio 分析器、内置生成式小曲；`play()` 返回 Promise（自动播放拦截可感知） |
| `api/boot.ts` | Workers 入口：安全头、音频代理（先验签）、tRPC 挂载、`/api/*` JSON 404、`scheduled`（Cron） |
| `api/neteaseRouter.ts` | 全部 tRPC 路由；`songUrl` 双模式判定在此 |
| `api/neteaseClient.ts` | 自实现 weapi（AES-128-CBC + BigInt RSA）；有黄金向量回归网 |
| `api/lib/songMedia.ts` | 直连模式支持：isolate 级 10min 缓存、outer 外链 URL、外链 UA |
| `api/lib/{proxyToken,loginBind,audit}.ts` | 三条安全主线：代理签名 / 登录绑定 / 审计 |
| `contracts/types.ts` | 前后端契约（含 `NeteaseSongUrlResult` 三态） |

---

## 2. 运行时契约与关键实现

### 2.1 API 面（tRPC `netease.*`）

| 路由 | 鉴权 | 说明 |
|---|---|---|
| `qrcodeCreate` | 公开 | 申请 unikey + SVG 二维码 dataURL；同时下发 `qr_bind` 绑定 cookie（H2 防跨站登录） |
| `qrcodeCheck` | 公开 | 轮询扫码状态；803 成功时建会话并下发 session cookie；qr_bind 校验失败复用 `expired` 语义 |
| `me` / `logout` | 公开 | 登录态查询 / 退出（logout 带审计） |
| `searchSongs` | 公开 | 匿名搜索 + 封面回填（song/detail 批量，失败静默） |
| `myPlaylists` / `playlistTracks` | **protected** | 需登录；`protectedQuery` 默认失败关闭，公开接口必须显式声明 |
| `songUrl` | 公开 | 播放地址三态，详见 §2.2 |
| `lyric` | 公开 | LRC/翻译/纯音乐标记 |

**鉴权与会话模型**：`api/middleware.ts` 的 `protectedQuery`（默认失败关闭）；
`api/neteaseSession.ts`：网易云 cookie 用 **AES-GCM 加密落库**、会话 token **只存 SHA-256**、
`Secure` 无条件开启、`purgeExpiredSessions()` 由 Cron 调用。

**音频代理**（`boot.ts` + `lib/proxyToken.ts`）：HMAC 签名 URL（TTL 6h，`buildProxyUrl/signAudioToken`），
先验签再做 weapi；`Sec-Fetch-Site` 校验；无 Range 时限 8 MiB 分片；HEAD 短路；
有 `content-encoding` 时不通传 `content-length`。

**审计**（`lib/audit.ts` + 表 `audit_events`）：四类事件 `login_success / logout /
session_expired_purge / proxy_rejected`；主体只落 **HMAC-SHA256 哈希**（netease uid / 客户端 IP），
绝不落 cookie 与明文 IP；代理拒绝带「每 isolate × 每 reason × 60s 最多一行」防刷节流；
Cron 每日清理超 90 天事件。

### 2.2 播放链路（**重点，含生产降级**）

契约 `NeteaseSongUrlResult`（`contracts/types.ts`）三态：

1. **`spectrum:true`（正常模式）**：服务端 weapi 取链成功（本地/中国出口），返回同源签名
   `proxyUrl`，前端经代理播放 + WebAudio 频谱驱动场景。
2. **`spectrum:false`（生产直连模式）**：CF 出口被网易云风控（`code:-462`，见 §6 V29）时，
   服务端返回 outer 外链（`https://music.163.com/song/media/outer/url?id=X.mp3`），
   客户端 `<audio>` 直连播放——音乐/歌词/进度可用，**无频谱**；UI 显示「直连播放（当前网络下无频谱）」。
   命中过的 id 在 isolate 内缓存 10 分钟（`lib/songMedia.ts`），避免白打 weapi。
3. **`playable:false`**：VIP/付费/无音源 → UI 显示明确话术。

**HTTPS 下的两个关键拦截点（已修复，务必了解，§8 陷阱 15）**：
① 静态资源 CSP（`app/public/_headers`）必须放行 `media-src ... https://music.163.com https://*.music.126.net`；
② outer 端点 302 落到 **http** CDN，HTTPS 页面属混合内容，必须靠 `upgrade-insecure-requests`
把 302 目标升级为 https（实测 https CDN 同路径返回 200 audio/mpeg）。

**预期内失败**：部分歌曲无外链（302 → `music.163.com/404`，如周杰伦原版），
UI 提示「音频加载失败」，属版权限制不可绕。

**前端播放状态机**（Home.tsx）：`trackLoading` 在查询出错时必须复位（否则卡「加载中…」）；
`play()` 的 Promise 拒绝 → 提示「播放被浏览器拦截，请再点一次播放按钮」；
同曲点击且上次失败 → 手动重取链重试；快速切歌有 `cancelled` 守卫（旧异步链路不得写状态）；
「直连播放 / 纯音乐」提示互斥。

### 2.3 歌词渲染与列表（**改特效前必读**）

- 解析：`lib/lrc.ts`（多时间戳、按时间排序；纯文本按 duration 均匀分布兜底）。
- 当前行（列表）呈现：**实色暖白 `#fffaf0` + 克制光晕（7/18px）+ 逐字透明度揭示（≤80ms/字）**；
  卡拉OK扫光用 **`mask-image`**（`--sweep` 由 rAF 直写 CSS 变量）——已唱全亮、未唱压暗 50%。
- 笔尖：`.lyric-write-wrap`（inline-block，轨道 = 文字实际宽）内的 5px 光点，
  `animationDuration` 按行时长写入；**不要移除该容器**，否则笔尖会飘到行尾空白（旧 bug）。
- **禁止回退的旧写法**：逐字 `filter: blur(2.5px)` + 父元素 `background-clip:text` 渐变
  ——移动端会出现"无字形糊团/光斑"（§8 陷阱 16）。
- 性能约定：歌词高亮/滚动/扫光/脉动全部 rAF 直写 DOM/CSS 变量（零重渲染）；
  **不要用 `scrollIntoView`**（会滚动 fixed 根容器导致整个 3D 层横移），只对列表容器 `scrollTo`；
  根容器用 `overflow-clip` 而不是 `overflow-hidden`（防止程序化滚动）。
- 3D 飞行字幕（`.lyric-line` 层）：按 `project()` 取屏幕坐标 + 随距离淡入淡出/模糊，
  与列表是两套展示（飞行层保留强光晕，列表层克制）。

### 2.4 场景（VoxelWorld）与显示布局约定

- 主题 5 个：`themes.ts` 的 `spring / autumn / winter / city / beach`；天气 8 个：
  `auto・clear・petals・rain・leaves・wind・snow・snowstorm`；**天气与主题解耦**，
  `auto` 跟随主题 `defaultWeather`；`setTheme` 内部会按 `auto` 快进天气强度。
- 硬约束：零分配循环、实例化渲染、`pixelRatio ≤ 1.5`、签名兼容（新增能力只加方法）。
- 布局约定（防重叠，别改回）：右上角 **天气按钮与主题按钮列并排一行**（整簇不向下延伸）；
  歌词面板 `top: calc(50% + 24px)`；面板开关同偏移；移动端似乎是靠这两条避免压面板（见 §6 V30）。
- 已知非阻断小瑕疵：窄屏（如 390px）下"开始浮层"与已打开的网易云面板**点击区域重叠**
  （收起面板即恢复）。

---

## 3. 关键决策记录

| # | 决策 | 理由 | 被推翻条件 |
|---|---|---|---|
| D-1 | **单源单部署单元**（Workers + Static Assets，`run_worker_first:["/api/*"]`） | 三条同源约束（§1.3） | 除非重建会话机制（SameSite=None+CORS+CSRF）并重解频谱 |
| D-2 | 保留 `node:crypto`（`nodejs_compat`），不迁 WebCrypto | 官方核验：除 generateKeyPair(DSA/DH)/argon2/ed448/x448/FIPS 外全量支持 | 实测 createCipheriv 异常（已实测正常） |
| D-3 | 网易云 cookie **AES-GCM 加密落库**、session token 只存 SHA-256 | 安全加固窗口 | 回滚代码 = 全员重新扫码（已接受） |
| D-4 | 回滚代价：全员重新扫码 | 无存量线上会话 | 出现需保留旧会话的线上流量 |
| D-5 | 静态资源走 Static Assets，**不用** catch-all `_redirects` 做 fallback | catch-all 会遮蔽 `/api/*`；免费档 `run_worker_first` 超额返回 429 而非回落 | — |
| D-6 | `qrcode` 用 `QRCode.toString({type:"svg"})` + 手工 data URL | `toDataURL` 绑定 Canvas 渲染器，Worker 无 DOM 必挂（已实测） | — |
| D-7 | zod 升至 ≥4.5（实际 `^4.6.5`） | Workers 内存页要求（免费档 isolate 仅 128 MB） | — |
| **D-8** | **生产播放降级为"客户端直连外链"（无频谱）** | CF 出口被网易云风控取链（V29）；手机/中国出口直连可用 | 网易云放宽云出口风控（兜底链路会自动恢复频谱模式） |
| **D-9** | **歌词当前行改用 `mask-image` 扫光 + 透明度逐字揭示** | 移动端 `background-clip:text` + 子元素动画渲染出糊团（陷阱 16） | 浏览器实现修复该渲染问题（暂不需要） |
| **D-10** | **天气菜单收起为单按钮并与主题列并排** | 8 个 chips 常显时压住歌词面板顶部（实测坐标重叠，V30） | 布局重构后（如控制区移到别处） |

---

## 4. 开发、构建与部署手册

> **所有 npm 命令必须走 `scripts/run.mjs` 包装**（TEMP/日志重定向、PATH 注入，见 §8 陷阱 2/3/4/12）。

### 4.1 常用命令（工作目录 `app/`）

```powershell
npm run check        # tsc -b（前端 + Worker 双目标）
npm run test         # vitest，应为 57/57
npm run lint         # eslint（26 项为既有历史问题，关注"无新增"）
npm run build        # vite build → dist/public
npm run dev:worker   # ★ 全栈本地开发：Worker + 本地 D1 + secrets，端口 8787
npm run dev          # 前端 HMR（3000）；/api/* 经 Vite 代理到 8787（需先起 dev:worker）
npm run deploy       # 构建 + 发布（幂等）
npm run cf-typegen   # 改过 wrangler.jsonc 后必须重跑
npm run db:generate  # 改过 db/schema.ts 后生成迁移
npm run db:apply:local / db:apply:remote   # 应用 D1 迁移（本地命令须沙箱外跑，§8 陷阱 14）
```

本地全栈 = **两个终端**：先 `dev:worker`（8787）→ 再 `dev`（3000）。
只跑 `dev` 而 8787 未启动时 `/api/*` 报错是预期行为。

### 4.2 直接调 wrangler（含引号参数时避免 shell 拆参数）

```powershell
node scripts/run.mjs wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM netease_sessions"
node scripts/run.mjs wrangler tail guanglu-lyric --format json      # 看 CPU/错误（G5 观察）
curl.exe "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=23+4+*+*+*"   # 本地手动触发 Cron（实测可用；新版 wrangler 也提示 /cdn-cgi/local/scheduled）
```

### 4.3 推送到 GitHub（**本机必须带代理与集成 token**，§8 陷阱 13）

```powershell
git -c "http.proxy=http://127.0.0.1:7900" -c "https.proxy=http://127.0.0.1:7900" -c credential.helper= -c "credential.helper=!gh auth git-credential" push
```

### 4.4 CI（`.github/workflows/ci.yml`）

- 工作目录 `app/`；`npm ci --ignore-scripts`（陷阱 2）。
- `verify`（push/PR/手动）：`check → test → build → build:worker(dry-run)`。
- `deploy`（仅 master push / 手动触发，**门控在 `CLOUDFLARE_API_TOKEN` 是否存在**）：`npm run deploy`。
- 实测：verify 约 30–40s、deploy 约 25–35s，全绿；查看：`gh run list --repo SWBX29/guanglu-lyric`。

### 4.5 回滚与密钥

- 代码：`git revert <commit>`；CF Dashboard 可回退历史版本。
- 数据：D1 Time Travel（免费档 **7 天**）/ `wrangler d1 export`。
- **注意**：D-3 上线后回滚代码 = 旧版本读不到新格式会话 = 全员重新扫码。
- 密钥：生产在 CF `wrangler secret`（`COOKIE_ENC_KEY`/`PROXY_SIGN_KEY`）；本地 `app/.dev.vars`（已 gitignore）。**绝不进 git、绝不进 `vars`**。

---

## 5. 最近提交历史（截至 2026-10-04）

| 提交 | 内容 |
|---|---|
| `39b21e8` | docs：HANDOFF 同步歌词栏糊团修复（V33/陷阱 16） |
| `a821b9d` | fix：歌词栏当前行糊团修复 —— 去掉 blur、光晕收敛、扫光改 `mask-image` |
| `e90c782` | docs：HANDOFF 同步系统排查结果（V30–V32、陷阱 15、基线 57/57） |
| `1b3c2d4` | fix：生产直连播放被 CSP/混合内容拦截 —— `media-src` 放行 + `upgrade-insecure-requests` |
| `7ae5d93` | fix：UI/播放状态机缺陷修复（加载态卡死/自动播放拦截/同曲重试/笔尖越界/天气压面板/二维码超时/切歌守卫） |
| `2842904` | feat：播放直连模式（云出口风控降级，契约新增 `spectrum` 判别字段） |
| `2106ebd` `c751554` | chore：取链失败话术收敛 / 临时诊断透出（V29 定位过程） |
| `9ad510d` `01dafb8` | fix：外链兜底链路 + 外链/代理补显式 User-Agent（空 UA 会被退回 302 错误链） |
| `ccf72ff` | feat：绑定自定义域名 `lyric.swbx.cc.cd`（保留 workers.dev 双入口） |
| `00a41c1` `abbbdad` | feat：结构化审计日志 + 文档同步 |
| `a40d94d` `2971ff4` `7c80af4` | ci：GitHub Actions；fix：Vite 代理（陷阱 10）、run.mjs 注入 WRANGLER_LOG_PATH（陷阱 12） |

更早的迁移期提交（P0→P2）见 `git log` 与 `docs/cloudflare-migration.md`。

---

## 6. 验证矩阵（当前有效项；**编号保持稳定，V29 被代码注释引用**）

> 迁移期的 V1–V28 完整历史已随旧版文档删除，若需溯源见 `git log` 与 `docs/cloudflare-migration.md`。

| # | 检查 | 方法 | 结果 |
|---|---|---|---|
| V29 | **生产取链失败根因定位** | 本地 vs 生产同 id 对照 + 一次性探针 Worker | ✅ 本地（中国出口）206 + 真实 MP3；生产（CF 出口）weapi `code:404`、外链端点 `200 text/html`、明文 API `code:-462`（风控页）→ **网易云对云出口下发风控挑战，非代码缺陷**；同期修复 `songUrl` 补传会话 cookie + 外链兜底（isolate 缓存、空 UA 修复） |
| V30 | **UI/播放状态机修复的实测闭环** | 本地双服务 + 浏览器 DOM 几何/快照取证（只读） | ✅ 笔尖轨道=文字实际宽（144/160/128px；修复前 ~258px）；右上角主题+天气簇底边 222 < 面板顶 227（修复前 8 chips 压面板）；搜索→点歌→进度前进→暂停冻结→恢复；控制台 0 报错；二维码 60s 超时出现刷新入口（线上亦复现） |
| V31 | **直连播放被两个浏览器侧拦截点拦截（定位+修复）** | 线上 curl 对照 + 浏览器复现 + https CDN 对照 | ✅ ① CSP `media-src 'self'` 拒绝跨源音频；② outer 302 → **http** CDN 属混合内容。修复：CSP 放行 + `upgrade-insecure-requests`；**实测同路径 https CDN 200 audio/mpeg（3.7MB）** |
| V32 | **CSP 修复部署核对** | 线上 `curl -D`（经代理） | ✅ 生产首页已返回新 CSP（media-src 双域名 + UIR + CF 探针放行）；CI verify+deploy 双绿 |
| V33 | **歌词栏当前行"糊团"修复** | 用户手机截图 4x 放大取证 + 代码层重构（免浏览器） | ✅ 确认为"无字形模糊金斑 + 大光晕"（clip 鬼影 + 2.5px 模糊 + 呼吸光晕叠加）；已改为透明度揭示 + `mask-image` 扫光 + 克制光晕；本地 `check/test/build` 全绿。**真机复验待用户确认** |
| 质量门 | `check` / `test` / `build` / CI | 最近一次：2026-10-04 | ✅ tsc 0；**57/57**；build OK；CI 全绿（含本文件所在提交） |

---

## 7. 免费档边界与官方事实

| 事实 | 来源 |
|---|---|
| Workers Free：**100,000 请求/天、CPU 10 ms/请求**（实测峰值 102–123 ms 被容忍，持续观察）、内存 128 MB、子请求 50、并发出站 6、体积 64 MiB、**Cron 5 个/账号** | developers.cloudflare.com/workers/platform/limits/ |
| `node:crypto` 全量支持（例外：generateKeyPair DSA/DH、argon2、ed448/x448、FIPS） | .../runtime-apis/nodejs/crypto/ |
| 静态资源请求**免费不限量**；免费档 `run_worker_first` 超额返回 **429** 而非回落静态 | .../static-assets/billing-and-limitations/ |
| zod 需 **≥4.5.0**（更早版本每 schema 内存占用显著更高） | Workers 内存限制页 |
| D1 Free：10 库、账号 5 GB、Time Travel **7 天**、50 查询/Worker 调用、单库单线程 | .../d1/platform/limits/ |
| Pages Free（备选路径）：500 构建/月、20,000 文件、`_headers` 100 条 | .../pages/platform/limits/ |

---

## 8. 环境陷阱与解法（**本机特有，16 条，编号稳定**）

1. **`package-lock.json` 内网镜像**：曾指向 `npm.mirrors.msh.team`（ECONNRESET），已归一化到 `registry.npmjs.org`。重新生成 lockfile 后要复查。
2. **npm 生命周期脚本被拦**：esbuild postinstall 走 spawn+管道 → EPERM。**安装用 `npm ci --ignore-scripts`**（@esbuild/win32-x64 作为 optionalDep 会正常落盘）。
3. **esbuild 需要命名管道**：vite/vitest 的 JS API 以管道启动 esbuild → 受限模式下 `spawn EPERM`；esbuild **CLI**（继承 stdio）不受影响 → 一切走 `scripts/run.mjs`。
4. **系统 `%TEMP%` 拒绝删除**（esbuild 写后删 → Access denied）→ `scripts/run.mjs` 把 TEMP 指到项目内 `.tmp/`。
5. **workerd 起不来**（`CreateDirectory ... miniflare-email-store` 拒绝）→ 经 `scripts/run.mjs` 启动；仍失败可用 **Node 内置 `node:sqlite` 直读** `.wrangler/state/v3/d1/**/*.sqlite`。
6. **PowerShell `Invoke-WebRequest -Headers @{Cookie=…}` 不会真正发 Cookie** → 冒烟测试必须用 `curl.exe -H "Cookie: …"` 或 `-b jar`。
7. **`wrangler d1 create` 会偷偷追加第二条 D1 绑定** → 必须删掉重复条目（只保留 `DB`）。
8. **`_headers` 语法**：只支持 `#` 注释；`/* */` 会被当路径模式导致部署失败。
9. **`wrangler types` 生成物必须与 wrangler.jsonc 同步**；改绑定/配置后重跑 `npm run cf-typegen`。
10. **Vite dev 曾丢绑定（已修复）**：原 `@hono/vite-dev-server` 调 `app.fetch()` 不传 env → `/api/health` 全 false。现 `vite.config.ts` 用 `server.proxy`：`/api` → `http://127.0.0.1:8787`。**本地全栈必须双终端**（dev:worker + dev）。
11. **`localhost` vs `127.0.0.1`**：Vite 默认绑 IPv6 `::1`；用 `127.0.0.1` 访问可能 `HTTP 000` → 浏览器/冒烟优先 `localhost`。
12. **沙箱内 wrangler 写日志被拒 → exit 1（实际已成功）**：wrangler 默认写 `%APPDATA%\xdg.config\.wrangler\logs\`，沙箱拒绝 → 打 EPERM 且 exit 1，会让 `&&` 链误判。**已固化**：`scripts/run.mjs` 统一注入 `WRANGLER_LOG_PATH` 到 `.tmp/wrangler-logs`。手工等效：`$env:WRANGLER_LOG_PATH = "<app>\.tmp\wrangler-logs"`。
13. **推 GitHub 需两件套：代理 + 集成 token**：① `github.com` TLS 被干扰（`api.github.com` 正常）→ 必须走本机代理 `http://127.0.0.1:7900`；② keyring OAuth token 缺 `workflow` 作用域，推 `.github/workflows/*` 会被拒，而 TRAE 注入的 `GH_TOKEN`（集成 App token）可写 workflow。命令见 §4.3。另：`gh repo create` 用集成 token 会报 "Resource not accessible by integration"，需清空 `GH_TOKEN` 用 keyring token。
14. **沙箱内 `wrangler d1` 本地命令必崩**（`_cf_ALARM: no such table` + uv async 断言失败）→ `db:apply:local` / `d1 execute --local`（含 `--file`）**一律沙箱外执行**。本地 Cron 手动触发见 §4.2。
15. **生产直连播放的两个浏览器侧拦截点（已修复）**：① `_headers` 的 CSP `media-src 'self'` 直接拒绝跨源音频；② outer 端点 302 落到 **http** CDN（`*.music.126.net`），HTTPS 页面属混合内容。**解法**：CSP 放行 `https://music.163.com https://*.music.126.net` + `upgrade-insecure-requests`（302 目标升级为 https）。注意 `_headers` 改动需重新部署；CF 探针（cloudflareinsights）也需放行否则控制台报资源错误。
16. **歌词特效移动端"糊团"（已修复）**：勿用「父子元素 `background-clip:text` 渐变 + 子元素 `opacity/filter` 动画」组合（移动端渲染出无字形光斑）。**现行方案**：实色文字 + `mask-image` 扫光 + 纯透明度逐字揭示。遇到"桌面正常、手机异常"的文字特效，优先怀疑 clip/filter 与合成层交互。

---

## 9. 尚未验证 / 剩余风险

| 项 | 说明 |
|---|---|
| **真人扫码登录** | 接口层已验证（801/802/803、错误分支、D1 读写、加解密），但**没人用手机真扫过**。扫码成功后可在 D1 `audit_events` 核对新增 `login_success` 行（审计最后一块拼图） |
| **真机直连出声** | 直连模式代码/网络层已验证（V31/V32）；手机打开线上 → 搜一首有外链的歌（如「稻香(深情版)」）→ 应显示「直连播放（当前网络下无频谱）」且有声、进度走字。无外链歌曲提示失败属预期 |
| **歌词修复真机确认** | V33 已按截图重构，待手机复看（当前行应为清晰暖白发光字 + 逐字淡入 + 小光点笔尖） |
| **iOS/Safari 兼容** | AudioContext 手势要求、`upgrade-insecure-requests` 对 302 的升级行为、Range 行为均未实机测 |
| **G5 CPU 持续观察** | 峰值 102–123 ms 高于名义 10 ms 未被拒；若出现 `1102`，瘦身顺序：① songUrl/lyric 加平台缓存 ② 二维码前端渲染 ③ weapi 链路去 zod |
| **墙内可达性** | workers.dev 直连被黑洞（经代理可达）；自定义域名可达性受 CF 边缘 IP 干扰影响，属尽力而为 |
| **非阻断清单** | 窄屏浮层/面板点击重叠（§2.4）；上游错误文案收敛；`chart.tsx` 的 `dangerouslySetInnerHTML`（静态输入）；会话滑动续期/批量撤销；eslint 26 项历史问题（shadcn react-refresh、VoxelWorld `any` 等） |

---

## 10. 新会话上手清单（10 步）

1. 读本文档（先 §0 → §2 → §8）。
2. 读 `docs/cloudflare-migration.md`（迁移决策 + 免费档边界）。
3. 读 `app/api/boot.ts` + `api/lib/env.ts` + `app/wrangler.jsonc`（运行时入口与绑定契约）。
4. 读 `api/neteaseSession.ts` + `api/lib/proxyToken.ts` + `api/lib/loginBind.ts`（安全三主线）。
5. 跑 `npm run check && npm run test`（确认 57/57 与 tsc 绿 = 当前基线）。
6. 要动前端：起双终端 `dev:worker` + `dev`（陷阱 10）；要动绑定/配置：改完 `npm run cf-typegen`。
7. 动契约先改 `app/contracts/types.ts`（前后端共享）。
8. 遇到构建/运行报错：**先查 §8 的 16 条陷阱**（尤其"是否走 run.mjs / 是否该沙箱外跑"）。
9. 发布：push master（CI 自动部署）或 `npm run deploy`；发布后核对 `wrangler deployments list` / `gh run list`。
10. 有变更同步本文档（**章节与编号不要动**）。

---

## 11. 症状 → 速查

| 症状 | 优先排查 |
|---|---|
| 本地 `/api/*` 全挂 | 是否只起了 `dev` 没起 `dev:worker`（陷阱 10） |
| wrangler 输出正常但 exit 1 | 沙箱日志写入问题（陷阱 12，已固化） |
| `wrangler d1` 本地崩溃 | 必须在沙箱外跑（陷阱 14） |
| 生产点歌失败/无声 | 先看是否显示「直连播放」；无外链歌属预期；全站失败查 CSP/混合内容（陷阱 15） |
| 歌词行糊成一团/无字形 | 特效写法回退到旧方案了（陷阱 16） |
| 控制台 CSP 报错 | `_headers` 放行域名是否齐全（陷阱 15） |
| `git push` 被拒 | 代理 + 集成 token 两件套（陷阱 13） |
| 手机扫码不成功 | qr_bind 绑定/过期刷新（60s 超时入口）/网易云服务状态 |
| 3D 画布整体横移出屏 | 是否误用了 `scrollIntoView`（§2.3 约定） |

---

## 12. CI / 自定义域名 / 审计（收尾状态）

1. **GitHub CI —— ✅ 已完成**：`verify` + `deploy`（master push 自动发布）；secrets
   `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 已配置；**未配置 token 时 deploy 打 notice 跳过**（ci.yml 注释按本节引用）。
   **校验 token 用账户级端点** `GET /client/v4/accounts/<id>/tokens/verify`（`/user/tokens/verify` 对账户 token 会误报 Invalid）。
2. **自定义域名 —— ✅ 已完成**：`lyric.swbx.cc.cd`（zone `swbx.cc.cd`，同账户），DNS/证书自动管理；
   绑定路径 `wrangler.jsonc` 的 `routes[].custom_domain`，由本地 wrangler OAuth 部署完成
   （账户 API token 调 `/accounts/*/workers/domains` 返回 10405，不能用于绑定）。
   **CI 兼容性已实测**：CI token 对既有绑定是无操作，无需 zone 路由写权限；
   若未来**新增/修改** routes，token 需具备对应 zone 权限，否则 deploy 会失败（wrangler.jsonc 注释按本节引用）。
3. **审计日志 —— ✅ 已完成**：四类事件 + HMAC 主体哈希 + 防刷节流 + 90 天保留（§2.1）；端到端验证见旧版 V28（已随旧文档移除，结论仍有效）。
4. **生产播放 —— 直连模式 + CSP 修复已上线**（§2.2 / V31 / V32），真机出声待确认。
5. **歌词栏 —— 糊团修复已上线**（§2.3 / V33），真机复看待确认。