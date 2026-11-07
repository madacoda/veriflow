import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoWorkflow } from "@veriflow/core/fixtures";
import { startBuiltPlatform } from "../unit/built-platform.ts";
import AxeBuilder from "@axe-core/playwright";
import type { RunRecord } from "@veriflow/core";

test("configured runtime generates, reviews, saves and runs a workflow with inline screenshots and a reconciled report", async ({
  page,
}, testInfo) => {
  // This full journey includes generation, a real browser run (20s poll), PNGs,
  // CSV/PDF downloads, responsive layouts and axe; allow room under parallel load.
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "veriflow-generation-browser-"));
  const requests: {
    model: string;
    messages: { role: string; content: string }[];
  }[] = [];
  // Explicit local HTTP fixture; Chromium and the built app/SDK are real, the model is not.
  const fixture = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const input = JSON.parse(
      body.messages.find((message: { role: string }) => message.role === "user")
        .content,
    );
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: "explicit-provider-fixture",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                ...demoWorkflow,
                name: "Draft from configured HTTP fixture",
                steps: demoWorkflow.steps.map((step) =>
                  step.code === "redirect"
                    ? { ...step, url: input.project.url }
                    : step,
                ),
              }),
            },
          },
        ],
      }),
    );
  });
  let platform: Awaited<ReturnType<typeof startBuiltPlatform>> | undefined;
  try {
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const address = fixture.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture failed to listen");
    platform = await startBuiltPlatform(root, {
      OPENAI_API_KEY: "explicit-fixture-key",
      OPENAI_MODEL: "explicit-fixture-model",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    });
    const created = await page.request.post(`${platform.origin}/api/projects`, {
      data: {
        title: "Configured provider fixture",
        url: `${platform.origin}/demo?bug=0`,
      },
    });
    expect(created.status()).toBe(201);
    const { project } = await created.json();
    await page.goto(platform.origin);
    await page.getByLabel("Selected project").selectOption(project.id);
    const editor = page.getByRole("region", { name: "Workflow draft" });
    await editor.getByRole("button", { name: "Load coupon fixture" }).click();
    await editor
      .getByLabel("Workflow name")
      .fill("Keep current unsaved changes");
    await editor.getByText("Preview draft generation", { exact: true }).click();
    const panel = editor.getByRole("region", { name: "Workflow generation" });
    await expect(panel.getByLabel("Generation mode")).toHaveCount(0);
    await expect(editor.getByLabel("Workflow steps (JSON)")).toHaveCount(0);
    await panel
      .getByLabel("Objective")
      .fill("Verify SAVE10 changes the total to 90000");
    const [response] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/workflows/generate"),
      ),
      panel
        .getByRole("button", { name: "Generate draft", exact: true })
        .click(),
    ]);
    expect(response.status()).toBe(200);
    expect((await response.json()).draft.provider).toBe("model");
    await expect(
      panel.getByRole("heading", {
        name: "Draft from configured HTTP fixture",
      }),
    ).toBeVisible();
    await expect(editor.getByLabel("Workflow name")).toHaveValue(
      "Keep current unsaved changes",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("explicit-fixture-model");
    await panel
      .getByRole("button", { name: "Replace editor with generated draft" })
      .click();
    await expect(editor.getByLabel("Workflow name")).toHaveValue(
      "Draft from configured HTTP fixture",
    );
    for (const kind of ["workflows", "runs"]) {
      const stored = await page.request.get(
        `${platform.origin}/api/projects/${project.id}/${kind}`,
      );
      expect((await stored.json())[kind]).toEqual([]);
    }
    await editor
      .getByRole("button", { name: "Save workflow", exact: true })
      .click();
    await expect(editor.getByRole("status")).toHaveText("Saved revision 1.");
    const runs = page.getByRole("region", { name: "Timeline", exact: true });
    const [started] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/projects/${project.id}/runs`) &&
          response.request().method() === "POST",
      ),
      runs.getByRole("button", { name: "Start run", exact: true }).click(),
    ]);
    expect(started.status()).toBe(202);
    const { run: queued } = await started.json();
    let completed: RunRecord | undefined;
    await expect
      .poll(
        async () => {
          completed = (
            await (
              await page.request.get(
                `${platform!.origin}/api/projects/${project.id}/runs/${queued.id}`,
              )
            ).json()
          ).run;
          return completed?.lifecycle;
        },
        { timeout: 20000 },
      )
      .toBe("completed");
    expect(completed).toMatchObject({
      adapter: "browser",
      outcome: "passed",
      revision: 1,
    });
    expect(completed!.steps.at(-1)).toMatchObject({
      expected: "90000",
      actual: "90000",
      status: "passed",
    });
    await expect(runs.getByRole("status")).toContainText("passed");
    await expect(
      runs.getByRole("heading", { name: "Evidence", exact: true }),
    ).toHaveCount(0);
    for (const artifact of completed!.evidence.artifacts) {
      const row = runs.locator(`[data-step-id="${artifact.stepId}"]`);
      await expect(
        row.getByRole("img", {
          name: `Screenshot for ${artifact.stepId}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        row.getByRole("link", {
          name: `Open screenshot for ${artifact.stepId}`,
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `/api/projects/${project.id}/runs/${queued.id}/evidence/${artifact.id}`,
      );
    }
    await expect
      .poll(() =>
        runs
          .getByRole("img")
          .evaluateAll((images) =>
            images.every(
              (image) => (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect(
      runs.getByRole("heading", {
        name: "Check order total reads “90000”",
        exact: true,
      }),
    ).toBeVisible();
    const snapshot = (
      await (
        await page.request.get(
          `${platform.origin}/api/projects/${project.id}/runs/${queued.id}/report`,
        )
      ).json()
    ).snapshot;
    expect(snapshot.run).toEqual(completed);
    expect(snapshot.workflow.revision).toBe(1);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      runs.getByRole("button", { name: "Download CSV", exact: true }).click(),
    ]);
    const reportPath = testInfo.outputPath("generated-run.csv");
    await download.saveAs(reportPath);
    const csv = await readFile(reportPath, "utf8");
    expect(csv).toContain(queued.id);
    expect(csv).toContain('"90000","90000"');
    expect(csv).toContain('"browser","completed","passed"');
    const [pdfDownload, pdfResponse] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse(
        (response) =>
          response.url() ===
          `${platform!.origin}/api/projects/${project.id}/runs/${queued.id}/report?format=pdf`,
      ),
      runs.getByRole("button", { name: "Download PDF", exact: true }).click(),
    ]);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
    expect(pdfDownload.suggestedFilename()).toBe(`veriflow-${queued.id}.pdf`);
    const pdfPath = testInfo.outputPath("generated-run.pdf");
    await pdfDownload.saveAs(pdfPath);
    const pdf = await readFile(pdfPath);
    expect(pdf.subarray(0, 8).toString()).toMatch(/^%PDF-1\./);
    expect(pdf.subarray(-20).toString()).toContain("%%EOF");
    await expect(
      runs.getByRole("region", { name: "Run report" }).getByRole("status"),
    ).toHaveText("PDF download started.");
    await testInfo.attach("generated-run-pdf", {
      path: pdfPath,
      contentType: "application/pdf",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const timelineBox = (await runs.boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    expect(timelineBox.x).toBeLessThan(editorBox.x);
    expect(timelineBox.width).toBeGreaterThan(editorBox.width);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath("configured-generation-http-fixture.png"),
      fullPage: true,
    });
  } finally {
    await platform?.close();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
