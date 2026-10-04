import { drizzle } from "drizzle-orm/d1";
import * as schema from "@db/schema";

/**
 * 按请求构造 Drizzle 句柄（Cloudflare D1 驱动）。
 *
 * 为什么不做模块级单例（评审 R2 / M2 / A-11）：
 * D1 binding 只能来自 Worker 的每次请求 `c.env`；在模块作用域缓存 DB 句柄会在
 * isolate 复用与多环境（preview/production）之间串库，且 binding 绝不允许经
 * header/query/body 传入。`drizzle()` 包装本身极廉价。
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
