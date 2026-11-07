import { test, expect } from "@playwright/test";
import { authFixtureEnv } from "../unit/auth-fixture.ts";
import AxeBuilder from "@axe-core/playwright";

test("shared-account login, direct API guards and persistent logout replay rejection", async ({
  browser,
  baseURL,
}, testInfo) => {
  // Deliberately anonymous context; the rest of the suite uses an authenticated fixture.
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await testInfo.attach("login-desktop", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const path of [
      "/api/projects",
      "/api/templates",
      "/api/projects/p/attachments/a/content",
      "/api/projects/p/runs/r/evidence/e",
      "/api/projects/p/runs/r/report?format=csv",
    ]) {
      expect((await context.request.get(path)).status()).toBe(401);
    }
    await page
      .getByLabel("Username", { exact: true })
      .fill(authFixtureEnv.AUTH_USERNAME);
    await page
      .getByLabel("Password", { exact: true })
      .fill("wrong-fixture-password");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(
      page
        .getByRole("form", { name: "Sign in", exact: true })
        .getByRole("alert"),
    ).toHaveText("Invalid username or password.");
    await page
      .getByLabel("Password", { exact: true })
      .fill(authFixtureEnv.AUTH_PASSWORD);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(
      page.getByRole("heading", { name: "Veriflow", exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/projects")).status()).toBe(200);
    const session = (await context.cookies()).find(
      (cookie) => cookie.name === "veriflow_session",
    )!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "veriflow_session",
    );
    expect(
      (
        await context.request.post("/api/projects", {
          headers: { Origin: "https://evil.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "You have been signed out.",
    );
    expect((await context.request.get("/api/projects")).status()).toBe(401);
    // Replaying a copied cookie after logout must fail, even though it has not expired.
    await context.addCookies([session]);
    expect((await context.request.get("/api/projects")).status()).toBe(401);
    await context.clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login?next=//evil.invalid");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await testInfo.attach("login-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page
      .getByLabel("Username", { exact: true })
      .fill(authFixtureEnv.AUTH_USERNAME);
    await page
      .getByLabel("Password", { exact: true })
      .fill(authFixtureEnv.AUTH_PASSWORD);
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(page).toHaveURL(baseURL + "/");
  } finally {
    await context.close();
  }
});
