import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 网易云登录会话表（Cloudflare D1 / SQLite）。
 *
 * 安全设计（评审 task-2 的 H1，决策 D-3）：
 * - 只存 session token 的 SHA-256（token_hash）：数据库被读走也无法直接冒充在线会话
 * - 网易云 cookie 以 AES-GCM 密文存储（`iv.ciphertext`，base64）：一次 DB 读取不再等于账号接管
 *
 * 时间列统一 `{ mode: "timestamp_ms" }`：D1 无原生 timestamp 类型，秒/毫秒混用会导致
 * 会话「永不过期」或「全站立即登出」且**类型检查抓不到**（评审 B4 / A-01 / R8）。
 */
export const neteaseSessions = sqliteTable("netease_sessions", {
  /** sha256(session token) 的十六进制，明文 token 只存在于用户 cookie 中 */
  tokenHash: text("token_hash").primaryKey(),
  /** 网易云登录 cookie 的 AES-GCM 密文，绝不下发前端，也绝不落库为明文 */
  neteaseCookie: text("netease_cookie").notNull(),
  neteaseUserId: text("netease_user_id").notNull().default(""),
  nickname: text("nickname").notNull().default(""),
  avatarUrl: text("avatar_url"),
  /** 毫秒级 Unix 时间戳（约 1.7e12 量级，可用 datetime(expires_at/1000,'unixepoch') 对拍） */
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  /** 与 expires_at 同单位，避免 defaultNow() 与 mode 错配读出 1970 年（评审 R8/A-02） */
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type NeteaseSession = typeof neteaseSessions.$inferSelect;
export type NewNeteaseSession = typeof neteaseSessions.$inferInsert;

/**
 * 审计事件表（收尾项 3：只记事件与哈希，绝不记 cookie / 原始 IP / uid）。
 *
 * - event_type：`login_success` / `logout` / `session_expired_purge` / `proxy_rejected`
 * - subject_hash：主体（netease uid / 客户端 IP）的 HMAC-SHA256——库被读走也无法反推原值
 * - meta：非敏感元数据 JSON（如拒绝原因、清理条数）
 * - created_at：与 netease_sessions 同口径的毫秒时间戳；Cron 每日清理超 90 天旧事件
 *
 * 注意：代理拒绝是攻击者可放大的写入路径，写入侧带节流（见 api/lib/audit.ts），
 * 避免审计反而成为打爆 D1 免费写额度的入口。
 */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventType: text("event_type").notNull(),
    subjectHash: text("subject_hash"),
    meta: text("meta"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("audit_events_created_at_idx").on(table.createdAt)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
