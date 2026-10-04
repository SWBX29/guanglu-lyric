/**
 * 网易云登录会话管理（Cloudflare D1 版）。
 *
 * 安全设计（评审 task-2 交接项）：
 * - 前端只持 httpOnly cookie 中的随机 token，数据库只存其 SHA-256（H1）
 * - 网易云 cookie 以 AES-GCM 加密落库，密钥来自 Worker secret（H1 / D-3）
 * - Set-Cookie 无条件带 Secure（B2 / A-05：Workers 下 NODE_ENV 恒不存在）
 * - 畸形 cookie 不再抛出 500（M3）
 */
// node:crypto 在 Workers 上由 nodejs_compat 全量支持，见决策 D-2（官方文档核验）
import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { AppDb } from "./queries/connection";
import { readCookie } from "./lib/cookies";
import { neteaseSessions } from "@db/schema";

export const SESSION_COOKIE = "netease_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/** 对调用方可见的会话视图：cookie 已解密，token 哈希不外泄 */
export interface SessionView {
  neteaseCookie: string;
  neteaseUserId: string;
  nickname: string;
  avatarUrl: string | null;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 密钥解析：接受 base64 或 64 位十六进制，必须为 32 字节；错误信息明确（不静默失败） */
function decodeSecret(secret: string): Uint8Array<ArrayBuffer> {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return hexToBytes(secret);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(secret);
  } catch {
    // 非合法 base64（例如误填了任意字符串）也归入"密钥格式不对"
    throw new Error("COOKIE_ENC_KEY must decode to 32 bytes (base64 or 64 hex chars)");
  }
  if (bytes.length !== 32) {
    throw new Error("COOKIE_ENC_KEY must decode to 32 bytes (base64 or 64 hex chars)");
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeSecret(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** session token 的存储形态：SHA-256 十六进制 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** AES-GCM 加密，输出 `iv.ciphertext`（两段均为 base64，每次独立 96-bit IV） */
export async function encryptCookie(plain: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(plain));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`;
}

export async function decryptCookie(payload: string, secret: string): Promise<string> {
  const [ivB64, ctB64] = payload.split(".");
  if (!ivB64 || !ctB64) throw new Error("malformed encrypted payload");
  const key = await importKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) },
    key,
    fromBase64(ctB64),
  );
  return textDecoder.decode(pt);
}

export async function createSession(
  db: AppDb,
  cookieKey: string,
  params: { neteaseCookie: string; neteaseUserId: string; nickname: string; avatarUrl: string },
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(neteaseSessions).values({
    tokenHash: await hashToken(token),
    neteaseCookie: await encryptCookie(params.neteaseCookie, cookieKey),
    neteaseUserId: params.neteaseUserId,
    nickname: params.nickname,
    avatarUrl: params.avatarUrl,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export function readSessionToken(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

export async function getSession(
  db: AppDb,
  cookieKey: string,
  req: Request,
): Promise<SessionView | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const rows = await db
    .select()
    .from(neteaseSessions)
    .where(eq(neteaseSessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteByHash(db, tokenHash);
    return null;
  }
  try {
    return {
      neteaseCookie: await decryptCookie(row.neteaseCookie, cookieKey),
      neteaseUserId: row.neteaseUserId,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
    };
  } catch {
    // 密钥轮换或密文损坏：按无会话处理并清理该行，避免持续报错
    await deleteByHash(db, tokenHash);
    return null;
  }
}

export async function destroySession(db: AppDb, req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (!token) return;
  await deleteByHash(db, await hashToken(token));
}

export async function deleteByHash(db: AppDb, tokenHash: string): Promise<void> {
  await db.delete(neteaseSessions).where(eq(neteaseSessions.tokenHash, tokenHash));
}

/** 懒清理过期会话（可挂 Cron Trigger；免费档每账号 5 个，官方核验可用） */
export async function purgeExpiredSessions(db: AppDb): Promise<void> {
  await db.delete(neteaseSessions).where(lt(neteaseSessions.expiresAt, new Date()));
}

/** 无条件 Secure：自定义域/workers.dev 均为 HTTPS，无合法明文场景 */
export function setSessionCookie(resHeaders: Headers, token: string): void {
  resHeaders.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
}

export function clearSessionCookie(resHeaders: Headers): void {
  resHeaders.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  );
}
