/**
 * 播放直连模式的支持模块。
 *
 * 背景（2026-10-04 实测，见 docs/HANDOFF.md §6 V29）：
 * 网易云对云厂商出口（Cloudflare）的取链端点统一下发风控挑战（`code: -462`），
 * 服务端无法出流；但**客户端直连**网易云公开外链端点（手机 / 中国出口）可正常
 * 播放（已实测可用）。因此取链 API 失败时降级为「直连模式」：
 * 客户端 `<audio>` 直接播放外链端点 —— 音乐 / 歌词 / 进度可用，
 * 唯独拿不到频谱（外链无 CORS，WebAudio 分析器读不到字节）。
 *
 * 命中过的 id 在 isolate 内缓存，避免每次点歌都白打一遍 weapi
 * （双层 AES + BigInt 模幂，是评审核验过的 CPU 敏感项）。
 */
const DIRECT_MODE_TTL_MS = 10 * 60 * 1000;

/** id -> 在该时刻前直接走直连模式（不再尝试服务端取链）。isolate 级、尽力而为。 */
const directModeUntil = new Map<string, number>();

export function markDirectMode(id: string, now: number = Date.now()): void {
  directModeUntil.set(id, now + DIRECT_MODE_TTL_MS);
}

export function isDirectMode(id: string, now: number = Date.now()): boolean {
  const until = directModeUntil.get(id);
  if (until === undefined) return false;
  if (until <= now) {
    directModeUntil.delete(id);
    return false;
  }
  return true;
}

/** 公开外链端点：客户端直连播放（浏览器跟随 302 到 CDN mp3） */
export function outerSongUrl(id: string): string {
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

/**
 * 网易云请求的显式 User-Agent：服务端 fetch 默认不带 UA，
 * 而网易云对空 UA 的客户端会退回 302 错误链（实测；音频代理出站复用此头）。
 */
export const OUTER_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "GuangluLyric/1.0 (+https://lyric.swbx.cc.cd)",
};