import {
  contextDocumentSchema,
  createProjectSchema,
  entityIdSchema,
  generationRequestSchema,
  httpUrlSchema,
  type DraftGenerator,
} from "@veriflow/core";
import { resolveTemplates } from "../templates/catalog.ts";
import { AgentError } from "./errors.ts";

export type GenerationInput = Parameters<DraftGenerator["generate"]>[0];

/** One validation path for drafts and model-driven tool decisions. */
export function prepareGenerationInput(input: GenerationInput) {
  const request = generationRequestSchema.safeParse(input.request);
  const project = structuredClone(input.project);
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
  if (!Array.isArray(input.documents)) throw new AgentError("context_mismatch");
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
      (document) => !sourceAttachmentIds.includes(document.attachmentId),
    )
  )
    throw new AgentError("context_mismatch");
  if (documents.some((document) => document.kind === "image"))
    throw new AgentError("unsupported_format");
  const templates = resolveTemplates(request.data.templateIds);
  return { project, request: request.data, documents, templates };
}
