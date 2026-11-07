import { expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authFixtureEnv } from "./auth-fixture.ts";

/** Exercise built Next routes without importing its CommonJS source into the ESM runner. */
export async function startBuiltPlatform(
  storageRoot: string,
  providerEnv: {
    OPENAI_API_KEY: string;
    OPENAI_MODEL: string;
    OPENAI_BASE_URL: string;
  } = { OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "" },
) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("next/dist/bin/next")),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: fileURLToPath(new URL("../../../apps/web/", import.meta.url)),
      env: {
        ...process.env,
        ...authFixtureEnv,
        // Only an explicitly supplied local provider fixture may enable generation.
        ...providerEnv,
        STORAGE_DIR: storageRoot,
        VERIFLOW_RUN_ADAPTER: "browser",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve) => child.once("close", resolve));
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })());
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Isolated browser platform failed to start")),
        15000,
      );
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      void exited.then(() => {
        clearTimeout(timer);
        reject(new Error("Isolated browser platform exited"));
      });
    });
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(`${origin}/health`, {
                signal: AbortSignal.timeout(1000),
              })
            ).status;
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
