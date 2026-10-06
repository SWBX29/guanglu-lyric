/**
 * 画质分级：按设备能力自动探测 + 允许用户手动覆盖。
 *
 * 三档语义（差异必须肉眼可辨，且逐档降低 GPU 填充开销）：
 * - 'low'    流畅：无 MSAA、Byte HDR、bloom 减半采样、关闭接触阴影与装饰
 * - 'medium' 标准：MSAA 2x、无 HDR 浮点 RT、bloom 半分辨率、接触阴影开
 * - 'high'   极致：MSAA 4x + HalfFloat HDR RT、全分辨率 bloom、装饰 ×1.3
 *
 * 设计要点（性能关键，勿随手改）：
 * - MSAA 与 HalfFloat 是最贵的两项：samples 每 +1 约线性增加光栅化与 resolve 成本，
 *   HalfFloat 让每像素带宽翻倍。二者只在 high 同时开启。
 * - bloom 的 resolution 决定其 5 级 mip 链的总像素量：半分辨率可省约 75% 填充。
 * - decorDensity 控制装饰实例数量（萤火虫/蝴蝶/花瓣/风痕），必须被 buildXxx 真正读取。
 *
 * 探测只读、无副作用；结果不落 localStorage（持久化由调用方负责）。
 */

export type QualityLevel = 'low' | 'medium' | 'high';

/** 用户可选值：'auto' 表示跟随设备探测 */
export type QualityChoice = 'auto' | QualityLevel;

export interface QualitySettings {
  /** composer 的 MSAA 采样数（0 = 关闭）。高开销，仅 high 开 4。 */
  msaaSamples: number;
  /** composer 的 RenderTarget 是否用 HalfFloatType（HDR）。高开销，仅 high 开。 */
  hdrHalfFloat: boolean;
  /** bloom 内部 RT 分辨率倍率（1 = 全分辨率；0.5 = 半分辨率，省约 75% 填充） */
  bloomResolutionScale: number;
  /** 接触阴影（角色/路灯/树/建筑根部的假阴影） */
  contactShadows: boolean;
  /** bloom 半径倍率（1 = 主题基准） */
  bloomRadiusScale: number;
  /** 装饰实例密度倍率（1 = 基准；被萤火虫/蝴蝶/花瓣/风痕读取） */
  decorDensity: number;

  // ---- 场景细节密度与光照分级（细节增强 pass 新增）----

  /**
   * 场景元素密度倍率：决定「实际绘制」的实例数量。
   *
   * ★ 容量一律按 high 上限预分配（buildXxx 用 MAX_DENSITY_SCALE 算容量），
   *   低档用 setDrawRange / scale=0 降级，**绝不重建几何或重分配数组**。
   * 语义：low 0.6（并隐藏所有新增元素）/ medium 1.0 / high 1.4
   */
  densityScale: number;
  /** 假接触阴影层数：0 = 无 / 1 = 单层椭圆 / 2 = 双层 + 灯柱长条影 */
  shadowQuality: 0 | 1 | 2;
  /** 灯柱光锥 / 体积光柱是否渲染 */
  volumetricLight: boolean;
  /** 灯柱光晕层数（1 = 仅 glow / 2 = +glowOuter / 3 = +glowFar） */
  lampLayers: 1 | 2 | 3;
  /** 雾密度与曝光的逐帧呼吸是否启用（low 关闭，省常数级开销） */
  fogBreath: boolean;
  /** 大气扩展层总开关（光尘 / 薄雾带 / 车流光带 / 浪线 / 落地堆积） */
  ambienceExtras: boolean;
  /** 星空点数（setDrawRange 降级） */
  starCount: number;
  /** 体积光柱层数 */
  godrayLayers: 0 | 1 | 2;
}

/**
 * 实例容量的预分配倍率。
 *
 * 所有 InstancedMesh / Points 的**容量**都按此值（high 档上限）分配，
 * 这样运行时切档只需要 setDrawRange / scale=0 降级，永远不会重建几何。
 */
export const MAX_DENSITY_SCALE = 1.4;

export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  low: {
    msaaSamples: 0,
    hdrHalfFloat: false,
    bloomResolutionScale: 0.5,
    contactShadows: false,
    bloomRadiusScale: 1.0,
    decorDensity: 0.5,
    densityScale: 0.6,
    shadowQuality: 0,
    volumetricLight: false,
    lampLayers: 1,
    fogBreath: false,
    ambienceExtras: false,
    starCount: 600,
    godrayLayers: 0,
  },
  medium: {
    msaaSamples: 2,
    hdrHalfFloat: false,
    bloomResolutionScale: 0.5,
    contactShadows: true,
    bloomRadiusScale: 1.0,
    decorDensity: 1.0,
    densityScale: 1.0,
    shadowQuality: 1,
    volumetricLight: true,
    lampLayers: 2,
    fogBreath: true,
    ambienceExtras: true,
    starCount: 1200,
    godrayLayers: 1,
  },
  high: {
    msaaSamples: 4,
    hdrHalfFloat: true,
    bloomResolutionScale: 1.0,
    contactShadows: true,
    bloomRadiusScale: 1.25,
    decorDensity: 1.3,
    densityScale: 1.4,
    shadowQuality: 2,
    volumetricLight: true,
    lampLayers: 3,
    fogBreath: true,
    ambienceExtras: true,
    starCount: 2000,
    godrayLayers: 2,
  },
};

