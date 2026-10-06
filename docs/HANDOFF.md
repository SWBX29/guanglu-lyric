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
| **当前 Worker 版本** | 2026-10-05 由 CI 随 `e7827af` 发布（V34 窄屏四项加固已上线，部署端到端取证见 §6 V35）。此后每次 master push 都会由 CI 重新发布，**最新版本以 `wrangler deployments list` 为准** |
| Cloudflare 账号 | `1663988203@qq.com's Account` / account id `c5b214ba182d8c1a2880bff2613c2bb8`（本机 wrangler 已 OAuth 登录） |
| D1 数据库 | `guanglu-lyric-db` / id `a8f4b230-1181-4d24-9aaf-bc15a55f70d1`；迁移 `0000`（会话表）+ `0001`（audit_events）本地/远端均已应用 |
| Secrets | `COOKIE_ENC_KEY`、`PROXY_SIGN_KEY`（CF 侧 `wrangler secret`；本地副本 `app/.dev.vars`，已 gitignore） |
| Cron | `23 4 * * *`（清理过期会话 + 90 天前审计事件） |
| 仓库 | **https://github.com/SWBX29/guanglu-lyric**（Public，master；**push 即 CI 自动部署**）；本机工作树 clean |
| 质量门 | `tsc -b` exit 0 ｜ `vitest` **57/57** ｜ `vite build` OK ｜ `wrangler deploy --dry-run` OK ｜ CI verify + deploy 全绿 ｜ `eslint` 26 项均为既有历史问题（无新增） |
| 当前状态 | 功能完整可用。生产播放走**直连模式**（无频谱）且已完成 CSP/混合内容修复；歌词栏"糊团"已修复；**窄屏布局四项加固已完成并上线**（V34/V35/D-11，CI 双绿、产物端到端取证）。**待人工验证**：真机扫码登录、真机直连出声、歌词修复真机确认、窄屏布局真机确认、iOS/Safari |

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
- **窄屏宽度约定（2026-10-05 加固，见 §6 V34）**：歌词面板宽度统一用 `:root` 的
  `--lyric-panel-w: clamp(168px, 70vw, 300px)`（`.lyric-panel-wrap` 引用它）；悬浮开关
  `right: min(calc(var(--lyric-panel-w) + 36px), calc(100vw - 42px))` —— 后一个 `min()`
  是**安全钳制**，保证开关左缘 ≥10px. 旧写法 `calc(min(80vw,300px)+32px)` 无下限：
  320px 时左缘正好 0px、280px 时已溢出屏外。**两处必须共用同一变量**，否则开关不再贴面板左缘。
