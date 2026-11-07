import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  demoAttachment,
  demoFailedRun,
  demoProject,
  demoTemplate,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import type { RunRecord } from "@veriflow/core";

const projectPath = `**/api/projects/${demoProject.id}`;

test("previews generation inputs without changing or saving the current draft", async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  let writeRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/workflows"))
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

  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  const name = editor.getByLabel("Workflow name");
  await name.fill("My unsaved changes");
  await editor.getByText("Preview draft generation", { exact: true }).click();

  const fixture = editor.getByRole("region", { name: "Workflow generation" });
  await fixture.getByLabel("Generation mode").selectOption("fixture");
  await fixture
    .getByLabel("Objective")
    .fill("Verify the discount from the checkout requirements.");
  await fixture.getByLabel("Template").selectOption(demoTemplate.id);
  await fixture.getByRole("checkbox", { name: /pending\.md/ }).check();
  await fixture.getByRole("button", { name: "Prepare fixture draft" }).click();
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
  ).toContainText("seeded workflow steps and attachment metadata");
  await expect(name).toHaveValue("My unsaved changes");
  await page.screenshot({
    path: testInfo.outputPath("generation-fixture.png"),
    fullPage: true,
  });

  await fixture
    .getByRole("button", { name: "Replace editor with fixture draft" })
    .click();
  await expect(name).toHaveValue(demoWorkflow.name);
  await expect(
    editor.getByText("Generation fixture draft · Unsaved draft"),
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
      json: { attachments: [demoAttachment, pendingAttachment] },
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
      : route.fulfill({ json: { templates: [demoTemplate] } });
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
          sourceAttachmentIds: [demoAttachment.id],
          warnings: ["One attachment could not be used."],
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
  await expect(
    panel.getByRole("heading", { name: generated.name }),
  ).toBeVisible();
  await expect(panel.getByText(/Provider: model/)).toBeVisible();
  await expect(
    panel.getByRole("list", { name: "Draft warnings" }),
  ).toContainText("One attachment could not be used.");
  await expect(
    panel.getByRole("listitem").filter({ hasText: demoAttachment.filename }),
  ).toBeVisible();
  await expect(
    panel.getByRole("listitem").filter({ hasText: "pending.md" }),
  ).toHaveCount(0);
  await expect(name).toHaveValue("Keep my current edits");
  expect(generationInputs).toEqual(
    Array.from({ length: 3 }, () => ({
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
  const runs = page.getByRole("region", { name: "Saved revisions and runs" });
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
