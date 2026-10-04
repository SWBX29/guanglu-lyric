import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createDb, type AppDb } from "./queries/connection";
import type { Bindings } from "./lib/env";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** 每请求构造的 D1 句柄（binding 只来自 Worker env） */
  db: AppDb;
  /** 用于解密 D1 中网易云 cookie 的 AES-GCM 密钥 */
  cookieKey: string;
  /** 音频代理短时效签名密钥（评审 B1 / D5） */
  proxyKey: string;
};

/**
 * 闭包工厂：把 Worker `env` 注入 tRPC 上下文。
 * tRPC 的 createContext 签名本身不携带 Hono 的 `c.env`，故由调用方（boot.ts）传入。
 */
export function createContextFactory(env: Bindings) {
  return async (opts: FetchCreateContextFnOptions): Promise<TrpcContext> => ({
    req: opts.req,
    resHeaders: opts.resHeaders,
    db: createDb(env.DB),
    cookieKey: env.COOKIE_ENC_KEY,
    proxyKey: env.PROXY_SIGN_KEY ?? env.COOKIE_ENC_KEY,
  });
}