- **网易云面板高度自适应**：容器上下边距为 `top: max(3.5rem, min(4.5rem, 8dvh))` /
  `bottom: max(5rem, min(7rem, 16dvh))`（高屏 ≥900px 等同原值 72/112px，矮屏收紧让位给列表）；
  QR 容器用 `h-36 w-36 min-[375px]:h-44 min-[375px]:w-44`。
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
| **D-11** | **窄屏宽度改用 `--lyric-panel-w` 变量 + 开关 `right` 双约束；面板高度 `dvh` 自适应** | 旧 `min(80vw,300px)` 无下限，320px 时开关左缘 0px、**280px 时溢出屏外**；矮屏面板被固定边距压到列表不可用（V34） | 面板/控制区布局重构后；或改用容器查询（container queries）统一处理 |

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
| `e7827af` | chore：`.gitignore` 忽略 `.workbuddy/`（agent 工作区数据，非源码） |
| `7ced1c4` | docs：HANDOFF 同步 V34/D-11；标注已过期排查计划并修正 60/60 → 57 |
| `7fad758` | fix：窄屏布局四项加固 —— D10 开关边距 / E11 天气展开态 / E12 面板高度 / A2 `begin()` Promise 感知（V34、D-11） |
| `122c689` | docs：交接文档整体重写（旧版删除，章节/陷阱/V 编号保持稳定） |
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
| V34 | **窄屏布局四项加固 + 基线重校**（D10/E11/E12/A2 残留） | 代码层几何推导（免浏览器）+ 全量静态门 | ✅ **基线重校**：`check` 0 ／ `test` **57/57** ／ `lint` **26 项**（含本文件所在提交前后**逐行签名 diff 完全一致**，零新增）／ `build` OK。**改动**：① D10 开关左缘按 `clamp(168,70vw,300)` + `min(w+36,100vw-42)` 复算 —— 320px→28px、280px→16px、375px→45px、≥430px 与原值一致；② E12 面板 568px 可用高 384→421px，≥900px 取原值 72/112px（零回归）；③ E11 展开态 chips 加 `max-h+overflow-y-auto` 使底边受钳；④ A2 `begin()` 感知 `play()` Promise 并加 `playError` 兜底提示位。**真机复验待确认**（`clamp/min/dvh` 在 jsdom 无布局引擎，无法由 vitest 证实） |
| V35 | **V34 上线核对（push → CI → 部署产物端到端取证）** | `gh run watch` + 线上 `curl`（经代理） | ✅ push `122c689..e7827af` → CI run `37291388553` **verify + deploy 双绿**（deploy 32s）；线上首页 `index-eLLBho46.css` 与本地构建产物**文件名完全一致**，且线上 CSS 内含本轮新增 `--lyric-panel-w` / `clamp(168px` / `100vw - 42px` → **新代码确已上线**；线上 `/api/health` → `{"ok":true,"storage":true,"key":true}`。备注：**陷阱 13 的集成 token 本次未用到**（提交未触碰 `.github/workflows/`，keyring token 即足够） |
| 质量门 | `check` / `test` / `build` / CI | 最近一次：2026-10-05（V35 后） | ✅ tsc 0；**57/57**；lint 26 项无新增；build OK；CI verify+deploy 双绿 |

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

## 8. 环境陷阱与解法（**本机特有，18 条，编号稳定**）

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
17. **`MultiplyBlending` 必须配 `premultipliedAlpha: true`**：three 对「乘算混合 + 非预乘 alpha」的材质**每个 draw call 打一条 `WebGLState` 警告**，会刷满 console 掩盖真实错误。路面贴花（`decals`）踩过：贴花本身"看起来是对的"（只是 console 噪声），极易漏掉。**凡是 `blending: THREE.MultiplyBlending` 的材质，一并写 `premultipliedAlpha: true`**。
18. **`InstancedMesh` 容量必须按「最大实例数」而不是「逻辑对象数」预分配**：左右成对摆放的道具（路缘石 `curbs`、篱笆 `fences`）若单侧计 N 个，实际会写 2N 个实例 → `setMatrixAt(2N-1, …)` 越界（**静默不报错**，表现为部分道具消失或错位）。`MAX_*` 是单侧上限，mesh 容量写 `MAX_* * 2`（与 `canopyLow` 的 `MAX_TREE_N * 2` 同惯例）。

---

## 9. 尚未验证 / 剩余风险

