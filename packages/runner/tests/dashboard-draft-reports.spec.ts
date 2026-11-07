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

  const fixture = editor.getByRole("region", { name: "Generation fixture" });
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
