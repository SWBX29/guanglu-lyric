/**
 * D1（SQLite）时代的种子脚本说明。
 *
 * 历史：本文件原为 MySQL 版的 `getDb()` 播种桩（TODO 未实现）。迁移到 D1 后，
 * 数据库连接只存在于 Worker 的 binding 中，Node 侧没有连接串可用，
 * 因此播种改为在 D1 上直接执行 SQL（`wrangler d1 execute`）。
 *
 * 用法：
 *   npx wrangler d1 execute DB --local  --file=./db/seed.sql
 *   npx wrangler d1 execute DB --remote --file=./db/seed.sql
 *
 * 当前 `netease_sessions` 是运行时表（扫码登录自动写入），无需种子数据；
 * 将来新增字典/配置类表时，请把 INSERT 语句写进 `db/seed.sql`。
 */
export const SEED_NOTE =
  "D1 播种请使用 wrangler d1 execute --file=./db/seed.sql（见本文件注释）";
