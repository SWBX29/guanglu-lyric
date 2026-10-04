/**
 * 直连模式支持模块的离线单测（缓存与 URL 构造）。
 * 纯函数，不触网、不需要 D1 与 Worker 运行时。
 */
import { describe, it, expect } from 'vitest';
import { isDirectMode, markDirectMode, outerSongUrl } from './lib/songMedia';

const uid = () => `id-${Math.random()}`;

describe('outerSongUrl', () => {
  it('构造公开外链端点（客户端直连播放）', () => {
    expect(outerSongUrl('123')).toBe('https://music.163.com/song/media/outer/url?id=123.mp3');
  });
});

describe('直连模式缓存', () => {
  it('初始非直连；markDirectMode 后在 TTL 内直连，过期后恢复尝试 API', () => {
    const id = uid();
    expect(isDirectMode(id, 1_000)).toBe(false);
    markDirectMode(id, 1_000);
    expect(isDirectMode(id, 1_000 + 599_999)).toBe(true);
    expect(isDirectMode(id, 1_000 + 600_000)).toBe(false);
  });
});