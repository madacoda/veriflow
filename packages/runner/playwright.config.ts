import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT || "1111";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  webServer: {
    command: "bun run --cwd ../../apps/web start --hostname 127.0.0.1",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60000,
  },
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
