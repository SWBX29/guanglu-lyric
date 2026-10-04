/**
 * 音频代理短时效签名（评审 task-2 的 B1/D5，放行条件 G8）
 *
 * 背景：`/api/proxy/audio` 是匿名可用的流式转发端点，每个请求都要先做一遍
 * weapi（双层 AES + 2048-bit BigInt 模幂）再出站 fetch，CPU 与请求数双计。
 * 在 Workers 免费档上，「被第三方站点随意嵌入 <audio src>」等于可用性事故。
 *
 * 方案：`songUrl` 下发带 HMAC 签名与过期时间的代理地址；代理路由先验签再转发。
 * 令牌只绑定 `id`（不绑定会话）——匿名播放仍然开放，但第三方无法凭空拼出可用的代理 URL。
 *
 * 说明：TTL 取 6 小时而非数十秒，因为媒体元素会在整首歌期间持续发起 Range 请求，
 * 过短的 TTL 会让长歌播到一半断流；防护目标是"阻止任意 id 的批量盗链"，不是阻止用户听歌。
 */
export const AUDIO_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64OrHex(secret: string): Uint8Array<ArrayBuffer> {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    const out = new Uint8Array(new ArrayBuffer(32));
    for (let i = 0; i < 32; i++) out[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const bin = atob(secret);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64OrHex(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

/** 生成 `exp` 与 `sig`（sig 覆盖 id 与 exp，二者任一被改动都会失配） */
export async function signAudioToken(
  id: string,
  secret: string,
  ttlMs: number = AUDIO_TOKEN_TTL_MS,
  now: number = Date.now(),
): Promise<{ exp: number; sig: string }> {
  const exp = now + ttlMs;
  return { exp, sig: await hmac(secret, `${id}.${exp}`) };
}

/** 恒时比较，避免通过响应时间逐字节猜签名 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 通用 HMAC 签名（登录绑定等复用同一密钥派生方式） */
export async function hmacSign(secret: string, message: string): Promise<string> {
  return hmac(secret, message);
}

export async function verifyAudioToken(
  id: string,
  exp: string | number | undefined,
  sig: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!sig || exp === undefined || exp === "") return { ok: false, reason: "missing token" };
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return { ok: false, reason: "bad exp" };
  if (expNum < now) return { ok: false, reason: "expired" };
  const expected = await hmac(secret, `${id}.${expNum}`);
  if (!constantTimeEqual(expected, sig)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

export function buildProxyUrl(id: string, exp: number, sig: string): string {
  return `/api/proxy/audio?id=${id}&exp=${exp}&sig=${sig}`;
}