| 项 | 说明 |
|---|---|
| **真人扫码登录** | 接口层已验证（801/802/803、错误分支、D1 读写、加解密），但**没人用手机真扫过**。扫码成功后可在 D1 `audit_events` 核对新增 `login_success` 行（审计最后一块拼图） |
| **真机直连出声** | 直连模式代码/网络层已验证（V31/V32）；手机打开线上 → 搜一首有外链的歌（如「稻香(深情版)」）→ 应显示「直连播放（当前网络下无频谱）」且有声、进度走字。无外链歌曲提示失败属预期 |
| **歌词修复真机确认** | V33 已按截图重构，待手机复看（当前行应为清晰暖白发光字 + 逐字淡入 + 小光点笔尖） |
| **窄屏布局加固真机确认（V34/V35）** | D10 开关边距 / E12 面板高度 / E11 展开态 chips 均为几何推导修复，`clamp/min/dvh` 无法由 vitest 证实；**代码已于 2026-10-05 随 `e7827af` 上线**，需在 320×568、280px、横屏 320×375 与 iOS Safari 上目视复看 |
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
| 窄屏歌词开关被挤出/贴左屏边 | 是否回退成 `calc(min(80vw,300px)+32px)`（§2.4 窄屏约定 / D-11 / V34） |
| 矮屏网易云面板列表几乎看不见 | 容器是否回退成固定 `top-[4.5rem] bottom-28`；QR 是否缺 `min-[375px]:` 断点（§2.4 / V34） |
| 本地文件播放点了没反应 | `begin()` 是否仍在 fire-and-forget 调 `play()`（§2 播放状态机 / V34） |
| 路面出现「纸片/垃圾」状浅色块 | 贴花材质被改成受光材质了；必须 `MeshBasicMaterial` + `MultiplyBlending`（§13.4） |
| 路面出现**近黑的「破洞/污渍」** | Multiply 混合下乘数过低（材质色深 / opacity<1 / instanceColor 太小）。乘数必须贴近 1（§13.4） |
| 路旁一片**「满地的细棍/竹签/倒伏木板」** | 某层几何长径比 >6:1 或实例随机倾角过大。用 CDP 量长径比定位（§13.4.1） |
| 秋季整体「一坨紫泥」、物体没有固有色 | `autumn.fog` 用了饱和紫 + 密度过高；雾色饱和度必须显著低于场景主色（§13.4.2） |
| 「冬→春/沙滩」切换时路面残留浅蓝矩形 | `footprints.visible` 未卡 `wI.snow` 阈值（它是平滑插值量，切离雪天缓慢衰减）（§13.3） |
| 低画质下、非城市主题里出现红绿灯 | `refreshPropVisibility()` 未被调用 / 可见性被单开关直写（§13.2） |
| 某类道具少了几个/位置错乱 | `InstancedMesh` 容量按逻辑数而非最大实例数分配（左右成对层须 ×2，陷阱 18） |
| 切档位卡顿 | 是否重建了几何；应只改 `InstancedMesh.count` / `setDrawRange`（§13.1） |
| 控制台刷 `MultiplyBlending requires premultipliedAlpha` | 乘算混合材质缺 `premultipliedAlpha: true`（陷阱 17） |
| 调低画质后画面变化很小 | `ambienceExtras` / `lampLayers` / `shadowQuality` 等字段是否真的被消费（§13.1/13.5） |
| 植被压到路沿上、读成「路上的碎块」 | 摆放内沿 < 路面半宽 4.8 + 实例半径；按净距重设内沿（§13.4.1 第 4 条） |

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

---

## 13. 场景美术与光照：三层密度/分档体系（2026-10-05 新增）

> 需求背景：用户连续三轮反馈「不局限于现有画面，可以更丰富（做好性能层级和自身优化）」→
> 「场景细节还是不够」。**核心痛点收敛为「细节密度 / 微细节」而非「元素种类」**。
> 改造范围：`themes.ts`（主题参数层）+ `VoxelWorld.ts`（场景结构层）+ `quality.ts`（画质联动层）。

### 13.1 三层常量体系（**改密度前必读**）

```
BASE_*  = medium（densityScale = 1.0）基准数量
MAX_*   = round(BASE * MAX_DENSITY_SCALE)，MAX_DENSITY_SCALE = 1.4
          → **所有 InstancedMesh / BufferGeometry 的预分配容量**
effective = clamp(round(BASE * max(MIN_DENSITY=0.6, densityScale)), 1, MAX)
```

- **降级方式**：`InstancedMesh.count = effective`（three 按 count 遍历，**切档零重建几何**）；
  `Points` 用 `setDrawRange`。**绝不重建几何、不重分配数组**（§2.4 硬约束）。
- `applyDensity()`（`VoxelWorld`）算全部 effective count 并同步 `count`；
  `applyDecorDensity()` 只调 `Points.setDrawRange` + 蝴蝶逐只显隐。
- **构造函数顺序必须「先 `applyDensity()` 再 `applyDecorDensity()`」**：后者依赖 `this.extras`。
- `QUALITY_SETTINGS.ambienceExtras` 是 **P3/P4 新增层的总闸**（low = false → 新层 count 全 0）。

