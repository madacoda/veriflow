import { test, expect } from "@playwright/test";
import { startBrowserTarget } from "../unit/browser-target.ts";

let target: Awaited<ReturnType<typeof startBrowserTarget>>;
test.beforeAll(async () => {
  target = await startBrowserTarget();
});
test.afterAll(async () => {
  await target.close();
});

for (const bug of [false, true]) {
  test(`coupon target exposes the ${bug ? "known-fail" : "known-pass"} outcome`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${target.origin}/demo?bug=${Number(bug)}`);
    await page.getByTestId("coupon-input").fill("SAVE10");
    await page.getByTestId("apply-coupon").click();
    await expect(page.getByTestId("order-total")).toHaveText(
      bug ? "100000" : "90000",
    );
    await page.getByLabel("Accept terms", { exact: true }).check();
    await expect(
      page.getByLabel("Accept terms", { exact: true }),
    ).toBeChecked();
    await page.getByLabel("Accept terms", { exact: true }).uncheck();
    await expect(
      page.getByLabel("Accept terms", { exact: true }),
    ).not.toBeChecked();
    const screenshot = await page.screenshot({
      path: testInfo.outputPath("coupon.png"),
    });
    expect([...screenshot.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    await testInfo.attach("coupon-evidence", {
      body: screenshot,
      contentType: "image/png",
    });
  });
}
