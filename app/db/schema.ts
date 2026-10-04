import {
  mysqlTable,
  varchar,
  text,
  timestamp,
} from "drizzle-orm/mysql-core";

// 网易云登录会话表：前端只持有 session token（id），网易云 cookie 只存服务端
export const neteaseSessions = mysqlTable("netease_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(), // 随机 session token
  neteaseCookie: text("netease_cookie").notNull(), // 网易云登录 cookie，绝不下发前端
  neteaseUserId: varchar("netease_user_id", { length: 32 }).notNull().default(""),
  nickname: varchar("nickname", { length: 255 }).notNull().default(""),
  avatarUrl: text("avatar_url"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NeteaseSession = typeof neteaseSessions.$inferSelect;