### 13.2 正交可见性合成（`refreshPropVisibility`）

`traffic` / `clouds` 的可见性同时受 **主题族**（`setTheme`）与 **档位**（`applyDensity`）控制。
两处各自直写 `visible` 会互相覆盖——症状是「低档位下、非城市主题里，出现卡在路边的幽灵红绿灯」
（setTheme 把被裁掉的红绿灯重新点亮到上一轮的**陈旧位置**）。

**正解**：两个开关分别写 `userData.familyOn` / `userData.byDensity`，
由 `refreshPropVisibility()` 合成 `visible = familyOn && byDensity`，
`setTheme` 与 `applyDensity` 末尾都调用它。

### 13.3 新增的密度层（数量随档位；low 档不画）

| 层 | BASE | 说明 | 可见条件 |
|---|---|---|---|
| `mosses`（L0 苔藓） | **68** | 扁平多面体贴地（Y 缩 0.42~0.58，兼有厚度），铺在路肩→草皮过渡带（\|x\| 6.0~9.5） | `!isCity` |
| `tallGrass`（L3 芒草丛） | **34** | 6 片带锥度莲座叶（0.26×1.02），只在远侧（\|x\| 6.4~11.6）拉地平线毛边 | `!isCity` |
| `curbs`（路缘石） | 30 ×2 | 半埋矮条石（0.3×0.16×1.0，y=0.055），给路面一个路肩参照 | 全主题 |
| `decals`（路面贴花） | **30** | 磨损/湿痕，`MultiplyBlending` 极淡暗渍（乘数 0.86~0.95，见 §13.4） | 全主题 |
| `benches`（长椅） | 12 | 座+背+双腿合并几何，朝道路 | 全主题 |
| `signs`（路牌） | 10 | 细杆 + 方板 | 全主题 |
| `fences`（矮篱笆） | 14 ×2 | 柱高 0.52、每段仅占间距 55%、`s2<0.22` 断段 | `!isCity` |
| `farTreeLine`（远景剪影带） | 1 | 96 齿 `ShapeGeometry`，`z = charZ - 160`，视差≈0 | `!isBeach` |
| `footprints`（雪面脚印） | 18 ×2 | 身后 0.9m 起、每 0.62m 一个，越远越淡 | `snowActive && wI.snow>0.3 && extras` |
| `dust`（灯下微尘） | 240 点 | 纯 GPU 上浮粒子，聚集在 \|x\|≈5.4 的灯柱区 | `extras && !rain` |

> **第四轮下调**（`moss 96→68`、`tallGrass 54→34`、`decal 44→30`、`reed 160→110`）：
> 用户反馈「太杂」后，这些层从「宁多勿少」改为「宁少勿多」——
> 在**已经有多层植被**的前提下，同类元素堆量只会互相抵消、读成噪声。
> 密度不是「细节感」的来源，**层次与形状的可读性**才是（见 §13.4.1）。

**容量陷阱**：`curbs` / `fences` 是左右成对摆放，`MAX_*` 是**单侧**上限，
故 mesh 容量写 `MAX_* * 2`（与 `canopyLow` 的 `MAX_TREE_N * 2` 同惯例）。见 §8 陷阱 18。

### 13.4 视觉教训：贴花必须「只能压暗」（★ 第四轮修正，以此为准）

路面贴花（`decals`）改过**三轮**才做对：
1. 初版 `MeshStandardMaterial` + `opacity 0.5` → 受阳光照亮后**比路面更亮**，读成「地上的纸片/垃圾」。
2. 压到 `opacity 0.14` 仍是 Standard 材质，直射光下在阴影路面中依旧偏亮。
3. 改用 `MeshBasicMaterial` + `MultiplyBlending` 方向对了，但**误留深色材质色 `#5c6068` + `opacity 0.85`**
   → 乘数 ≈ `0.36 × 0.7 × 0.85 ≈ 0.21`，把路面压到约 21% 亮度（**近黑**），
   在浅色路面（春/冬/沙滩）上直接读成「一个个破洞/污渍」——**这是用户反馈「太杂」的最刺眼来源**。

