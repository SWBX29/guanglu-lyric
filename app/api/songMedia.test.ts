/**
 * 播放媒体解析层（外链兜底 + 缓存）的离线单测。
 * fetch 用 stub 注入，不触网。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  markApiFailed,
  outerSongUrl,
  probeOuterPlayable,
  shouldPreferOuter,
} from './lib/songMedia';

const uid = () => `id-${Math.random()}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outerSongUrl', () => {
  it('构造公开外链端点', () => {
    expect(outerSongUrl('123')).toBe('https://music.163.com/song/media/outer/url?id=123.mp3');
  });
});

describe('preferOuter 缓存', () => {
  it('初始不优先；markApiFailed 后在 TTL 内优先，过期后恢复尝试 API', () => {
    const id = uid();
    expect(shouldPreferOuter(id, 1_000)).toBe(false);
    markApiFailed(id, 1_000);
    expect(shouldPreferOuter(id, 1_000 + 599_999)).toBe(true);
    expect(shouldPreferOuter(id, 1_000 + 600_000)).toBe(false);
  });
});

describe('probeOuterPlayable', () => {
  it('音频响应返回 { playable: true }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 206, headers: { 'content-type': 'audio/mpeg' } })),
    );
    await expect(probeOuterPlayable(uid())).resolves.toEqual({ playable: true });
  });

  it('非音频响应返回不可播并带诊断（不把 HTML 当音频）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })),
    );
    const r = await probeOuterPlayable(uid());
    expect(r.playable).toBe(false);
    if (!r.playable) expect(r.detail).toContain('status=200');
  });

  it('网络异常返回不可播并带诊断（探测不抛出）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const r = await probeOuterPlayable(uid());
    expect(r.playable).toBe(false);
    if (!r.playable) expect(r.detail).toContain('network down');
  });
});