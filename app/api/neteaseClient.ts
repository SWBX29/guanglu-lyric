/**
 * 网易云音乐 API 封装（服务端专用，自实现 weapi 协议）。
 *
 * 不依赖任何第三方网易云库：weapi 加密用 node:crypto（AES-128-CBC）+
 * BigInt 模幂（无填充 RSA）实现，HTTP 用原生 fetch。
 * 模块加载零副作用（不读文件、不联网），部署环境冷启动绝对安全。
 *
 * 注意：网易云 cookie 只存在于本模块/数据库，绝不返回前端。
 */
import crypto from "node:crypto";

// ---------- weapi 加密 ----------
const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const PUB_KEY_E = BigInt("0x10001");
const PUB_KEY_N = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b72515" +
    "2b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbd" +
    "a92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cf" +
    "e4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
);

function aesEncrypt(text: string, key: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(IV, "utf8"));
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

function rsaEncrypt(text: string): string {
  // 无填充 RSA：将明文反转后按大整数做 modPow
  const m = BigInt("0x" + Buffer.from(text, "utf8").reverse().toString("hex"));
  const c = m ** PUB_KEY_E % PUB_KEY_N;
  return c.toString(16).padStart(256, "0");
}

function randomSecretKey(): string {
  return crypto.randomBytes(8).toString("hex"); // 16 个十六进制字符
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function weapiEncrypt(payload: Record<string, any>): { params: string; encSecKey: string } {
  const text = JSON.stringify(payload);
  const secretKey = randomSecretKey();
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY), secretKey),
    encSecKey: rsaEncrypt(secretKey),
  };
}

// ---------- HTTP ----------
export interface NcmResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  cookie?: string[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 匿名默认 cookie：os=pc/appver 是网页端基线，缺少时播放地址接口会返回空 url(code -110) */
const DEFAULT_COOKIE = "os=pc; appver=8.9.70";

async function weapi(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
  cookie?: string,
): Promise<NcmResponse> {
  const { params, encSecKey } = weapiEncrypt({ ...data, csrf_token: "" });
  const res = await fetch(`https://music.163.com/weapi/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Referer: "https://music.163.com",
      Cookie: cookie || DEFAULT_COOKIE,
    },
    body: new URLSearchParams({ params, encSecKey }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setCookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, cookie: setCookies };
}

// ---------- 业务端点（返回结构与调用方契约保持一致） ----------
export const ncm = {
  /** 申请 unikey */
  loginQrKey: async (): Promise<NcmResponse> => {
    const res = await weapi("login/qrcode/unikey", { type: 1 }, "");
    return res;
  },

  /** 轮询扫码状态：801 待扫码 / 802 待确认 / 803 成功 / 800 过期 */
  loginQrCheck: async (key: string): Promise<NcmResponse> => {
    const res = await weapi("login/qrcode/client/login", { key, type: 1 }, "");
    // 兼容调用方：body.cookie 提供完整 cookie 串
    const cookieStr = (res.cookie ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { ...res, body: { ...res.body, cookie: cookieStr } };
  },

  /** 登录成功后的账号信息（昵称/头像/uid） */
  userAccount: (cookie: string): Promise<NcmResponse> =>
    weapi("nuser/account/get", {}, cookie),

  /** 搜索单曲：body.result.songs（旧版 GET 接口匿名可用，cloudsearch 匿名被风控 50000005） */
  search: async (keywords: string, limit = 20, offset = 0, cookie?: string): Promise<NcmResponse> => {
    const qs = new URLSearchParams({
      s: keywords,
      type: "1",
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`https://music.163.com/api/search/get?${qs}`, {
      headers: { "User-Agent": UA, Referer: "https://music.163.com", Cookie: cookie || DEFAULT_COOKIE },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  },

  /** 用户歌单：body.playlist */
  userPlaylist: (uid: string | number, cookie: string): Promise<NcmResponse> =>
    weapi("user/playlist", { uid, limit: 100, offset: 0 }, cookie),

  /** 歌单全部歌曲：兼容调用方，返回 body.songs */
  playlistTrackAll: async (
    id: string | number,
    cookie?: string,
    limit = 1000,
  ): Promise<NcmResponse> => {
    const res = await weapi("v6/playlist/detail", { id, n: limit, s: 8 }, cookie);
    const tracks = res.body?.playlist?.tracks ?? [];
    return { ...res, body: { ...res.body, songs: tracks } };
  },

  /** 播放地址：body.data[0]（url/br/type/fee/code）。v1 接口匿名 400，用旧版 player/url 并申请最高码率 */
  songUrlV1: (id: string | number, cookie?: string, _level = "exhigh"): Promise<NcmResponse> =>
    weapi("song/enhance/player/url", { ids: [Number(id)], br: 999000 }, cookie),

  /** 歌词：body.lrc.lyric / body.tlyric.lyric / body.nolyric */
  lyric: (id: string | number, cookie?: string): Promise<NcmResponse> =>
    weapi("song/lyric", { id: Number(id), lv: -1, tv: -1 }, cookie),

  /** 批量歌曲详情（补全 al.picUrl）：body.songs，单次最多 1000 首 */
  songDetail: (ids: (string | number)[], cookie?: string): Promise<NcmResponse> =>
    weapi(
      "v3/song/detail",
      { c: JSON.stringify(ids.slice(0, 1000).map((i) => ({ id: Number(i) }))) },
      cookie,
    ),
};

/** 匿名兜底 cookie：weapi 协议下大部分接口空 cookie 即可，恒为空串（保留接口兼容） */
export function getAnonCookie(): Promise<string> {
  return Promise.resolve("");
}
