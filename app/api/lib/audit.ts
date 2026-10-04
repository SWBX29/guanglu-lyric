/**
 * 结构化审计（收尾项 3：会话建/毁、扫码成功、代理滥用）。
 *
 * 原则（评审结论）：
 * - **只记事件与哈希**：主体（netease uid / 客户端 IP）只落 HMAC-SHA256，
 *   数据库被读走也无法反推原值；绝不记录 cookie、token、明文 IP。
 * - **旁路写入**：任何失败（迁移未应用、D1 抖动、密钥异常）都不能影响主流程，
 *   故本模块对外函数永不抛出。
 * - **代理拒绝带节流**：它是攻击者可任意放大的写入路径（一次 403 一行）。
 *   若不设防，滥用流量会借审计打爆 D1 免费档每日写额度（进而拖垮登录等真实写入）。
 *   节流口径为「每 isolate × 每 reason × 60s 最多一行」——最佳努力采样，不承诺完整计数。
 */
import { lt } from "drizzle-orm";
import { auditEvents } from "@db/schema";
import type { AppDb } from "../queries/connection";
import { hmacSign } from "./proxyToken";

export type AuditEventType =
  | "login_success"
  | "logout"
  | "session_expired_purge"
  | "proxy_rejected";

/** 审计事件保留天数（Cron 每日清理更早的行） */
export const AUDIT_RETENTION_DAYS = 90;

const REJECT_LOG_WINDOW_MS = 60_000;
const lastRejectLoggedAt = new Map<string, number>();

/**
 * 代理拒绝的写入节流判定：放行时记录时间戳并返回 true，窗口内返回 false。
 * `now` 可注入，便于测试；state 是模块级 Map（每 isolate 独立，属预期）。
 */
export function shouldLogRejection(reason: string, now: number = Date.now()): boolean {
  const last = lastRejectLoggedAt.get(reason);
  if (last !== undefined && now - last < REJECT_LOG_WINDOW_MS) return false;
  lastRejectLoggedAt.set(reason, now);
  return true;
}

/** 主体脱敏：HMAC-SHA256（密钥为 Worker secret）；密钥异常时返回 null 而不是抛错 */
export async function hashSubject(secret: string, value: string): Promise<string | null> {
  try {
    return await hmacSign(secret, `audit:${value}`);
  } catch {
    return null;
  }
}

/** 统一写入入口：绝不抛出（失败只打日志，供 observability 采集） */
export async function recordAudit(
  db: AppDb,
  eventType: AuditEventType,
  opts: { subjectHash?: string | null; meta?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      eventType,
      subjectHash: opts.subjectHash ?? null,
      meta: opts.meta ? JSON.stringify(opts.meta) : null,
    });
  } catch (err) {
    console.error(
      `audit write failed: ${eventType}`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** 代理拒绝：节流 + IP 哈希后落库（由 boot.ts 的 waitUntil 调用，不阻塞响应） */
export async function recordProxyRejection(
  db: AppDb,
  secret: string,
  req: Request,
  reason: string,
): Promise<void> {
  if (!shouldLogRejection(reason)) return;
  const ip = req.headers.get("CF-Connecting-IP");
  await recordAudit(db, "proxy_rejected", {
    subjectHash: ip ? await hashSubject(secret, ip) : null,
    meta: { reason },
  });
}

/** 保留期清理：删除超过 AUDIT_RETENTION_DAYS 的旧事件（Cron 每日调用） */
export async function purgeOldAuditEvents(db: AppDb, now: number = Date.now()): Promise<void> {
  try {
    await db
      .delete(auditEvents)
      .where(lt(auditEvents.createdAt, new Date(now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)));
  } catch (err) {
    console.error("audit retention purge failed", err instanceof Error ? err.message : String(err));
  }
}