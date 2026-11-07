import assert from "node:assert/strict";
import { test } from "node:test";
import { templateDefinitionSchema, workflowSchema } from "@veriflow/core";
import {
  demoRevision,
  demoTemplate,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import {
  functionalTemplateFixture,
  listTemplates,
  resolveTemplates,
} from "../server/templates/catalog.ts";
import { coverageTemplates } from "../server/templates/coverage.ts";
import { AgentError } from "../server/agent/errors.ts";
import { templateDefinitionFixtures } from "../server/templates/fixtures.ts";

test("catalog begins with shared versioned functional fixture and explicit prerequisites/capabilities", () => {
  const templates = listTemplates();
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
  assert.deepEqual(workflowSchema.parse(fixture.workflow), demoWorkflow);
});

test("catalog covers all six v1 categories with unique versioned definitions and prerequisites", () => {
  const templates = listTemplates();
  assert.equal(templates.length, 15);
  assert.equal(
    new Set(templates.map((template) => template.id)).size,
    templates.length,
  );
  assert.deepEqual(
    [...new Set(templates.map((template) => template.category))].sort(),
    [
      "accessibility",
      "compliance",
      "functional",
      "regression",
      "responsive",
      "security",
    ],
  );
  for (const template of templates) {
    templateDefinitionSchema.parse(template);
    assert.equal(
      template.version,
      coverageTemplates.some((t) => t.definition.id === template.id)
        ? "1.1.0"
        : "1.0.0",
    );
    assert.ok(template.prerequisites.length > 0);
    assert.ok(template.requiredCapabilities.length > 0);
    assert.equal(template.parameterSchema.type, "object");
    assert.equal(template.parameterSchema.additionalProperties, false);
  }
  for (const [id, capability] of [
    ["responsive-layout", "viewport"],
    ["security-passive-baseline", "security"],
    ["accessibility-page-audit", "accessibility"],
  ] as const) {
    const [template] = resolveTemplates([id]);
    assert.ok(template.requiredCapabilities.includes(capability));
    assert.match(template.prerequisites.join(" "), /Generation is unavailable/);
  }
});

test("catalog callers cannot change future definitions, and missing templates fail explicitly", () => {
  const first = listTemplates();
  first[0].requiredCapabilities.length = 0;
  assert.ok(listTemplates()[0].requiredCapabilities.includes("screenshot"));
  const [responsive] = resolveTemplates(["responsive-layout"]);
  const original = structuredClone(responsive);
  responsive.prerequisites.length = 0;
  // Nested JSON-schema values are copied, too.
  const properties = responsive.parameterSchema.properties as Record<
    string,
    { items: unknown }
  >;
  properties.viewports.items = { type: "string" };
  assert.deepEqual(resolveTemplates(["responsive-layout"])[0], original);
  assert.equal(resolveTemplates([demoTemplate.id, demoTemplate.id]).length, 1);
  assert.deepEqual(
    resolveTemplates([
      "requirements-acceptance",
      demoTemplate.id,
      "requirements-acceptance",
    ]).map((template) => template.id),
    ["requirements-acceptance", demoTemplate.id],
  );
  assert.throws(
    () => resolveTemplates(["not-implemented"]),
    (error: unknown) =>
      error instanceof AgentError && error.code === "template_unavailable",
  );
});

test("definition fixtures are labeled, independently editable and never fabricate unsupported workflows", () => {
  const fixtures = templateDefinitionFixtures();
  assert.equal(fixtures.length, listTemplates().length);
  for (const fixture of fixtures) {
    assert.equal(fixture.provider, "fixture");
    assert.match(
      fixture.warning,
      /no model, browser or check adapter was executed/,
    );
    if (
      ["functional", "compliance"].includes(fixture.template.category) ||
      coverageTemplates.some((t) => t.definition.id === fixture.template.id)
    ) {
      workflowSchema.parse(fixture.workflow);
    } else {
      assert.equal(fixture.workflow, undefined);
    }
  }
  const requirements = fixtures.find(
    (fixture) => fixture.template.category === "compliance",
  )!;
  assert.ok(
    requirements.sourceDocuments?.every(
      (document) =>
        document.attachmentId &&
        document.kind === "text" &&
        document.text.trim(),
    ),
  );
  const regression = fixtures.find(
    (fixture) => fixture.template.category === "regression",
  )!;
  assert.deepEqual(regression.reviewedWorkflow, demoRevision);
  assert.deepEqual(regression.parameters, {
    workflowId: demoRevision.workflow.id,
    revision: demoRevision.revision,
  });
  const before = structuredClone(fixtures);
  regression.reviewedWorkflow!.workflow.steps.length = 0;
  requirements.sourceDocuments!.length = 0;
  fixtures[0].template.requiredCapabilities.length = 0;
  fixtures[0].parameters.extra = true;
  assert.deepEqual(templateDefinitionFixtures(), before);
});