export const QUALITY_LABELS: { value: QualityChoice; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '流畅' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '极致' },
];

const STORAGE_KEY = 'guanglu:quality';

function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'low' || v === 'medium' || v === 'high';
}

/** WebGL2 可用性探测（MSAA samples 需要 WebGL2） */
function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** GPU 描述串（经 WEBGL_debug_renderer_info；不可用时返回空串） */
function gpuRenderer(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg
      ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);
    return (name || '').toLowerCase();
  } catch {
    return '';
  }
}

/** 已知的低端/软件渲染 GPU 特征（命中即强制 low） */
const WEAK_GPU_PATTERNS = [
  'swiftshader',      // 软件渲染，任何 MSAA 都会卡死
  'llvmpipe',
  'software',
  'basic render',
  'microsoft basic',
  'mesa offscreen',
];

/**
 * 老旧的核显 / 早期 iGPU：即便 CPU 核数很多也扛不住后处理，强制 low。
 * 判定优先于 ENTRY（Intel HD 4000 这类 2012 年 iGPU 连 medium 的 2x MSAA 都吃力）。
 */
const LEGACY_GPU_PATTERNS = [
  'hd graphics 4000',
  'hd graphics 3000',
  'hd graphics 2500',
  'hd graphics 2000',
  'hd graphics 500',      // Apollo Lake 时代的弱核显
  'hd graphics 505',
  'gma',
  'radeon hd',
];

/**
 * 入门级 GPU：可以跑 medium，但不建议上 high。
 * 注意只放「桌面」可识别的型号；移动 GPU 由 isMobile 分支单独处理，
 * 否则会把 Adreno 740 这类旗舰移动 GPU 也按桌面入门卡降级。
 */
const ENTRY_GPU_PATTERNS = [
  'radeon 5',        // Radeon 520/530/540...（2016 入门独显）
  'radeon r5',
  'radeon r7',
  'hd graphics',     // 未被 LEGACY 命中的其余 HD Graphics
  'uhd graphics',
  'intel(r) hd',
  'intel(r) uhd',
  'iris xe',
];

/**
 * 按设备能力推断档位。
 *
 * 核心教训：**CPU 核心数不能推断 GPU 能力**。本机实测 16 核 / 16GB，
 * 但配的是 Radeon 520（2016 入门独显）——按核心数判 high 会导致 8× 填充开销、严重掉帧。
 * 因此以 GPU 描述串为主信号，CPU/内存/DPR 仅作辅助。
 */
export function detectQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'medium';

  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
  const cores = navigator.hardwareConcurrency || 0;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const webgl2 = hasWebGL2();
  const gpu = gpuRenderer();

  // 1. 软件渲染（SwiftShader / llvmpipe）/ GPU 串不可得 → 最保守
  if (!gpu || WEAK_GPU_PATTERNS.some((p) => gpu.includes(p))) return 'low';

  // 2. 移动端：一律不超过 medium（即便型号好看，发热降频后依然吃紧）
  if (isMobile) {
    return cores >= 8 && dpr <= 3 && webgl2 ? 'medium' : 'low';
  }

  // 3. 老旧核显 → low（必须在 ENTRY 之前判，否则会被 'hd graphics' 兜成 medium）
  if (LEGACY_GPU_PATTERNS.some((p) => gpu.includes(p))) return 'low';

  // 4. 低核数 / 低内存 → low（兜住老旧机器）
  if (cores > 0 && cores <= 4) return 'low';
  if (mem > 0 && mem <= 4) return 'low';

  // 5. 入门级桌面 GPU → 上限 medium（high 的 MSAA4 + HalfFloat 对这类卡是灾难）
  if (ENTRY_GPU_PATTERNS.some((p) => gpu.includes(p))) return 'medium';

  // 6. 剩余：明确的桌面独显 + WebGL2 → high
  return webgl2 ? 'high' : 'medium';
}

/** 把用户选择解析为实际档位 */
export function resolveQuality(choice: QualityChoice): QualityLevel {
  return choice === 'auto' ? detectQuality() : choice;
}

/** 读取持久化的用户选择（默认 'auto'） */
export function loadQualityChoice(): QualityChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'auto' || isQualityLevel(raw)) return raw;
  } catch {
    /* localStorage 不可用（隐私模式等）→ 走默认 */
  }
  return 'auto';
}

/** 写入用户选择 */
export function saveQualityChoice(choice: QualityChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* 忽略写入失败 */
  }
}
