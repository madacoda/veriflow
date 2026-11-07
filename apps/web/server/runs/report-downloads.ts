import { createHash, randomUUID } from "node:crypto";
import type { ReportFormat, ReportRenderer } from "@veriflow/core";
import { PlatformError, PlatformStore } from "../projects/platform-store.ts";
import { writeStorageFile } from "../projects/storage-files.ts";

const mediaTypes: Record<ReportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
export class ReportDownloads {
  constructor(
    private readonly store: PlatformStore,
    private readonly renderer?: ReportRenderer,
  ) {}
  async download(projectId: string, runId: string, format: ReportFormat) {
    const snapshot = await this.store.report(projectId, runId);
    if (!this.renderer)
      throw new PlatformError(
        "adapter_unavailable",
        503,
        "Report renderer is not configured",
      );
    // Preserve authoritative state even if a renderer mutates the supplied object.
    const digest = createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");
    const rendered = await this.renderer.render(
      structuredClone(snapshot),
      format,
    );
    if (
      !(rendered.bytes instanceof Uint8Array) ||
      rendered.bytes.byteLength === 0 ||
      rendered.bytes.byteLength > 25 * 1024 * 1024 ||
      rendered.mediaType.split(";")[0].trim().toLowerCase() !==
        mediaTypes[format]
    )
      throw new PlatformError(
        "internal_error",
        500,
        "Report renderer returned invalid output",
      );
    const storageKey = [
      "reports",
      snapshot.run.id,
      `${digest}-${randomUUID()}.${format}`,
    ];
    await writeStorageFile(this.store.storageRoot, storageKey, rendered.bytes);
    return {
      bytes: rendered.bytes,
      mediaType: `${mediaTypes[format]}${format === "csv" ? "; charset=utf-8" : ""}`,
      filename: `veriflow-${snapshot.run.id}.${format}`,
    };
  }
}
