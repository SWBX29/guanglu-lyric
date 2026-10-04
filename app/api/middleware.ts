import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getSession } from "./neteaseSession";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/**
 * 无需登录的 procedure —— 必须显式选择，便于审计（评审 M2：原实现是
 * `publicQuery = t.procedure`，等于所有新路由默认公开）。
 */
export const publicQuery = t.procedure;

/**
 * 需要网易云登录。会话在中间件里取好并挂到 ctx，
 * 业务 handler 直接读 `ctx.session.neteaseCookie`，不再逐个手工 `requireSession`。
 */
export const protectedQuery = t.procedure.use(async ({ ctx, next }) => {
  const session = await getSession(ctx.db, ctx.cookieKey, ctx.req);
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先扫码登录网易云音乐" });
  }
  return next({ ctx: { ...ctx, session } });
});
