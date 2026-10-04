/**
 * 网易云登录会话管理：前端只持 httpOnly cookie 中的随机 token，
 * 网易云 cookie 仅存服务端数据库。
 */
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { neteaseSessions, type NeteaseSession } from "@db/schema";

export const SESSION_COOKIE = "netease_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export async function createSession(params: {
  neteaseCookie: string;
  neteaseUserId: string;
  nickname: string;
  avatarUrl: string;
}): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await getDb().insert(neteaseSessions).values({
    id: token,
    neteaseCookie: params.neteaseCookie,
    neteaseUserId: params.neteaseUserId,
    nickname: params.nickname,
    avatarUrl: params.avatarUrl,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getSession(req: Request): Promise<NeteaseSession | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = await getDb().query.neteaseSessions.findFirst({
    where: eq(neteaseSessions.id, token),
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await getDb().delete(neteaseSessions).where(eq(neteaseSessions.id, token));
    return null;
  }
  return row;
}

export async function destroySession(req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (token) {
    await getDb().delete(neteaseSessions).where(eq(neteaseSessions.id, token));
  }
}

export function setSessionCookie(resHeaders: Headers, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  resHeaders.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(resHeaders: Headers): void {
  resHeaders.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}
