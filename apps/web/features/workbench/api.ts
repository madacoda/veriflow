import {
  CONTRACT_VERSION,
  entityIdSchema,
  templateDefinitionSchema,
  workflowSchema,
  type generationRequestSchema,
  type ApiError,
  type AttachmentMetadata,
  type ProjectRecord,
  type ReportFormat,
  type RunRecord,
  type Workflow,
  type WorkflowDraft,
  type WorkflowRevision,
} from "@veriflow/core";

export class RequestError extends Error {
  readonly code: ApiError["error"]["code"];

  constructor({ code, message, issues }: ApiError["error"]) {
    super(
      issues?.length
        ? `${message}. ${issues.map((issue) => `${issue.path} — ${issue.message}`).join(". ")}`
        : message,
    );
    this.code = code;
  }
}

async function fetchResponse(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (body?.error?.code && typeof body.error.message === "string") {
      throw new RequestError(body.error);
    }
    throw new Error(`Request failed (HTTP ${response.status}).`);
  }
  return response;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchResponse(path, options);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object")
    throw new Error("The server returned an invalid response.");
  return body as T;
}

function post(body?: object): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
}

const projectsPath = "/api/projects";
const projectPath = (id: string) => `${projectsPath}/${encodeURIComponent(id)}`;
const attachmentsPath = (id: string) => `${projectPath(id)}/attachments`;
const workflowsPath = (id: string) => `${projectPath(id)}/workflows`;
const runsPath = (id: string) => `${projectPath(id)}/runs`;
const runPath = (id: string, runId: string) =>
  `${runsPath(id)}/${encodeURIComponent(runId)}`;

const reportMediaTypes: Record<ReportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export const api = {
  projects: (signal: AbortSignal) =>
    request<{ projects: ProjectRecord[] }>(projectsPath, { signal }),
  createProject: (title: string, url: string) =>
    request<{ project: ProjectRecord }>(projectsPath, post({ title, url })),
  attachments: (projectId: string, signal: AbortSignal) =>
    request<{ attachments: AttachmentMetadata[] }>(attachmentsPath(projectId), {
      signal,
    }),
  uploadAttachment: (projectId: string, file: File, signal: AbortSignal) => {
    const body = new FormData();
    body.set("file", file);
    return request<{ attachment: AttachmentMetadata }>(
      attachmentsPath(projectId),
      {
        method: "POST",
        body,
        signal,
      },
    );
  },
  workflows: (projectId: string, signal: AbortSignal) =>
    request<{ workflows: WorkflowRevision[] }>(workflowsPath(projectId), {
      signal,
    }),
  templates: async (signal: AbortSignal) => {
    const { templates } = await request<{ templates: unknown }>(
      "/api/templates",
      { signal },
    );
    const parsed = templateDefinitionSchema.array().safeParse(templates);
    if (!parsed.success)
      throw new Error("The server returned an invalid template catalog.");
    return parsed.data;
  },
  generateDraft: async (
    projectId: string,
    input: ReturnType<typeof generationRequestSchema.parse>,
    signal: AbortSignal,
  ): Promise<WorkflowDraft> => {
    const { draft } = await request<{ draft?: WorkflowDraft }>(
      `${workflowsPath(projectId)}/generate`,
      { ...post(input), signal },
    );
    const workflow = workflowSchema.safeParse(draft?.workflow);
    if (
      !draft ||
      draft.contractVersion !== CONTRACT_VERSION ||
      (draft.provider !== "model" && draft.provider !== "fixture") ||
      !workflow.success ||
      !Array.isArray(draft.sourceAttachmentIds) ||
      !draft.sourceAttachmentIds.every(
        (id) => entityIdSchema.safeParse(id).success,
      ) ||
      !Array.isArray(draft.warnings) ||
      !draft.warnings.every((warning) => typeof warning === "string")
    )
      throw new Error("The server returned an invalid workflow draft.");
    return { ...draft, workflow: workflow.data };
  },
  workflow: (projectId: string, workflowId: string, revision?: number) =>
    request<{ workflow: WorkflowRevision }>(
      `${workflowsPath(projectId)}/${encodeURIComponent(workflowId)}${revision === undefined ? "" : `?revision=${revision}`}`,
    ),
  saveWorkflow: (
    projectId: string,
    workflow: Workflow,
    expectedRevision: number | null,
  ) =>
    request<{ workflow: WorkflowRevision }>(
      workflowsPath(projectId),
      post({ workflow, expectedRevision }),
    ),
  runs: (projectId: string, signal: AbortSignal) =>
    request<{ runs: RunRecord[] }>(runsPath(projectId), { signal }),
  startRun: (projectId: string, workflowId: string, revision: number) =>
    request<{ run: RunRecord }>(
      runsPath(projectId),
      post({ workflowId, revision }),
    ),
  run: (projectId: string, runId: string, signal: AbortSignal) =>
    request<{ run: RunRecord }>(runPath(projectId, runId), { signal }),
  cancel: (projectId: string, runId: string) =>
    request<{ run: RunRecord }>(`${runPath(projectId, runId)}/cancel`, post()),
  evidence: (projectId: string, runId: string, evidenceId: string) =>
    `${runPath(projectId, runId)}/evidence/${encodeURIComponent(evidenceId)}`,
  downloadReport: async (
    projectId: string,
    runId: string,
    format: ReportFormat,
    signal: AbortSignal,
  ) => {
    const response = await fetchResponse(
      `${runPath(projectId, runId)}/report?format=${format}`,
      { signal },
    );
    const mediaType = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (mediaType !== reportMediaTypes[format])
      throw new Error("The server returned an unexpected report format.");
    const report = await response.blob();
    if (!report.size) throw new Error("The server returned an empty report.");
    return report;
  },
};
