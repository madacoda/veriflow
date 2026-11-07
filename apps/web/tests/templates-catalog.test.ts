import assert from "node:assert/strict";
import { test } from "node:test";
import { templateDefinitionSchema, workflowSchema } from "@veriflow/core";
import { demoTemplate } from "@veriflow/core/fixtures";
import {
  functionalTemplateFixture,
  listTemplates,
  resolveTemplates,
} from "../server/templates/catalog.ts";
import { AgentError } from "../server/agent/errors.ts";

test("catalog begins with shared versioned functional fixture and explicit prerequisites/capabilities", () => {
  const templates = listTemplates();
  assert.equal(templates.length, 10);
  assert.equal(new Set(templates.map((t) => t.category)).size, 6);
  assert.deepEqual(templateDefinitionSchema.parse(templates[0]), demoTemplate);
  assert.equal(templates[0].category, "functional");
  assert.equal(templates[0].version, "1.0.0");
  assert.ok(templates[0].prerequisites.length > 0);
  assert.deepEqual(templates[0].requiredCapabilities, [
    "navigate",
    "fill",
    "click",
    "assert",
    "screenshot",
  ]);
  assert.deepEqual(templates[0].parameterSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  const fixture = functionalTemplateFixture();
  assert.equal(fixture.provider, "fixture");
  workflowSchema.parse(fixture.workflow);
});

test("catalog callers cannot change future definitions, and missing templates fail explicitly", () => {
  const first = listTemplates();
  first[0].requiredCapabilities.length = 0;
  assert.ok(listTemplates()[0].requiredCapabilities.includes("screenshot"));
  assert.equal(resolveTemplates([demoTemplate.id, demoTemplate.id]).length, 1);
  assert.throws(
    () => resolveTemplates(["not-implemented"]),
    (error: unknown) =>
      error instanceof AgentError && error.code === "template_unavailable",
  );
});
