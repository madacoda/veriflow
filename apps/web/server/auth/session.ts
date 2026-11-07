import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";

export const SESSION_COOKIE = "veriflow_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export interface AuthConfig {
  username: string;
  password: string;
  secret: string;
  storageRoot: string;
  secure: boolean;
  origin?: string;
}
export interface Session {
  id: string;
  username: string;
  expiresAt: number;
}
export function authConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfig {
  const username = env.AUTH_USERNAME;
  const password = env.AUTH_PASSWORD;
  const secret = env.AUTH_SESSION_SECRET;
  if (!username?.trim() || !password || !secret || secret.length < 32)
    throw new Error("Authentication is unavailable");
  const originURL = env.AUTH_ORIGIN ? new URL(env.AUTH_ORIGIN) : undefined;
  if (originURL && !["https:", "http:"].includes(originURL.protocol))
    throw new Error("Authentication is unavailable");
  const origin = originURL?.origin;
  return {
    username,
    password,
    secret,
    storageRoot: resolve(
      /* turbopackIgnore: true */ env.STORAGE_DIR ?? "../../data",
    ),
    secure:
      env.AUTH_COOKIE_SECURE === undefined
        ? env.NODE_ENV === "production"
        : env.AUTH_COOKIE_SECURE !== "false",
    origin,
  };
}
function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
export function validCredentials(
  config: AuthConfig,
  username: string,
  password: string,
) {
  const userMatches = timingSafeEqual(
    digest(username),
    digest(config.username),
  );
  const passwordMatches = timingSafeEqual(
    digest(password),
    digest(config.password),
  );
  return userMatches && passwordMatches;
}
function signature(config: AuthConfig, payload: string) {
  const key = createHmac("sha256", config.secret)
    .update(JSON.stringify([config.username, config.password]))
    .digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function issueSession(config: AuthConfig, now = Date.now()) {
  const session: Session = {
    id: randomBytes(32).toString("hex"),
    username: config.username,
    expiresAt: now + SESSION_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { session, token: `${payload}.${signature(config, payload)}` };
}
function revocationRoot(config: AuthConfig) {
  return join(config.storageRoot, "auth-revocations");
}
export async function verifySession(
  config: AuthConfig,
  token?: string,
  now = Date.now(),
): Promise<Session | null> {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  if (!timingSafeEqual(digest(supplied), digest(signature(config, payload))))
    return null;
  let session: Session;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !session ||
    !/^[a-f0-9]{64}$/.test(session.id) ||
    session.username !== config.username ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= now ||
    session.expiresAt > now + SESSION_SECONDS * 1000
  )
    return null;
  try {
    await access(join(revocationRoot(config), session.id));
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return session;
}
export async function revokeSession(
  config: AuthConfig,
  session: Session,
  now = Date.now(),
) {
  const root = revocationRoot(config);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(
    root,
    `${session.id}.${randomBytes(12).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, String(session.expiresAt), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    await rename(temporary, join(root, session.id));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const path = join(root, name);
    try {
      const stored = await readFile(path, "utf8");
      const expiry = Number(stored);
      if (
        /^[1-9]\d*$/.test(stored) &&
        Number.isSafeInteger(expiry) &&
        expiry <= now
      )
        await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function sessionCookie(
  config: AuthConfig,
  token: string,
  clear = false,
) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${config.secure ? "; Secure" : ""}`;
}
export function requestToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
