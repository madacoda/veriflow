import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  demoAttachment,
  demoFailedRun,
  demoProject,
  demoTemplate,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import type { RunRecord } from "@veriflow/core";

const projectPath = `**/api/projects/${demoProject.id}`;

test("real generation routes advertise supported choices and preserve edits when the provider is unavailable", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.VERIFLOW_U1_TEST_HTTP !== "1",
    "Requires isolated real platform storage",
  );
  const created = await request.post("/api/projects", {
    data: {
      title: "Generation integration check",
      url: `${baseURL}/demo`,
    },
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const path = `/api/projects/${project.id}`;
  const uploaded = await request.post(`${path}/attachments`, {
    multipart: {
      file: {
        name: "requirements.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "REQ-1: checkout shows a discounted total of 90000.",
        ),
      },
    },
  });
  expect(uploaded.status()).toBe(201);
  const { attachment } = await uploaded.json();
  const catalog = await (await request.get("/api/templates")).json();
  expect(catalog.templates).toHaveLength(15);
  expect(catalog.generationTemplateIds).toEqual([
    "functional-exact-total",
    "requirements-acceptance",
  ]);
  await page.goto(baseURL!);
  await page.getByLabel("Selected project").selectOption(project.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  await editor.getByLabel("Workflow name").fill("Keep unsaved work");
  await editor.getByText("Preview draft generation", { exact: true }).click();
  const panel = editor.getByRole("region", { name: "Workflow generation" });
  await expect(panel.getByLabel("Template").locator("option")).toHaveCount(3);
  expect(
    await panel
      .getByLabel("Template")
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      ),
  ).toEqual(["", ...catalog.generationTemplateIds]);
  await panel.getByLabel("Template").selectOption("requirements-acceptance");
  await panel
    .getByLabel("Objective")
    .fill("Check the supplied checkout requirement");
  await panel.getByRole("checkbox", { name: /requirements.md/ }).check();
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith(`${path}/workflows/generate`),
    ),
    panel.getByRole("button", { name: "Generate draft", exact: true }).click(),
  ]);
  expect(response.status()).toBe(503);
  expect(response.request().postDataJSON()).toEqual({
    objective: "Check the supplied checkout requirement",
    templateIds: ["requirements-acceptance"],
    attachmentIds: [attachment.id],
  });
  await expect(panel.getByRole("alert")).toContainText(
    "Generation is currently unavailable",
  );
  await expect(editor.getByLabel("Workflow name")).toHaveValue(
    "Keep unsaved work",
  );
  await expect(panel.getByLabel("Objective")).toHaveValue(
    "Check the supplied checkout requirement",
  );
  await expect(
    panel.getByRole("checkbox", { name: /requirements.md/ }),
  ).toBeChecked();
  expect(
    (await (await request.get(`${path}/workflows`)).json()).workflows,
  ).toEqual([]);
  expect((await (await request.get(`${path}/runs`)).json()).runs).toEqual([]);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("generation-api-unavailable.png"),
    fullPage: true,
  });
});

