export * from "./errors";

// ============ 网易云音乐 共享类型（前端契约） ============

export interface NeteaseSong {
  id: number;
  name: string;
  artists: string; // "周杰伦" / "A/B"
  album: string;
  cover: string; // 专辑封面 URL（可能为空字符串）
  duration: number; // 毫秒
  fee: number; // 0 免费, 1 VIP, 4 付费专辑, 8 非会员低音质
  isVip: boolean;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  cover: string;
  trackCount: number;
  creator: string;
}

export interface NeteaseQrcodeCreateResult {
  key: string; // unikey，轮询时回传
  qrDataUrl: string; // base64 dataURL 二维码图片
}

export type NeteaseQrcodeStatus = "waiting" | "scanned" | "success" | "expired";

export interface NeteaseQrcodeCheckResult {
  code: number; // 800 过期 / 801 待扫码 / 802 已扫码待确认 / 803 成功
  status: NeteaseQrcodeStatus;
  message: string;
}

export interface NeteaseMe {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
}

export type NeteaseSongUrlResult =
  | { playable: true; url: string; br: number; type: string; proxyUrl: string }
  | { playable: false; reason: string };

export interface NeteaseLyric {
  lrc: string | null; // 原始 LRC 文本
  tlyric: string | null; // 翻译歌词（可能为空）
  pureMusic: boolean;
}

