import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const runner = createRequire(resolve("packages/runner/package.json"));
const test = createRequire(runner.resolve("@playwright/test/package.json"));
const playwright = createRequire(test.resolve("playwright/package.json"));
const core = dirname(playwright.resolve("playwright-core/package.json"));
cpSync(core, process.argv[2], { recursive: true });
