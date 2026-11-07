import {
  httpUrlSchema,
  workflowSchema,
  type DraftGenerator,
  type TemplateDefinition,
} from "@veriflow/core";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { prepareGenerationInput, type GenerationInput } from "./input.ts";
import { DEFAULT_TIMEOUT_MS, withBudget } from "./budget.ts";
import { AgentError } from "./errors.ts";

/** Local injection seam, not a replacement for the shared DraftGenerator port. */
export interface DraftProvider {
  readonly kind: "model" | "fixture";
  generate(
    input: GenerationInput & { templates: readonly TemplateDefinition[] },
    signal: AbortSignal,
  ): Promise<unknown>;
}

export const MAX_PROVIDER_OUTPUT_CHARACTERS = 200_000;

export function createDraftGenerator(
  options: {
    provider?: DraftProvider;
    timeoutMs?: number;
  } = {},
): DraftGenerator {
  return {
    async generate(input, signal) {
      return withBudget(
        signal,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        async (boundedSignal, checkActive) => {
          const provider = options.provider;
          if (
            !provider ||
            !["model", "fixture"].includes(provider.kind) ||
            typeof provider.generate !== "function"
          )
            throw new AgentError("adapter_unavailable");
          const providerKind = provider.kind;
          const { project, request, documents, templates, pageContext } =
            prepareGenerationInput(input);
          if (pageContext?.some((page) => page.status === "unavailable"))
            throw new AgentError("inspection_unavailable");
          const guarded = pageContext?.some(
            (page) =>
              page.status === "observed" && page.accessSignals.length > 0,
          );
          if (guarded && request.accessMode !== "guard")
            throw new AgentError("authentication_required");
          if (pageContext && request.accessMode === "guard" && !guarded)
            throw new AgentError("guard_not_observed");
          const requirementsSelected = templates.some(
            (template) => template.category === "compliance",
          );
          const sourceAttachmentIds = [...new Set(request.attachmentIds)];
          let output: unknown;
          try {
            output = await provider.generate(
              structuredClone({
                project,
                request,
                documents,
                templates,
                ...(pageContext ? { pageContext } : {}),
              }),
              boundedSignal,
            );
          } catch {
            checkActive();
            throw new AgentError("provider_failed");
          }
          checkActive();
          try {
            const serialized =
              typeof output === "string" ? output : JSON.stringify(output);
            if (
              !serialized ||
              serialized.length > MAX_PROVIDER_OUTPUT_CHARACTERS
            )
              throw new AgentError("invalid_provider_output");
            const decoded: unknown = JSON.parse(serialized);
            const workflow = workflowSchema.parse(decoded);
            const checks = new Set([
              "assert",
              "assertHttp",
              "assertLayout",
              "accessibility",
              "assertRequirement",
            ]);
            if (!workflow.steps.some((step) => checks.has(step.code)))
              throw new AgentError("invalid_provider_output");
            // Regeneration may add checks, but cannot silently remove or weaken reviewed ones.
            if (
              request.baseWorkflow?.steps
                .filter((step) => checks.has(step.code))
                .some(
                  (original) =>
                    !workflow.steps.some((step) =>
                      isDeepStrictEqual(step, original),
                    ),
                )
            )
              throw new AgentError("invalid_provider_output");
            if (pageContext) {
              const observed = pageContext.filter(
                (page) => page.status === "observed",
              );
              const findPage = (value: string) => {
                const url = new URL(value);
                url.search = "";
                url.hash = "";
                const matches = observed.filter(
                  (entry) =>
                    entry.sourceUrl === url.href ||
                    entry.observation.url === url.href,
                );
                return matches.length === 1 ? matches[0] : undefined;
              };
              let page = findPage(project.url);
              for (const step of workflow.steps) {
                if (step.code === "redirect") page = findPage(step.url);
                if (
                  "target" in step &&
                  step.target &&
                  (!page ||
                    !page.observation.targets.some((target) =>
                      isDeepStrictEqual(target, step.target),
                    ))
                )
                  throw new AgentError("invalid_provider_output");
              }
              if (
                request.accessMode === "guard" &&
                !workflow.steps.some(
                  (step) =>
                    step.code === "assert" ||
                    (step.code === "assertHttp" &&
                      step.statuses.every(
                        (status) => status === 401 || status === 403,
                      )),
                )
              )
                throw new AgentError("invalid_provider_output");
            }
            if (
              (requirementsSelected &&
                !workflow.steps.some(
                  (step) =>
                    step.code === "assert" || step.code === "assertRequirement",
                )) ||
              workflow.steps.some(
                (step) =>
                  (step.code === "redirect" || step.code === "assertHttp") &&
                  (!httpUrlSchema.safeParse(step.url).success ||
                    !project.allowedOrigins.includes(new URL(step.url).origin)),
              )
            )
              throw new AgentError("invalid_provider_output");
            // The editor opens generated work as a new record; never reuse the source identity.
            if (request.baseWorkflow) workflow.id = randomUUID();
            return {
              contractVersion: "1",
              workflow,
              sourceAttachmentIds,
              ...(pageContext ? { pageContext } : {}),
              warnings: [
                ...(providerKind === "fixture"
                  ? ["Deterministic fixture output; no model was called"]
                  : []),
                "Review this draft before saving or running it",
                ...(pageContext
                  ? [
                      "Page observations are anonymous, read-only snapshots. Generation has not executed this workflow or verified its outcome.",
                    ]
                  : [
                      "No live page inspection was supplied; verify every target and expectation before running.",
                    ]),
                ...(request.accessMode === "guard"
                  ? [
                      "This draft checks access restrictions only; it does not test the protected feature.",
                    ]
                  : []),
                ...(request.baseWorkflow
                  ? [
                      "Regenerated as a new unsaved draft. Existing assertions were preserved.",
                    ]
                  : []),
                ...(requirementsSelected
                  ? [
                      "Check coverage against the supplied requirement sources; this draft is not a certification",
                    ]
                  : []),
              ],
              provider: providerKind,
            };
          } catch {
            throw new AgentError("invalid_provider_output");
          }
        },
      );
    },
  };
}
