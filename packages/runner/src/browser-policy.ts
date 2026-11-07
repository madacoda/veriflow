import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { SessionOptions } from "@veriflow/core";

export class BrowserPolicyError extends Error {}

export function allowedOrigins(values: readonly string[]): ReadonlySet<string> {
  if (values.length === 0)
    throw new BrowserPolicyError("At least one allowed origin is required");
  return new Set(
    values.map((value) => {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.origin !== value
      ) {
        throw new BrowserPolicyError(
          "Allowed origins must be exact credential-free HTTP(S) origins",
        );
      }
      return url.origin;
    }),
  );
}

export function permitsUrl(
  value: string,
  origins: ReadonlySet<string>,
): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      origins.has(url.origin)
    );
  } catch {
    return false;
  }
}

/** The storage root is trusted configuration. Descendants cannot be symlinks. */
export async function artifactLocation(
  storageRoot: string,
  options: SessionOptions,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.runId)) {
    throw new BrowserPolicyError("Invalid run ID");
  }
  const directory = `runs/${options.runId}`;
  if (
    options.artifactDirectory !== undefined &&
    options.artifactDirectory !== directory
  ) {
    throw new BrowserPolicyError("Artifact directory must belong to the run");
  }
  await mkdir(resolve(storageRoot), { recursive: true, mode: 0o700 });
  // Evidence belongs to the runtime volume, never the Next.js build output.
  const root = await realpath(/* turbopackIgnore: true */ resolve(storageRoot));
  let path = root;
  for (const part of ["runs", options.runId]) {
    path = resolve(path, part);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    const actual = await realpath(/* turbopackIgnore: true */ path);
    const descendant = relative(root, actual);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      isAbsolute(descendant) ||
      descendant === ".." ||
      descendant.startsWith(`..${sep}`)
    ) {
      throw new BrowserPolicyError("Unsafe artifact directory");
    }
  }
  return { path, directory };
}
