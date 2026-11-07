import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  // Container builds include the traced monorepo dependencies. Local builds keep
  // working on Windows without requiring permission to create symlinks.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@veriflow/core", "@veriflow/runner"],
  serverExternalPackages: [
    "@playwright/test",
    "playwright",
    "playwright-core",
    "axe-core",
  ],
  agentRules: false,
};
export default config;
