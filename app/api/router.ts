import { createRouter, publicQuery } from "./middleware";
import { neteaseRouter } from "./neteaseRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  netease: neteaseRouter,
});

export type AppRouter = typeof appRouter;
