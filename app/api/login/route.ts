import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authEnabled, sessionToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!authEnabled()) {
    return NextResponse.json({ ok: true, note: "Auth disabled (APP_PASSWORD not set)" });
  }
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
  });
  return response;
}
