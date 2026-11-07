import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("browser and accessibility tooling start", async ({ page }) => {
  await page.route("http://veriflow.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Smoke test</title></head><body><main><h1>Veriflow</h1></main></body></html>',
    }),
  );
  await page.goto("http://veriflow.test/");
  await expect(page.getByRole("heading", { name: "Veriflow" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
