import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowSchema, type DraftGenerator } from "@veriflow/core";
import {
  demoContext,
  demoProject,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import { createDraftGenerator, AgentError } from "../server/agent/index.ts";
import { createFixtureProvider } from "../server/agent/fixtures.ts";

const input = (): Parameters<DraftGenerator["generate"]>[0] => ({
  project: structuredClone(demoProject),
  request: {
    objective: "Verify SAVE10 changes the total to 90000",
    attachmentIds: [demoContext.attachmentId],
    templateIds: ["functional-exact-total"],
  },
  documents: [structuredClone(demoContext)],
});
const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;

test("fixture objective produces a valid editable draft, trusted provenance and source references", async () => {
  const source = input();
  const before = structuredClone(source);
  const generator = createDraftGenerator({ provider: createFixtureProvider() });
  const draft = await generator.generate(source, signal());
  workflowSchema.parse(draft.workflow);
  assert.equal(draft.provider, "fixture");
  assert.equal(draft.contractVersion, "1");
  assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
  assert.match(draft.warnings.join(" "), /no model was called/);
  assert.deepEqual(source, before);
  draft.workflow.name = "User edited draft";
  const regenerated = await generator.generate(source, signal());
  assert.equal(draft.workflow.name, "User edited draft");
  assert.equal(regenerated.workflow.name, demoWorkflow.name);
  assert.equal(demoWorkflow.name, "Discount updates total");
});

test("injected provider receives objective, context and versioned template snapshots", async () => {
  const source = input();
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate(received) {
        assert.equal(received.request.objective, source.request.objective);
        assert.equal(
          received.documents[0].attachmentId,
          demoContext.attachmentId,
        );
        assert.equal(received.templates[0].version, "1.0.0");
        received.request.attachmentIds.length = 0;
        received.project.allowedOrigins = ["https://evil.example"];
        return JSON.stringify(demoWorkflow);
      },
    },
  });
  const draft = await generator.generate(source, signal());
  assert.deepEqual(draft.sourceAttachmentIds, [demoContext.attachmentId]);
  assert.deepEqual(source.project, demoProject);
});

test("missing configuration fails explicitly with no implicit fixture", async () => {
  await assert.rejects(
    createDraftGenerator().generate(input(), signal()),
    code("adapter_unavailable"),
  );
});

for (const [name, output] of Object.entries({
  malformedJson: "{not json",
  markdownFence: "```json\n{}\n```",
  unknownAction: {
    ...demoWorkflow,
    steps: [{ id: "eval", code: "eval", script: "secret" }],
  },
  duplicateSteps: {
    ...demoWorkflow,
    steps: [demoWorkflow.steps[0], demoWorkflow.steps[0]],
  },
  forgedProvenance: {
    ...demoWorkflow,
    provider: "model",
    sourceAttachmentIds: ["forged"],
  },
  empty: null,
  oversized: "x".repeat(200_001),
  credentials: {
    ...demoWorkflow,
    steps: [
      {
        id: "open",
        code: "redirect",
        url: "https://user:password@example.com",
      },
    ],
  },
  otherOrigin: {
    ...demoWorkflow,
    steps: [{ id: "open", code: "redirect", url: "https://other.example" }],
  },
})) {
  test(`provider output rejects ${name}`, async () => {
    await assert.rejects(
      createDraftGenerator({
        provider: createFixtureProvider(output),
      }).generate(input(), signal()),
      code("invalid_provider_output"),
    );
  });
}

test("invalid inputs, unavailable templates and mismatched source documents never call provider", async () => {
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
  const invalidObjective = input();
  invalidObjective.request.objective = " ";
  await assert.rejects(
    generator.generate(invalidObjective, signal()),
    code("validation_error"),
  );
  const unknownTemplate = input();
  unknownTemplate.request.templateIds = ["missing"];
  await assert.rejects(
    generator.generate(unknownTemplate, signal()),
    code("template_unavailable"),
  );
  const missing = input();
  missing.documents = [];
  await assert.rejects(
    generator.generate(missing, signal()),
    code("context_mismatch"),
  );
  const unsolicited = input();
  unsolicited.request.attachmentIds = [];
  await assert.rejects(
    generator.generate(unsolicited, signal()),
    code("context_mismatch"),
  );
  const duplicate = input();
  duplicate.documents = [demoContext, demoContext];
  await assert.rejects(
    generator.generate(duplicate, signal()),
    code("context_mismatch"),
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
    generator.generate(image, signal()),
    code("unsupported_format"),
  );
  assert.equal(calls, 0);
});

test("provider failures expose fixed safe errors", async () => {
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate() {
        throw new Error("secret token /private/provider/path");
      },
    },
  });
  await assert.rejects(
    generator.generate(input(), signal()),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "provider_failed");
      assert.doesNotMatch(error.message, /secret|private/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test("generation cancels before provider dispatch and while provider ignores abort", async () => {
  let calls = 0;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let providerSignal: AbortSignal | undefined;
  const generator = createDraftGenerator({
    provider: {
      kind: "fixture",
      async generate(_input, bounded) {
        calls++;
        providerSignal = bounded;
        started();
        return new Promise(() => {});
      },
    },
  });
  const preCancelled = new AbortController();
  preCancelled.abort("secret reason");
  await assert.rejects(
    generator.generate(input(), preCancelled.signal),
    code("cancelled"),
  );
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = generator.generate(input(), controller.signal);
  await ready;
  controller.abort("private reason");
  await assert.rejects(pending, code("cancelled"));
  assert.equal(providerSignal?.aborted, true);
});

test("generation bounds noncooperative provider waits and validates timeout configuration", async () => {
  const provider = {
    kind: "fixture" as const,
    async generate() {
      return new Promise(() => {});
    },
  };
  await assert.rejects(
    createDraftGenerator({ provider, timeoutMs: 10 }).generate(
      input(),
      signal(),
    ),
    code("timeout"),
  );
  for (const timeoutMs of [0, -1, 1.5, 120001, NaN, Infinity])
    await assert.rejects(
      createDraftGenerator({ provider, timeoutMs }).generate(input(), signal()),
      code("validation_error"),
    );
});
