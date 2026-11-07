import {
  attachmentMetadataSchema,
  contextDocumentSchema,
  entityIdSchema,
  generationRequestSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentReader,
  type ContextDocument,
  type ContextExtractor,
} from "@veriflow/core";
import { AgentError, checkCancellation } from "../agent/errors.ts";
import { DEFAULT_TIMEOUT_MS, withBudget } from "../agent/budget.ts";

const textTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export const contextExtractor: ContextExtractor = {
  async extract(input, signal) {
    checkCancellation(signal);
    const parsed = attachmentMetadataSchema.safeParse(input.metadata);
    if (!parsed.success) throw new AgentError("extraction_failed");
    const metadata = parsed.data;
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength !== metadata.sizeBytes ||
      input.bytes.byteLength > MAX_ATTACHMENT_BYTES
    )
      throw new AgentError("extraction_failed");
    if (metadata.extraction.status === "failed")
      throw new AgentError(metadata.extraction.code);

    if (
      metadata.mediaType === "image/png" ||
      metadata.mediaType === "image/jpeg"
    ) {
      // Preserve only the reference. Loading images belongs to a model adapter
      // using the project-scoped reader; this extractor never claims OCR.
      const signature =
        metadata.mediaType === "image/png"
          ? [137, 80, 78, 71, 13, 10, 26, 10]
          : [255, 216, 255];
      if (!signature.every((byte, index) => input.bytes[index] === byte))
        throw new AgentError("extraction_failed");
      return contextDocumentSchema.parse({
        kind: "image",
        attachmentId: metadata.id,
        mediaType: metadata.mediaType,
      });
    }
    if (!textTypes.has(metadata.mediaType))
      throw new AgentError("unsupported_format");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      if (metadata.mediaType === "application/json") JSON.parse(text);
    } catch {
      throw new AgentError("extraction_failed");
    }
    if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
      throw new AgentError("extraction_failed");
    const document = contextDocumentSchema.safeParse({
      kind: "text",
      attachmentId: metadata.id,
      text,
    });
    if (!document.success) throw new AgentError("extraction_failed");
    checkCancellation(signal);
    return document.data;
  },
};

/** Read-only assembly. Neither extraction status nor attachment storage is written. */
export async function assembleContext(
  input: { projectId: string; attachmentIds: readonly string[] },
  reader: AttachmentReader,
  signal: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ContextDocument[]> {
  if (
    !entityIdSchema.safeParse(input.projectId).success ||
    !generationRequestSchema.safeParse({
      objective: "context",
      attachmentIds: input.attachmentIds,
    }).success
  )
    throw new AgentError("validation_error");
  const { projectId } = input;
  const attachmentIds = [...new Set(input.attachmentIds)];
  return withBudget(signal, timeoutMs, async (boundedSignal, checkActive) => {
    const documents: ContextDocument[] = [];
    for (const attachmentId of attachmentIds) {
      checkActive();
      let attachment: Awaited<ReturnType<AttachmentReader["read"]>>;
      try {
        attachment = await reader.read(projectId, attachmentId);
      } catch {
        checkActive();
        throw new AgentError("attachment_unavailable");
      }
      checkActive();
      if (
        attachment?.metadata?.projectId !== projectId ||
        attachment.metadata.id !== attachmentId
      )
        throw new AgentError("context_mismatch");
      documents.push(await contextExtractor.extract(attachment, boundedSignal));
    }
    return documents;
  });
}
