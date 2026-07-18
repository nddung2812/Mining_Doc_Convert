import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, authEnabled, issueSessionToken } from "@/lib/auth";

/**
 * Brute-force throttle: 10 failed attempts per IP per 15 minutes. In-memory,
 * so it is per-instance on serverless — a speed bump, not a hard guarantee
 * (the real defence is a strong APP_PASSWORD).
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function throttled(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry || Date.now() > entry.resetAt) return false;
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now > entry.resetAt) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export async function POST(request: NextRequest) {
  if (!authEnabled()) {
    return NextResponse.json({ ok: true, note: "Auth disabled (APP_PASSWORD not set)" });
  }

  const ip = clientIp(request);
  if (throttled(ip)) {
    return NextResponse.json(
      { error: "Too many failed attempts — wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || password !== process.env.APP_PASSWORD) {
    recordFailure(ip);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  failures.delete(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await issueSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
  return response;
}
