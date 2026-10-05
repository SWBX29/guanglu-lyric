# 计划：项目 bug 与显示错误系统排查（全栈 · 线上 + 本地）

> **⚠️ 本计划已过期（2026-10-05 复核）**：基线 `2842904` 之后，`7ae5d93`（UI/播放状态机修复）
> 与 `a821b9d`（歌词糊团修复）已把本计划 §1.2 中 9 项高/中风险缺陷修掉。
> **不要再按本计划直接动手**；请以 `docs/HANDOFF.md` §6（V30–V34）为准。
> 另：§1.1 表格中的 **`vitest` 60/60 是错的**，实测为 **57/57**（`app/api/*.test.ts` 的 it 计数）。
> 逐项复核结论（HEAD `122c689`，详见文末）：

> | 项 | 现状 | | 项 | 现状 |
> |---|---|---|---|---|
> | A1 trackLoading 卡死 | ✅ 已修复 | | D8 笔尖越界 | ✅ 已修复 |
> | A2 play() 丢弃 Promise | ⚠️ 残留（`begin()` 本地路径）→ 已在 V34 修复 | | D9 光晕 z-index:-1 | ⬜ 待目视，未判定 |
> | A3 快速切歌守卫 | ✅ 已修复 | | D10 320px 开关贴边 | ✅ 已修复（V34/D-11） |
> | B4 歌词失败静默 | ✅ 已修复 | | E11 主题+天气压面板 | ✅ 已修复（结构重构）；展开态残留已在 V34 加固 |
> | B5 提示行叠加 | ✅ 已修复 | | E12 矮屏面板压缩 | ✅ 已修复（V34） |
> | C6 二维码僵尸态 | ✅ 已修复 | | F 后端/部署 | ✅ 复核无问题 |
> | C7 expired 高频循环 | ✅ 已修复 | | | |

> 目标：系统性检查「光路·歌词」全栈项目（React 前端 + Cloudflare Workers 后端）的 bug 与显示错误，
> **发现即修复并验证**（用户已确认），覆盖**本地与线上**两个环境，最终以回归 + 浏览器实测收口。
> 基线版本：HEAD `2842904`（播放直连模式）；工作树 clean。

---

## 一、现状分析（基于实际代码走查）

### 1.1 架构与基线
| 项 | 现状 |
|---|---|
| 前端 | `app/src/`：`pages/Home.tsx`（主页面/UI 编排）、`scene/VoxelWorld.ts`（2277 行 3D 场景，update 由 Home 的 rAF 驱动，无内部定时器）、`audio/AudioEngine.ts`、`components/NeteasePanel.tsx`、`components/LyricParticles.tsx`、`providers/trpc.tsx` |
| 后端 | `app/api/`：Hono + tRPC on Workers；`neteaseRouter.ts`（songUrl 直连降级）、`lib/songMedia.ts`（isolate 级直连缓存）、审计/会话/代理签名 |
| 质量门基线 | `tsc -b` 绿；`vitest` **57/57**（实测；原写 60/60 有误）；`vite build` OK；CI push 即自动部署（`.github/workflows/ci.yml`） |
| 本地运行 | 需双终端：`npm run dev:worker`（8787，绑定+D1+secrets）→ `npm run dev`（3000，`/api/*` 代理到 8787） |
| 线上 | https://lyric.swbx.cc.cd （自定义域名）+ workers.dev 双入口；生产取链受网易云风控 → 走**直连模式**（无频谱） |
| 强制约定 | 所有命令走 `scripts/run.mjs`；本地 D1 命令须沙箱外跑（陷阱 14）；推 GitHub 需代理 7900 + 集成 token（陷阱 13） |

### 1.2 走查发现的候选缺陷（按风险排序，待运行时确认）

