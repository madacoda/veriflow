import {
  contextDocumentSchema,
  createProjectSchema,
  entityIdSchema,
  generationRequestSchema,
  httpUrlSchema,
  workflowSchema,
  type DraftGenerator,
  type TemplateDefinition,
} from "@veriflow/core";
import { resolveTemplates } from "../templates/catalog.ts";
import { DEFAULT_TIMEOUT_MS, withBudget } from "./budget.ts";
import { AgentError, checkCancellation } from "./errors.ts";

type GenerationInput = Parameters<DraftGenerator["generate"]>[0];

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
        async (boundedSignal) => {
          const provider = options.provider;
          if (
            !provider ||
            !["model", "fixture"].includes(provider.kind) ||
            typeof provider.generate !== "function"
          )
            throw new AgentError("adapter_unavailable");
          const providerKind = provider.kind;
          const request = generationRequestSchema.safeParse(input.request);
          const project = input.project;
          if (
            !request.success ||
            !entityIdSchema.safeParse(project?.id).success ||
            !createProjectSchema.safeParse({
              title: project?.title,
              url: project?.url,
              description: project?.description,
              goals: project?.goals,
            }).success ||
            !Array.isArray(project?.allowedOrigins) ||
            !project.allowedOrigins.length ||
            !project.allowedOrigins.every(
              (origin) =>
                httpUrlSchema.safeParse(origin).success &&
                new URL(origin).origin === origin,
            )
          )
            throw new AgentError("validation_error");
          const sourceAttachmentIds = [...new Set(request.data.attachmentIds)];
          const documents = input.documents.map((document) => {
            const parsed = contextDocumentSchema.safeParse(document);
            if (!parsed.success) throw new AgentError("context_mismatch");
            return parsed.data;
          });
          if (
            documents.length !== sourceAttachmentIds.length ||
            new Set(documents.map((document) => document.attachmentId)).size !==
              documents.length ||
            documents.some(
              (document) =>
                !sourceAttachmentIds.includes(document.attachmentId),
            )
          )
            throw new AgentError("context_mismatch");
          if (documents.some((document) => document.kind === "image"))
            throw new AgentError("unsupported_format");
          const templates = resolveTemplates(request.data.templateIds);
          let output: unknown;
          try {
            output = await provider.generate(
              structuredClone({
                project,
                request: request.data,
                documents,
                templates,
              }),
              boundedSignal,
            );
          } catch {
            checkCancellation(boundedSignal);
            throw new AgentError("provider_failed");
          }
          checkCancellation(boundedSignal);
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
              warnings:
                providerKind === "fixture"
                  ? [
                      "Deterministic fixture output; no model was called",
                      "Review this draft before saving or running it",
                    ]
                  : ["Review this draft before saving or running it"],
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
