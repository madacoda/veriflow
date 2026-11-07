import { z } from "zod";
import { workflowSchema, targetSchema } from "./workflow.ts";
import type { Target } from "./workflow.ts";
import { httpUrlSchema } from "./http-url.ts";
export { httpUrlSchema } from "./http-url.ts";
import type { Project, StoredWorkflow } from "./project.ts";
import type { Evidence, Finding } from "./results.ts";
import type { StepResult, ExecutionSession } from "../application/ports.ts";
import type { Command } from "../application/translate-workflow.ts";

/** Additive boundary contracts. The existing workflow language remains version 1. */
export const CONTRACT_VERSION = "1" as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const entityIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);

export const createProjectSchema = z.strictObject({
  title: z.string().trim().min(1).max(256),
  url: httpUrlSchema,
  description: z.string().max(20000).default(""),
  goals: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
});
export interface ProjectRecord extends Project {
  createdAt: string;
  updatedAt: string;
  /** Exact URL origins. Local demo origins must be explicitly included. */
  allowedOrigins: readonly string[];
}
export const saveWorkflowSchema = z.strictObject({
  workflow: workflowSchema,
  expectedRevision: z.number().int().positive().nullable(),
});
export interface WorkflowRevision extends StoredWorkflow {
  savedAt: string;
}

export const attachmentMediaTypes = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
] as const;
/** Formats whose bytes the draft context extractor can actually read. */
export const textContextMediaTypes = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;
export const attachmentMetadataSchema = z.strictObject({
  id: entityIdSchema,
  projectId: entityIdSchema,
  filename: z.string().min(1).max(255),
  mediaType: z.enum(attachmentMediaTypes),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  createdAt: z.iso.datetime(),
  extraction: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("pending") }),
    z.strictObject({ status: z.literal("ready") }),
    z.strictObject({
      status: z.literal("failed"),
      code: z.enum(["unsupported_format", "extraction_failed"]),
      message: z.string().min(1),
    }),
  ]),
});
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export const contextDocumentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    attachmentId: entityIdSchema,
    text: z.string().min(1).max(100000),
  }),
  z.strictObject({
    kind: z.literal("image"),
    attachmentId: entityIdSchema,
    mediaType: z.enum(["image/png", "image/jpeg"]),
    description: z.string().max(4000).optional(),
  }),
]);
export type ContextDocument = z.infer<typeof contextDocumentSchema>;
export const generationRequestSchema = z.strictObject({
  objective: z.string().trim().min(1).max(10000),
  attachmentIds: z.array(entityIdSchema).max(20).default([]),
  templateIds: z.array(entityIdSchema).max(20).default([]),
  /** Explicit additions to project.url; composition enforces five distinct same-origin URLs total. */
  pageUrls: z.array(httpUrlSchema).max(5).optional(),
  /** Untrusted, read-only input; returned drafts never save over this source. */
  baseWorkflow: workflowSchema
    .refine(
      (workflow) =>
        workflow.steps.length <= 100 &&
        JSON.stringify(workflow).length <= 100000,
      "Regeneration supports up to 100 steps and 100,000 characters",
    )
    .optional(),
});
export interface WorkflowDraft {
  contractVersion: "1";
  workflow: z.infer<typeof workflowSchema>;
  sourceAttachmentIds: readonly string[];
  warnings: readonly string[];
  provider: "model" | "fixture";
  pageContext?: readonly PageInspection[];
}
export interface AttachmentReader {
  read(
    projectId: string,
    attachmentId: string,
  ): Promise<{ metadata: AttachmentMetadata; bytes: Uint8Array }>;
}
export interface ContextExtractor {
  extract(
    input: { metadata: AttachmentMetadata; bytes: Uint8Array },
    signal: AbortSignal,
  ): Promise<ContextDocument>;
}
export interface DraftGenerator {
  generate(
    input: {
      project: ProjectRecord;
      request: z.infer<typeof generationRequestSchema>;
      documents: readonly ContextDocument[];
      pageContext?: readonly PageInspection[];
    },
    signal: AbortSignal,
  ): Promise<WorkflowDraft>;
}
export const capabilitySchema = z.enum([
  "navigate",
  "fill",
  "click",
  "setChecked",
  "assert",
  "observe",
  "viewport",
  "accessibility",
  "security",
  "screenshot",
  "video",
  "trace",
]);
export const templateDefinitionSchema = z.strictObject({
  id: entityIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1).max(256),
  category: z.enum([
    "functional",
    "responsive",
    "security",
    "compliance",
    "accessibility",
    "regression",
  ]),
  prerequisites: z.array(z.string().min(1)).max(50),
  parameterSchema: z.record(z.string(), z.unknown()),
  requiredCapabilities: z.array(capabilitySchema).min(1),
});
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

