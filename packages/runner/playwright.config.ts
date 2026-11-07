import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  webServer: {
    command: "bun run --cwd ../../apps/web start --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
