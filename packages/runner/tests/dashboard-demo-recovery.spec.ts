import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  demoProject,
  demoTemplate,
  demoWorkflow,
} from "@veriflow/core/fixtures";

/** Explicit model HTTP fixture; saved workflows and Chromium runs remain real. */
async function prepareGenerationDraft(page: Page, targetUrl: string) {
  await page.route("**/api/projects/*/workflows/generate", (route) =>
    route.fulfill({
      json: {
        draft: {
          contractVersion: "1",
          provider: "fixture",
          sourceAttachmentIds: [],
          warnings: [],
          workflow: {
            ...demoWorkflow,
            steps: demoWorkflow.steps.map((step) =>
              step.code === "redirect" ? { ...step, url: targetUrl } : step,
            ),
          },
        },
      },
    }),
  );
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByText("Preview draft generation", { exact: true }).click();
  const preview = editor.getByRole("region", { name: "Workflow generation" });
  await preview.getByLabel("Objective").fill("Verify the SAVE10 discount.");
  await preview.getByLabel("Template").selectOption(demoTemplate.id);
  await preview.getByRole("button", { name: "Generate draft" }).click();
  await preview
    .getByRole("button", {
      name: /fixture draft in editor|Replace editor with fixture draft/,
    })
    .click();
}

for (const { mode, loader, outcome } of [
  { mode: "1", loader: "coupon", outcome: "failed" },
  { mode: "0", loader: "generation", outcome: "passed" },
]) {
  test(`${loader} fixture runs the selected demo mode through ordinary UI actions`, async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90000);
    test.skip(
      process.env.VERIFLOW_U1_TEST_HTTP !== "1",
      "Requires isolated real platform storage",
    );
    const origin = baseURL!;
    await page.goto(origin);
    await expect(page.getByLabel("Project target URL")).toHaveValue(
      `${origin}/demo?bug=1`,
    );
    await page.getByLabel("Project name").fill(`Demo recovery ${randomUUID()}`);
    const targetUrl = `${origin}/demo?bug=${mode}`;
    if (mode === "0")
      await page.getByLabel("Project target URL").fill(targetUrl);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    const editor = page.getByRole("region", { name: "Workflow draft" });
    await expect(editor).toBeVisible();
    const projectId = await page.getByLabel("Selected project").inputValue();
    const projectPath = `${origin}/api/projects/${projectId}`;
    if (loader === "coupon")
      await editor.getByRole("button", { name: "Load coupon fixture" }).click();
    else await prepareGenerationDraft(page, targetUrl);
    const firstStep = editor
      .getByRole("list", { name: "Workflow steps", exact: true })
      .getByRole("listitem")
      .first();
    await expect(firstStep).toContainText(`Open ${targetUrl}`);
    expect(
      (await (await request.get(`${projectPath}/workflows`)).json()).workflows,
    ).toEqual([]);
    await editor
      .getByRole("button", { name: "Save workflow", exact: true })
      .click();
    await expect(editor.getByRole("status")).toHaveText("Saved revision 1.");
    const runs = page.getByRole("region", { name: "Timeline", exact: true });
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url() === `${projectPath}/runs` &&
          candidate.request().method() === "POST",
      ),
      runs.getByRole("button", { name: "Start run", exact: true }).click(),
    ]);
    expect(response.status()).toBe(202);
    const { run } = await response.json();
    await expect(runs.getByRole("status")).toContainText(outcome, {
      timeout: 45000,
    });
    const observed = (
      await (await request.get(`${projectPath}/runs/${run.id}`)).json()
    ).run;
    expect(observed).toMatchObject({
      adapter: "browser",
      lifecycle: "completed",
      outcome,
      revision: 1,
    });
    expect(observed.steps.at(-1)).toMatchObject({
      expected: "90000",
      actual: mode === "0" ? "90000" : "100000",
    });
    const savedPath = `${projectPath}/workflows/${run.workflowId}?revision=1`;
    const before = await (await request.get(savedPath)).json();
    await editor.getByRole("button", { name: "Load coupon fixture" }).click();
    expect(await (await request.get(savedPath)).json()).toEqual(before);
    expect(before.workflow.workflow.steps[0].url).toBe(targetUrl);
    await page.screenshot({
      path: testInfo.outputPath(`${loader}-${outcome}.png`),
      fullPage: true,
    });
  });
}

