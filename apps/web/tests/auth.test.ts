import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";
import {
  authConfig,
  issueSession,
  verifySession,
  revokeSession,
  sessionCookie,
  validCredentials,
  SESSION_SECONDS,
} from "../server/auth/session.ts";
import { login, LoginAttempts, sameOrigin } from "../server/auth/http.ts";
import { safeReturnPath } from "../features/auth/return-path.ts";

// Explicit local fixtures; no developer environment credentials or browser adapter.
const fixtureEnv = {
  AUTH_USERNAME: "fixture-user",
  AUTH_PASSWORD: "fixture-password",
  AUTH_SESSION_SECRET: "explicit-unit-fixture-secret-32-characters",
};
const origin = "http://localhost";
function request(body: unknown, path = "/api/auth/login", site = origin) {
  return new Request(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: site },
    body: JSON.stringify(body),
  });
}

test("sessions validate credentials, reject tampering/expiry/rotation and persist logout revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "auth-unit-"));
  try {
    const config = authConfig({
      ...fixtureEnv,
      STORAGE_DIR: root,
      NODE_ENV: "production",
    });
    assert.equal(
      validCredentials(config, "fixture-user", "fixture-password"),
      true,
    );
    assert.equal(validCredentials(config, "other", "fixture-password"), false);
    assert.equal(validCredentials(config, "fixture-user", "wrong"), false);
    const now = Date.now();
    const { token, session } = issueSession(config, now);
    assert.deepEqual(await verifySession(config, token, now), session);
    assert.equal(await verifySession(config, token + "x", now), null);
    assert.equal(await verifySession(config, "invalid", now), null);
    assert.equal(await verifySession(config, token, session.expiresAt), null);
    assert.equal(
      await verifySession({ ...config, password: "rotated" }, token, now),
      null,
    );
    assert.equal(
      await verifySession({ ...config, secret: "rotated" }, token, now),
      null,
    );
    await revokeSession(config, session, now);
    const restarted = authConfig({ ...fixtureEnv, STORAGE_DIR: root });
    assert.equal(await verifySession(restarted, token, now), null);
    assert.match(
      sessionCookie(config, token),
      /HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/,
    );
    assert.match(sessionCookie(config, "", true), /Max-Age=0; Secure$/);
    // Neither password nor secret is in the signed payload.
    const payload = Buffer.from(token.split(".")[0], "base64url").toString();
    assert.ok(
      !payload.includes(config.password) && !payload.includes(config.secret),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent logouts preserve every revocation and cleanup ignores incomplete records", async () => {
  const root = await mkdtemp(join(tmpdir(), "auth-concurrent-"));
  try {
    const config = authConfig({ ...fixtureEnv, STORAGE_DIR: root });
    const entries = Array.from({ length: 12 }, () => issueSession(config));
    const incomplete = issueSession(config);
    await mkdir(join(root, "auth-revocations"), { recursive: true });
    await writeFile(join(root, "auth-revocations", incomplete.session.id), "");
    await Promise.all(
      entries.map(({ session }) => revokeSession(config, session)),
    );
    for (const { token } of [...entries, incomplete])
      assert.equal(await verifySession(config, token), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configuration fails closed and return URLs cannot escape the local UI", () => {
  assert.throws(() => authConfig({}));
  assert.throws(() =>
    authConfig({ ...fixtureEnv, AUTH_SESSION_SECRET: "short" }),
  );
  assert.throws(() =>
    authConfig({ ...fixtureEnv, AUTH_ORIGIN: "file:///tmp" }),
  );
  for (const input of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%2fevil",
    "/login",
    "/api/auth/logout",
    "/a/../login",
    "/\nevil",
    undefined,
  ])
    assert.equal(safeReturnPath(input), "/");
  assert.equal(safeReturnPath("/?project=example"), "/?project=example");
});

test("login validates JSON, uses generic credential errors and limits malformed or failed attempts", async () => {
  const root = await mkdtemp(join(tmpdir(), "auth-http-"));
  try {
    const config = authConfig({ ...fixtureEnv, STORAGE_DIR: root });
    const limiter = new LoginAttempts();
    const run = (body: unknown) => login(request(body), () => config, limiter);
    const success = await run({
      username: "fixture-user",
      password: "fixture-password",
    });
    assert.equal(success.status, 200);
    assert.match(success.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal((await success.json()).user.username, "fixture-user");
    assert.equal(
      (await login(request({}), () => config, new LoginAttempts())).status,
      400,
    );
    const oversized = new Request(origin + "/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "x".repeat(5000),
    });
    assert.equal(
      (await login(oversized, () => config, new LoginAttempts())).status,
      400,
    );
    for (let index = 0; index < 10; index++) {
      const response = await run({
        username: index ? "unknown" : "fixture-user",
        password: "wrong",
      });
      assert.equal(response.status, 401);
      assert.equal(
        (await response.json()).error.message,
        "Invalid username or password.",
      );
    }
    const limited = await run({
      username: "fixture-user",
      password: "fixture-password",
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(limiter.remaining(Date.now() + SESSION_SECONDS * 1000), 0);
    assert.equal(
      (
        await login(request({}), () => {
          throw new Error("private config");
        })
      ).status,
      503,
    );
    assert.equal(
      (await login(request({}, undefined, "https://evil.test"), () => config))
        .status,
      403,
    );
    assert.equal(sameOrigin(new Request(origin), config, true), false);
    assert.equal(
      sameOrigin(
        new Request("http://internal-listener/api/auth/login", {
          headers: { Origin: "http://127.0.0.1:1177", Host: "127.0.0.1:1177" },
        }),
        config,
        true,
      ),
      true,
    );
    assert.equal(
      sameOrigin(
        new Request("http://internal-listener/api/auth/login", {
          headers: { Origin: "http://evil.invalid", Host: "127.0.0.1:1177" },
        }),
        config,
        true,
      ),
      false,
    );
    assert.equal(
      sameOrigin(
        new Request(origin, {
          headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" },
        }),
        config,
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proxy protects direct API/download paths, enforces origins and preserves public browser targets", async () => {
  const original = { ...process.env };
  const root = await mkdtemp(join(tmpdir(), "auth-proxy-"));
  Object.assign(process.env, fixtureEnv, {
    STORAGE_DIR: root,
    AUTH_ORIGIN: "",
  });
  try {
    for (const path of [
      "/api/projects",
      "/api/templates",
      "/api/workflows/validate",
      "/api/projects/p/attachments/a/content",
      "/api/projects/p/runs/r/evidence/e",
      "/api/projects/p/runs/r/report?format=csv",
    ]) {
      const response = await proxy(new NextRequest(origin + path));
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await proxy(new NextRequest(origin + "/"))).status, 307);
    for (const path of ["/demo?bug=0", "/demo?bug=1", "/health", "/login"])
      assert.equal(
        (await proxy(new NextRequest(origin + path))).headers.get(
          "x-middleware-next",
        ),
        "1",
      );
    const config = authConfig();
    const { token } = issueSession(config);
    const headers = { Cookie: `veriflow_session=${token}` };
    assert.equal(
      (
        await proxy(new NextRequest(origin + "/api/projects", { headers }))
      ).headers.get("x-middleware-next"),
      "1",
    );
    assert.equal(
      (
        await proxy(
          new NextRequest(origin + "/api/projects", {
            method: "POST",
            headers: { ...headers, Origin: "https://evil.test" },
          }),
        )
      ).status,
      403,
    );
    delete process.env.AUTH_PASSWORD;
    assert.equal(
      (await proxy(new NextRequest(origin + "/api/projects", { headers })))
        .status,
      503,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});
