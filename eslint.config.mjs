import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default defineConfig([
  { settings: { next: { rootDir: "apps/web/" } } },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/next-env.d.ts",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx,js,mjs}"],
  })),
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["apps/api/**/*.ts", "packages/**/*.ts"],
  })),
]);
