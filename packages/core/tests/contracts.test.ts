import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentMetadataSchema,
  browserToolCallSchema,
  contextDocumentSchema,
  createProjectSchema,
  generationRequestSchema,
  MAX_ATTACHMENT_BYTES,
  saveWorkflowSchema,
  stepSchema,
  startRunSchema,
  templateDefinitionSchema,
  translateWorkflow,
  workflowSchema,
  type AttachmentReader,
  type ContextExtractor,
} from "../src/index.ts";
import {
  demoAttachment,
  demoContext,
  demoFailedRun,
  demoProject,
  demoTemplate,
  demoWorkflow,
} from "../src/fixtures.ts";

test("v1 fixtures cross the project, context, template and workflow boundaries", () => {
  createProjectSchema.parse({ title: demoProject.title, url: demoProject.url });
  attachmentMetadataSchema.parse(demoAttachment);
  contextDocumentSchema.parse(demoContext);
  templateDefinitionSchema.parse(demoTemplate);
  saveWorkflowSchema.parse({ workflow: demoWorkflow, expectedRevision: null });
  startRunSchema.parse({ workflowId: demoWorkflow.id, revision: 1 });
  assert.equal(demoFailedRun.adapter, "fake");
  assert.equal(demoFailedRun.outcome, "failed");
  assert.equal(demoFailedRun.steps.at(-1)?.actual, "100000");
});
test("click is additive and translates without changing step identity", () => {
  assert.deepEqual(translateWorkflow(demoWorkflow).commands[2], {
    stepId: "apply",
    timeoutMs: 30000,
    action: "click",
    target: { by: "testId", value: "apply-coupon" },
  });
  assert.equal(
    workflowSchema.parse({ ...demoWorkflow, steps: [demoWorkflow.steps[0]] })
      .schemaVersion,
    "1",
  );
});
test("untrusted tools reject scripts, extra fields and excessive observations", () => {
  for (const input of [
    { tool: "eval", script: "alert(1)" },
    { tool: "observe", maxCharacters: 20001 },
    { tool: "observe", extra: true },
    {
      tool: "execute",
      step: { id: "x", code: "click", target: { by: "css", value: "button" } },
    },
  ])
    assert.equal(browserToolCallSchema.safeParse(input).success, false);
  assert.equal(
    browserToolCallSchema.parse({ tool: "observe" }).maxCharacters,
    8000,
  );
  browserToolCallSchema.parse({ tool: "execute", step: demoWorkflow.steps[2] });
});
test("URL credentials, stale-write ambiguity and client-owned fields are rejected", () => {
  for (const url of [
    "file:///etc/passwd",
    "https://user:password@example.com",
  ]) {
    assert.equal(
      createProjectSchema.safeParse({ title: "Test", url }).success,
      false,
    );
  }
  assert.equal(
    createProjectSchema.safeParse({
      title: "Test",
      url: "https://example.com",
      id: "owned",
    }).success,
    false,
  );
  assert.equal(
    saveWorkflowSchema.safeParse({ workflow: demoWorkflow }).success,
    false,
  );
  assert.equal(
    saveWorkflowSchema.safeParse({
      workflow: demoWorkflow,
      expectedRevision: 0,
    }).success,
    false,
  );
  assert.equal(
    startRunSchema.safeParse({ workflowId: "example", revision: 0 }).success,
    false,
  );
});
test("attachments and image context explicitly distinguish unsupported inputs", () => {
  for (const invalid of [
    { mediaType: "application/zip" },
    { sizeBytes: MAX_ATTACHMENT_BYTES + 1 },
    { extraction: { status: "failed" } },
  ]) {
    assert.equal(
      attachmentMetadataSchema.safeParse({ ...demoAttachment, ...invalid })
        .success,
      false,
    );
  }
  contextDocumentSchema.parse({
    kind: "image",
    attachmentId: "image-1",
    mediaType: "image/png",
  });
  assert.equal(
    contextDocumentSchema.safeParse({
      kind: "text",
      attachmentId: "image-1",
      text: "",
    }).success,
    false,
  );
  assert.equal(
    generationRequestSchema.safeParse({ objective: "Test", overwrite: true })
      .success,
    false,
  );
});

test("navigation rejects credentials and malformed URLs at every shared boundary", () => {
  for (const url of [
    "https://user:password@example.com",
    "https://user@example.com",
    "https://:password@example.com",
    "https://us%65r:p%40ss@example.com",
    "not a URL",
    "http://[invalid",
    "file:///etc/passwd",
  ]) {
    const step = { id: "open", code: "redirect", url };
    const workflow = { ...demoWorkflow, steps: [step] };
    assert.equal(
      createProjectSchema.safeParse({ title: "Example", url }).success,
      false,
    );
    assert.equal(stepSchema.safeParse(step).success, false);
    assert.equal(workflowSchema.safeParse(workflow).success, false);
    assert.equal(
      saveWorkflowSchema.safeParse({ workflow, expectedRevision: null })
        .success,
      false,
    );
    assert.equal(
      browserToolCallSchema.safeParse({ tool: "execute", step }).success,
      false,
    );
  }
  for (const url of [
    "http://127.0.0.1:1111/demo?bug=1",
    "https://example.com/path?value=user%40example.com",
  ]) {
    const step = { id: "open", code: "redirect", url };
    stepSchema.parse(step);
    browserToolCallSchema.parse({ tool: "execute", step });
    translateWorkflow({ ...demoWorkflow, steps: [step] });
  }
});

test("shared attachment fixture survives an integrity-checking reader/extractor round trip", async () => {
  assert.equal(demoContext.kind, "text");
  if (demoContext.kind !== "text") throw new Error("Expected text fixture");
  const text = demoContext.text;
  const reader: AttachmentReader = {
    read: async () => ({
      metadata: structuredClone(demoAttachment),
      bytes: new TextEncoder().encode(text),
    }),
  };
  const extractor: ContextExtractor = {
    extract: async ({ metadata, bytes }) => {
      assert.equal(bytes.byteLength, metadata.sizeBytes);
      return contextDocumentSchema.parse({
        kind: "text",
        attachmentId: metadata.id,
        text: new TextDecoder().decode(bytes),
      });
    },
  };
  assert.equal(demoAttachment.sizeBytes, 73);
  const source = await reader.read(demoProject.id, demoAttachment.id);
  assert.deepEqual(
    await extractor.extract(source, new AbortController().signal),
    demoContext,
  );
});
