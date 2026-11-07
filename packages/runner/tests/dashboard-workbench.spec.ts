import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  demoFailedRun,
  demoProject,
  demoRevision,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import type { ProjectRecord, RunRecord } from "@veriflow/core";

const origin = "http://127.0.0.1:3000";

test("polls a labeled fake run until cancellation completes", async ({
  page,
}) => {
  const { id, projectId, createdAt } = demoFailedRun;
  const projectPath = `**/api/projects/${projectId}`;
  const run: RunRecord = {
    ...demoFailedRun,
    lifecycle: "running",
    outcome: null,
    finishedAt: undefined,
    steps: [],
    events: demoFailedRun.events.slice(0, 2),
    evidence: {
      ...demoFailedRun.evidence,
      artifacts: [],
      capture: "unavailable",
      warnings: ["Fixture capture unavailable"],
    },
  };
  let cancelled = false;
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route(`${projectPath}/workflows`, (route) =>
    route.fulfill({ json: { workflows: [demoRevision] } }),
  );
  await page.route(`${projectPath}/runs`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { runs: [] } })
      : route.fulfill({ status: 202, json: { run } }),
  );
  await page.route(`${projectPath}/runs/${id}`, (route) =>
    route.fulfill({
      json: {
        run: cancelled
          ? {
              ...run,
              lifecycle: "cancelled",
              finishedAt: createdAt,
              events: [
                ...run.events,
                {
                  sequence: 3,
                  timestamp: createdAt,
                  runId: id,
                  type: "cancellation_requested",
                },
                {
                  sequence: 4,
                  timestamp: createdAt,
                  runId: id,
                  type: "cancelled",
                },
              ],
            }
          : run,
      },
    }),
  );
  await page.route(`${projectPath}/runs/${id}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({
      json: { run: { ...run, cancelRequestedAt: createdAt } },
    });
  });

  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(projectId);
  const runs = page.getByRole("region", { name: "Saved revisions and runs" });
  await runs.getByLabel("Saved workflow").selectOption(demoWorkflow.id);
  await runs.getByRole("button", { name: "Start run" }).click();
  await expect(runs.getByRole("status")).toContainText("Fake adapter run");
  await expect(runs.getByText("Fixture capture unavailable")).toBeVisible();
  await runs.getByRole("button", { name: "Cancel run" }).click();
  await expect(runs.getByRole("status")).toContainText("cancelled");
  await expect(runs.getByText("4. Run cancelled")).toBeVisible();
  await expect(runs.getByRole("button", { name: "Cancel run" })).toHaveCount(0);
});

test("renders every fixture state and keeps sample evidence non-downloadable", async ({
  page,
}, testInfo) => {
  await page.goto(origin);
  const preview = page.getByRole("region", { name: "Run previews" });
  const state = preview.getByLabel("Fixture state");

  await expect(
    preview.getByText("Sample screenshot reference for total"),
  ).toBeVisible();
  await expect(preview.getByRole("link", { name: /screenshot/i })).toHaveCount(
    0,
  );
  await expect(preview.getByText('"90000"', { exact: true })).toBeVisible();
  await expect(preview.getByText('"100000"', { exact: true })).toBeVisible();
  for (const selection of [
    "Queued",
    "Running",
    "Passed",
    "Failed",
    "Blocked",
    "Cancelled",
    "Error",
  ]) {
    await state.selectOption(selection);
    const summary = preview.getByRole("status");
    await expect(
      summary.getByText(selection.toLowerCase(), { exact: true }),
    ).toBeVisible();
    await expect(summary).toContainText("Fixture preview");
    if (["Passed", "Failed", "Blocked"].includes(selection)) {
      await expect(
        summary.getByText("completed", { exact: true }),
      ).toBeVisible();
    }
    if (selection === "Error")
      await expect(summary).toContainText(
        "The fixture browser could not start.",
      );
    await page.screenshot({
      path: testInfo.outputPath(`${selection.toLowerCase()}.png`),
      fullPage: true,
    });
  }
});

test("the coupon target preserves the frozen locators and exact totals", async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/demo?bug=1`);
  await expect(page.getByTestId("order-total")).toHaveText("100000");
  await page.getByTestId("coupon-input").fill("SAVE10");
  await page.getByTestId("apply-coupon").click();
  await expect(page.getByTestId("order-total")).toHaveText("100000");
  await page.screenshot({ path: testInfo.outputPath("coupon-known-fail.png") });

  await page.getByRole("link", { name: "Open known-pass target" }).click();
  await expect(page).toHaveURL(`${origin}/demo?bug=0`);
  await expect(page.getByTestId("coupon-input")).toHaveValue("");
  await expect(page.getByTestId("order-total")).toHaveText("100000");
  await page.getByTestId("coupon-input").fill("SAVE10");
  await page.getByTestId("apply-coupon").click();
  await expect(page.getByTestId("order-total")).toHaveText("90000");
  await page.screenshot({ path: testInfo.outputPath("coupon-known-pass.png") });
});

