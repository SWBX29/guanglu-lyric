/**
 * 扫码登录浏览器绑定（qr_bind）的离线单测 —— 对应评审 H2 与放行条件 G8。
 * 纯函数 + Headers/Request，无需 D1 或 Worker 运行时。
 */
import { describe, it, expect } from 'vitest';
import {
  QR_BIND_COOKIE,
  QR_BIND_TTL_S,
  clearQrBindCookie,
  setQrBindCookie,
  signQrBind,
  verifyQrBind,
} from './lib/loginBind';

const KEY = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=';
const OTHER_KEY = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=';
const QR_KEY = 'unikey-abc-123';

/** 把 Set-Cookie 变成一个带该 cookie 的请求，模拟浏览器行为 */
function requestWithCookie(setCookieHeader: string): Request {
  const pair = setCookieHeader.split(';')[0];
  return new Request('https://example.com/api/trpc/netease.qrcodeCheck', {
    headers: { cookie: pair },
  });
}

describe('signQrBind', () => {
  it('确定性签名且只含 URL 安全字符', async () => {
    const a = await signQrBind(QR_KEY, KEY);
    const b = await signQrBind(QR_KEY, KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('不同 key 得到不同签名（绑定是逐二维码的）', async () => {
    expect(await signQrBind(QR_KEY, KEY)).not.toBe(await signQrBind(`${QR_KEY}x`, KEY));
  });
});

describe('verifyQrBind', () => {
  it('cookie 与 key 匹配时通过', async () => {
    const headers = new Headers();
    setQrBindCookie(headers, await signQrBind(QR_KEY, KEY));
    const setCookie = headers.get('set-cookie')!;
    await expect(verifyQrBind(requestWithCookie(setCookie), QR_KEY, KEY)).resolves.toBe(true);
  });

  it('没有 cookie 时拒绝（跨站攻击者的处境）', async () => {
    const bare = new Request('https://example.com/api/trpc/netease.qrcodeCheck');
    await expect(verifyQrBind(bare, QR_KEY, KEY)).resolves.toBe(false);
  });

  it('持有 A 的 cookie 却提交 B 的 key 时拒绝（会话注入被阻断）', async () => {
    const headers = new Headers();
    setQrBindCookie(headers, await signQrBind('attacker-key', KEY));
    const setCookie = headers.get('set-cookie')!;
    // 攻击者让受害者浏览器带着 attacker-key 的绑定，去确认自己的 key
    await expect(verifyQrBind(requestWithCookie(setCookie), 'attacker-key', KEY)).resolves.toBe(true);
    await expect(verifyQrBind(requestWithCookie(setCookie), QR_KEY, KEY)).resolves.toBe(false);
  });

  it('伪造的 cookie 值被拒绝', async () => {
    const forged = new Request('https://example.com/', {
      headers: { cookie: `${QR_BIND_COOKIE}=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` },
    });
    await expect(verifyQrBind(forged, QR_KEY, KEY)).resolves.toBe(false);
  });

  it('换密钥后旧 cookie 失效', async () => {
    const headers = new Headers();
    setQrBindCookie(headers, await signQrBind(QR_KEY, KEY));
    const setCookie = headers.get('set-cookie')!;
    await expect(verifyQrBind(requestWithCookie(setCookie), QR_KEY, OTHER_KEY)).resolves.toBe(false);
  });
});

describe('qr_bind cookie 属性', () => {
  it('HttpOnly + Secure + SameSite=Lax + Path=/ + 10 分钟 TTL', () => {
    const headers = new Headers();
    setQrBindCookie(headers, 'sig-value');
    const value = headers.get('set-cookie')!;
    expect(value).toContain(`${QR_BIND_COOKIE}=sig-value`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Path=/');
    expect(value).toContain(`Max-Age=${QR_BIND_TTL_S}`);
  });

  it('登录成功后清理 cookie（一次性使用）', () => {
    const headers = new Headers();
    clearQrBindCookie(headers);
    expect(headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