test("previews generation inputs without changing or saving the current draft", async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  let writeRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/workflows"))
      writeRequests++;
  });
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route(`${projectPath}/workflows`, (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route(`${projectPath}/runs`, (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route(`${projectPath}/attachments`, (route) =>
    route.fulfill({
      json: {
        attachments: [
          demoAttachment,
          {
            ...demoAttachment,
            id: "attachment-pending",
            filename: "pending.md",
            extraction: { status: "pending" },
          },
        ],
      },
    }),
  );

  // Explicit API fixture: no live model request in the smoke suite.
  await page.route("**/api/templates", (route) =>
    route.fulfill({
      json: {
        templates: [demoTemplate],
        generationTemplateIds: [demoTemplate.id],
      },
    }),
  );
  await page.route(`${projectPath}/workflows/generate`, (route) =>
    route.fulfill({
      json: {
        draft: {
          contractVersion: "1",
          provider: "model",
          workflow: demoWorkflow,
          sourceAttachmentIds: ["attachment-pending"],
          warnings: ["Review before saving"],
        },
      },
    }),
  );
  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  const name = editor.getByLabel("Workflow name");
  await name.fill("My unsaved changes");
  await editor.getByText("Preview draft generation", { exact: true }).click();

  const fixture = editor.getByRole("region", { name: "Workflow generation" });
  await expect(fixture.getByLabel("Generation mode")).toHaveCount(0);
  await fixture
    .getByLabel("Objective")
    .fill("Verify the discount from the checkout requirements.");
  await fixture.getByLabel("Template").selectOption(demoTemplate.id);
  await fixture.getByRole("checkbox", { name: /pending\.md/ }).check();
  await fixture.getByRole("button", { name: "Generate draft" }).click();
  await expect(
    fixture.getByRole("heading", { name: demoWorkflow.name }),
  ).toBeVisible();
  await expect(
    fixture
      .getByRole("listitem")
      .filter({ hasText: "pending.md · Extraction pending" }),
  ).toBeVisible();
  await expect(
    fixture.getByRole("listitem").filter({ hasText: demoAttachment.filename }),
  ).toHaveCount(0);
  await expect(
    fixture.getByRole("list", { name: "Draft warnings" }),
  ).toContainText("Review before saving");
  await expect(name).toHaveValue("My unsaved changes");
  await page.screenshot({
    path: testInfo.outputPath("generation-api-fixture.png"),
    fullPage: true,
  });

  await fixture
    .getByRole("button", { name: "Replace editor with generated draft" })
    .click();
  await expect(name).toHaveValue(demoWorkflow.name);
  await expect(
    editor.getByText("Generated workflow draft · Unsaved draft"),
  ).toBeVisible();
  await name.fill("Reviewed fixture workflow");
  await expect(name).toHaveValue("Reviewed fixture workflow");
  expect(writeRequests).toBe(0);
});

test("loads the API catalog and reviews a generated draft after recoverable errors", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  const pendingAttachment = {
    ...demoAttachment,
    id: "attachment-pending",
    filename: "pending.md",
    extraction: { status: "pending" },
  };
  const generated = { ...demoWorkflow, name: "Generated checkout review" };
  let catalogAttempts = 0;
  const generationInputs: unknown[] = [];
  let saves = 0;

  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route(`${projectPath}/workflows`, (route) => {
    if (route.request().method() === "POST") saves++;
    return route.fulfill({ json: { workflows: [] } });
  });
  await page.route(`${projectPath}/runs`, (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route(`${projectPath}/attachments`, (route) =>
    route.fulfill({
      json: {
        attachments: [
          demoAttachment,
          pendingAttachment,
          {
            ...demoAttachment,
            id: "reference-pdf",
            filename: "reference.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    }),
  );
  await page.route("**/api/templates", (route) => {
    catalogAttempts++;
    return catalogAttempts === 1
      ? route.fulfill({
          status: 404,
          json: {
            error: {
              code: "not_found",
              message: "Template catalog is unavailable",
            },
          },
        })
      : route.fulfill({
          json: {
            templates: [demoTemplate],
            generationTemplateIds: [demoTemplate.id],
          },
        });
  });
  await page.route(`${projectPath}/workflows/generate`, (route) => {
    generationInputs.push(route.request().postDataJSON());
    if (generationInputs.length === 1) {
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "adapter_unavailable",
            message: "Generation provider is not configured",
          },
        },
      });
    }
    return route.fulfill({
      json: {
        draft: {
          contractVersion: "1",
          provider: "model",
          workflow:
            generationInputs.length === 2
              ? { ...generated, steps: [] }
              : generated,
          sourceAttachmentIds:
            generationInputs.length === 3
              ? ["unrequested-source"]
              : [demoAttachment.id, pendingAttachment.id],
          warnings: ["Review this draft before saving or running it"],
        },
      },
    });
  });

  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  const name = editor.getByLabel("Workflow name");
  await name.fill("Keep my current edits");
  await editor.getByText("Preview draft generation", { exact: true }).click();
  const panel = editor.getByRole("region", { name: "Workflow generation" });
  const generate = panel.getByRole("button", { name: "Generate draft" });
  await expect(panel.getByRole("alert")).toContainText(
    "Could not load templates",
  );
  await expect(generate).toBeDisabled();
  expect(generationInputs).toHaveLength(0);
  await panel.getByRole("button", { name: "Retry templates" }).click();
  await expect(
    panel.getByRole("checkbox", { name: /reference\.pdf/ }),
  ).toBeDisabled();
  await expect(panel.getByText(/Stored for reference only/)).toBeVisible();

  const objective = "Review the checkout requirement";
  await panel.getByLabel("Objective").fill(objective);
  await panel.getByLabel("Template").selectOption(demoTemplate.id);
  await panel.getByRole("checkbox", { name: /checkout\.md/ }).check();
  await panel.getByRole("checkbox", { name: /pending\.md/ }).check();
  await generate.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Generation is currently unavailable",
  );
  await expect(name).toHaveValue("Keep my current edits");
  await expect(panel.getByLabel("Objective")).toHaveValue(objective);
  await expect(
    panel.getByRole("button", { name: /replace editor/i }),
  ).toHaveCount(0);

  await generate.click();
  await expect(panel.getByRole("alert")).toContainText(
    "invalid workflow draft",
  );
  await expect(
    panel.getByRole("button", { name: /replace editor/i }),
  ).toHaveCount(0);
  await generate.click();
  await expect(panel.getByRole("alert")).toContainText(
    "invalid workflow draft",
  );
  await expect(name).toHaveValue("Keep my current edits");
  await generate.click();
  await expect(
    panel.getByRole("heading", { name: generated.name }),
  ).toBeVisible();
  await expect(panel.getByText(/Provider: model/)).toBeVisible();
  await expect(
    panel.getByRole("list", { name: "Draft warnings" }),
  ).toContainText("Review this draft before saving or running it");
  await expect(
    panel.getByRole("listitem").filter({ hasText: demoAttachment.filename }),
  ).toBeVisible();
  await expect(
    panel.getByRole("listitem").filter({ hasText: "pending.md" }),
  ).toBeVisible();
  await expect(name).toHaveValue("Keep my current edits");
  expect(generationInputs).toEqual(
    Array.from({ length: 4 }, () => ({
      objective,
      attachmentIds: [demoAttachment.id, pendingAttachment.id],
      templateIds: [demoTemplate.id],
    })),
  );

  await panel
    .getByRole("button", { name: "Replace editor with generated draft" })
    .click();
  await expect(name).toHaveValue(generated.name);
  await expect(
    editor.getByText("Generated workflow draft · Unsaved draft"),
  ).toBeVisible();
  expect(saves).toBe(0);
});

test("downloads reports for terminal runs and handles an unavailable renderer", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  const active: RunRecord = {
    ...demoFailedRun,
    id: "run-active",
    lifecycle: "running",
    outcome: null,
    finishedAt: undefined,
    events: [],
    steps: [],
    evidence: {
      ...demoFailedRun.evidence,
      runId: "run-active",
      capture: "unavailable",
      artifacts: [],
    },
  };
  const reports = {
    csv: {
      type: "text/csv; charset=utf-8",
      bytes: Buffer.from("revision,outcome\r\n1,failed\r\n"),
    },
    xlsx: {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    pdf: {
      type: "application/pdf",
      bytes: Buffer.from("%PDF transport fixture"),
    },
  };
  let unavailable = true;
  let invalidPdf = true;
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route(`${projectPath}/workflows`, (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route(`${projectPath}/attachments`, (route) =>
    route.fulfill({ json: { attachments: [] } }),
  );
  await page.route(`${projectPath}/runs`, (route) =>
    route.fulfill({ json: { runs: [active, demoFailedRun] } }),
  );
  await page.route(`${projectPath}/runs/${active.id}`, (route) =>
    route.fulfill({ json: { run: active } }),
  );
  await page.route(
    (url) =>
      url.pathname ===
      `/api/projects/${demoProject.id}/runs/${demoFailedRun.id}/report`,
    (route) => {
      const format = new URL(route.request().url()).searchParams.get("format");
      if (format === "csv" && unavailable) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "adapter_unavailable",
              message: "Report renderer is not configured",
            },
          },
        });
      }
      if (format === "pdf" && invalidPdf)
        return route.fulfill({
          contentType: "text/html",
          body: "<p>Unexpected HTML response</p>",
        });
      if (format !== "csv" && format !== "xlsx" && format !== "pdf")
        return route.abort();
      const file = reports[format];
      return route.fulfill({ contentType: file.type, body: file.bytes });
    },
  );

  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const runs = page.getByRole("region", { name: "Timeline", exact: true });
  const history = runs.getByLabel("Run history");
  await history.selectOption(active.id);
  await expect(runs.getByRole("status")).toContainText("running");
  await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(
    0,
  );
  await history.selectOption(demoFailedRun.id);
  const report = runs.getByRole("region", { name: "Run report" });
  await report.getByRole("button", { name: "Download CSV" }).click();
  await expect(report.getByRole("alert")).toContainText(
    "CSV export is currently unavailable",
  );
  await expect(history).toHaveValue(demoFailedRun.id);
  unavailable = false;

  await report.getByRole("button", { name: "Download PDF" }).click();
  await expect(report.getByRole("alert")).toContainText(
    "unexpected report format",
  );
  invalidPdf = false;

  for (const format of ["csv", "xlsx", "pdf"] as const) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      report
        .getByRole("button", { name: `Download ${format.toUpperCase()}` })
        .click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `veriflow-${demoFailedRun.id}.${format}`,
    );
    expect(await readFile(await download.path())).toEqual(
      reports[format].bytes,
    );
    await expect(report.getByRole("status")).toHaveText(
      `${format.toUpperCase()} download started.`,
    );
    await expect(report.getByRole("alert")).toHaveCount(0);
  }
});
