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
  startRunSchema,
  templateDefinitionSchema,
  translateWorkflow,
  workflowSchema,
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
