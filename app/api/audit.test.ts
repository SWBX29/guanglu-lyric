/**
 * 审计模块离线单测（收尾项 3）。
 * 纯函数 + 假 DB，不触网、不需要 D1 与 Worker 运行时。
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_RETENTION_DAYS,
  hashSubject,
  purgeOldAuditEvents,
  recordAudit,
  recordProxyRejection,
  shouldLogRejection,
} from './lib/audit';
import type { AppDb } from './queries/connection';

const KEY = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=';
const OTHER_KEY = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=';

type Row = Record<string, unknown>;

/** 捕获写入行的假 DB（只实现本模块用到的 insert / delete 链式形态） */
function fakeDb(capture: (row: Row) => void, fail = false): AppDb {
  const boom = (): never => {
    throw new Error('db down');
  };
  return {
    insert: () => ({
      values: async (row: Row) => {
        if (fail) boom();
        capture(row);
      },
    }),
    delete: () => ({
      where: async () => {
        if (fail) boom();
      },
    }),
  } as unknown as AppDb;
}

describe('hashSubject', () => {
  it('同密钥同输入确定性输出，且 URL-safe、不包含原值', async () => {
    const h1 = await hashSubject(KEY, '203.0.113.7');
    const h2 = await hashSubject(KEY, '203.0.113.7');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(h1).not.toContain('203.0.113.7');
  });

  it('换密钥输出不同（HMAC 密钥隔离）', async () => {
    const a = await hashSubject(KEY, '203.0.113.7');
    const b = await hashSubject(OTHER_KEY, '203.0.113.7');
    expect(a).not.toBe(b);
  });

  it('非法密钥返回 null 而不是抛错（审计是旁路）', async () => {
    await expect(hashSubject('not-a-key', 'x')).resolves.toBeNull();
  });
});

describe('shouldLogRejection 节流', () => {
  it('首个事件放行；窗口内抑制；窗口过后再次放行', () => {
    const reason = `reason-${Math.random()}`; // 唯一 key，避免跨用例污染模块级 Map
    expect(shouldLogRejection(reason, 1_000)).toBe(true);
    expect(shouldLogRejection(reason, 1_000 + 59_999)).toBe(false);
    expect(shouldLogRejection(reason, 1_000 + 60_000)).toBe(true);
  });
});

describe('recordAudit', () => {
  it('写入行含事件类型 / 主体哈希 / 元数据 JSON', async () => {
    const rows: Row[] = [];
    await recordAudit(fakeDb((r) => rows.push(r)), 'login_success', {
      subjectHash: 'abc',
      meta: { a: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'login_success',
      subjectHash: 'abc',
      meta: '{"a":1}',
    });
  });

  it('省略主体与元数据时写 null', async () => {
    const rows: Row[] = [];
    await recordAudit(fakeDb((r) => rows.push(r)), 'logout');
    expect(rows[0]).toMatchObject({ eventType: 'logout', subjectHash: null, meta: null });
  });

  it('DB 失败时吞掉异常（绝不影响主流程）', async () => {
    await expect(recordAudit(fakeDb(() => {}, true), 'logout')).resolves.toBeUndefined();
  });
});

describe('recordProxyRejection', () => {
  it('有 CF-Connecting-IP 时只落哈希、绝不落原始 IP', async () => {
    const rows: Row[] = [];
    const reason = `reason-${Math.random()}`;
    const req = new Request('https://example.com/api/proxy/audio', {
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
    });
    await recordProxyRejection(fakeDb((r) => rows.push(r)), KEY, req, reason);
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toBe(JSON.stringify({ reason }));
    expect(typeof rows[0].subjectHash).toBe('string');
    expect(rows[0].subjectHash).not.toContain('203.0.113.7');
  });

  it('同 reason 在节流窗口内只写一行（防滥用放大写入）', async () => {
    const rows: Row[] = [];
    const reason = `reason-${Math.random()}`;
    const req = new Request('https://example.com/');
    const db = fakeDb((r) => rows.push(r));
    await recordProxyRejection(db, KEY, req, reason);
    await recordProxyRejection(db, KEY, req, reason);
    await recordProxyRejection(db, KEY, req, reason);
    expect(rows).toHaveLength(1);
  });

  it('无 IP 头时主体哈希为 null', async () => {
    const rows: Row[] = [];
    await recordProxyRejection(
      fakeDb((r) => rows.push(r)),
      KEY,
      new Request('https://example.com/'),
      `reason-${Math.random()}`,
    );
    expect(rows[0].subjectHash).toBeNull();
  });
});

describe('purgeOldAuditEvents', () => {
  it('保留期为 90 天，且失败不抛出', async () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90);
    await expect(purgeOldAuditEvents(fakeDb(() => {}, true))).resolves.toBeUndefined();
  });
});