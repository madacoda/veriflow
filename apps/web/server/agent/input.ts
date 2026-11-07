import {
  contextDocumentSchema,
  createProjectSchema,
  entityIdSchema,
  generationRequestSchema,
  httpUrlSchema,
  type DraftGenerator,
  type ProjectRecord,
  type StoredWorkflow,
  workflowSchema,
} from "@veriflow/core";
import { resolveTemplates } from "../templates/catalog.ts";
import { AgentError } from "./errors.ts";

export type GenerationInput = Parameters<DraftGenerator["generate"]>[0];

export interface ReviewedWorkflowInput {
  project: ProjectRecord;
  reviewedWorkflow: StoredWorkflow;
}

function prepareProject(input: ProjectRecord) {
  const project = structuredClone(input);
  if (
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
  return project;
}

/** Validate and copy a coordinator-supplied saved revision; never look up or save it here. */
export function prepareReviewedWorkflow(input: ReviewedWorkflowInput) {
  const project = prepareProject(input.project);
  const saved = input.reviewedWorkflow;
  const parsed = workflowSchema.safeParse(saved?.workflow);
  if (
    !parsed.success ||
    saved.projectId !== project.id ||
    !Number.isSafeInteger(saved.revision) ||
    saved.revision < 1 ||
    parsed.data.steps.some(
      (step) =>
        step.code === "redirect" &&
        !project.allowedOrigins.includes(new URL(step.url).origin),
    )
  )
    throw new AgentError("validation_error");
  return {
    project,
    reviewedWorkflow: {
      projectId: project.id,
      revision: saved.revision,
      workflow: parsed.data,
    },
  };
}

/** One validation path for draft requests and provider input. */
export function prepareGenerationInput(input: GenerationInput) {
  const request = generationRequestSchema.safeParse(input.request);
  const project = prepareProject(input.project);
  if (!request.success) throw new AgentError("validation_error");
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
