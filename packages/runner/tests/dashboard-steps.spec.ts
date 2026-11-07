import { expect, test } from "@playwright/test";
import { workflowSchema, type Workflow } from "@veriflow/core";
import { demoProject } from "@veriflow/core/fixtures";

test("plain-language editing preserves all step types and supports changes without JSON", async ({
  page,
  baseURL,
}) => {
  const target = { by: "testId", value: "checkout-control" };
  const workflow = workflowSchema.parse({
    schemaVersion: "1",
    id: "all-actions",
    name: "Every supported action",
    steps: [
      { id: "open", code: "redirect", url: demoProject.url },
      { id: "fill", code: "fill", target, value: "Coupon" },
      { id: "check", code: "check", target },
      { id: "uncheck", code: "uncheck", target },
      { id: "click", code: "click", target },
      {
        id: "assert",
        code: "assert",
        target,
        expectation: { kind: "checked", value: false },
      },
      { id: "viewport", code: "viewport", width: 768, height: 1024 },
      { id: "layout", code: "assertLayout", target },
      {
        id: "accessibility",
        code: "accessibility",
        tags: ["wcag2a", "wcag22aa"],
      },
      {
        id: "http",
        code: "assertHttp",
        url: demoProject.url,
        statuses: [401, 403],
      },
      {
        id: "secret",
        code: "fillSecret",
        target,
        secret: "TEST_LOGIN_PASSWORD",
      },
      {
        id: "requirement",
        code: "assertRequirement",
        requirementId: "REQ-42",
        requirement: "Checkout total is correct",
        source: "requirements.md",
        target,
        expectation: { kind: "text", value: "90000" },
      },
    ],
  });
  const revision = {
    projectId: demoProject.id,
    revision: 1,
    workflow,
    savedAt: demoProject.createdAt,
  };
  const projectPath = `**/api/projects/${demoProject.id}`;
  let saved: Workflow | undefined;
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [demoProject] } }),
  );
  await page.route(`${projectPath}/runs`, (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route(`${projectPath}/attachments`, (route) =>
    route.fulfill({ json: { attachments: [] } }),
  );
  await page.route(`${projectPath}/templates`, (route) =>
    route.fulfill({ json: { templates: [] } }),
  );
  await page.route(`${projectPath}/workflows`, (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      expect(input.expectedRevision).toBe(1);
      saved = workflowSchema.parse(input.workflow);
      return route.fulfill({
        status: 201,
        json: { workflow: { ...revision, workflow: saved, revision: 2 } },
      });
    }
    return route.fulfill({ json: { workflows: [revision] } });
  });
  await page.route(`${projectPath}/workflows/all-actions**`, (route) =>
    route.fulfill({ json: { workflow: revision } }),
  );
  await page.goto(baseURL!);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const runs = page.getByRole("region", { name: "Timeline", exact: true });
  await runs.getByLabel("Saved workflow").selectOption(workflow.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor
    .getByRole("button", { name: "Review selected revision" })
    .click();
  const steps = editor
    .getByRole("list", { name: "Workflow steps" })
    .getByRole("listitem");
  await expect(steps).toHaveCount(12);
  await expect(editor.getByLabel("Workflow steps (JSON)")).toHaveCount(0);
  await expect(steps.nth(5)).toContainText(
    "Check checkout control is not selected",
  );
  await expect(steps.nth(6)).toContainText("768 × 1024 pixels");
  await expect(steps.nth(8)).toContainText("WCAG2A, WCAG22AA");
  await expect(steps.nth(9)).toContainText("HTTP 401 or 403");
  await expect(steps.nth(10)).toContainText("saved secret TEST_LOGIN_PASSWORD");
  await expect(steps.nth(11)).toContainText(
    "REQ-42: Checkout total is correct",
  );
  await steps.nth(1).getByText("Edit step 2", { exact: true }).click();
  await steps.nth(1).getByLabel("Text to enter").fill("SAVE10");
  await steps.nth(6).getByText("Edit step 7", { exact: true }).click();
  await steps.nth(6).getByLabel("Width in pixels").fill("390");
  await steps.nth(6).getByLabel("Height in pixels").fill("844");
  await editor.getByRole("button", { name: "Add step", exact: true }).click();
  await steps.nth(12).getByText("Edit step 13", { exact: true }).click();
  await steps.nth(12).getByRole("button", { name: "Move up" }).click();
  await steps.nth(11).getByRole("button", { name: "Remove step" }).click();
  await expect(steps).toHaveCount(12);
  await editor
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  await expect(editor.getByRole("status")).toHaveText("Saved revision 2.");
  expect(saved).toEqual({
    ...workflow,
    steps: workflow.steps.map((step) =>
      step.code === "fill"
        ? { ...step, value: "SAVE10" }
        : step.code === "viewport"
          ? { ...step, width: 390, height: 844 }
          : step,
    ),
  });
});
