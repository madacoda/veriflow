import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!zod$)[^.]",
              message:
                "The workflow core is independent of runtime adapters and feature modules.",
            },
            {
              group: ["**/apps/**", "**/runner/**"],
              message:
                "Adapters depend on the workflow core, never the reverse.",
            },
          ],
        },
      ],
    },
  },
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
  ...["functionality", "security", "accessibility"].flatMap((module) =>
    ["domain", "application", "infrastructure", "presentation"].map(
      (layer) => ({
        files: [`apps/api/src/modules/${module}/${layer}/**/*.ts`],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["functionality", "security", "accessibility"]
                    .filter((name) => name !== module)
                    .map((name) => `**/${name}/**`),
                  message:
                    "Use reviewed public contracts instead of another module's internals.",
                },
                ...(["domain", "application"].includes(layer)
                  ? [
                      {
                        regex: "^(?!@veriflow/core$)[^.]",
                        message:
                          "Use local domain types and application ports instead of external frameworks.",
                      },
                      {
                        group: [
                          "**/infrastructure/**",
                          "**/presentation/**",
                          "**/platform/**",
                          "**/app.js",
                          ...(layer === "domain" ? ["**/application/**"] : []),
                        ],
                        message:
                          "Dependencies must point inward toward domain and application ports.",
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      }),
    ),
  ),
]);
