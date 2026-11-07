import { randomUUID } from "node:crypto";
import {
  browserObservationSchema,
  generationRequestSchema,
  type BrowserSession,
  type PageInspection,
  type ProjectRecord,
  type SessionFactory,
} from "@veriflow/core";
import { AgentError, checkCancellation } from "../agent/errors.ts";
import { BrowserAdmission } from "../runs/browser-admission.ts";

function publicUrl(value: string) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.href;
}

/** Validate every URL before opening a browser or sending anything to a model. */
export function inspectionUrls(project: ProjectRecord, input: unknown) {
  const request = generationRequestSchema.safeParse(input);
  if (!request.success) throw new AgentError("validation_error");
  const urls = [...new Set([project.url, ...(request.data.pageUrls ?? [])])];
  if (
    urls.length > 5 ||
    urls.some((value) => new URL(value).origin !== new URL(project.url).origin)
  )
    throw new AgentError("validation_error");
  return urls;
}

export class PageInspector {
  constructor(
    private readonly factory: SessionFactory | undefined,
    private readonly admission: BrowserAdmission,
  ) {}

  async inspect(
    project: ProjectRecord,
    urls: readonly string[],
    signal: AbortSignal,
  ): Promise<PageInspection[]> {
    checkCancellation(signal);
    const unavailable = (
      url: string,
      reason: "adapter_unavailable" | "navigation_failed",
    ): PageInspection => ({
      status: "unavailable",
      sourceUrl: publicUrl(url),
      capturedAt: new Date().toISOString(),
      reason,
    });
    if (!this.factory)
      return urls.map((url) => unavailable(url, "adapter_unavailable"));
    const release = this.admission.acquire("inspection");
    const pages: PageInspection[] = [];
    try {
      for (const url of urls) {
        checkCancellation(signal);
        let session: Awaited<ReturnType<SessionFactory["open"]>> | undefined;
        try {
          session = await this.factory.open(
            {
              runId: randomUUID(),
              purpose: "inspection",
              allowedOrigins: [new URL(project.url).origin],
            },
            signal,
          );
          checkCancellation(signal);
          if (
            !("observe" in session) ||
            typeof session.observe !== "function"
          ) {
            pages.push(unavailable(url, "adapter_unavailable"));
            continue;
          }
          const navigation = await session.execute(
            { action: "navigate", stepId: "inspect", url, timeoutMs: 10000 },
            signal,
          );
          checkCancellation(signal);
          if (navigation.status !== "passed") {
            pages.push(unavailable(url, "navigation_failed"));
            continue;
          }
          const observation = browserObservationSchema.parse(
            await (session as BrowserSession).observe(8000, signal),
          );
          checkCancellation(signal);
          if (new URL(observation.url).origin !== new URL(project.url).origin) {
            pages.push(unavailable(url, "navigation_failed"));
            continue;
          }
          if (
            observation.navigationStatus &&
            observation.navigationStatus >= 400 &&
            observation.navigationStatus !== 401 &&
            observation.navigationStatus !== 403
          ) {
            pages.push(unavailable(url, "navigation_failed"));
            continue;
          }
          observation.url = publicUrl(observation.url);
          observation.links = observation.links
            ?.filter(
              (link) =>
                new URL(link.url).origin === new URL(project.url).origin,
            )
            .map((link) => ({ ...link, url: publicUrl(link.url) }));
          const scope = observation.scope ?? "body";
          const accessSignals: Extract<
            PageInspection,
            { status: "observed" }
          >["accessSignals"] = [];
          if (
            observation.navigationStatus === 401 ||
            observation.navigationStatus === 403
          )
            accessSignals.push({
              kind: "http_access_denied",
              scope,
              evidence: `HTTP ${observation.navigationStatus}`,
            });
          if (observation.passwordFieldVisible)
            accessSignals.push({
              kind: "password_form_observed",
              scope,
              evidence:
                "A visible password input was observed in this scope; no field values were read.",
            });
          if (
            scope !== "body" &&
            /(?:authentication required|account required|sign in to (?:access|continue)|log in to (?:access|continue))/i.test(
              observation.text,
            )
          )
            accessSignals.push({
              kind: "sign_in_prompt_observed",
              scope,
              evidence:
                "This page scope contains an account or sign-in prerequisite message.",
            });
          pages.push({
            status: "observed",
            provenance: "browser",
            sourceUrl: publicUrl(url),
            capturedAt: new Date().toISOString(),
            observation,
            accessSignals,
          });
        } catch {
          checkCancellation(signal);
          pages.push(unavailable(url, "navigation_failed"));
        } finally {
          await session?.close();
        }
      }
      return pages;
    } finally {
      release();
    }
  }
}
