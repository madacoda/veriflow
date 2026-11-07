import type { DraftGenerator } from "@veriflow/core";
import {
  AgentError,
  createDraftGenerator,
  type DraftProvider,
} from "../agent/index.ts";
import { withBudget } from "../agent/budget.ts";
import { assembleContext } from "../context/extract.ts";
import type { AttachmentStore } from "../attachments/store.ts";
import type { PlatformStore } from "../projects/platform-store.ts";
import {
  inspectionUrls,
  type PageInspector,
} from "../context/inspect-pages.ts";

type GenerationRequest = Parameters<DraftGenerator["generate"]>[0]["request"];
/** A trusted server resolver refreshes configuration without replacing active runs. */
export type DraftProviderSource = DraftProvider | (() => DraftProvider);

/** Read-only composition: one deadline covers input, source reads and generation. */
export class DraftGeneration {
  constructor(
    private readonly store: PlatformStore,
    private readonly attachments: AttachmentStore,
    private readonly provider?: DraftProviderSource,
    private readonly timeoutMs = 30000,
    private readonly inspector?: PageInspector,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw new Error("Invalid generation deadline");
  }

  generate(
    projectId: string,
    readInput: (signal: AbortSignal) => Promise<GenerationRequest>,
    signal: AbortSignal,
  ) {
    return withBudget(signal, this.timeoutMs, async (bounded, checkActive) => {
      const project = await this.store.getProject(projectId);
      checkActive();
      const request = await readInput(bounded);
      const urls = inspectionUrls(project, request);
      checkActive();
      if (!this.provider) throw new AgentError("adapter_unavailable");
      // Resolve before dispatch so invalid configuration stays a generation-only 503.
      const provider =
        typeof this.provider === "function" ? this.provider() : this.provider;
      const generator = createDraftGenerator({
        provider,
        timeoutMs: this.timeoutMs,
      });
      const documents = await assembleContext(
        { projectId, attachmentIds: request.attachmentIds },
        this.attachments,
        bounded,
        this.timeoutMs,
      );
      checkActive();
      const pageContext = await this.inspector?.inspect(project, urls, bounded);
      checkActive();
      return generator.generate(
        {
          project,
          request,
          documents,
          ...(pageContext ? { pageContext } : {}),
        },
        bounded,
      );
    });
  }
}
