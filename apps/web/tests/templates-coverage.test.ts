import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplate,
  templateOptions,
} from "../server/templates/coverage.ts";
import { workflowSchema } from "@veriflow/core";
test("all category defaults build editable, valid independent workflows", () => {
  const options = templateOptions("http://localhost:3000/demo");
  for (const option of options) {
    const first = buildTemplate(option.id, option.defaults, "first");
    workflowSchema.parse(first);
    assert.equal(first.category, option.category);
    first.steps.length = 0;
    assert.ok(buildTemplate(option.id, option.defaults, "second").steps.length);
  }
});
test("templates reject unknown parameters, empty checklists, credential URLs and invalid secret names", () => {
  assert.throws(() =>
    buildTemplate(
      "compliance-checklist",
      { url: "http://localhost", requirements: [] },
      "test",
    ),
  );
  assert.throws(() =>
    buildTemplate(
      "accessibility-wcag",
      { url: "http://u:p@localhost" },
      "test",
    ),
  );
  assert.throws(() =>
    buildTemplate(
      "responsive-viewports",
      { url: "http://localhost", viewports: [{ width: 0, height: 720 }] },
      "test",
    ),
  );
  assert.throws(() =>
    buildTemplate(
      "security-access",
      { checks: [{ url: "http://localhost", statuses: [] }] },
      "test",
    ),
  );
  const auth = templateOptions("http://localhost").find(
    (t) => t.id === "functional-auth",
  )!;
  assert.throws(() =>
    buildTemplate(
      auth.id,
      { ...auth.defaults, passwordSecret: "password with spaces" },
      "test",
    ),
  );
});
