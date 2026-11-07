import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  createProjectSchema,
  saveWorkflowSchema,
  startRunSchema,
  type ApiErrorCode,
  type ProjectRecord,
  type WorkflowRevision,
  type RunRecord,
  type ReportSnapshot,
  type RunEvent,
} from "@veriflow/core";

export class PlatformError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface Database {
  version: 1;
  projects: ProjectRecord[];
  workflows: WorkflowRevision[];
  runs: RunRecord[];
  snapshots: ReportSnapshot[];
}
const processState = globalThis as typeof globalThis & {
  __veriflowStoreQueues?: Map<string, Promise<unknown>>;
};
const queues = (processState.__veriflowStoreQueues ??= new Map());
const now = () => new Date().toISOString();
const terminal = (run: RunRecord) =>
  ["completed", "cancelled", "error"].includes(run.lifecycle);
export { terminal as isTerminalRun };
export function addRunEvent(
  run: RunRecord,
  type: RunEvent["type"],
  extra: Pick<RunEvent, "step" | "message"> = {},
) {
  run.events = [
    ...run.events,
    {
      sequence: run.events.length + 1,
      timestamp: now(),
      runId: run.id,
      type,
      ...extra,
    },
  ];
}

/** Single-process durable store. All instances in this process serialize by absolute filename. */
export class PlatformStore {
  readonly storageRoot: string;
  private readonly filename: string;
  constructor(storageRoot: string) {
    this.storageRoot = resolve(storageRoot);
    this.filename = join(this.storageRoot, "platform-v1.json");
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const pending = queues.get(this.filename) ?? Promise.resolve();
    const result = pending.then(action, action);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(this.filename, settled);
    try {
      return await result;
    } finally {
      if (queues.get(this.filename) === settled) queues.delete(this.filename);
    }
  }
  private async load(): Promise<Database> {
    try {
      const data = JSON.parse(
        await readFile(this.filename, "utf8"),
      ) as Database;
      if (
        data.version !== 1 ||
        ![data.projects, data.workflows, data.runs, data.snapshots].every(
          Array.isArray,
        )
      )
        throw new Error("Invalid store");
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          version: 1,
          projects: [],
          workflows: [],
          runs: [],
          snapshots: [],
        };
      throw new PlatformError(
        "internal_error",
        500,
        "Persistent storage could not be read",
      );
    }
  }
  private async persist(data: Database) {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(data));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async query<T>(action: (data: Database) => T): Promise<T> {
    return this.locked(async () => structuredClone(action(await this.load())));
  }
  private async change<T>(action: (data: Database) => T): Promise<T> {
    return this.locked(async () => {
      const data = await this.load();
      const result = action(data);
      await this.persist(data);
      return structuredClone(result);
    });
  }
  private project(data: Database, projectId: string): ProjectRecord {
    const project = data.projects.find((entry) => entry.id === projectId);
    if (!project)
      throw new PlatformError("not_found", 404, "Project not found");
    return project;
  }
  private workflow(
    data: Database,
    projectId: string,
    workflowId: string,
    revision?: number,
  ): WorkflowRevision {
    this.project(data, projectId);
    const workflow = data.workflows.findLast(
      (entry) =>
        entry.projectId === projectId &&
        entry.workflow.id === workflowId &&
        (revision === undefined || entry.revision === revision),
    );
    if (!workflow)
      throw new PlatformError("not_found", 404, "Workflow revision not found");
    return workflow;
  }
  private run(data: Database, projectId: string, runId: string): RunRecord {
    this.project(data, projectId);
    const run = data.runs.find(
      (entry) => entry.projectId === projectId && entry.id === runId,
    );
    if (!run) throw new PlatformError("not_found", 404, "Run not found");
    return run;
  }
  listProjects() {
    return this.query((data) => data.projects);
  }
  getProject(projectId: string) {
    return this.query((data) => this.project(data, projectId));
  }
  createProject(input: unknown) {
    const parsed = createProjectSchema.parse(input);
    return this.change((data) => {
      const timestamp = now();
      const project: ProjectRecord = {
        ...parsed,
        id: randomUUID(),
        allowedOrigins: [new URL(parsed.url).origin],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.projects.push(project);
      return project;
    });
  }
  listWorkflows(projectId: string) {
    return this.query((data) => {
      this.project(data, projectId);
      const latest = new Map<string, WorkflowRevision>();
      data.workflows
        .filter((entry) => entry.projectId === projectId)
        .forEach((entry) => latest.set(entry.workflow.id, entry));
      return [...latest.values()];
    });
  }
  getWorkflow(projectId: string, workflowId: string, revision?: number) {
    return this.query((data) =>
      this.workflow(data, projectId, workflowId, revision),
    );
  }
  saveWorkflow(projectId: string, input: unknown) {
    const { workflow, expectedRevision } = saveWorkflowSchema.parse(input);
    return this.change((data) => {
      const project = this.project(data, projectId);
      const current = data.workflows.findLast(
        (entry) =>
          entry.projectId === projectId && entry.workflow.id === workflow.id,
      );
      if ((current?.revision ?? null) !== expectedRevision)
        throw new PlatformError(
          "revision_conflict",
          409,
          "Workflow has changed; reload before saving",
        );
      const saved: WorkflowRevision = {
        projectId,
        workflow,
        revision: (current?.revision ?? 0) + 1,
        savedAt: now(),
      };
      data.workflows.push(saved);
      project.updatedAt = saved.savedAt;
      return saved;
    });
  }
  listRuns(projectId: string) {
    return this.query((data) => {
      this.project(data, projectId);
      return data.runs
        .filter((entry) => entry.projectId === projectId)
        .reverse();
    });
  }
  getRun(projectId: string, runId: string) {
    return this.query((data) => this.run(data, projectId, runId));
  }
  createRun(projectId: string, input: unknown, adapter: RunRecord["adapter"]) {
    const parsed = startRunSchema.parse(input);
    return this.change((data) => {
      const project = this.project(data, projectId);
      const workflow = this.workflow(
        data,
        projectId,
        parsed.workflowId,
        parsed.revision,
      );
      const id = randomUUID();
      const run: RunRecord = {
        contractVersion: "1",
        id,
        projectId,
        workflowId: parsed.workflowId,
        revision: parsed.revision,
        adapter,
        lifecycle: "queued",
        outcome: null,
        createdAt: now(),
        steps: [],
        events: [],
        evidence: {
          contractVersion: "1",
          runId: id,
          artifacts: [],
          capture: "unavailable",
          warnings: ["Capture has not completed"],
        },
      };
      addRunEvent(run, "queued");
      data.runs.push(run);
      data.snapshots.push(
        structuredClone({
          contractVersion: "1",
          createdAt: run.createdAt,
          project,
          workflow,
          run,
          findings: [],
        }),
      );
      return { run, project, workflow, viewport: parsed.viewport };
    });
  }
  updateRun(
    projectId: string,
    runId: string,
    update: (run: RunRecord) => void,
  ) {
    return this.change((data) => {
      const run = this.run(data, projectId, runId);
      if (!terminal(run)) update(run);
      const snapshot = data.snapshots.find(
        (entry) => entry.run.id === runId && entry.project.id === projectId,
      );
      if (!snapshot) throw new Error("Missing run snapshot");
      snapshot.run = structuredClone(run);
      return run;
    });
  }
  report(projectId: string, runId: string) {
    return this.query((data) => {
      const run = this.run(data, projectId, runId);
      if (!terminal(run))
        throw new PlatformError(
          "run_not_finished",
          409,
          "The run has not finished",
        );
      const snapshot = data.snapshots.find(
        (entry) => entry.run.id === runId && entry.project.id === projectId,
      );
      if (!snapshot) throw new Error("Missing run snapshot");
      return snapshot;
    });
  }
  recoverInterruptedRuns() {
    return this.change((data) => {
      let recovered = 0;
      for (const run of data.runs)
        if (!terminal(run)) {
          run.lifecycle = "error";
          run.outcome = null;
          run.finishedAt = now();
          run.error = {
            code: "interrupted",
            message: "The service restarted before this run finalized",
          };
          run.evidence.capture = "unavailable";
          run.evidence.warnings = ["Capture did not finalize before restart"];
          addRunEvent(run, "error", { message: run.error.message });
          const snapshot = data.snapshots.find(
            (entry) => entry.run.id === run.id,
          );
          if (snapshot) snapshot.run = structuredClone(run);
          recovered++;
        }
      return recovered;
    });
  }
}
