import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowSchema, type DraftGenerator } from "@veriflow/core";
import {
  demoContext,
  demoProject,
  demoTemplate,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import {
  AgentError,
  createDraftGenerator,
  createOpenAIDraftProvider,
} from "../server/agent/index.ts";
import { createFixtureProvider } from "../server/agent/fixtures.ts";

const input = (
  templateIds = ["requirements-acceptance"],
): Parameters<DraftGenerator["generate"]>[0] => ({
  project: structuredClone(demoProject),
  request: {
    objective: "Verify the supplied coupon requirement",
    attachmentIds: [demoContext.attachmentId],
    templateIds,
  },
  documents: [structuredClone(demoContext)],
});
const active = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;

for (const id of [
  "responsive-layout",
  "security-passive-baseline",
  "accessibility-page-audit",
  "regression-saved-revision",
]) {
  test(`${id} cannot silently become a functional draft, even in a mixed selection`, async () => {
    let calls = 0;
    const generator = createDraftGenerator({
      provider: {
        kind: "fixture",
        async generate() {
          calls++;
          return demoWorkflow;
        },
      },
    });
    for (const ids of [[id], [demoTemplate.id, id]]) {
      await assert.rejects(
        generator.generate(input(ids), active()),
        code("template_unavailable"),
      );
    }
    assert.equal(calls, 0);
  });
}

test("supplied-requirement generation rejects missing or blank source text before dispatch", async () => {
  let calls = 0;
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate() {
        calls++;
        return demoWorkflow;
      },
    },
  });
  const missing = input();
  missing.request.attachmentIds = [];
  missing.documents = [];
  await assert.rejects(
    generator.generate(missing, active()),
    code("template_unavailable"),
  );
  const blank = input();
  blank.documents = [
    { kind: "text", attachmentId: demoContext.attachmentId, text: " \n\t " },
  ];
  await assert.rejects(
    generator.generate(blank, active()),
    code("template_unavailable"),
  );
  const image = input();
  image.documents = [
    {
      kind: "image",
      attachmentId: demoContext.attachmentId,
      mediaType: "image/png",
    },
  ];
  await assert.rejects(
    generator.generate(image, active()),
    code("unsupported_format"),
  );
  assert.equal(calls, 0);
});

test("requirement-based fixtures retain sources and browser assertions with a trusted coverage warning", async () => {
  const source = input([
    "requirements-acceptance",
    demoTemplate.id,
    "requirements-acceptance",
  ]);
  const before = structuredClone(source);
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate(received) {
        assert.deepEqual(
          received.templates.map((template) => template.id),
          ["requirements-acceptance", demoTemplate.id],
        );
        assert.equal(received.templates[0].version, "1.0.0");
        assert.deepEqual(received.documents, source.documents);
        // Provider changes cannot suppress trusted warnings or source references.
        received.templates[0].category = "functional";
        received.request.attachmentIds.length = 0;
        return structuredClone(demoWorkflow);
      },
    },
  });
  const draft = await generator.generate(source, active());
  workflowSchema.parse(draft.workflow);
  assert.equal(draft.provider, "fixture");
  assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
  assert.match(draft.warnings.join(" "), /no model was called/);
  assert.match(
    draft.warnings.join(" "),
    /coverage against the supplied requirement sources/,
  );
  assert.match(draft.warnings.join(" "), /not a certification/);
  assert.ok(draft.workflow.steps.some((step) => step.code === "assert"));
  assert.deepEqual(source, before);
});

test("supplied-requirement output must contain an assertion, even if the provider alters its template copy", async () => {
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate(received) {
        received.templates[0].category = "functional";
        return {
          ...demoWorkflow,
          steps: demoWorkflow.steps.filter((step) => step.code !== "assert"),
        };
      },
    },
  });
  await assert.rejects(
    generator.generate(input(), active()),
    code("invalid_provider_output"),
  );
});

test("ordinary functional generation keeps its existing warnings and needs no requirement attachment", async () => {
  const source = input([demoTemplate.id]);
  source.request.attachmentIds = [];
  source.documents = [];
  const draft = await createDraftGenerator({
    provider: createFixtureProvider(),
  }).generate(source, active());
  assert.deepEqual(draft.warnings, [
    "Deterministic fixture output; no model was called",
    "Review this draft before saving or running it",
  ]);
  assert.deepEqual(draft.workflow, demoWorkflow);
});

test("direct OpenAI provider use also checks template prerequisites before HTTP dispatch", async () => {
  let requests = 0;
  const provider = createOpenAIDraftProvider({
    apiKey: "fixture-credential-not-a-real-key",
    model: "fixture-model",
    fetch: async () => {
      requests++;
      throw new Error("No HTTP fixture should be called");
    },
  });
  // Caller-supplied definitions cannot bypass catalog validation.
  for (const id of [
    "responsive-layout",
    "security-passive-baseline",
    "accessibility-page-audit",
    "regression-saved-revision",
    "requirements-acceptance",
  ]) {
    const source = input([id]);
    source.request.attachmentIds = [];
    source.documents = [];
    await assert.rejects(
      provider.generate({ ...source, templates: [demoTemplate] }, active()),
      code("template_unavailable"),
    );
  }
  assert.equal(requests, 0);
});
