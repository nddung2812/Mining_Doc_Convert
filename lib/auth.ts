export const SESSION_COOKIE = "mdoc_session";

/** Sessions live this long; the login route's cookie maxAge matches. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Auth is enabled only when APP_PASSWORD is set (always set it on deployments). */
export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/**
 * HMAC key for session tokens. SESSION_SECRET lets the operator rotate every
 * session without changing the password; without it the key is derived from
 * the password (so changing APP_PASSWORD also revokes all sessions).
 */
function secretMaterial(): string {
  return process.env.SESSION_SECRET || `${process.env.APP_PASSWORD}:mdocconvert-session-v2`;
}

/** Edge-safe (Web Crypto) HMAC-SHA256, hex-encoded. */
async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretMaterial()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (edge-safe; no node:crypto). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signed, expiring session token: `<expiresAtMs>.<hmac(expiresAtMs)>`. */
export async function issueSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  return `${expiresAt}.${await hmacHex(String(expiresAt))}`;
}

export async function isValidSession(cookieValue: string | undefined, now = Date.now()): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const expiresRaw = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return timingSafeEqual(signature, await hmacHex(expiresRaw));
}
