/**
 * weapi 黄金向量（由 app/api/neteaseClient.ts 的真实实现产出后固化）。
 *
 * 固定输入：
 *   payload   = {"ids":[123456],"br":999000,"csrf_token":""}
 *   secretKey = "0123456789abcdef"
 *
 * 重新生成方式（仅当协议常量被有意变更时才需要，且必须在评审中说明）：
 *   node node_modules/esbuild/bin/esbuild api/neteaseClient.ts --format=esm --platform=node --outfile=.tmp/neteaseClient.mjs
 *   node .tmp/golden.mjs
 *
 * 这些值属于「回归锁」而非协议标准：任何改动都必须同时解释清楚为何
 * 与上游网易云 weapi 仍然兼容。
 */
export const FIXED_KEY = '0123456789abcdef';

export const PAYLOAD_JSON = '{"ids":[123456],"br":999000,"csrf_token":""}';

export const GOLDEN = {
  params:
    'N0pBlFT/bSbdbWdhNuyZJW+DJYWCe6X/liya9GaUk6FiJtm2jppKxJGwCis6LuXyHvET6OWYhvs9mssOs+WwTU+0icT/FvflIgJkGUK3KCY=',
  encSecKey:
    '35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b949debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de948206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520ea826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52',
} as const;

/** aesEncrypt('hello-weapi', FIXED_KEY) */
export const AES_SAMPLE = 'Z7ZRZoKS8sm/VEsOvUbGIw==';

/** rsaEncrypt(FIXED_KEY) —— 与 GOLDEN.encSecKey 同源（同一 secretKey） */
export const RSA_SAMPLE = GOLDEN.encSecKey;
