import { randomUUID } from "node:crypto";
import {
  attachmentMetadataSchema,
  attachmentMediaTypes,
  MAX_ATTACHMENT_BYTES,
  type AttachmentMetadata,
  type AttachmentReader,
} from "@veriflow/core";
import { PlatformError, PlatformStore } from "../projects/platform-store.ts";
import {
  readStorageFile,
  writeStorageFile,
  removeStorageFile,
} from "../projects/storage-files.ts";

export class AttachmentStore implements AttachmentReader {
  constructor(private readonly platform: PlatformStore) {}
  async upload(
    projectId: string,
    input: { filename: string; mediaType: string; bytes: Uint8Array },
  ): Promise<AttachmentMetadata> {
    await this.platform.getProject(projectId);
    const mediaType = input.mediaType.split(";")[0].trim().toLowerCase();
    if (!attachmentMediaTypes.some((type) => type === mediaType))
      throw new PlatformError(
        "unsupported_format",
        415,
        "Attachment format is not supported",
      );
    if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES)
      throw new PlatformError(
        "payload_too_large",
        413,
        "Attachments must be at most 10 MiB",
      );
    const parsed = attachmentMetadataSchema.safeParse({
      id: randomUUID(),
      projectId,
      filename: input.filename,
      mediaType,
      sizeBytes: input.bytes.byteLength,
      createdAt: new Date().toISOString(),
      extraction: { status: "pending" },
    });
    if (
      !parsed.success ||
      !input.filename.trim() ||
      [".", ".."].includes(input.filename) ||
      /[\\/\u0000-\u001f\u007f]/.test(input.filename)
    )
      throw new PlatformError(
        "validation_error",
        422,
        "Provide a nonempty file and a filename of at most 255 characters without path separators or control characters",
      );
    const metadata = parsed.data;
    const key = ["attachments", projectId, `${metadata.id}.bin`];
    await writeStorageFile(this.platform.storageRoot, key, input.bytes);
    try {
      return await this.platform.registerAttachment(metadata);
    } catch (error) {
      await removeStorageFile(this.platform.storageRoot, key);
      throw error;
    }
  }
  async read(projectId: string, attachmentId: string) {
    const metadata = await this.platform.getAttachment(projectId, attachmentId);
    const bytes = await readStorageFile(
      this.platform.storageRoot,
      ["attachments", metadata.projectId, `${metadata.id}.bin`],
      MAX_ATTACHMENT_BYTES,
    );
    if (bytes.byteLength !== metadata.sizeBytes)
      throw new PlatformError(
        "internal_error",
        500,
        "Stored attachment size does not match its metadata",
      );
    return { metadata, bytes };
  }
}
