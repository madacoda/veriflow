import type { Workflow } from "./workflow.ts";

export interface Project {
  id: string;
  title: string;
  url: string;
  description: string;
  goals: readonly string[];
}
export interface StoredWorkflow {
  projectId: string;
  revision: number;
  workflow: Workflow;
}
export interface WorkflowRepository {
  get(projectId: string, workflowId: string): Promise<StoredWorkflow | null>;
  /** null means create-only. Conflicts must reject without overwriting newer data. */
  save(
    projectId: string,
    workflow: Workflow,
    expectedRevision: number | null,
  ): Promise<StoredWorkflow>;
}
export interface WorkflowGenerator {
  /** Return untrusted provider output, then validate with workflowSchema. */
  generate(project: Project, signal: AbortSignal): Promise<unknown>;
}
