import { test } from "node:test";
import assert from "node:assert/strict";
import { workflowSchema } from "@veriflow/core";
import { FakeWorkflowRepository } from "../src/testing.js";

test("repository fixtures isolate projects, copy values and reject stale writes", async () => {
  const repository = new FakeWorkflowRepository();
  const workflow = workflowSchema.parse({
    schemaVersion: "1",
    id: "w",
    name: "Example",
    steps: [{ id: "s", code: "redirect", url: "https://example.com" }],
  });
  const stored = await repository.save("p1", workflow, null);
  stored.workflow.name = "Mutation";
  assert.equal((await repository.get("p1", "w"))?.workflow.name, "Example");
  assert.equal(await repository.get("p2", "w"), null);
  await assert.rejects(
    repository.save("p1", workflow, null),
    /Revision conflict/,
  );
  assert.equal((await repository.save("p1", workflow, 1)).revision, 2);
  await assert.rejects(repository.save("p1", workflow, 1), /Revision conflict/);
});
