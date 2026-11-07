/** Frozen v1 examples for independent development. These are fixtures, not observed runs. */
import { workflowSchema } from "./domain/workflow.ts";
import type {
  ProjectRecord,
  WorkflowRevision,
  RunRecord,
  TemplateDefinition,
  ReportSnapshot,
  ContextDocument,
  AttachmentMetadata,
  ApiError,
} from "./domain/contracts.ts";

const timestamp = "2026-11-07T03:00:00.000Z";
export const demoProject: ProjectRecord = {
  id: "project-demo",
  title: "Checkout acceptance",
  url: "http://127.0.0.1:1111/demo?bug=1",
  description:
    "A deterministic checkout target with a switchable discount bug.",
  goals: ["A 10% discount changes a 100000 total to 90000"],
  allowedOrigins: ["http://127.0.0.1:1111"],
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const demoWorkflow = workflowSchema.parse({
  schemaVersion: "1",
  id: "checkout-discount",
  name: "Discount updates total",
  steps: [
    { id: "open", code: "redirect", url: demoProject.url },
    {
      id: "coupon",
      code: "fill",
      target: { by: "testId", value: "coupon-input" },
      value: "SAVE10",
    },
    {
      id: "apply",
      code: "click",
      target: { by: "testId", value: "apply-coupon" },
    },
    {
      id: "total",
      code: "assert",
      target: { by: "testId", value: "order-total" },
      expectation: { kind: "text", value: "90000" },
    },
  ],
});
export const demoRevision: WorkflowRevision = {
  projectId: demoProject.id,
  revision: 1,
  workflow: demoWorkflow,
  savedAt: timestamp,
};
export const demoAttachment: AttachmentMetadata = {
  id: "attachment-prd",
  projectId: demoProject.id,
  filename: "checkout.md",
  mediaType: "text/markdown",
  sizeBytes: 75,
  createdAt: timestamp,
  extraction: { status: "ready" },
};
export const demoContext: ContextDocument = {
  kind: "text",
  attachmentId: demoAttachment.id,
  text: "SAVE10 discounts the order total by 10%. A total of 100000 becomes 90000.",
};
export const demoTemplate: TemplateDefinition = {
  id: "functional-exact-total",
  version: "1.0.0",
  title: "Discount matches the requirement",
  category: "functional",
  prerequisites: ["The target checkout and SAVE10 fixture exist"],
  parameterSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredCapabilities: ["navigate", "fill", "click", "assert", "screenshot"],
};
export const demoFailedRun: RunRecord = {
  contractVersion: "1",
  id: "run-failed",
  projectId: demoProject.id,
  workflowId: demoWorkflow.id,
  revision: 1,
  adapter: "fake",
  lifecycle: "completed",
  outcome: "failed",
  createdAt: timestamp,
  startedAt: timestamp,
  finishedAt: timestamp,
  steps: [
    { stepId: "open", status: "passed" },
    { stepId: "coupon", status: "passed" },
    { stepId: "apply", status: "passed" },
    {
      stepId: "total",
      status: "failed",
      expected: "90000",
      actual: "100000",
      reason: "Order total did not match",
    },
  ],
  events: [
    { sequence: 1, timestamp, runId: "run-failed", type: "queued" },
    { sequence: 2, timestamp, runId: "run-failed", type: "started" },
    { sequence: 3, timestamp, runId: "run-failed", type: "completed" },
  ],
  evidence: {
    contractVersion: "1",
    runId: "run-failed",
    capture: "complete",
    warnings: [],
    artifacts: [
      {
        id: "evidence-total",
        runId: "run-failed",
        stepId: "total",
        kind: "screenshot",
        artifactPath: "runs/run-failed/total.png",
        mediaType: "image/png",
      },
    ],
  },
};
export const demoPassedRun: RunRecord = {
  ...demoFailedRun,
  id: "run-passed",
  outcome: "passed",
  steps: demoWorkflow.steps.map((step) => ({
    stepId: step.id,
    status: "passed" as const,
  })),
  events: [{ sequence: 1, timestamp, runId: "run-passed", type: "completed" }],
  evidence: {
    contractVersion: "1",
    runId: "run-passed",
    capture: "unavailable",
    artifacts: [],
    warnings: ["Fixture has no real media"],
  },
};
export const demoBlockedRun: RunRecord = {
  ...demoPassedRun,
  id: "run-blocked",
  outcome: "blocked",
  steps: demoWorkflow.steps.map((step) => ({
    stepId: step.id,
    status: "blocked" as const,
    reason: "Fixture prerequisite unavailable",
  })),
  events: [{ sequence: 1, timestamp, runId: "run-blocked", type: "completed" }],
  evidence: {
    contractVersion: "1",
    runId: "run-blocked",
    capture: "unavailable",
    artifacts: [],
    warnings: ["No browser was started"],
  },
};
export const demoReport: ReportSnapshot = {
  contractVersion: "1",
  createdAt: timestamp,
  project: demoProject,
  workflow: demoRevision,
  run: demoFailedRun,
  findings: [],
};
export const boundaryErrors = {
  staleRevision: {
    error: {
      code: "revision_conflict",
      message: "Workflow has changed; reload before saving",
    },
  },
  missingProject: {
    error: { code: "not_found", message: "Project not found" },
  },
  unsupportedAttachment: {
    error: {
      code: "unsupported_format",
      message: "Attachment format is not supported",
    },
  },
  unavailableAdapter: {
    error: {
      code: "adapter_unavailable",
      message: "Browser adapter is not configured",
    },
  },
} satisfies Record<string, ApiError>;