test("preserves project fields when the API rejects creation", async ({
  page,
}) => {
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { projects: [] } });
    await route.fulfill({
      status: 422,
      json: {
        error: {
          code: "validation_error",
          message: "Request validation failed",
          issues: [{ path: "url", message: "Use an HTTP(S) URL" }],
        },
      },
    });
  });
  await page.goto(origin);
  await page.getByLabel("Project name").fill("Draft checkout project");
  await page
    .getByLabel("Project target URL")
    .fill("ftp://example.com/checkout");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("region", { name: "Projects" }).getByRole("alert"),
  ).toContainText("Use an HTTP(S) URL");
  await expect(page.getByLabel("Project name")).toHaveValue(
    "Draft checkout project",
  );
  await expect(page.getByLabel("Project target URL")).toHaveValue(
    "ftp://example.com/checkout",
  );
});

test("persists revisions, recovers from a stale save and surfaces the default run 503", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env.VERIFLOW_U1_TEST_HTTP !== "1",
    "Enable with an isolated STORAGE_DIR and no run adapter.",
  );
  await page.goto(origin);
  const projectName = `U1 checkout ${randomUUID()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  const projectSelector = page.getByLabel("Selected project");
  await expect(projectSelector.locator("option:checked")).toHaveText(
    projectName,
  );
  const projectId = await projectSelector.inputValue();
  const projectPath = `${origin}/api/projects/${encodeURIComponent(projectId)}`;

  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  await expect(
    editor.getByText("Coupon fixture · Unsaved draft"),
  ).toBeVisible();
  const name = editor.getByLabel("Workflow name");
  await name.fill("Reviewed checkout draft");
  await editor.getByRole("button", { name: "Save workflow" }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved revision 1.");

  const concurrent = await request.post(`${projectPath}/workflows`, {
    data: {
      workflow: { ...demoWorkflow, name: "Concurrent edit" },
      expectedRevision: 1,
    },
  });
  expect(concurrent.status()).toBe(201);
  await name.fill("Keep my checkout edits");
  const steps = editor.getByLabel("Workflow steps (JSON)");
  const retainedSteps = (await steps.inputValue()).replace("90000", "91000");
  await steps.fill(retainedSteps);
  await editor.getByRole("button", { name: "Save workflow" }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Your edits are still here.",
  );
  await expect(name).toHaveValue("Keep my checkout edits");
  await expect(steps).toHaveValue(retainedSteps);

  await editor
    .getByRole("button", { name: "Review latest saved version" })
    .click();
  await expect(
    editor.getByText("Latest saved revision 2 · Concurrent edit"),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Use latest as save base" }).click();
  await expect(steps).toHaveValue(retainedSteps);
  await editor.getByRole("button", { name: "Save workflow" }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved revision 3.");

  await page.reload();
  await projectSelector.selectOption(projectId);
  const runs = page.getByRole("region", { name: "Saved revisions and runs" });
  await runs.getByLabel("Saved workflow").selectOption(demoWorkflow.id);
  await expect(runs.getByLabel("Revision to run")).toHaveValue("3");
  await runs.getByLabel("Revision to run").fill("1");
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${projectPath}/runs` &&
        response.request().method() === "POST",
    ),
    runs.getByRole("button", { name: "Start run" }).click(),
  ]);
  expect(response.request().postDataJSON()).toEqual({
    workflowId: demoWorkflow.id,
    revision: 1,
  });
  expect(response.status()).toBe(503);
  await expect(runs.getByRole("alert")).toContainText(
    "Browser adapter is not configured",
  );
  await expect(runs.getByLabel("Revision to run")).toHaveValue("1");
  await expect(runs.getByLabel("Run history").locator("option")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("adapter-unavailable.png"),
    fullPage: true,
  });

  const projectsResponse = await request.get(`${origin}/api/projects`);
  const { projects }: { projects: ProjectRecord[] } =
    await projectsResponse.json();
  expect(projects.some((project) => project.id === projectId)).toBe(true);
});
