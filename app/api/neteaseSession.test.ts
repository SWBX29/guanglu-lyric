/**
 * 会话安全原语的离线单测（不触网、不需要 D1）。
 *
 * 对应评审结论：
 * - H1：token 只以 SHA-256 落库；网易云 cookie 以 AES-GCM 密文落库
 * - B2 / A-05：生产 cookie 必须无条件带 Secure
 * - M3：畸形 cookie 不得造成 500
 * - B4 / A-01：TTL 单位必须是毫秒（与 schema 的 timestamp_ms 对齐）
 */
import { describe, it, expect } from 'vitest';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  decryptCookie,
  encryptCookie,
  hashToken,
  readSessionToken,
  setSessionCookie,
} from './neteaseSession';

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 字节 base64
const KEY_B = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=';

describe('hashToken', () => {
  it('输出 64 位十六进制（sha256）且确定性', async () => {
    const a = await hashToken('token-value');
    const b = await hashToken('token-value');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('不同 token 不碰撞（抽样）', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(await hashToken(`token-${i}`));
    expect(seen.size).toBe(50);
  });

  it('原始 token 不出现在哈希里（不可逆形态）', async () => {
    const token = 'deadbeef'.repeat(8);
    expect(await hashToken(token)).not.toContain(token);
  });
});

describe('cookie 加密（AES-GCM）', () => {
  it('加解密回环还原原文', async () => {
    const plain = 'MUSIC_U=abc123; __csrf=def; os=pc';
    expect(await decryptCookie(await encryptCookie(plain, KEY_A), KEY_A)).toBe(plain);
  });

  it('密文不等于明文且每次 IV 不同（同明文两次密文不同）', async () => {
    const plain = 'MUSIC_U=abc123';
    const c1 = await encryptCookie(plain, KEY_A);
    const c2 = await encryptCookie(plain, KEY_A);
    expect(c1).not.toBe(plain);
    expect(c1).not.toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  });

  it('换密钥解不开（GCM 认证失败）', async () => {
    const ct = await encryptCookie('secret', KEY_A);
    await expect(decryptCookie(ct, KEY_B)).rejects.toThrow();
  });

  it('密文被篡改时拒绝解密', async () => {
    const ct = await encryptCookie('secret', KEY_A);
    const [iv, body] = ct.split('.');
    const tampered = `${iv}.${body.slice(0, -4)}AAAA`;
    await expect(decryptCookie(tampered, KEY_A)).rejects.toThrow();
  });

  it('密钥长度不对时明确报错（而不是静默失败）', async () => {
    await expect(encryptCookie('x', 'short-key')).rejects.toThrow(/32 bytes/);
  });
});

describe('Set-Cookie 属性', () => {
  it('session cookie 带 HttpOnly + Secure + SameSite=Lax + Max-Age=604800', () => {
    const headers = new Headers();
    setSessionCookie(headers, 'token-abc');
    const value = headers.get('set-cookie') ?? '';
    expect(value).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Path=/');
    expect(value).toContain('Max-Age=604800');
  });

  it('清理 cookie 同样带 Secure 且 Max-Age=0', () => {
    const headers = new Headers();
    clearSessionCookie(headers);
    const value = headers.get('set-cookie') ?? '';
    expect(value).toContain('Max-Age=0');
    expect(value).toContain('Secure');
  });
});

describe('readSessionToken 健壮性', () => {
  const withCookie = (cookie: string) => new Request('https://example.com/', { headers: { cookie } });

  it('从多 cookie 中取出目标值', () => {
    expect(readSessionToken(withCookie(`other=1; ${SESSION_COOKIE}=abc.def; tail=2`))).toBe('abc.def');
  });

  it('缺失时返回 null', () => {
    expect(readSessionToken(new Request('https://example.com/'))).toBeNull();
    expect(readSessionToken(withCookie('other=1'))).toBeNull();
  });

  it('畸形百分号编码返回 null 而不是抛错（M3）', () => {
    expect(readSessionToken(withCookie(`${SESSION_COOKIE}=%`))).toBeNull();
  });
});
