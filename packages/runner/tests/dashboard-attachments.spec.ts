import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoAttachment, demoProject } from "@veriflow/core/fixtures";
import { MAX_ATTACHMENT_BYTES } from "@veriflow/core";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("keeps attachment results scoped when the selected project changes during a request", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  const other = { ...demoProject, id: "project-other", title: "Other project" };
  const firstStarted = latch();
  const releaseFirst = latch();
  const firstFinished = latch();
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject, other] } }),
  );
  await page.route("**/api/projects/*/workflows", (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route("**/api/projects/*/runs", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route(
    `**/api/projects/${demoProject.id}/attachments`,
    async (route) => {
      firstStarted.release();
      await releaseFirst.promise;
      try {
        await route.fulfill({
          json: {
            attachments: [{ ...demoAttachment, filename: "first-only.md" }],
          },
        });
      } finally {
        firstFinished.release();
      }
    },
  );
  await page.route(`**/api/projects/${other.id}/attachments`, (route) =>
    route.fulfill({
      json: {
        attachments: [
          {
            ...demoAttachment,
            projectId: other.id,
            filename: "second-only.md",
            extraction: {
              status: "failed",
              code: "extraction_failed",
              message: "Fixture extraction could not read the file.",
            },
          },
        ],
      },
    }),
  );

  await page.goto(origin);
  const project = page.getByLabel("Selected project");
  const panel = page.getByRole("region", { name: "Project attachments" });
  await project.selectOption(demoProject.id);
  await firstStarted.promise;
  await project.selectOption(other.id);
  releaseFirst.release();
  await firstFinished.promise;
  await expect(panel.getByText("second-only.md")).toBeVisible();
  await expect(panel.getByText("Extraction failed")).toBeVisible();
  await expect(
    panel.getByText("Fixture extraction could not read the file."),
  ).toBeVisible();
  await expect(panel.getByText("first-only.md")).toHaveCount(0);
});

test("rejects invalid files and retains the file after an upload error", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  let uploadRequests = 0;
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route("**/api/projects/*/workflows", (route) =>
    route.fulfill({ json: { workflows: [] } }),
  );
  await page.route("**/api/projects/*/runs", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route("**/api/projects/*/attachments", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { attachments: [] } });
    uploadRequests++;
    return route.fulfill({
      status: 500,
      json: {
        error: {
          code: "internal_error",
          message: "Upload could not be completed",
        },
      },
    });
  });

  await page.goto(origin);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const panel = page.getByRole("region", { name: "Project attachments" });
  const file = panel.getByLabel("Attachment file");
  const upload = panel.getByRole("button", { name: "Upload attachment" });
  await file.setInputFiles({
    name: "archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("zip"),
  });
  await upload.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Attachment format is not supported",
  );
  await file.setInputFiles({
    name: "large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
  });
  await upload.click();
  await expect(panel.getByRole("alert")).toContainText("at most 10 MiB");
  expect(uploadRequests).toBe(0);
  await file.setInputFiles({
    name: "requirements.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Review the coupon total."),
  });
  await upload.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Upload could not be completed",
  );
  await expect(file).toHaveValue(/requirements\.txt$/);
  await expect(upload).toBeEnabled();
  expect(uploadRequests).toBe(1);
});

test("uploads a Markdown attachment and reloads its pending status from P2", async ({
  page,
  baseURL,
}, testInfo) => {
  const origin = baseURL ?? new URL(demoProject.url).origin;
  test.skip(
    process.env.VERIFLOW_U1_TEST_HTTP !== "1",
    "Enable with an isolated STORAGE_DIR.",
  );
  await page.goto(origin);
  await page.getByLabel("Project name").fill(`Attachments ${randomUUID()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  const panel = page.getByRole("region", { name: "Project attachments" });
  await expect(panel.getByText("No attachments yet.")).toBeVisible();
  const projectId = await page.getByLabel("Selected project").inputValue();
  await panel.getByLabel("Attachment file").setInputFiles({
    name: "checkout-requirements.md",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("# Checkout\nSAVE10 updates the order total."),
  });
  await panel.getByRole("button", { name: "Upload attachment" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "checkout-requirements.md uploaded.",
  );
  await expect(panel.getByText("Extraction pending")).toBeVisible();

  await page.reload();
  await page.getByLabel("Selected project").selectOption(projectId);
  await expect(
    panel.getByText("checkout-requirements.md", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Extraction pending")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("attachment-pending.png"),
    fullPage: true,
  });
});
