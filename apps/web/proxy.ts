import { NextResponse, type NextRequest } from "next/server";
import { authConfig, requestToken, verifySession } from "./server/auth/session";
import { authError, sameOrigin, unavailable } from "./server/auth/http";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path === "/health" ||
    path === "/demo" ||
    path === "/login" ||
    ["/api/auth/login", "/api/auth/logout", "/api/auth/session"].includes(path)
  )
    return NextResponse.next();
  try {
    const config = authConfig();
    const session = await verifySession(config, requestToken(request));
    if (!session) {
      if (path === "/api" || path.startsWith("/api/"))
        return authError(401, "unauthenticated", "Sign in to continue.");
      const url = new URL("/login", request.url);
      url.searchParams.set("next", path + request.nextUrl.search);
      const response = NextResponse.redirect(url);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !sameOrigin(request, config)
    )
      return authError(
        403,
        "forbidden",
        "Cross-origin requests are not allowed.",
      );
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return unavailable();
  }
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico$).*)"],
};
