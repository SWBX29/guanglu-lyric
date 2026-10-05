/**
 * 画质分级：按设备能力自动探测 + 允许用户手动覆盖。
 *
 * 三档语义：
 * - 'low'    流畅：仅保留无开销的色彩管线修复（OutputPass + ACES），关闭 MSAA / 接触阴影
 * - 'medium' 标准：+ MSAA samples 4 + 接触阴影（桌面主流默认）
 * - 'high'   极致：+ 更强的 bloom 半径与更多装饰细节
 *
 * 探测只读、无副作用；结果不落 localStorage（持久化由调用方负责）。
 */

export type QualityLevel = 'low' | 'medium' | 'high';

/** 用户可选值：'auto' 表示跟随设备探测 */
export type QualityChoice = 'auto' | QualityLevel;

export interface QualitySettings {
  /** composer 的 MSAA 采样数（0 = 关闭） */
  msaaSamples: number;
  /** 接触阴影（角色/路灯/树/建筑根部的假阴影） */
  contactShadows: boolean;
  /** bloom 半径倍率（1 = 主题基准） */
  bloomRadiusScale: number;
  /** 装饰实例密度倍率（1 = 基准） */
  decorDensity: number;
  /** 是否启用更重的后处理（预留：SSAO 等） */
  heavyPost: boolean;
}

export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  low: {
    msaaSamples: 0,
    contactShadows: false,
    bloomRadiusScale: 1.0,
    decorDensity: 1.0,
    heavyPost: false,
  },
  medium: {
    msaaSamples: 4,
    contactShadows: true,
    bloomRadiusScale: 1.0,
    decorDensity: 1.0,
    heavyPost: false,
  },
  high: {
    msaaSamples: 4,
    contactShadows: true,
    bloomRadiusScale: 1.25,
    decorDensity: 1.3,
    heavyPost: false,
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

/** WebGL2 可用性探测（SSAA samples 需要 WebGL2） */
function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * 按设备能力推断档位。保守优先：任何探测失败都退回 low，避免低端机卡死。
 * 判定依据：核心数 / 设备内存（若可用）/ WebGL2 / 是否移动端 / DPR。
 */
export function detectQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'medium';

  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
  const cores = navigator.hardwareConcurrency || 0;
  // deviceMemory 非标准（Chromium 系可用），单位 GB
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  const webgl2 = hasWebGL2();

  // 移动端：只在明显高配时给 medium，其余一律 low
  if (isMobile) {
    if (cores >= 8 && dpr <= 3 && webgl2) return 'medium';
    return 'low';
  }

  // 桌面：低核数/低内存直接 low
  if (cores > 0 && cores <= 4) return 'low';
  if (mem > 0 && mem <= 4) return 'low';

  // 高配桌面：≥12 核 + WebGL2
  if (cores >= 12 && webgl2) return 'high';

  // 其余桌面按 medium
  return 'medium';
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

export { resolveQuality as _resolveQuality };
