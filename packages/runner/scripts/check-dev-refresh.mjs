import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Production smoke tests cannot detect development HMR reload loops.
// Run against `bun run dev`; no project or workflow is created.
const baseURL =
  process.env.VERIFLOW_DEV_URL ??
  `http://localhost:${process.env.PORT || "1111"}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const pages = [];
  for (let index = 0; index < 2; index++) {
    const page = await context.newPage();
    const state = { page, navigations: 0, reloads: 0, errors: [] };
    pages.push(state);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) state.navigations++;
    });
    page.on("pageerror", (error) => state.errors.push(error.message));
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        if (/"(?:type|action)"\s*:\s*"reloadPage"/.test(String(payload)))
          state.reloads++;
      });
    });
    await page.goto(baseURL);
    await page.getByLabel("Project name", { exact: true }).waitFor();
  }
  // Let initial compilation settle, then exercise API route compilation with
  // both HMR clients connected and unsaved input present.
  await pages[0].page.waitForTimeout(2000);
  for (const state of pages) {
    state.navigations = 0;
    state.reloads = 0;
    await state.page
      .getByLabel("Project name", { exact: true })
      .fill("Dev refresh regression check");
  }
  const catalog = await context.request.get(
    new URL("/api/templates", baseURL).href,
  );
  assert.equal(catalog.status(), 200, "Catalog route failed");
  assert.ok((await catalog.json()).templates.length > 0);
  for (const { page } of pages) {
    await page
      .getByRole("button", { name: "Refresh projects", exact: true })
      .click();
  }
  await pages[0].page.waitForTimeout(30000);
  for (const { page, navigations, reloads, errors } of pages) {
    assert.equal(navigations, 0, "Page navigated while idle after compilation");
    assert.equal(reloads, 0, "Dev server requested a page reload");
    assert.deepEqual(errors, [], "Browser runtime errors occurred");
    assert.equal(
      await page.getByLabel("Project name", { exact: true }).inputValue(),
      "Dev refresh regression check",
    );
  }
  console.log(
    "PASS: two tabs retained form state for 30 seconds after catalog/API requests; no reloads or runtime errors.",
  );
} finally {
  await browser.close();
}