test("coupon fixture and API draft preserve a selected project's different origin and mode", async ({
  page,
  baseURL,
}) => {
  const target =
    "https://selected-demo.example/preview/checkout?bug=0&scenario=checkout#coupon";
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            ...demoProject,
            url: target,
            allowedOrigins: [new URL(target).origin],
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects/*/workflows", (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route("**/api/projects/*/runs", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route("**/api/projects/*/attachments", (route) =>
    route.fulfill({ json: { attachments: [] } }),
  );
  await page.route("**/api/projects/*/templates", (route) =>
    route.fulfill({ json: { templates: [] } }),
  );
  await page.goto(baseURL!);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  const firstStep = editor
    .getByRole("list", { name: "Workflow steps", exact: true })
    .getByRole("listitem")
    .first();
  await expect(firstStep).toContainText(`Open ${target}`);
  expect(writes).toBe(0);
  await prepareGenerationDraft(page, target);
  await expect(firstStep).toContainText(`Open ${target}`);
  // Only the explicit generation request; neither loader auto-saves or runs.
  expect(writes).toBe(1);
});

test("catalog retry preserves the draft and ignores the previous project's late response", async ({
  page,
  baseURL,
}, testInfo) => {
  const other = { ...demoProject, id: "project-other", title: "Other project" };
  let attempts = 0;
  let releaseRetry!: () => void;
  const retryHeld = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  let retryStarted!: () => void;
  const retryReady = new Promise<void>((resolve) => {
    retryStarted = resolve;
  });
  let retryFinished!: () => void;
  const retryDone = new Promise<void>((resolve) => {
    retryFinished = resolve;
  });
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject, other] } }),
  );
  await page.route("**/api/projects/*/workflows", (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route("**/api/projects/*/runs", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route("**/api/projects/*/attachments", (route) =>
    route.fulfill({ json: { attachments: [] } }),
  );
  await page.route(
    `**/api/projects/${demoProject.id}/templates`,
    async (route) => {
      attempts++;
      if (attempts === 1 || attempts === 3)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "adapter_unavailable",
              message: "Fixture catalog unavailable",
            },
          },
        });
      if (attempts === 4) {
        retryStarted();
        await retryHeld;
      }
      try {
        await route.fulfill({
          json: {
            templates: [
              {
                ...demoTemplate,
                title: "First project template",
                defaults: {},
              },
            ],
          },
        });
      } finally {
        if (attempts === 4) retryFinished();
      }
    },
  );
  await page.route(`**/api/projects/${other.id}/templates`, (route) =>
    route.fulfill({
      json: {
        templates: [
          {
            ...demoTemplate,
            id: "other-template",
            title: "Other project template",
            defaults: { other: true },
          },
        ],
      },
    }),
  );
  await page.goto(baseURL!);
  const selection = page.getByLabel("Selected project");
  await selection.selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  await editor.getByLabel("Workflow name").fill("Keep my unsaved review");
  const steps = editor.getByRole("list", {
    name: "Workflow steps",
    exact: true,
  });
  const retainedSteps = await steps.innerText();
  await expect(editor.getByRole("alert")).toContainText(
    "Could not load testing templates. Fixture catalog unavailable",
  );
  await page.screenshot({
    path: testInfo.outputPath("catalog-error.png"),
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Retry testing templates" }).click();
  await expect(
    editor
      .getByLabel("Testing template")
      .getByRole("option", { name: "First project template" }),
  ).toHaveCount(1);
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(editor.getByLabel("Workflow name")).toHaveValue(
    "Keep my unsaved review",
  );
  expect(await steps.innerText()).toBe(retainedSteps);
  await selection.selectOption(other.id);
  await selection.selectOption(demoProject.id);
  await expect(editor.getByRole("alert")).toContainText(
    "Fixture catalog unavailable",
  );
  await editor.getByRole("button", { name: "Retry testing templates" }).click();
  await retryReady;
  await selection.selectOption(other.id);
  releaseRetry();
  await retryDone;
  await expect(
    editor
      .getByLabel("Testing template")
      .getByRole("option", { name: "Other project template" }),
  ).toHaveCount(1);
  await expect(
    editor
      .getByLabel("Testing template")
      .getByRole("option", { name: "First project template" }),
  ).toHaveCount(0);
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await editor.getByLabel("Testing template").selectOption("other-template");
  await expect(editor.getByLabel("Template parameters (JSON)")).toHaveValue(
    JSON.stringify({ other: true }, null, 2),
  );
});
