# Shared-account authentication

AUTH-1 / AUTH-UI was merged in PR #23. Dev 1 owns the backend and integration.
Production application login was verified and the Nginx Basic Auth gate removed on 7 November 2026, against running image revision `29f813148717b76479232f4882f1f002308efba5`.

## Frozen HTTP contract

- `POST /api/auth/login`: JSON `{ username, password }`; success `200 { user: { username }, expiresAt }` sets an eight-hour HttpOnly, SameSite=Lax cookie. Wrong credentials return generic `401 invalid_credentials`; malformed JSON/input returns `400 invalid_request`; ten failed attempts per fifteen minutes return `429 rate_limited` with `Retry-After`. Attempts are bounded per service process, independent of supplied usernames or untrusted forwarding headers.
- `GET /api/auth/session`: `200 { user: { username }, expiresAt }`, otherwise `401 unauthenticated`.
- `POST /api/auth/logout`: `200 { ok: true }`, persistently revokes the current session and expires its cookie. Idempotent without a session.
- Errors: `{ error: { code, message } }`, no-store; unavailable/missing configuration or session storage returns generic `503 auth_unavailable`.
- Every other API requires a valid session; unsafe requests with an Origin must match the configured `AUTH_ORIGIN` or the request origin. Login/logout require an Origin. Cross-site fetches are rejected. Server clients may omit Origin on protected APIs when supplying a session.
- Protected pages redirect to `/login?next=...`; `next` is validated as a local dashboard path. `/demo`, `/health`, login and framework static assets are public. Demo targets never inherit product credentials.

## Configuration

Set server-only `AUTH_USERNAME`, `AUTH_PASSWORD`, and a random `AUTH_SESSION_SECRET` (at least 32 characters) in ignored `apps/web/.env`. These are a single shared trusted-team account, with the password stored literally as requested. No account database or registration. Never use `NEXT_PUBLIC_` for these values. `.env.example` contains placeholders only. Restart after changing credentials; credential/key rotation invalidates all existing sessions.

Sessions are HMAC-signed; logout revocations are stored under `STORAGE_DIR/auth-revocations` and survive restart. One service process and persistent storage remain required. Expired revocations are pruned during logout. Credentials are never included in tokens, logs, workflows, browser target sessions or evidence.

Production uses `AUTH_ORIGIN=https://veriflow.madacoda.dev` and `AUTH_COOKIE_SECURE=true`. `AUTH_COOKIE_SECURE=false` is an explicit local HTTP test override. Provision production variables in `/opt/veriflow/app.env` with mode 600; do not copy credentials into version control. The active Nginx vhost delegates authentication to the application and does not issue a Basic Auth challenge.

## Production cutover — 2026-11-07

The running image already included authentication, but the production environment lacked `AUTH_*` values. Protected application routes returned 503 while liveness stayed green. The user-supplied production dotenv file was parsed without exposing secrets and applied to `/opt/veriflow/app.env`; its quoted model value was decoded for Compose's raw env-file format. Compose retained `/data`, loopback port 1111, the named data volume and the current immutable image. Supplied concurrency is two runs.

The operator held `.deploy.lock`, retained root-only rollback copies, recreated the current image without rebuilding, and verified direct application authentication before disabling Basic Auth. Final public HTTPS verification passed: login and its assets 200 without `WWW-Authenticate`, dashboard redirect to login, protected APIs/evidence 401 anonymously, valid login and authenticated dashboard/projects/session 200, invalid credentials 401, Secure/HttpOnly/SameSite=Lax cookie, cross-origin writes 403, and logout/replayed-session rejection. HTTP redirects to HTTPS. Cloudflare rejects Python's default user agent; the public probe used a browser-style user agent without changing Cloudflare policy.

The isolated Nginx fixture separately verified cookie forwarding, stripped obsolete Authorization credentials, Origin checks, redirects and logs without secrets. It uses a fake upstream and does not establish application session behavior; the live checks above do. No repeated full local suite was needed for this environment/proxy cutover.

## Acceptance and verification

Verify login success/failure and malformed input, bounded attempts, missing configuration, tampered/expired/rotated/revoked sessions, cookie flags, logout replay after restart, same-origin enforcement and safe return paths. Real browser tests must cover keyboard login, logout, direct protected APIs/download paths and the existing known-fail/known-pass workflow with owned screenshots. Test credentials must be explicit fixtures, never inherited developer credentials.

## Local verification — 2026-11-07

Working tree based on `2de5b95`, with pre-existing generation/UI edits preserved; no commit, merge or deployment performed.

- `bun install --frozen-lockfile`, `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run test:unit`, `bun run build`, and `bun run browsers:install` passed. Unit results: 252 passed, two optional real-provider tests skipped, including five authentication test groups.
- `PORT=1177 VERIFLOW_U1_TEST_HTTP=1 STORAGE_DIR=<isolated temporary directory> bun run --cwd packages/runner test:smoke --workers=1`: 53 passed, one runner assertion timed out (`real workflow fails and finalizes owned PNGs`). The same command with `--last-failed` passed the remaining test. This records a local timing flake, not an unconditionally green full-suite run.
- Authentication browser checks passed: keyboard login, generic invalid-password error, direct API/attachment/evidence/report denial, actual cookie attributes and JavaScript invisibility, CSRF rejection, logout/replay rejection, safe return navigation, zero axe violations and mobile overflow checks. Desktop and 390-pixel mobile screenshots were visually inspected. Real authenticated HTTP fail/pass workflows and registered screenshot retrieval passed.
- `bun run test:dev` passed against the existing development server: two tabs retained unsaved input for thirty seconds after authenticated API requests, without HMR reloads or runtime errors. The helper authenticates over HTTP and reads local environment files without recording passwords.
- All fifteen built client JavaScript assets were checked against the provisioned local password and session secret; neither appeared. The ignored local `.env` has mode `600`.
- Independent read-only review and re-review passed after fixing a concurrent logout cleanup race with atomic revocation writes and strict expiry parsing. The local Host/origin handling also received re-review.
- Container smoke was updated with explicit fixture authentication and syntax checked, but could not run because the Docker daemon is unavailable. Linux/Windows CI and production TLS behavior remain release checks. Nginx configuration is unchanged.
