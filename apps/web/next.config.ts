import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@veriflow/core"],
  agentRules: false,
};
export default config;
