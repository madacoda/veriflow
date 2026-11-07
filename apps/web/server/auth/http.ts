import { mkdir } from "node:fs/promises";
import { readRequestBody } from "../composition/request-body.ts";
import {
  authConfig,
  issueSession,
  requestToken,
  revokeSession,
  sessionCookie,
  validCredentials,
  verifySession,
  type AuthConfig,
} from "./session.ts";

export function authError(
  status: number,
  code: string,
  message: string,
  headers: HeadersInit = {},
) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    },
  );
}
export function unavailable() {
  return authError(
    503,
    "auth_unavailable",
    "Sign in is unavailable. Check the server configuration.",
  );
}
export function sameOrigin(
  request: Request,
  config: AuthConfig,
  required = false,
) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return !required;
  // Next may construct route-handler URLs with its internal listener hostname.
  // The HTTP Host identifies the browser-facing local origin. Forwarded headers
  // are deliberately ignored; TLS proxies configure AUTH_ORIGIN explicitly.
  const local = new URL(request.url);
  local.host = request.headers.get("host") ?? local.host;
  return origin === (config.origin ?? local.origin);
}
// One fixed-size bucket for this shared account; arbitrary usernames and proxy
// headers cannot allocate buckets or evade the limit. Single service process.
export class LoginAttempts {
  private failures = 0;
  private until = 0;
  remaining(now = Date.now()) {
    if (now >= this.until) {
      this.failures = 0;
      this.until = now + 15 * 60 * 1000;
    }
    return this.failures >= 10
      ? Math.max(1, Math.ceil((this.until - now) / 1000))
      : 0;
  }
  fail() {
    this.failures++;
  }
  reset() {
    this.failures = 0;
  }
}
const state = globalThis as typeof globalThis & {
  __veriflowLoginAttempts?: LoginAttempts;
};
const attempts = (state.__veriflowLoginAttempts ??= new LoginAttempts());

export async function login(
  request: Request,
  configSource = authConfig,
  limiter = attempts,
) {
  try {
    const config = configSource();
    if (!sameOrigin(request, config, true))
      return authError(403, "forbidden", "Use the same origin to sign in.");
    const retry = limiter.remaining();
    if (retry)
      return authError(
        429,
        "rate_limited",
        "Too many sign-in attempts. Try again later.",
        { "Retry-After": String(retry) },
      );
    // Count before reading the body so concurrent/invalid requests are bounded.
    limiter.fail();
    let input: unknown;
    try {
      if (
        request.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      )
        throw new Error();
      input = JSON.parse(
        Buffer.from(await readRequestBody(request, 4096)).toString("utf8"),
      );
    } catch {
      return authError(
        400,
        "invalid_request",
        "Enter a username and password.",
      );
    }
    if (
      !input ||
      typeof input !== "object" ||
      !("username" in input) ||
      !("password" in input) ||
      typeof input.username !== "string" ||
      typeof input.password !== "string" ||
      input.username.length > 256 ||
      input.password.length > 1024 ||
      !input.username ||
      !input.password
    )
      return authError(
        400,
        "invalid_request",
        "Enter a username and password.",
      );
    if (!validCredentials(config, input.username, input.password))
      return authError(
        401,
        "invalid_credentials",
        "Invalid username or password.",
      );
    // Fail before issuing a cookie if the persistent revocation directory is unwritable.
    await mkdir(`${config.storageRoot}/auth-revocations`, {
      recursive: true,
      mode: 0o700,
    });
    const { session, token } = issueSession(config);
    limiter.reset();
    return Response.json(
      { user: { username: session.username }, expiresAt: session.expiresAt },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookie(config, token),
        },
      },
    );
  } catch {
    return unavailable();
  }
}
export async function currentSession(request: Request) {
  try {
    const session = await verifySession(authConfig(), requestToken(request));
    if (!session)
      return authError(401, "unauthenticated", "Sign in to continue.");
    return Response.json(
      { user: { username: session.username }, expiresAt: session.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailable();
  }
}
export async function logout(request: Request) {
  try {
    const config = authConfig();
    if (!sameOrigin(request, config, true))
      return authError(403, "forbidden", "Use the same origin to sign out.");
    const session = await verifySession(config, requestToken(request));
    if (session) await revokeSession(config, session);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookie(config, "", true),
        },
      },
    );
  } catch {
    return unavailable();
  }
}
