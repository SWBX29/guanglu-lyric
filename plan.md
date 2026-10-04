# 迭代计划：歌词书写特效 + 粒子性能 + 可选天气 + 新地图

## 跨代理契约（两个代理都必须遵守）
- 主题扩展：themes.ts 新增两张地图，id 为 `city`（城市）和 `beach`（夏日海滩），连同现有 spring/autumn/winter 共 5 个主题
- 天气接口：VoxelWorld 新增 `setWeather(mode: WeatherMode)`，WeatherMode = 'auto' | 'clear' | 'petals' | 'rain' | 'leaves' | 'wind' | 'snow' | 'snowstorm'
  - 'auto' = 跟随当前主题默认天气（现状行为）
  - 天气与主题解耦：任何主题下可选任何天气
- Home.tsx 主题切换器遍历 themes 列表渲染 5 个主题；天气二级菜单调用 world.setWeather

## Agent A：场景（scene-weather 分支）
1. 粒子性能根治：雪/落叶/花瓣等下落粒子改 GPU 驱动（Points + 顶点着色器内 position = f(time, seed)，CPU 每帧只写 uniform）——消除一抽一抽
2. 天气系统重构为可选模式（见契约），setWeather 实现
3. 新地图：城市（建筑楼群、霓虹/窗灯、斑马线、路牌等）+ 夏日海滩（沙滩路、棕榈树、海浪/海面侧景、贝壳、遮阳伞等），low-poly 风格统一
4. 继续丰富现有三主题元素
5. 硬约束：零分配、实例化、pixelRatio≤1.5、签名兼容（update/setTheme 不变，新增 setWeather）

## Agent B：UI（lyric-write 分支）
1. 歌词模拟书写出现特效：当前行从左到右逐字揭示（clip-path/渐变 mask），带一个发光的"笔尖"点引导，速度跟随行实际时长（跟唱节奏），替代突然弹出
2. 歌词栏修复：去掉按距离模糊（全是糊的），对齐修正（统一左对齐或居中一致，行高稳定），保持可折叠
3. 主题切换支持 5 主题 + 天气二级菜单（chips：自动/晴朗/花瓣/细雨/落叶/阵风/雪/暴雪），调 world.setWeather
4. 不动 scene 内部实现（只调契约接口）、api/contracts/audio

## Stage 2：合并 + 构建 + 冒烟 + dynamic 版本
