import type {
  ApiError,
  ProjectRecord,
  RunRecord,
  Workflow,
  WorkflowRevision,
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (body?.error?.code && typeof body.error.message === "string") {
      throw new RequestError(body.error);
    }
    throw new Error(`Request failed (HTTP ${response.status}).`);
  }
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
const workflowsPath = (id: string) => `${projectPath(id)}/workflows`;
const runsPath = (id: string) => `${projectPath(id)}/runs`;
const runPath = (id: string, runId: string) =>
  `${runsPath(id)}/${encodeURIComponent(runId)}`;

export const api = {
  projects: (signal: AbortSignal) =>
    request<{ projects: ProjectRecord[] }>(projectsPath, { signal }),
  createProject: (title: string, url: string) =>
    request<{ project: ProjectRecord }>(projectsPath, post({ title, url })),
  workflows: (projectId: string, signal: AbortSignal) =>
    request<{ workflows: WorkflowRevision[] }>(workflowsPath(projectId), {
      signal,
    }),
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
};