**★★ 正解（务必照抄）**：
- 材质色恒定 **`#ffffff`**（基准乘数 1.0）、`opacity: 1`、`premultipliedAlpha: true`、`MultiplyBlending`。
- **压暗幅度只由 `instanceColor` 的 `0.86~0.95` 决定**（只压暗 5%~14%，读作「淡淡湿痕」）。
- 判断口诀：**Multiply 混合下，乘数必须贴近 1**。「想更明显」的正确做法是**多摆几片**，
  而不是把乘数调低——乘数一低就从「湿痕」跳变成「黑洞」。
- 冷中性（而非暖褐）：与蓝调雪面/夜色路面混合时不会污染出橄榄黄。

配套结论：
- 贴花尺寸宜小不宜大（`0.4~0.9` 倍）——大片即便很淡也容易读成「异物」。
- **不要给贴花做「雪面提亮」**（暖褐 × 冷色雪面 = 橄榄黄，读成另一种材质）。
- **路牌面板不要向纯白插值**（会在雾里读成「悬空的纸片」）；用主题 `curb` 色 ×0.78。
- **篱笆不要高、不要首尾相接**：初版柱高 0.72 + 密排 → 两侧连成「围栏墙」压过植被；
  压到 0.52 + 55% 占距 + 断段 + 颜色 ×0.62 后才是「隐约的田埂边界」。

### 13.4.1 视觉教训：细长几何 = 「满地的棍」（★ 第四轮新增，通用规则）

用户「太杂/太乱」的第二来源，是**一堆长径比过高的几何**。低饱和远景下它们本无妨，
但一旦主题叶色饱和（秋季 `#d97b3f/#c45a3a`）或路面浅亮，它们立刻从「草」退化成「棍/竹签/薄片」。

**诊断手法（推荐复用）**：CDP 遍历 `scene.traverse`，对每个 `isInstancedMesh` 取实例矩阵，
解出 `sx/sy/sz` 三轴模长，算 `max/min` 长径比；**> 3 的实例即在视觉上读作「棍」**。
同时打印 `geometry.boundingBox` 的基准长径比与 `instanceColor` 是否存在。

**实测锁定 + 修法**：

| 层 | 旧值（长径比） | 新值（长径比） | 关键手法 |
|---|---|---|---|
| `tallGrass` | `0.11×1.75`（16:1） | `0.26×1.02`（3.9:1） | 加宽 + 顶端收窄（锥度）+ 6 片莲座替 4 片十字 |
| `reeds` | `0.09×1.15`（12.8:1） | `0.17×0.92`（5.4:1） | 加宽压矮；**色 lerp `curb` 0.3→0.72**，退出饱和 foliage 家族 |
| `mosses` | Y 缩 `0.06~0.13`（**实测 21.2:1**） | Y 缩 `0.42~0.58`（实测 7.3:1） | 「扁」要有下限；Y 太低就从「苔痕」变「插在地上的薄片」 |
| `stumps` 倒木 | 长 `1.6+s1` × 半径 0.2（13:1） | 长 `1.0+s1*0.5` × 半径 ×1.25 | 倒木概率 0.5→0.22，加粗径向 |

**通用规则**：
1. **任何「草/叶」类几何，宽度不得低于 ~0.17，长径比控制在 ~6:1 以内**。
   低于此值，侧看只剩一条竖缝 → 读成细棍。
2. **实例的随机倾角也是「倒伏木棍」的来源**：`tallGrass` 的 `rotation.x` 从 ±0.18 收到 ±0.10
   后，观感从「满地折断的板」回到「站着的草丛」。
3. **颜色也要匹配身份**：芦苇是**枯黄老秆**，若沿用饱和 `foliage` 色（秋季橙红）就会读成
   「红竹签」。用 `lerp(curb, 0.72)` 让它退回背景。
