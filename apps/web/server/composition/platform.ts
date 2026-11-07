import { resolve } from "node:path";
import type { SessionFactory, ReportRenderer } from "@veriflow/core";
import { PlaywrightSessionFactory } from "@veriflow/runner/browser";
import { PlatformError, PlatformStore } from "../projects/platform-store.ts";
import {
  RunCoordinator,
  type RunCoordinatorOptions,
} from "../runs/coordinator.ts";
import { createFakeSessionFactory } from "../runs/fake-session.ts";
import { PlatformHttp, errorResponse } from "./http.ts";
import { AttachmentStore } from "../attachments/store.ts";
import { renderCsv } from "../reports/csv.ts";
import { ReportDownloads } from "../runs/report-downloads.ts";
import { createOpenAIDraftProvider } from "../agent/index.ts";
import {
  DraftGeneration,
  type DraftProviderSource,
} from "../workflows/generate-draft.ts";

export async function createPlatform(
  storageRoot: string,
  factory?: SessionFactory,
  adapter: "browser" | "fake" = "browser",
  integrations: {
    reportRenderer?: ReportRenderer;
    runOptions?: RunCoordinatorOptions;
    draftProvider?: DraftProviderSource;
    generationTimeoutMs?: number;
  } = {},
) {
  const store = new PlatformStore(storageRoot);
  await store.recoverInterruptedRuns();
  const coordinator = new RunCoordinator(
    store,
    factory,
    adapter,
    120000,
    integrations.runOptions,
  );
  const attachments = new AttachmentStore(store);
  const reports = new ReportDownloads(store, integrations.reportRenderer);
  const generation = new DraftGeneration(
    store,
    attachments,
    integrations.draftProvider,
    integrations.generationTimeoutMs,
  );
  return {
    store,
    coordinator,
    attachments,
    reports,
    http: new PlatformHttp(
      store,
      coordinator,
      attachments,
      reports,
      generation,
    ),
  };
}
const processState = globalThis as typeof globalThis & {
  __veriflowPlatform?: ReturnType<typeof createPlatform>;
};
/** Trusted server configuration; browser is the default and fixtures require opt-in. */
export function createRuntimePlatform(env: NodeJS.ProcessEnv = process.env) {
  const adapter = env.VERIFLOW_RUN_ADAPTER ?? "browser";
  if (adapter !== "browser" && adapter !== "fake")
    throw new PlatformError(
      "adapter_unavailable",
      503,
      "Run adapter configuration is invalid",
    );
  // Persistent runtime data lives on its own volume and must not be bundled.
  const storageRoot = resolve(
    /* turbopackIgnore: true */ env.STORAGE_DIR ?? "../../data",
  );
  const factory =
    adapter === "fake"
      ? createFakeSessionFactory(
          env.VERIFLOW_FAKE_OUTCOME === "failed" ? "failed" : "passed",
        )
      : new PlaywrightSessionFactory({
          storageRoot,
          resolveSecret: (name) => env[`VERIFLOW_SECRET_${name}`],
        });
  return createPlatform(storageRoot, factory, adapter, {
    draftProvider: () =>
      createOpenAIDraftProvider({
        apiKey: env.OPENAI_API_KEY?.trim(),
        model: env.OPENAI_MODEL?.trim(),
        baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
      }),
    reportRenderer: {
      async render(snapshot, format) {
        if (format === "csv") return renderCsv(snapshot);
        if (format === "pdf") {
          // Load the PDF library and embedded font only for a PDF download.
          const { renderPdf } = await import("../reports/pdf.ts");
          return renderPdf(snapshot);
        }
        throw new PlatformError(
          "unsupported_format",
          422,
          "XLSX export is not available yet. Choose CSV or PDF.",
        );
      },
    },
    runOptions: {
      maxConcurrentRuns: Number(env.VERIFLOW_MAX_CONCURRENT_RUNS ?? "2"),
    },
  });
}
export async function platformHttp() {
  if (!processState.__veriflowPlatform) {
    const pending = createRuntimePlatform();
    processState.__veriflowPlatform = pending;
    pending.catch(() => {
      if (processState.__veriflowPlatform === pending)
        delete processState.__veriflowPlatform;
    });
  }
  return (await processState.__veriflowPlatform).http;
}
export async function platformRoute(
  action: (http: PlatformHttp) => Promise<Response>,
) {
  try {
    return await action(await platformHttp());
  } catch (error) {
    return errorResponse(error);
  }
}
