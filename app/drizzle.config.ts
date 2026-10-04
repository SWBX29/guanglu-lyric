import { defineConfig } from "drizzle-kit";

/**
 * D1（SQLite）迁移配置。
 *
 * 迁移流程：
 *   npx drizzle-kit generate --name <change>     → 生成 db/migrations/*.sql
 *   npx wrangler d1 migrations apply DB --local  → 本地库
 *   npx wrangler d1 migrations apply DB --remote → 线上库
 *
 * 注意（评审 R8 / A-02）：首次迁移必须**重新生成**，不得沿用旧的 MySQL DDL ——
 * sqlite 的时间列单位（秒/毫秒）与默认值必须与 schema 的 mode 严格一致，
 * 否则会静默出现「会话永不过期」或「created_at 恒为 1970」。
 * 也不再需要 DATABASE_URL/dotenv（D1 由 binding 提供连接）。
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
});
