import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { startCoverageTarget } from "../unit/coverage-target.ts";

test("template UI saves, executes, exports and reruns the pinned revision with real Chromium", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  test.skip(
    process.env.VERIFLOW_U1_TEST_HTTP !== "1",
    "Requires isolated real platform storage",
  );
  const target = await startCoverageTarget();
  try {
    await page.goto("http://127.0.0.1:3000");
    const name = `Six category audit ${randomUUID()}`;
    await page.getByLabel("Project name").fill(name);
    await page.getByLabel("Project target URL").fill(target.origin);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      page.getByLabel("Selected project").locator("option:checked"),
    ).toHaveText(name);
    const projectId = await page.getByLabel("Selected project").inputValue();
    const path = `http://127.0.0.1:3000/api/projects/${projectId}`;
    const catalog = await request.get(`${path}/templates`);
    expect(catalog.ok()).toBe(true);
    const { templates } = await catalog.json();
    expect(
      new Set(templates.map((t: { category: string }) => t.category)).size,
    ).toBe(6);
    const invalid = await request.post(`${path}/templates`, {
      data: {
        templateId: "security-access",
        parameters: {
          checks: [{ url: "http://example.invalid", statuses: [403] }],
        },
      },
    });
    expect(invalid.status()).toBe(422);
    const editor = page.getByRole("region", { name: "Workflow draft" });
    await editor
      .getByLabel("Testing template")
      .selectOption("compliance-checklist");
    await editor.getByRole("button", { name: "Create template draft" }).click();
    await expect(editor.getByLabel("Workflow name")).toHaveValue(
      "Compliance · supplied requirements",
    );
    await editor
      .getByRole("button", { name: "Save workflow", exact: true })
      .click();
    await expect(editor.getByRole("status")).toHaveText("Saved revision 1.");
    const runs = page.getByRole("region", { name: "Saved revisions and runs" });
    await runs.getByLabel("Run viewport").selectOption("mobile");
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url() === `${path}/runs` && r.request().method() === "POST",
      ),
      runs.getByRole("button", { name: "Start run", exact: true }).click(),
    ]);
    const { run } = await response.json();
    expect(run.viewport).toEqual({ width: 390, height: 844 });
    await expect(runs.getByRole("status")).toContainText("passed", {
      timeout: 20000,
    });
    await expect(runs.getByText(/REQ-001/)).toBeVisible();
    const report = await request.get(
      `${path}/runs/${run.id}/report?format=csv`,
    );
    expect(report.ok()).toBe(true);
    expect(await report.text()).toContain("REQ-001");
    const [rerunResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url() === `${path}/runs` && r.request().method() === "POST",
      ),
      runs
        .getByRole("button", { name: "Rerun revision 1", exact: true })
        .click(),
    ]);
    const { run: rerun } = await rerunResponse.json();
    expect(rerun.id).not.toBe(run.id);
    expect(rerun.revision).toBe(1);
    expect(rerun.viewport).toEqual(run.viewport);
    await expect(runs.getByRole("status")).toContainText("passed", {
      timeout: 20000,
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("category-workbench.png"),
      fullPage: true,
    });
  } finally {
    await target.close();
  }
});
