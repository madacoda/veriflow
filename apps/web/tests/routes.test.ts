import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/health/route.js";
import { POST } from "../app/api/workflows/validate/route.js";
test("health remains available in the monolith", async () => {
  assert.deepEqual(await GET().json(), { status: "ok" });
});
test("workflow HTTP boundary accepts valid input and rejects malformed documents", async () => {
  const request = (body: string) =>
    new Request("http://localhost/api/workflows/validate", {
      method: "POST",
      body,
    });
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request("{}"))).status, 422);
  const response = await POST(
    request(
      JSON.stringify({
        schemaVersion: "1",
        id: "test",
        name: "Test",
        steps: [{ id: "open", code: "redirect", url: "https://example.com" }],
      }),
    ),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plan.commands[0].action, "navigate");
});