4. **内沿必须让开路面**（半宽 4.8）：按「内沿 − 实例半径」算净距。
   `moss` 5.0→6.0、`tallGrass` 7.0→6.4、`reeds` 5.4→6.2，否则植被压到路沿上。

### 13.4.2 视觉教训：秋日雾色不要用饱和紫

`autumn.fog = '#7d5470'`（**饱和紫**）+ `fogDensity 0.02` → 把路面、植被、天空**全部染成「一坨紫泥」**，
物体固有色被吃掉（用户「颜色/光照怪」的主因）。
改为 `'#a8836f'`（低饱和暖灰玫瑰）+ `fogDensity 0.016` —— 保留黄昏余晖的暖意，但不再糊住固有色。
**规则：雾色是「加在一切之上的一层」，饱和度必须显著低于场景主色，否则会统一压过所有物体。**

### 13.5 P6 灯光质感与假阴影

- **灯柱三层光晕**：`glow`（内核）/ `glowOuter`（中层，3.4×）/ `glowFar`（P6 外层，8×，最淡）。
  由 `lampLayers`（1/2/3）与 `volumetricLight`/`godrayLayers` 分别控制 `glowOuter`/`glowFar`/`cone`/`spot`。
- **假接触阴影双层椭圆**：slot 0 = 内层小而深，slot 1 = 外层大而淡（`shadowQuality>=2` 才画）。
  slot 2.. = 灯柱在路面的**长条影**（拉伸贴片朝路面中心倒）。**始终不开 shadowMap**
  （无限赛道 + 全实例化每帧重写 + `genFade` 缩零实例 → 阴影相机抖动/漏光，收益代价倒挂）。
- **海面反射带 `uReflect`**：以 `uReflectX`（跟随 `celestialX`）为中心的高斯亮带 + 高频 glint
  调制成碎光；强度取主题 `seaReflect`，颜色取 `celestialColor`。
- **天空三层 `uHorizonSharp`**：`bottom → mist（mistColor ?? fog）→ top` 三段混合，
  夜间 `horizonSharp = 1.05`、日景 `0.7`。`mist` 默认取 `fog` 以保证天地无缝。
- **霓虹上色**：逐实例取主题 `neonHue`，叠加 0.75~1.1 亮度错落，夜晚 ×1、白天 ×0.55。

### 13.6 P5 动态微细节

- **涟漪 3 环 → 5 环**（路面 shader，`for k < 5`）。
- **踩草倒伏**：角色前后 3.5m 内、靠近路肩的草被「压向路外」，
  权重 `near²`（连续衰减，避免硬阈值的台阶感）；`extras=false` 时关闭。
- **雪面脚印**：位置是 `distance` 的纯函数（无需环槽回收——印子只在身后 11m 内）。
- **灯下微尘**：240 点纯 GPU 上浮，`uOpacity` 夜间 0.42 / 白天 0.16 + 脉动。

### 13.7 分档实测（CDP 探针，SwiftShader）

| 档位 | InstancedMesh 数 | 实绘实例 | Sprite 数 | Points 顶点 |
|---|---|---|---|---|
| low | 9 | **628** | 13 | 903 |
| medium | 17 | 1362 | 35 | 966 |
| high | 17 | **1902** | 46 | 966 |

- low 档比 high 少画 **67%** 实例；medium 起多出的 8 个 InstancedMesh 正是 P3/P4 新层。
- **low 档不绘制任何新增内容** → 「low 帧率不低于改造前」由构造保证。
- SwiftShader 下三档帧率差异被全屏 fill 淹没（均 ~8.5fps），**绝对帧率无参考价值**，
  只能用于同机 A/B；真机帧率仍需本地 GPU 实测。
- **验证法**：无头 Edge + CDP 注入 `gl.compileShader`/`gl.linkProgram` 钩子 +
  `Page.reload({ignoreCache:true})`；本轮全部新增 shader（海面反射/天空 mist/微尘）编译 0 错误、
  运行期 console 0 error。探针必须 `run_in_background` 起 Vite 与 Edge，否则命令返回时子进程被杀。
