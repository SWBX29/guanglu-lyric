import { z } from "zod";
import QRCode from "qrcode";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedQuery, publicQuery } from "./middleware";
import { hashSubject, recordAudit } from "./lib/audit";
import { markApiFailed, outerSongUrl, probeOuterPlayable, shouldPreferOuter } from "./lib/songMedia";
import { buildProxyUrl, signAudioToken } from "./lib/proxyToken";
import {
  clearQrBindCookie,
  setQrBindCookie,
  signQrBind,
  verifyQrBind,
} from "./lib/loginBind";
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

/** 需要网易云登录的 procedure 统一走 `protectedQuery`（见 middleware.ts）。 */

/**
 * 把 SVG 文本转成 data URL。
 * Worker 无 DOM，`QRCode.toDataURL` 会走 canvas 渲染器（已实测确证），
 * 故改用纯字符串的 SVG 渲染器（评审 R6 / A-03，契约字段 qrDataUrl 不变）。
 */
function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export const neteaseRouter = createRouter({
  /** 第一步：申请 unikey 并生成二维码 dataURL；同时写下浏览器绑定 cookie */
  qrcodeCreate: publicQuery.query(async ({ ctx }): Promise<NeteaseQrcodeCreateResult> => {
    const res = await ncm.loginQrKey();
    const key: string = res.body?.data?.unikey ?? res.body?.unikey;
    if (!key) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "获取 unikey 失败" });
    const svg = await QRCode.toString(`https://music.163.com/login?codekey=${key}`, {
      type: "svg",
      margin: 1,
      width: 320,
    });
    // 绑定本次扫码到当前浏览器（评审 H2：阻断跨站的登录 CSRF/会话注入）
    setQrBindCookie(ctx.resHeaders, await signQrBind(key, ctx.proxyKey));
    return { key, qrDataUrl: svgToDataUrl(svg) };
  }),

  /** 第二步：前端轮询扫码状态；803 成功时建立服务端会话并下发 session cookie */
  qrcodeCheck: publicQuery
    .input(z.object({ key: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }): Promise<NeteaseQrcodeCheckResult> => {
      // 必须持有与 key 匹配的 qr_bind cookie，否则不建立任何会话。
      // 复用 expired 语义让前端自动刷新二维码，避免新增契约字段。
      if (!(await verifyQrBind(ctx.req, input.key, ctx.proxyKey))) {
        return { code: 0, status: "expired", message: "二维码会话已失效，正在重新生成" };
      }
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
      const token = await createSession(ctx.db, ctx.cookieKey, {
        neteaseCookie,
        neteaseUserId: userId,
        nickname,
        avatarUrl,
      });
      setSessionCookie(ctx.resHeaders, token);
      clearQrBindCookie(ctx.resHeaders); // 绑定用一次即弃
      // 审计：扫码登录成功（主体只落 uid 的 HMAC 哈希，绝不落原文）
      await recordAudit(ctx.db, "login_success", {
        subjectHash: userId ? await hashSubject(ctx.cookieKey, userId) : null,
      });
      return { code, status: "success", message: message || "登录成功" };
    }),

  /** 当前登录状态（昵称/头像，不含 cookie） */
  me: publicQuery.query(async ({ ctx }): Promise<NeteaseMe> => {
    const session = await getSession(ctx.db, ctx.cookieKey, ctx.req);
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
    // 审计需要主体：先读会话，再销毁（会话不存在时保持旧行为：静默成功）
    const session = await getSession(ctx.db, ctx.cookieKey, ctx.req);
    await destroySession(ctx.db, ctx.req);
    clearSessionCookie(ctx.resHeaders);
    if (session) {
      await recordAudit(ctx.db, "logout", {
        subjectHash: session.neteaseUserId
          ? await hashSubject(ctx.cookieKey, session.neteaseUserId)
          : null,
      });
    }
    return { ok: true };
  }),

  /** 搜索歌曲（匿名可用） */
  searchSongs: publicQuery
    .input(z.object({ keyword: z.string().min(1).max(100), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ input }): Promise<NeteaseSong[]> => {
      const res = await ncm.search(input.keyword, input.limit ?? 20);
      const songs = res.body?.result?.songs ?? [];
      return fillCovers(songs.map(mapSong));
    }),

  /** 我的歌单（需登录；protectedQuery 已保证 ctx.session 存在） */
  myPlaylists: protectedQuery.query(async ({ ctx }): Promise<NeteasePlaylist[]> => {
    const res = await ncm.userPlaylist(ctx.session.neteaseUserId, ctx.session.neteaseCookie);
    const playlists = res.body?.playlist ?? [];
    return playlists.map(mapPlaylist);
  }),

  /** 歌单歌曲（需登录） */
  playlistTracks: protectedQuery
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<NeteaseSong[]> => {
      const res = await ncm.playlistTrackAll(input.playlistId, ctx.session.neteaseCookie);
      const songs = res.body?.songs ?? [];
      return fillCovers(songs.map(mapSong), ctx.session.neteaseCookie);
    }),

  /**
   * 播放地址。**API 直链优先 + 外链兜底**：实测网易云取链 API 对 Cloudflare 出口
   * 稳定返回 code 404（版权区域限制；同 id 中国出口正常），而公开外链端点在海外
   * 出口可用（见 lib/songMedia.ts）。cookie 照常传入（有直链时权限/质量信息最全）。
   */
  songUrl: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<NeteaseSongUrlResult> => {
      const id = String(input.id);
      if (!shouldPreferOuter(id)) {
        const session = await getSession(ctx.db, ctx.cookieKey, ctx.req);
        const res = await ncm.songUrlV1(input.id, session?.neteaseCookie);
        const data = res.body?.data?.[0];
        if (data?.url) {
          // 代理地址必须携带签名与过期时间：第三方无法凭空拼出可用 URL（评审 B1/D5）
          const { exp, sig } = await signAudioToken(id, ctx.proxyKey);
          return {
            playable: true,
            url: data.url,
            br: data.br ?? 0,
            type: data.type ?? "",
            proxyUrl: buildProxyUrl(id, exp, sig),
          };
        }
        if (data?.message) return { playable: false, reason: data.message };
        if (data?.fee === 1 || data?.fee === 4) {
          return { playable: false, reason: "VIP/付费歌曲，暂无播放权限" };
        }
        // API 失败：探测外链端点是否可用（网易云对云端出口可能放行、也可能返回风控验证页）
        const probe = await probeOuterPlayable(id);
        if (!probe.playable) {
          return {
            playable: false,
            reason: "该歌曲暂无法播放：网易云限制了云端出口取链（本地运行不受影响，可稍后重试）",
          };
        }
        markApiFailed(id);
      }
      const { exp, sig } = await signAudioToken(id, ctx.proxyKey);
      return {
        playable: true,
        url: outerSongUrl(id),
        br: 0,
        type: "mp3",
        proxyUrl: buildProxyUrl(id, exp, sig),
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