export const browserToolCallSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    tool: z.literal("observe"),
    maxCharacters: z.number().int().min(1).max(20000).default(8000),
  }),
  z.strictObject({
    tool: z.literal("execute"),
    step: workflowSchema.shape.steps.element,
  }),
]);
export type BrowserToolCall = z.infer<typeof browserToolCallSchema>;
export interface BrowserObservation {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  targets: readonly Target[];
  scope?: "main" | "dialog" | "body";
  links?: readonly { url: string; label: string }[];
  navigationStatus?: number;
  capturedAt?: string;
}

export const browserObservationSchema = z.strictObject({
  url: z.union([httpUrlSchema, z.literal("about:blank")]),
  title: z.string().max(512),
  text: z.string().max(20000),
  truncated: z.boolean(),
  targets: z.array(targetSchema).max(50),
  scope: z.enum(["main", "dialog", "body"]).optional(),
  links: z
    .array(z.strictObject({ url: httpUrlSchema, label: z.string().max(256) }))
    .max(20)
    .optional(),
  navigationStatus: z.number().int().min(100).max(599).optional(),
  capturedAt: z.iso.datetime().optional(),
});
const accessSignalSchema = z.strictObject({
  kind: z.enum([
    "sign_in_prompt_observed",
    "password_form_observed",
    "http_access_denied",
  ]),
  scope: z.enum(["main", "dialog", "body"]),
  evidence: z.string().min(1).max(240),
});
export const pageInspectionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("observed"),
    provenance: z.literal("browser"),
    sourceUrl: httpUrlSchema,
    capturedAt: z.iso.datetime(),
    observation: browserObservationSchema,
    accessSignals: z.array(accessSignalSchema).max(5),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    sourceUrl: httpUrlSchema,
    capturedAt: z.iso.datetime(),
    reason: z.enum([
      "navigation_failed",
      "timeout",
      "adapter_unavailable",
      "policy_rejected",
    ]),
  }),
]);
export type PageInspection = z.infer<typeof pageInspectionSchema>;
/** The coordinator owns this same session during AI tools and deterministic execution. */
export interface BrowserSession extends ExecutionSession {
  observe(
    maxCharacters: number,
    signal: AbortSignal,
  ): Promise<BrowserObservation>;
}
export interface AgentToolPort {
  observe(
    maxCharacters: number,
    signal: AbortSignal,
  ): Promise<BrowserObservation>;
  execute(command: Command, signal: AbortSignal): Promise<StepResult>;
}

export const startRunSchema = z.strictObject({
  workflowId: workflowSchema.shape.id,
  revision: z.number().int().positive(),
  viewport: z
    .strictObject({
      width: z.number().int().min(320).max(3840),
      height: z.number().int().min(320).max(2160),
    })
    .optional(),
});
export type RunLifecycle =
  "queued" | "running" | "completed" | "cancelled" | "error";
export type RunOutcome = "passed" | "failed" | "blocked";
export interface RunEvent {
  sequence: number;
  timestamp: string;
  runId: string;
  type:
    | "queued"
    | "started"
    | "step"
    | "completed"
    | "cancellation_requested"
    | "cancelled"
    | "error";
  step?: StepResult;
  message?: string;
}
export interface EvidenceManifest {
  contractVersion: "1";
  runId: string;
  artifacts: readonly Evidence[];
  capture: "complete" | "partial" | "unavailable";
  warnings: readonly string[];
}
/** Lifecycle errors are distinct from assertion outcomes. A fake is always labeled. */
export interface RunRecord {
  contractVersion: "1";
  id: string;
  projectId: string;
  workflowId: string;
  revision: number;
  viewport?: { width: number; height: number };
  adapter: "browser" | "fake" | "unavailable";
  lifecycle: RunLifecycle;
  outcome: RunOutcome | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  steps: readonly StepResult[];
  events: readonly RunEvent[];
  evidence: EvidenceManifest;
  error?: {
    code: "adapter_unavailable" | "infrastructure_error" | "interrupted";
    message: string;
  };
}
export interface ReportSnapshot {
  contractVersion: "1";
  createdAt: string;
  project: ProjectRecord;
  workflow: WorkflowRevision;
  run: RunRecord;
  findings: readonly Finding[];
  aiSummary?: { text: string; provider: "model" | "fixture" };
}
export type ReportFormat = "csv" | "xlsx" | "pdf";
export interface ReportRenderer {
  render(
    snapshot: ReportSnapshot,
    format: ReportFormat,
  ): Promise<{ bytes: Uint8Array; mediaType: string; filename: string }>;
}
export type ApiErrorCode =
  | "invalid_json"
  | "validation_error"
  | "not_found"
  | "revision_conflict"
  | "payload_too_large"
  | "unsupported_format"
  | "adapter_unavailable"
  | "run_not_finished"
  | "internal_error";
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: readonly { path: string; message: string }[];
  };
}
