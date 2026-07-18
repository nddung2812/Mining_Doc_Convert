import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authEnabled, isValidSession } from "@/lib/auth";

// Next 16: the `middleware` convention is deprecated and renamed `proxy`.
export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const ok = await isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
