import { constants } from "node:fs";
import { mkdir, lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PlatformError } from "./platform-store.ts";

function segment(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(value))
    throw new Error("Invalid managed storage key");
  return value;
}
async function directory(
  root: string,
  parts: readonly string[],
  create: boolean,
) {
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  let current = await realpath(root);
  for (const part of parts) {
    current = join(current, segment(part));
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== current
    )
      throw new Error("Invalid managed storage directory");
  }
  return current;
}
/** Immutable objects become visible through metadata only after the complete write is synced. */
export async function writeStorageFile(
  root: string,
  parts: readonly string[],
  bytes: Uint8Array,
) {
  if (!parts.length) throw new Error("Missing storage key");
  const parent = await directory(root, parts.slice(0, -1), true);
  const filename = join(parent, segment(parts.at(-1)!));
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(filename);
    throw error;
  }
  await file.close();
}
export async function removeStorageFile(
  root: string,
  parts: readonly string[],
) {
  const parent = await directory(root, parts.slice(0, -1), false);
  await unlink(join(parent, segment(parts.at(-1)!)));
}
export async function readStorageFile(
  root: string,
  parts: readonly string[],
  maxBytes: number,
) {
  try {
    const parent = await directory(root, parts.slice(0, -1), false);
    const file = await open(
      join(parent, segment(parts.at(-1)!)),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxBytes)
        throw new Error("Invalid stored object");
      const bytes = await file.readFile();
      if (bytes.byteLength > maxBytes)
        throw new Error("Invalid stored object size");
      return bytes;
    } finally {
      await file.close();
    }
  } catch {
    throw new PlatformError(
      "internal_error",
      500,
      "Stored content could not be read",
    );
  }
}
