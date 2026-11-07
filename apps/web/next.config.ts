import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@veriflow/core", "@veriflow/runner"],
  serverExternalPackages: ["@playwright/test", "playwright", "playwright-core"],
  agentRules: false,
};
export default config;
