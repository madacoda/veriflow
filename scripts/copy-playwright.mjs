import { cpSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const runner = createRequire(resolve("packages/runner/package.json"));
const test = createRequire(runner.resolve("@playwright/test/package.json"));
const playwright = createRequire(test.resolve("playwright/package.json"));
const core = dirname(playwright.resolve("playwright-core/package.json"));
cpSync(core, process.argv[2], { recursive: true });

// Next's static trace can omit dynamically loaded Playwright assets (including
// browsers.json). Complete the packages at the locations the standalone server
// actually resolves; the separate installer copy cannot satisfy those imports.
const standalone = realpathSync(resolve(process.argv[3]));
const runtime = createRequire(resolve(standalone, "apps/web/server.js"));
const runtimeTest = createRequire(
  runtime.resolve("@playwright/test/package.json"),
);
const runtimePlaywright = createRequire(
  runtimeTest.resolve("playwright/package.json"),
);
for (const [source, destination] of [
  [
    dirname(runner.resolve("@playwright/test/package.json")),
    dirname(runtime.resolve("@playwright/test/package.json")),
  ],
  [
    dirname(test.resolve("playwright/package.json")),
    dirname(runtimeTest.resolve("playwright/package.json")),
  ],
  [core, dirname(runtimePlaywright.resolve("playwright-core/package.json"))],
]) {
  const target = realpathSync(destination);
  const within = relative(standalone, target);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw new Error(
      "Playwright destination must remain inside standalone output",
    );
  cpSync(source, target, { recursive: true });
}
if (runtime("@playwright/test").chromium.name() !== "chromium")
  throw new Error("Standalone browser import failed");
