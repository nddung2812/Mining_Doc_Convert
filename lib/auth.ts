export const SESSION_COOKIE = "mdoc_session";

/** Auth is enabled only when APP_PASSWORD is set (always set it on deployments). */
export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/** Deterministic session token derived from the password. Edge-safe (Web Crypto). */
export async function sessionToken(): Promise<string> {
  const secret = `${process.env.APP_PASSWORD}:mdocconvert-session-v1`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  return cookieValue === (await sessionToken());
}
