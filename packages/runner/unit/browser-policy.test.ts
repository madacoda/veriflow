import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowedOrigins,
  artifactLocation,
  permitsUrl,
} from "../src/browser-policy.ts";

test("origin checks reject protocol, credentials and similar hostnames", () => {
  const origins = allowedOrigins(["https://example.com"]);
  assert.equal(permitsUrl("https://example.com/path", origins), true);
  for (const url of [
    "https://example.com.attacker.test",
    "https://user:password@example.com",
    "http://example.com",
    "file:///secret",
    "javascript:alert(1)",
  ])
    assert.equal(permitsUrl(url, origins), false);
  assert.throws(() => allowedOrigins([]));
  assert.throws(() => allowedOrigins(["https://example.com/path"]));
});
test("artifact paths reject traversal, foreign run directories and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "veriflow-policy-"));
  const outside = await mkdtemp(join(tmpdir(), "veriflow-outside-"));
  try {
    await assert.rejects(
      artifactLocation(root, { runId: "../escape", allowedOrigins: [] }),
    );
    await assert.rejects(
      artifactLocation(root, {
        runId: "r1",
        artifactDirectory: "runs/r2",
        allowedOrigins: [],
      }),
    );
    await mkdir(join(root, "runs"));
    await symlink(
      outside,
      join(root, "runs", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      artifactLocation(root, { runId: "linked", allowedOrigins: [] }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
