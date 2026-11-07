import {
  httpUrlSchema,
  workflowSchema,
  type DraftGenerator,
  type TemplateDefinition,
} from "@veriflow/core";
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
          const { project, request, documents, templates } =
            prepareGenerationInput(input);
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
            if (
              (requirementsSelected &&
                !workflow.steps.some((step) => step.code === "assert")) ||
              workflow.steps.some(
                (step) =>
                  step.code === "redirect" &&
                  (!httpUrlSchema.safeParse(step.url).success ||
                    !project.allowedOrigins.includes(new URL(step.url).origin)),
              )
            )
              throw new AgentError("invalid_provider_output");
            return {
              contractVersion: "1",
              workflow,
              sourceAttachmentIds,
              warnings: [
                ...(providerKind === "fixture"
                  ? ["Deterministic fixture output; no model was called"]
                  : []),
                "Review this draft before saving or running it",
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
