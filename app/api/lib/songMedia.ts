/**
 * 播放媒体 URL 解析 —— 网易云区域限制的绕行层。
 *
 * 背景（2026-10-04 实测，见 docs/HANDOFF.md §9/V29）：
 * weapi 取链端点对 **Cloudflare 出口稳定返回 `code: 404`**（同一 id 从中国出口
 * 可正常取链，属版权区域限制/风控）；而公开外链端点
 * `music.163.com/song/media/outer/url` 在海外出口同样可用（实测 206 + audio/mpeg，
 * 无需 weapi、无需登录，重定向到 CDN mp3）。
 *
 * 因此策略为：**API 直链优先，失败回退外链端点**。
 * 失败过的 id 在 isolate 内缓存一段时间，避免音频代理的每个 Range 请求都白打
 * 一遍 weapi（双层 AES + BigInt 模幂，是评审核验过的 CPU 敏感项）。
 */
const API_FAIL_TTL_MS = 10 * 60 * 1000;

/** id -> 在该时刻前优先用外链（不再尝试 weapi）。isolate 级、尽力而为。 */
const preferOuterUntil = new Map<string, number>();

export function markApiFailed(id: string, now: number = Date.now()): void {
  preferOuterUntil.set(id, now + API_FAIL_TTL_MS);
}

export function shouldPreferOuter(id: string, now: number = Date.now()): boolean {
  const until = preferOuterUntil.get(id);
  if (until === undefined) return false;
  if (until <= now) {
    preferOuterUntil.delete(id);
    return false;
  }
  return true;
}

/** 公开外链端点（浏览器直链风格，服务端跟随重定向到 CDN mp3） */
export function outerSongUrl(id: string): string {
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

/**
 * 外链端点对**空 User-Agent** 的客户端会退回 302 错误链（实测：空 UA 失败、
 * 任意非空 UA 正常）——而 Worker 的 fetch 默认不带 UA，必须显式声明。
 * 使用自我标识而非伪装浏览器（该端点只要求非空）。
 */
export const OUTER_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "GuangluLyric/1.0 (+https://lyric.swbx.cc.cd)",
};

/**
 * 轻量探测：外链端点是否真的能出音频。
 * 只取 1 字节 Range 并立即取消响应体；任何异常一律按不可播处理（探测是旁路）。
 */
export async function probeOuterPlayable(id: string): Promise<boolean> {
  try {
    const res = await fetch(outerSongUrl(id), {
      headers: { Range: "bytes=0-0", ...OUTER_FETCH_HEADERS },
      redirect: "follow",
    });
    const type = res.headers.get("content-type") ?? "";
    const ok = (res.ok || res.status === 206) && /audio|octet-stream/.test(type);
    await res.body?.cancel();
    if (!ok) {
      console.warn(`[songMedia] outer probe not audio: id=${id} status=${res.status} type=${type}`);
    }
    return ok;
  } catch (err) {
    console.warn(`[songMedia] outer probe failed: id=${id}`, err instanceof Error ? err.message : String(err));
    return false;
  }
}