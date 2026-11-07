import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Production smoke tests cannot detect self-triggering Turbopack invalidations.
// Run against `bun run dev`; no project or workflow is created.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let navigations = 0;
  let reloads = 0;
  const errors = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (String(payload).includes('"type":"reloadPage"')) reloads++;
    });
  });
  await page.goto(process.env.VERIFLOW_DEV_URL ?? "http://localhost:3000");
  await page.getByLabel("Project name", { exact: true }).waitFor();
  // Allow first-route compilation and the initial HMR connection to settle.
  await page.waitForTimeout(2000);
  navigations = 0;
  reloads = 0;
  const input = page.getByLabel("Project name", { exact: true });
  await input.fill("Dev refresh regression check");
  await page
    .getByRole("button", { name: "Refresh projects", exact: true })
    .click();
  await page.waitForTimeout(10000);
  assert.equal(navigations, 0, "Page navigated while idle after compilation");
  assert.equal(reloads, 0, "Dev server repeatedly requested a page reload");
  assert.deepEqual(errors, [], "Browser runtime errors occurred");
  assert.equal(await input.inputValue(), "Dev refresh regression check");
  console.log(
    "PASS: no reloads or runtime errors; form state retained for 10 seconds after an API refresh.",
  );
} finally {
  await browser.close();
}