**A. 播放状态机（Home.tsx，高）**
1. [Home.tsx L246-268](file:///e:/AIwork/Kimi_Agent/app/src/pages/Home.tsx#L246-L268) + [L299-319](file:///e:/AIwork/Kimi_Agent/app/src/pages/Home.tsx#L299-L319)：`playNetease` 置 `trackLoading=true`，但 `songUrlQ` **查询出错（isError）时 data 为 undefined**，effect 直接 return → `trackLoading` 永不复位 → HUD 永久显示「加载中…」，且无任何错误提示。
2. [AudioEngine.ts L153-157](file:///e:/AIwork/Kimi_Agent/app/src/audio/AudioEngine.ts#L153-L157)：`play()` 丢弃 `el.play()` 返回的 Promise；被浏览器自动播放策略拦截（iOS/Safari 高危）时**静默失败**，而 Home 无条件 `setPlaying(true)` → 播放按钮状态与实际播放脱节。
3. 快速连续点歌：旧查询 promise 晚到时可能对新上下文生效（需实测确认是否产生串歌/错误态）。

**B. 歌词链路（Home.tsx，中）**
4. [Home.tsx L271-297](file:///e:/AIwork/Kimi_Agent/app/src/pages/Home.tsx#L271-L297)：`lyricQ` 请求失败时同样静默 return，界面无任何反馈（纯音乐提示也不出现）。
5. `directPlay` 与 `pureMusic` 两个提示行可能同时渲染（文案叠加，小瑕疵）。

**C. 网易云面板（NeteasePanel.tsx，中）**
6. [NeteasePanel.tsx L39-50](file:///e:/AIwork/Kimi_Agent/app/src/components/NeteasePanel.tsx#L39-L50)：轮询 60s 上限到点后**静默停止**，状态文案仍是「请用网易云音乐 App 扫码」→ 僵尸态，无刷新入口。
7. `qrcodeCheck` 返回 `expired`（含 qr_bind 失效路径）→ 600ms 自动 `qr.refetch`；若反复失败需确认不会高频循环。

**D. 歌词列表显示（index.css / Home.tsx，待视觉确认）**
8. [index.css L212-242](file:///e:/AIwork/Kimi_Agent/app/src/index.css#L212-L242)：发光「笔尖」`.lyric-pen` 的 `left:0→100%` 以**整行容器宽度**为轨道；行容器为 flex 拉伸（可能宽于文字）→ 笔尖可能飘到文字右侧空白处。需浏览器实测确认。
9. `.lyric-list-cur::before` 光晕 `z-index:-1` 在带背景的父容器内可能不可见（视觉确认）。
10. 320px 窄屏「歌词面板开关」`right: calc(min(80vw,300px)+32px)` 贴边临界（视觉验证）。

**E. 布局/响应式（待视觉确认）**
11. 右上角 5 个主题按钮 + 8 个天气 chips 纵向排列，与右侧居中的歌词面板在**矮屏/手机**上可能重叠。
12. 网易云面板 `top-[4.5rem] bottom-28` 在矮屏内容区被压缩（QR 区 + 列表可用性）。

**F. 后端/部署（低，随查随验）**
13. `songUrl` 直连判定：仅取链 API 失败时 `markDirectMode`；VIP 分支与 `data.message` 分支不标记（符合预期，复核即可）。
14. 直连模式全链路仅在**线上**可复现（本地中国出口取链成功）。

---

## 二、执行方案（阶段化，每步产出证据）

### 阶段 0：基线与环境准备（只读/启动）
1. `git status` / `git log -1` 记录基线；工作树应 clean。
2. 跑静态门（清理沙箱差异，全部经 `scripts/run.mjs`）：
   - `cd app && npm run check`
   - `npm run test`（期望 ≥60/60）
   - `npm run lint`
   - `npm run build`
3. 启动本地双服务（后台进程）：`npm run dev:worker`（8787）→ `npm run dev`（3000）；用 `curl http://localhost:3000/api/health` 验证 `{"ok":true,"storage":true,"key":true}`（注意用 `localhost` 而非 `127.0.0.1`，陷阱 11）。
4. 线上连通性预检：`curl` 线上 `/api/health` 与首页（直连失败则经代理，属尽力而为）。

### 阶段 1：代码级定向审查（对照 1.2 清单逐项）
对候选 A–F 逐项做「复现判定 → 修复决策」，**只修可确证的 bug**，每项记录：现象/根因/改法。
修复决策（已定，执行时直接照做）：
- **A1**：`Home.tsx` 增加对 `songUrlQ.isError` 的处理：设 `playError('获取播放地址失败，请重试')` + `trackLoading=false`；并在 `playNetease` 中处理「同曲重试」路径（此前失败后点同一首不应无响应）。
- **A2**：`AudioEngine.play()` 改为返回/传播 Promise；`Home.togglePlay` 与自动播放处 `catch` 后回退 `playing=false` 并提示（自动播放被拦时给可操作文案）。
- **B4**：`lyricQ.isError` 时显示「歌词获取失败」小字提示（复用现有 HUD 文案位）。
- **B5**：提示行互斥（直连/纯音乐二选一，按优先级）。
- **C6**：60s 轮询上限后若仍 waiting，显示「二维码已超时」+「刷新」按钮（调 `qr.refetch`）。
- **D8/D9/D10、E11/E12**：浏览器实测确认后再定最小修法（D8 若确认：把字符序列包进 `inline-block` 相对定位的内层容器，笔尖轨道改为文字宽度；E11 若确认：窄屏下把天气菜单收起为可展开行或下移）。
- **F**：复核后无问题则不改。

### 阶段 2：本地运行时浏览器验证（browser_use 子代理）
URL：`http://localhost:3000`（前置：阶段 0 双服务已启动）。检查项（每步抓 console 错误 + 截图）：
1. 首屏：开始浮层完整渲染、无控制台报错。
2. 「内置小曲」启动 → 3D 场景渲染、歌词逐字书写 + 扫光 + 飞行字幕 + 粒子聚散。
3. 歌词面板：折叠/展开动画、开关位置。
4. 主题切换 ×5、天气 chips ×8（自动/晴朗/花瓣/细雨/落叶/阵风/雪/暴雪）视觉生效、无异常。
5. 网易云面板：搜索《稻香》→ 结果显示；点歌 → 加载 → 播放；QR 码正常渲染（不真扫）。
6. 播放控制：暂停/继续/进度条/点歌词行 seek。
7. **移动端视口（390×844 与 320×568）**：重点核 1.2-D/E 的重叠与贴边问题。
8. `/summary/` 静态页加载与控制台。
> 若浏览器子代理无法连 localhost，改用 Exec/curl 做 API 面验证 + 记录视觉项为「未能浏览器验证」。

### 阶段 3：线上运行时验证（browser_use 子代理）
URL：`https://lyric.swbx.cc.cd`（若浏览器侧不可达，降级为代理 curl 验证 API，视觉项列明未验）。
1. 首屏 + 开始浮层 + 控制台（CSP/字体/资源报错）。
2. 匿名搜索 → 点歌 → **直连模式**实测：出现「直连播放（当前网络下无频谱）」、音频真实出声、进度走字、歌词同步；无频谱时场景不报错。
3. 主题/天气/歌词面板在真实链路上的表现。
4. 记录直连模式下 UI 文案叠加（B5）与任何手机端显示异常。

### 阶段 4：修复-回归-提交-部署-终验
1. 每修完一项：`npm run check` + `npm run test`（全绿）+ 针对性浏览器复验。
2. 全部修复后跑一次完整静态门 + 本地浏览器回归（阶段 2 关键路径重跑）。
3. 提交（按项目风格拆分 commit；涉及多类修复则分 feat/fix 提交）。
4. 推送触发 CI 自动部署（HANDOFF §8 陷阱 13 的命令）：
   `git -c "http.proxy=http://127.0.0.1:7900" -c "https.proxy=http://127.0.0.1:7900" -c credential.helper= -c "credential.helper=!gh auth git-credential" push`
   失败兜底：本机 `npm run deploy`（OAuth 部署）。
5. CI/部署完成后，线上复验修复项（阶段 3 对应路径再跑一次）。
6. 按项目惯例同步 `docs/HANDOFF.md`（新增验证记录/陷阱，若有）。

---

## 三、假设与决策
- **修 vs 报**：已确证 bug 直接修；纯样式/文案类小瑕疵低风险则修，其余列清单说明。
- **不改**：安全模型、tRPC 契约字段、场景签名（update/setTheme 等）除必要 bug 外不动。
- **命令约定**：一律 `scripts/run.mjs` 包装；D1 本地命令沙箱外（本计划基本不涉及）；测试/构建预期沙箱内可跑。
- **环境约定**：浏览器验证优先用「浏览器控制」插件的子代理；线上不可达时降级 curl + 明示未验项。
- **不可验证项**（提前声明）：真人手机扫码登录、真实手机设备（非模拟视口）、iOS/Safari 实机、CF CPU 额度（1102）——列清单交人工。
- **直连模式**只能在线上复现，本地仅能验证 `spectrum:true` 正常链路 + 代码路径走查。

## 四、验收标准（完成定义）
- [x] `npm run check` exit 0；`npm run test` 全绿（**实测 57**，非 60）；`npm run lint` 无新增（26 项历史）；`npm run build` 成功。
- [x] 1.2 清单 A–F 每项有结论（见文末逐项复核表：9 项已修复、A2/D10/E11/E12 已在 V34 修复、D9 待目视）。
- [ ] 本地浏览器关键路径零控制台错误，截图留证；移动视口无重叠/溢出（或已修复）。
- [ ] 线上复验：直连播放链路、搜索、面板显示正常；修复项在线上生效。
- [ ] 有代码变更时：commit + push（CI 部署成功）或本地 deploy 成功；HANDOFF 同步。

## 五、风险与限制
- 线上视觉验证受本机网络/代理影响（workers.dev 直连被黑洞；自定义域名尽力而为）。
- 网易云风控可能随时间变化，直连/取链行为以实测为准，不视为本项目 bug。
- 浏览器子代理单次 URL 上限 3 个：本计划本地 1 个 + 线上 1 个，需分两次调用。