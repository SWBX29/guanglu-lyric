/**
 * Worker 运行时绑定契约。
 *
 * 迁移说明（评审 R4 / M5）：此处原先用 `dotenv` 读 `APP_ID / APP_SECRET / DATABASE_URL`，
 * 但三者在本工程业务代码中**从未被使用**（weapi 用的是协议公开常量），
 * 且 Workers 没有 `process.env.NODE_ENV`，保留会让「配置缺失」从启动报错
 * 退化为静默空值。故整体删除，改为显式绑定 + 启动即校验。
 *
 * `Cloudflare.Env` 由 `wrangler types` 依据 wrangler.jsonc 生成（改配置后需重新生成）；
 * 下方额外补上由 `wrangler secret put` 注入、因而不出现在配置里的敏感项。
 */
export type Bindings = Cloudflare.Env & {
  /** 32 字节密钥（base64 或 64 位十六进制），用于 AES-GCM 加密落库的网易云 cookie */
  COOKIE_ENC_KEY: string;
  /** 音频代理短时效签名密钥；未配置时回退到 COOKIE_ENC_KEY */
  PROXY_SIGN_KEY?: string;
};

/** 启动即校验：缺失时抛错，而不是静默返回空字符串 */
export function requireBindings(env: Partial<Bindings>): Bindings {
  const missing: string[] = [];
  if (!env.DB) missing.push("DB");
  if (!env.COOKIE_ENC_KEY) missing.push("COOKIE_ENC_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required bindings: ${missing.join(", ")} (see wrangler.jsonc / wrangler secret put)`,
    );
  }
  return env as Bindings;
}
