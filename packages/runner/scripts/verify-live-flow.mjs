import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Explicit opt-in: calls the running app's configured model and retains a labeled
// project, two reviewed revisions and three real browser runs for inspection.
if (process.env.VERIFLOW_VERIFY_OPENAI !== "1")
  throw new Error(
    "Set VERIFLOW_VERIFY_OPENAI=1 to verify the configured live provider",
  );
const origin = process.env.VERIFLOW_LIVE_URL ?? "http://127.0.0.1:1111";
const artifacts = resolve("test-results", `live-api-full-flow-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
console.log(JSON.stringify({ artifacts }));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const title = `Live API verification · ${new Date().toISOString()}`;
  await page.getByLabel("Project name", { exact: true }).fill(title);
  await page.getByLabel("Project target URL").fill(`${origin}/demo?bug=0`);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByLabel("Selected project").locator("option:checked"),
  ).toHaveText(title);
  const projectId = await page.getByLabel("Selected project").inputValue();
  const projectPath = `${origin}/api/projects/${projectId}`;
  const editor = page.getByRole("region", {
    name: "Workflow draft",
    exact: true,
  });
  const runs = page.getByRole("region", { name: "Timeline", exact: true });
  await editor.getByText("Preview draft generation", { exact: true }).click();
  const panel = editor.getByRole("region", { name: "Workflow generation" });
  await expect(panel.getByLabel("Generation mode")).toHaveCount(0);
  await expect(editor.getByLabel("Workflow steps (JSON)")).toHaveCount(0);
  await panel
    .getByLabel("Objective")
    .fill(
      "Create a functional coupon workflow with exactly four steps: redirect to the project URL; fill testId coupon-input with SAVE10; click testId apply-coupon; assert testId order-total text equals 90000. Use stable step IDs and timeoutMs 5000 for every step. No extra actions.",
    );
  console.log(JSON.stringify({ stage: "generating", projectId, title }));
  const [generated] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/workflows/generate"),
      { timeout: 45000 },
    ),
    panel.getByRole("button", { name: "Generate draft", exact: true }).click(),
  ]);
  const generation = await generated.json();
  assert.equal(generated.status(), 200, JSON.stringify(generation.error));
  const { draft } = generation;
  assert.equal(draft.provider, "model");
  assert.deepEqual(
    draft.workflow.steps.map((step) => step.code),
    ["redirect", "fill", "click", "assert"],
  );
  assert.equal(draft.workflow.steps[0].url, `${origin}/demo?bug=0`);
  assert.deepEqual(draft.workflow.steps[1].target, {
    by: "testId",
    value: "coupon-input",
  });
  assert.equal(draft.workflow.steps[1].value, "SAVE10");
  assert.deepEqual(draft.workflow.steps[2].target, {
    by: "testId",
    value: "apply-coupon",
  });
  assert.deepEqual(draft.workflow.steps[3].target, {
    by: "testId",
    value: "order-total",
  });
  assert.deepEqual(draft.workflow.steps[3].expectation, {
    kind: "text",
    value: "90000",
  });
  await writeFile(
    `${artifacts}/generated-draft.json`,
    JSON.stringify(generation, null, 2),
  );
  assert.deepEqual(
    (await (await page.request.get(`${projectPath}/workflows`)).json())
      .workflows,
    [],
  );
  await panel.getByText("Review workflow steps", { exact: true }).click();
  await expect(
    panel.getByRole("list", { name: "Workflow steps" }),
  ).toBeVisible();
  await panel
    .getByRole("button", {
      name: "Open generated draft in editor",
      exact: true,
    })
    .click();
  await editor
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  await expect(editor.getByRole("status")).toHaveText("Saved revision 1.");
  const saved = (
    await (
      await page.request.get(
        `${projectPath}/workflows/${draft.workflow.id}?revision=1`,
      )
    ).json()
  ).workflow;
  assert.deepEqual(saved.workflow, draft.workflow);
  console.log(
    JSON.stringify({
      stage: "generated-and-saved",
      provider: draft.provider,
      steps: 4,
      revision: 1,
    }),
  );
  await editor.getByText("Preview draft generation", { exact: true }).click();

  async function runAndVerify(revision, outcome, actual, label) {
    await runs.getByLabel("Revision to run").fill(String(revision));
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${projectPath}/runs` &&
          response.request().method() === "POST",
      ),
      runs.getByRole("button", { name: "Start run", exact: true }).click(),
    ]);
    assert.equal(response.status(), 202);
    const { run: queued } = await response.json();
    let result;
    await expect
      .poll(
        async () => {
          result = (
            await (
              await page.request.get(`${projectPath}/runs/${queued.id}`)
            ).json()
          ).run;
          assert.notEqual(
            result.lifecycle,
            "error",
            JSON.stringify(result.error),
          );
          return result.lifecycle;
        },
        { timeout: 60000 },
      )
      .toBe("completed");
    assert.equal(result.adapter, "browser");
    assert.equal(result.outcome, outcome);
    assert.equal(result.revision, revision);
    assert.equal(result.steps.length, 4);
    assert.equal(result.steps[3].expected, "90000");
    assert.equal(result.steps[3].actual, actual);
    assert(["complete", "partial"].includes(result.evidence.capture));
    if (result.evidence.capture === "partial") {
      assert(result.evidence.warnings.length > 0);
      for (const warning of result.evidence.warnings)
        await expect(runs.getByText(warning, { exact: true })).toBeVisible();
    }
    assert.equal(result.evidence.artifacts.length, 4);
    await expect(runs.getByRole("status")).toContainText(outcome);
    await expect(
      runs.getByRole("heading", { name: "Evidence", exact: true }),
    ).toHaveCount(0);
    for (const artifact of result.evidence.artifacts) {
      assert.equal(artifact.runId, result.id);
      const response = await page.request.get(
        `${projectPath}/runs/${result.id}/evidence/${artifact.id}`,
      );
      assert.equal(response.status(), 200);
      assert.equal(response.headers()["content-type"], "image/png");
      const bytes = await response.body();
      assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
      await writeFile(`${artifacts}/${label}-${artifact.stepId}.png`, bytes);
      const image = runs
        .locator(`[data-step-id="${artifact.stepId}"]`)
        .getByRole("img", {
          name: `Screenshot for ${artifact.stepId}`,
          exact: true,
        });
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate((image) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
    }
    const snapshot = (
      await (
        await page.request.get(`${projectPath}/runs/${result.id}/report`)
      ).json()
    ).snapshot;
    assert.deepEqual(snapshot.run, result);
    assert.equal(snapshot.workflow.revision, revision);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      runs.getByRole("button", { name: "Download CSV", exact: true }).click(),
    ]);
    await download.saveAs(`${artifacts}/${label}.csv`);
    await writeFile(
      `${artifacts}/${label}-report.json`,
      JSON.stringify(snapshot, null, 2),
    );
    await page.screenshot({
      path: `${artifacts}/${label}-timeline.png`,
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        stage: label,
        runId: result.id,
        revision,
        outcome,
        expected: "90000",
        actual,
        screenshots: 4,
        reportDownloaded: true,
      }),
    );
    return result;
  }

  const passed = await runAndVerify(1, "passed", "90000", "passed");
  const stepItems = editor
    .getByRole("list", { name: "Workflow steps", exact: true })
    .getByRole("listitem");
  await stepItems.nth(0).getByText("Edit step 1", { exact: true }).click();
  await stepItems.nth(0).getByLabel("Page URL").fill(`${origin}/demo?bug=1`);
  await editor
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  await expect(editor.getByRole("status")).toHaveText("Saved revision 2.");
  const failed = await runAndVerify(2, "failed", "100000", "known-failure");
  const rerun = await runAndVerify(1, "passed", "90000", "rerun");
  assert.notEqual(rerun.id, passed.id);
  assert(
    rerun.evidence.artifacts.every(
      (artifact) =>
        !passed.evidence.artifacts.some(
          (previous) => previous.id === artifact.id,
        ),
    ),
  );
  const historical = (
    await (
      await page.request.get(`${projectPath}/runs/${failed.id}/report`)
    ).json()
  ).snapshot;
  assert.equal(historical.run.outcome, "failed");
  assert.equal(historical.run.steps[3].actual, "100000");
  assert.equal(historical.workflow.revision, 2);
  await expect(
    runs.getByRole("heading", {
      name: `Open ${origin}/demo?bug=0`,
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${artifacts}/viewport-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByLabel("Selected project").selectOption(projectId);
  await expect(runs.getByLabel("Run history")).toHaveValue(rerun.id);
  await expect(runs.getByRole("status")).toContainText("passed");
  assert.deepEqual(errors, []);
  await writeFile(
    `${artifacts}/verification.json`,
    JSON.stringify(
      {
        projectId,
        title,
        workflowId: draft.workflow.id,
        provider: "model",
        generatedSteps: 4,
        passedRunId: passed.id,
        failedRunId: failed.id,
        rerunId: rerun.id,
        consoleErrors: errors,
        completed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      projectId,
      workflowId: draft.workflow.id,
      artifacts,
      consoleErrors: 0,
    }),
  );
} finally {
  await browser.close();
}
