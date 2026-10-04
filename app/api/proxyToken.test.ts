/**
 * 音频代理签名令牌的离线单测（对应评审 B1/D5 与放行条件 G8）。
 * 纯函数，不触网、不需要 D1 与 Worker 运行时。
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIO_TOKEN_TTL_MS,
  buildProxyUrl,
  signAudioToken,
  verifyAudioToken,
} from './lib/proxyToken';

const KEY = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=';
const OTHER_KEY = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=';
const NOW = 1_800_000_000_000;

describe('signAudioToken / verifyAudioToken', () => {
  it('签名后可通过校验', async () => {
    const { exp, sig } = await signAudioToken('123456', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    expect(exp).toBe(NOW + AUDIO_TOKEN_TTL_MS);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(verifyAudioToken('123456', exp, sig, KEY, NOW)).resolves.toEqual({ ok: true });
  });

  it('默认 TTL 覆盖整首歌的多次 Range 请求（6 小时）', () => {
    expect(AUDIO_TOKEN_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('缺少签名或 exp 一律拒绝', async () => {
    await expect(verifyAudioToken('1', undefined, undefined, KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'missing token',
    });
    await expect(verifyAudioToken('1', '123', '', KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'missing token',
    });
    await expect(verifyAudioToken('1', 'not-a-number', 'sig', KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad exp',
    });
  });

  it('过期令牌被拒绝', async () => {
    const { exp, sig } = await signAudioToken('123456', KEY, 1000, NOW);
    await expect(verifyAudioToken('123456', exp, sig, KEY, exp + 1)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('篡改 id 会让签名失配（一令牌只能用于一个 id）', async () => {
    const { exp, sig } = await signAudioToken('123456', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    await expect(verifyAudioToken('123457', exp, sig, KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('篡改 exp（续期）同样失配', async () => {
    const { exp, sig } = await signAudioToken('123456', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    await expect(verifyAudioToken('123456', exp + 999999, sig, KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('换密钥无法通过校验', async () => {
    const { exp, sig } = await signAudioToken('123456', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    await expect(verifyAudioToken('123456', exp, sig, OTHER_KEY, NOW)).resolves.toEqual({
      ok: false,
      reason: 'bad signature',
    });
  });

  it('同一 id 在不同时刻生成不同签名（exp 参与签名）', async () => {
    const a = await signAudioToken('1', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    const b = await signAudioToken('1', KEY, AUDIO_TOKEN_TTL_MS, NOW + 1);
    expect(a.sig).not.toBe(b.sig);
  });

  it('buildProxyUrl 生成的地址可被解析回原参数', async () => {
    const { exp, sig } = await signAudioToken('987', KEY, AUDIO_TOKEN_TTL_MS, NOW);
    const url = new URL(buildProxyUrl('987', exp, sig), 'https://example.com');
    expect(url.pathname).toBe('/api/proxy/audio');
    expect(url.searchParams.get('id')).toBe('987');
    await expect(
      verifyAudioToken('987', url.searchParams.get('exp')!, url.searchParams.get('sig')!, KEY, NOW),
    ).resolves.toEqual({ ok: true });
  });
});
