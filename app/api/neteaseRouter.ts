import { z } from "zod";
import QRCode from "qrcode";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { ncm } from "./neteaseClient";
import {
  createSession,
  destroySession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
} from "./neteaseSession";
import type {
  NeteaseSong,
  NeteasePlaylist,
  NeteaseQrcodeCreateResult,
  NeteaseQrcodeCheckResult,
  NeteaseMe,
  NeteaseSongUrlResult,
  NeteaseLyric,
} from "@contracts/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSong(s: any): NeteaseSong {
  const artists = (s.artists ?? s.ar ?? []).map((a: { name: string }) => a.name);
  const album = s.album ?? s.al ?? {};
  const fee = s.fee ?? 0;
  return {
    id: s.id,
    name: s.name ?? "",
    artists: artists.join("/"),
    album: album.name ?? "",
    cover: album.picUrl ?? "",
    duration: s.duration ?? s.dt ?? 0,
    fee,
    isVip: fee === 1 || fee === 4,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPlaylist(p: any): NeteasePlaylist {
  return {
    id: p.id,
    name: p.name ?? "",
    cover: p.coverImgUrl ?? "",
    trackCount: p.trackCount ?? 0,
    creator: p.creator?.nickname ?? "",
  };
}

/**
 * 补全缺失的专辑封面：搜索接口常不返回 al.picUrl，
 * 用 /song/detail 批量查询回填（失败时静默返回原列表，不阻断主流程）。
 */
async function fillCovers(songs: NeteaseSong[], cookie?: string): Promise<NeteaseSong[]> {
  const missing = songs.filter((s) => !s.cover).map((s) => s.id);
  if (missing.length === 0) return songs;
  try {
    const res = await ncm.songDetail(missing.slice(0, 1000), cookie);
    const coverById = new Map<number, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of res.body?.songs ?? []) {
      const pic: string | undefined = d?.al?.picUrl;
      if (d?.id != null && pic) coverById.set(d.id, pic);
    }
    return songs.map((s) => (s.cover ? s : { ...s, cover: coverById.get(s.id) ?? s.cover }));
  } catch {
    return songs;
  }
}

/** 需要网易云登录：取会话或抛 401，返回会话里的网易云 cookie */
async function requireNeteaseSession(req: Request) {
  const session = await getSession(req);
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先扫码登录网易云音乐" });
  }
  return session;
}

export const neteaseRouter = createRouter({
  /** 第一步：申请 unikey 并生成二维码 dataURL */
  qrcodeCreate: publicQuery.query(async (): Promise<NeteaseQrcodeCreateResult> => {
    const res = await ncm.loginQrKey();
    const key: string = res.body?.data?.unikey ?? res.body?.unikey;
    if (!key) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "获取 unikey 失败" });
    const qrDataUrl = await QRCode.toDataURL(`https://music.163.com/login?codekey=${key}`, {
      margin: 1,
      width: 320,
    });
    return { key, qrDataUrl };
  }),

  /** 第二步：前端轮询扫码状态；803 成功时建立服务端会话并下发 session cookie */
  qrcodeCheck: publicQuery
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<NeteaseQrcodeCheckResult> => {
      const res = await ncm.loginQrCheck(input.key);
      const code: number = res.body?.code ?? 0;
      const message: string = res.body?.message ?? "";
      if (code === 800) return { code, status: "expired", message };
      if (code === 801) return { code, status: "waiting", message };
      if (code === 802) return { code, status: "scanned", message };
      if (code !== 803) {
        return { code, status: "waiting", message: message || `未知状态 ${code}` };
      }
      // 803：登录成功。cookie 只存服务端
      const neteaseCookie: string = res.body?.cookie ?? (res.cookie ?? []).join(";");
      let userId = "";
      let nickname = "";
      let avatarUrl = "";
      try {
        const account = await ncm.userAccount(neteaseCookie);
        userId = String(account.body?.account?.id ?? account.body?.profile?.userId ?? "");
        nickname = account.body?.profile?.nickname ?? "";
        avatarUrl = account.body?.profile?.avatarUrl ?? "";
      } catch {
        // 资料获取失败不阻断登录
      }
      const token = await createSession({ neteaseCookie, neteaseUserId: userId, nickname, avatarUrl });
      setSessionCookie(ctx.resHeaders, token);
      return { code, status: "success", message: message || "登录成功" };
    }),

  /** 当前登录状态（昵称/头像，不含 cookie） */
  me: publicQuery.query(async ({ ctx }): Promise<NeteaseMe> => {
    const session = await getSession(ctx.req);
    if (!session) return { loggedIn: false };
    return {
      loggedIn: true,
      userId: session.neteaseUserId,
      nickname: session.nickname,
      avatarUrl: session.avatarUrl ?? undefined,
    };
  }),

  /** 退出登录 */
  logout: publicQuery.mutation(async ({ ctx }): Promise<{ ok: true }> => {
    await destroySession(ctx.req);
    clearSessionCookie(ctx.resHeaders);
    return { ok: true };
  }),

  /** 搜索歌曲（匿名可用） */
  searchSongs: publicQuery
    .input(z.object({ keyword: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ input }): Promise<NeteaseSong[]> => {
      const res = await ncm.search(input.keyword, input.limit ?? 20);
      const songs = res.body?.result?.songs ?? [];
      return fillCovers(songs.map(mapSong));
    }),

  /** 我的歌单（需登录） */
  myPlaylists: publicQuery.query(async ({ ctx }): Promise<NeteasePlaylist[]> => {
    const session = await requireNeteaseSession(ctx.req);
    const res = await ncm.userPlaylist(session.neteaseUserId, session.neteaseCookie);
    const playlists = res.body?.playlist ?? [];
    return playlists.map(mapPlaylist);
  }),

  /** 歌单歌曲（需登录） */
  playlistTracks: publicQuery
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<NeteaseSong[]> => {
      const session = await requireNeteaseSession(ctx.req);
      const res = await ncm.playlistTrackAll(input.playlistId, session.neteaseCookie);
      const songs = res.body?.songs ?? [];
      return fillCovers(songs.map(mapSong), session.neteaseCookie);
    }),

  /** 播放地址（匿名可用）。可播返回直链 + 本站代理地址 */
  songUrl: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }): Promise<NeteaseSongUrlResult> => {
      const res = await ncm.songUrlV1(input.id);
      const data = res.body?.data?.[0];
      if (!data?.url) {
        const reason =
          data?.message ??
          (data?.fee === 1 || data?.fee === 4 ? "VIP/付费歌曲，暂无播放权限" : `无法获取播放地址(code: ${data?.code ?? res.body?.code ?? "?"})`);
        return { playable: false, reason };
      }
      return {
        playable: true,
        url: data.url,
        br: data.br ?? 0,
        type: data.type ?? "",
        proxyUrl: `/api/proxy/audio?id=${input.id}`,
      };
    }),

  /** 歌词（匿名可用）。纯音乐 lrc 为 null 且 pureMusic=true */
  lyric: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }): Promise<NeteaseLyric> => {
      const res = await ncm.lyric(input.id);
      const body = res.body ?? {};
      return {
        lrc: body.lrc?.lyric ?? null,
        tlyric: body.tlyric?.lyric ?? null,
        pureMusic: Boolean(body.pureMusic),
      };
    }),
});
