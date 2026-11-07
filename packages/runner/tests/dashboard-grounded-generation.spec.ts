import { test, expect } from "@playwright/test";
import { demoProject } from "@veriflow/core/fixtures";

test("explicit page and guard intent regenerate a preview without replacing unsaved edits", async ({
  page,
  baseURL,
}) => {
  let input: Record<string, unknown> | undefined;
  let writes = 0;
  // Explicit HTTP fixture: no model call or target inspection is claimed by this test.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/workflows/generate")) {
      input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          draft: {
            contractVersion: "1",
            provider: "fixture",
            sourceAttachmentIds: [],
            warnings: [
              "Fixture only. Check access restrictions; protected functionality is unverified.",
            ],
            workflow: {
              schemaVersion: "1",
              id: "new-guard-draft",
              name: "Guard fixture",
              steps: [
                {
                  id: "guard",
                  code: "assert",
                  target: {
                    by: "role",
                    role: "heading",
                    value: "Player account required",
                  },
                  expectation: { kind: "visible", value: true },
                  timeoutMs: 1000,
                },
              ],
            },
          },
        },
      });
    }
    if (route.request().method() !== "GET") writes++;
    if (path === "/api/projects")
      return route.fulfill({ json: { projects: [demoProject] } });
    if (path === "/api/templates")
      return route.fulfill({
        json: { templates: [], generationTemplateIds: [] },
      });
    const key = path.split("/").at(-1)!;
    if (["templates", "workflows", "runs", "attachments"].includes(key))
      return route.fulfill({ json: { [key]: [] } });
    return route.fulfill({ json: { project: demoProject } });
  });
  await page.goto(baseURL!);
  await page.getByLabel("Selected project").selectOption(demoProject.id);
  const editor = page.getByRole("region", { name: "Workflow draft" });
  await editor.getByRole("button", { name: "Load coupon fixture" }).click();
  await editor.getByLabel("Workflow name").fill("Preserve my edits");
  await editor.getByText("Preview draft generation", { exact: true }).click();
  const panel = editor.getByRole("region", { name: "Workflow generation" });
  await panel
    .getByLabel("Additional pages to inspect (optional)")
    .fill("https://game.pixelogicgames.com/shop");
  await panel.getByLabel("Test purpose").selectOption("guard");
  await panel
    .getByRole("checkbox", {
      name: "Regenerate from the current editor draft, preserving its assertions",
    })
    .check();
  await panel.getByLabel("Objective").fill("Check access restrictions");
  await panel
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Guard fixture" }),
  ).toBeVisible();
  expect(input?.accessMode).toBe("guard");
  expect(input?.pageUrls).toEqual(["https://game.pixelogicgames.com/shop"]);
  expect(input?.baseWorkflow).toMatchObject({ name: "Preserve my edits" });
  await expect(editor.getByLabel("Workflow name")).toHaveValue(
    "Preserve my edits",
  );
  expect(writes).toBe(0);
  await panel
    .getByRole("button", { name: "Replace editor with fixture draft" })
    .click();
  await expect(editor.getByLabel("Workflow name")).toHaveValue("Guard fixture");
  await expect(editor.getByLabel("Element role", { exact: true })).toHaveValue(
    "heading",
  );
  expect(writes).toBe(0);
});
