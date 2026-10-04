/**
 * weapi 加密回归网（全项目第一块可执行测试）
 *
 * 存在意义：neteaseClient.ts 是本次 Cloudflare 迁移中风险最高的模块
 * （双层 AES-128-CBC + 无填充 RSA 2048）——迁移一旦改动它，必须能证明
 * 加密输出等价。本测试锁死「真实实现当前产出的字节」，任何重构/运行时
 * 更换（node:crypto → WebCrypto、BigInt 实现替换）都必须让这些断言继续通过。
 *
 * 黄金向量由本实现自身产出后固化（见 docs/cloudflare-migration.md P0-3），
 * 不依赖网络，可在任意环境离线运行。
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { AES_SAMPLE, FIXED_KEY, GOLDEN, PAYLOAD_JSON, RSA_SAMPLE } from './__golden__/weapiVector';
import { IV, PRESET_KEY, aesEncrypt, randomSecretKey, rsaEncrypt, weapiEncrypt } from './neteaseClient';

/** 测试用解密：与实现使用同一公开常量，逆向还原明文以验证加密链正确 */
function aesDecrypt(b64: string, key: string): string {
  const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

describe('weapi 协议常量', () => {
  it('使用协议公开的预设密钥与 IV（改错即与上游不兼容）', () => {
    expect(PRESET_KEY).toBe('0CoJUm6Qyw8W8jud');
    expect(IV).toBe('0102030405060708');
  });
});

describe('aesEncrypt（AES-128-CBC）', () => {
  it('固定输入产出固定密文（黄金向量）', () => {
    expect(aesEncrypt('hello-weapi', FIXED_KEY)).toBe(AES_SAMPLE);
  });

  it('解密回环还原原文', () => {
    const plain = '沿着微光铺成的小路 — 中文与 emoji 🎵 混排';
    expect(aesDecrypt(aesEncrypt(plain, FIXED_KEY), FIXED_KEY)).toBe(plain);
  });
});

describe('rsaEncrypt（无填充 RSA 2048，BigInt 模幂）', () => {
  it('输出为合法小写十六进制，长度落在 [256, 512]（padStart(256) 惯例）', () => {
    const out = rsaEncrypt(FIXED_KEY);
    // 说明：实现沿用参考实现的 zfill(256) 惯例——只补到 256 个字符，
    // 而 2048-bit 密文的十六进制长度是 511~512 位，因此实际输出长度会在
    // 256~512 间浮动（取决于高位零半字节）。上游以 BigInt('0x'+encSecKey)
    // 解析，前导零不参与数值，故功能等价；此处锁住该语义以防迁移时被"顺手改成 512"。
    expect(out).toMatch(/^[0-9a-f]{256,512}$/);
    expect(out.length).toBeGreaterThanOrEqual(256);
    expect(out.length).toBeLessThanOrEqual(512);
  });

  it('前导零缺失不影响数值（BigInt 再解析不丢位）', () => {
    const out = rsaEncrypt(FIXED_KEY);
    expect(BigInt('0x' + out).toString(16)).toBe(out.replace(/^0+/, ''));
  });

  it('同一输入确定性输出，且与黄金向量一致', () => {
    expect(rsaEncrypt(FIXED_KEY)).toBe(RSA_SAMPLE);
    expect(rsaEncrypt(FIXED_KEY)).toBe(rsaEncrypt(FIXED_KEY));
  });
});

describe('randomSecretKey', () => {
  it('恒为 16 个十六进制字符（AES-128 密钥长度）', () => {
    for (let i = 0; i < 20; i++) expect(randomSecretKey()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('两次调用不相同（随机源可用）', () => {
    expect(randomSecretKey()).not.toBe(randomSecretKey());
  });
});

describe('weapiEncrypt（双层 AES + RSA，迁移等价性的核心断言）', () => {
  it('固定 secretKey 时产出与黄金向量逐字节一致', () => {
    const out = weapiEncrypt(JSON.parse(PAYLOAD_JSON), FIXED_KEY);
    expect(out.params).toBe(GOLDEN.params);
    expect(out.encSecKey).toBe(GOLDEN.encSecKey);
  });

  it('params 按「secretKey → PRESET_KEY」逆序解密后等于原始 JSON', () => {
    const out = weapiEncrypt(JSON.parse(PAYLOAD_JSON), FIXED_KEY);
    const onceDecrypted = aesDecrypt(out.params, FIXED_KEY);
    expect(aesDecrypt(onceDecrypted, PRESET_KEY)).toBe(PAYLOAD_JSON);
  });

  it('encSecKey 与 params 使用同一 secretKey（密钥-密文耦合）', () => {
    const out = weapiEncrypt({ probe: 1 }, FIXED_KEY);
    expect(out.encSecKey).toBe(rsaEncrypt(FIXED_KEY));
  });

  it('默认随机 secretKey 下仍可自洽解密（生产调用路径）', () => {
    const payload = { ids: [987654], br: 999000, csrf_token: '' };
    const out = weapiEncrypt(payload);
    // 无法反推随机密钥，但可断言结构合法且两次调用不同
    expect(out.encSecKey).toMatch(/^[0-9a-f]{256,512}$/);
    expect(out.params).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(weapiEncrypt(payload).params).not.toBe(out.params);
  });

  it('非 ASCII 负载可解码回原样（中文关键词搜索路径）', () => {
    const payload = { s: '周杰伦 稻香', type: '1', limit: '20', offset: '0' };
    const out = weapiEncrypt(payload, FIXED_KEY);
    const decoded = aesDecrypt(aesDecrypt(out.params, FIXED_KEY), PRESET_KEY);
    expect(JSON.parse(decoded)).toEqual(payload);
  });
});
