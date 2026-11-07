import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authFixtureEnv } from "./unit/auth-fixture.ts";

const port = process.env.PORT || "1111";
const baseURL = `http://127.0.0.1:${port}`;
const authState = (process.env.VERIFLOW_AUTH_STATE ??= join(
  tmpdir(),
  `veriflow-auth-${randomUUID()}.json`,
));

export default defineConfig({
  globalSetup: "./unit/auth-setup.ts",
  webServer: {
    command: "bun run --cwd ../../apps/web start --hostname 127.0.0.1",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60000,
    // Smoke tests must not inherit developer credentials or load them from .env.
    env: {
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_BASE_URL: "",
      ...authFixtureEnv,
      AUTH_ORIGIN: baseURL,
    },
  },
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    storageState: authState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
