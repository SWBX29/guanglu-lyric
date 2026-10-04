/**
 * 扫码登录的「浏览器绑定」（评审 task-2 的 H2）
 *
 * 攻击前提：tRPC query 以 GET + 简单请求发出，无需预检；而响应侧的 `Set-Cookie`
 * **不受 CORS 限制**。于是攻击者页面可以让受害者浏览器替它调用 `qrcodeCheck`，
 * 从而在受害者站点上静默建立「攻击者账号」的会话（登录 CSRF / 会话注入）。
 *
 * 方案：`qrcodeCreate` 时把 `HMAC(secret, "qr:" + key)` 写进 httpOnly cookie；
 * `qrcodeCheck` 必须同时持有与查询参数里 `key` 匹配的 cookie 才允许建立会话。
 * 攻击者无法让受害者的浏览器带上它自己那把 key 的签名，因此攻击链断裂。
 *
 * 代价（已知并接受）：同一浏览器开两个标签页扫码时，后一个会覆盖 cookie，
 * 前一个标签的确认会失败并自动刷新二维码。
 */
import { readCookie } from "./cookies";
import { constantTimeEqual, hmacSign } from "./proxyToken";

export const QR_BIND_COOKIE = "qr_bind";
/** 10 分钟：与二维码本身的存活期同量级 */
export const QR_BIND_TTL_S = 10 * 60;

export async function signQrBind(key: string, secret: string): Promise<string> {
  return hmacSign(secret, `qr:${key}`);
}

export async function verifyQrBind(req: Request, key: string, secret: string): Promise<boolean> {
  const cookie = readCookie(req, QR_BIND_COOKIE);
  if (!cookie) return false;
  return constantTimeEqual(cookie, await signQrBind(key, secret));
}

export function setQrBindCookie(resHeaders: Headers, value: string): void {
  resHeaders.append(
    "Set-Cookie",
    `${QR_BIND_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${QR_BIND_TTL_S}`,
  );
}

export function clearQrBindCookie(resHeaders: Headers): void {
  resHeaders.append(
    "Set-Cookie",
    `${QR_BIND_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  );
}
