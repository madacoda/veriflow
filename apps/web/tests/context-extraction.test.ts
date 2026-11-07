import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ATTACHMENT_BYTES,
  type AttachmentMetadata,
  type AttachmentReader,
} from "@veriflow/core";
import {
  demoAttachment,
  demoContext,
  demoProject,
} from "@veriflow/core/fixtures";
import {
  assembleContext,
  contextExtractor,
} from "../server/context/extract.ts";
import { AgentError } from "../server/agent/errors.ts";

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;
function source(
  text = "SAVE10 changes 100000 to 90000",
  mediaType: AttachmentMetadata["mediaType"] = "text/markdown",
) {
  const bytes = new TextEncoder().encode(text);
  return {
    metadata: {
      ...structuredClone(demoAttachment),
      mediaType,
      sizeBytes: bytes.length,
    },
    bytes,
  };
}

test("supported text formats preserve source identity and Unicode, without mutating bytes", async () => {
  for (const mediaType of [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
  ] as const) {
    const original = source(
      mediaType === "application/json"
        ? '{"goal":"diskon ✓"}'
        : "diskon ✓\nSAVE10",
      mediaType,
    );
    const before = structuredClone(original);
    const document = await contextExtractor.extract(original, signal());
    assert.deepEqual(document, {
      kind: "text",
      attachmentId: original.metadata.id,
      text: new TextDecoder().decode(original.bytes),
    });
    assert.deepEqual(original, before);
  }
});

test("PDF and DOCX extraction return explicit unsupported errors", async () => {
  for (const mediaType of [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ] as const)
    await assert.rejects(
      contextExtractor.extract(source("not supported", mediaType), signal()),
      code("unsupported_format"),
    );
});

test("images remain references rather than fabricated OCR, and invalid image signatures fail", async () => {
  for (const [mediaType, signature] of [
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255]],
  ] as const) {
    const bytes = new Uint8Array(signature);
    const metadata = { ...demoAttachment, mediaType, sizeBytes: bytes.length };
    assert.deepEqual(
      await contextExtractor.extract({ metadata, bytes }, signal()),
      { kind: "image", attachmentId: metadata.id, mediaType },
    );
    await assert.rejects(
      contextExtractor.extract(source("pretend image", mediaType), signal()),
      code("extraction_failed"),
    );
  }
});

test("malformed, oversized, empty, binary and inconsistent text fails without partial output", async () => {
  const mismatch = source();
  mismatch.metadata.sizeBytes++;
  const binary = source();
  binary.bytes = new Uint8Array([255, 255]);
  binary.metadata.sizeBytes = 2;
  const oversizedBytes = source();
  oversizedBytes.metadata.sizeBytes = MAX_ATTACHMENT_BYTES + 1;
  for (const attachment of [
    mismatch,
    binary,
    oversizedBytes,
    source("  \n"),
    source("nul\u0000text"),
    source("x".repeat(100001)),
    source("{invalid", "application/json"),
  ])
    await assert.rejects(
      contextExtractor.extract(attachment, signal()),
      code("extraction_failed"),
    );
  const failed = source();
  failed.metadata.extraction = {
    status: "failed",
    code: "unsupported_format",
    message: "private upstream details",
  };
  await assert.rejects(
    contextExtractor.extract(failed, signal()),
    code("unsupported_format"),
  );
});

test("context assembly scopes reads to project, deduplicates sources and preserves shared text", async () => {
  const attachment = source(
    demoContext.kind === "text" ? demoContext.text : "",
  );
  const calls: string[][] = [];
  const reader: AttachmentReader = {
    async read(projectId, attachmentId) {
      calls.push([projectId, attachmentId]);
      return attachment;
    },
  };
  const documents = await assembleContext(
    {
      projectId: demoProject.id,
      attachmentIds: [demoAttachment.id, demoAttachment.id],
    },
    reader,
    signal(),
  );
  assert.deepEqual(documents, [demoContext]);
  assert.deepEqual(calls, [[demoProject.id, demoAttachment.id]]);
  assert.equal(attachment.metadata.sizeBytes, 73);
});

test("context assembly rejects cross-project/misidentified metadata and sanitizes reader errors", async () => {
  const request = {
    projectId: demoProject.id,
    attachmentIds: [demoAttachment.id],
  };
  for (const metadata of [
    { ...demoAttachment, projectId: "other-project" },
    { ...demoAttachment, id: "other-attachment" },
  ])
    await assert.rejects(
      assembleContext(
        request,
        {
          async read() {
            return { ...source(), metadata };
          },
        },
        signal(),
      ),
      code("context_mismatch"),
    );
  await assert.rejects(
    assembleContext(
      request,
      {
        async read() {
          throw new Error("secret /private/file");
        },
      },
      signal(),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "attachment_unavailable");
      assert.doesNotMatch(error.message, /secret|private/);
      return true;
    },
  );
});

test("context cancellation and deadline bound noncooperative readers without new reads", async () => {
  let count = 0;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const reader: AttachmentReader = {
    async read() {
      count++;
      started();
      return new Promise(() => {});
    },
  };
  const request = {
    projectId: demoProject.id,
    attachmentIds: [demoAttachment.id, "next"],
  };
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    assembleContext(request, reader, cancelled.signal),
    code("cancelled"),
  );
  assert.equal(count, 0);
  const controller = new AbortController();
  const pending = assembleContext(request, reader, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, code("cancelled"));
  assert.equal(count, 1);
  await assert.rejects(
    assembleContext(request, reader, signal(), 10),
    code("timeout"),
  );
  assert.equal(count, 2);
});
