import { test, expect } from "@playwright/test";

test("the monolith serves its UI, health and workflow translation", async ({
  page,
  request,
}) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByRole("heading", { name: "Veriflow" })).toBeVisible();
  expect(
    await (await request.get("http://127.0.0.1:3000/health")).json(),
  ).toEqual({ status: "ok" });
  const response = await request.post(
    "http://127.0.0.1:3000/api/workflows/validate",
    {
      data: {
        schemaVersion: "1",
        id: "integration",
        name: "Integration",
        steps: [{ id: "open", code: "redirect", url: "https://example.com" }],
      },
    },
  );
  expect(response.status()).toBe(200);
  expect((await response.json()).plan.commands[0].action).toBe("navigate");
});
