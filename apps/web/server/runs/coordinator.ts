import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  runWorkflow,
  startRunSchema,
  type SessionFactory,
  type RunRecord,
  type StepResult,
} from "@veriflow/core";
import {
  PlatformError,
  PlatformStore,
  addRunEvent,
  isTerminalRun,
} from "../projects/platform-store.ts";
import { validateEvidence } from "./evidence.ts";

export interface RunCoordinatorOptions {
  maxConcurrentRuns?: number;
  /** Trusted clock seam for deterministic pre/post-allocation deadline tests. */
  deadlineSignal?: (timeoutMs: number) => AbortSignal;
}
/** One process owns jobs and their shared session lifetime. No fire-and-forget cleanup. */
export class RunCoordinator {
  private readonly controllers = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  private admitted = 0;
  private readonly capacity: number;
  private readonly deadlineSignal: (timeoutMs: number) => AbortSignal;
  constructor(
    private readonly store: PlatformStore,
    private readonly factory?: SessionFactory,
    private readonly adapter: RunRecord["adapter"] = "browser",
    private readonly maxRunMs = 120000,
    options: RunCoordinatorOptions = {},
  ) {
    this.capacity = options.maxConcurrentRuns ?? 2;
    if (
      !Number.isSafeInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 8
    )
      throw new Error("Run concurrency must be an integer from 1 to 8");
    if (!Number.isSafeInteger(maxRunMs) || maxRunMs < 1 || maxRunMs > 120000)
      throw new Error("Invalid run deadline");
    this.deadlineSignal =
      options.deadlineSignal ?? ((ms) => AbortSignal.timeout(ms));
  }
  private admit() {
    if (this.admitted >= this.capacity)
      throw new PlatformError(
        "adapter_unavailable",
        503,
        "Run capacity reached; retry after another run finishes",
      );
    // No await between checking and reserving: concurrent starts cannot over-admit.
    this.admitted++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.admitted--;
      }
    };
  }

  async start(projectId: string, input: unknown): Promise<RunRecord> {
    const parsed = startRunSchema.parse(input);
    await this.store.getWorkflow(projectId, parsed.workflowId, parsed.revision);
    if (!this.factory)
      throw new PlatformError(
        "adapter_unavailable",
        503,
        "Browser adapter is not configured",
      );
    const release = this.admit();
    try {
      const context = await this.store.createRun(
        projectId,
        parsed,
        this.adapter,
      );
      const controller = new AbortController();
      this.controllers.set(context.run.id, controller);
      const task = this.execute(context, controller).finally(() => {
        this.controllers.delete(context.run.id);
        this.jobs.delete(context.run.id);
        release();
      });
      // Errors are handled inside execute; observe persistence failures without exposing details.
      task.catch(() =>
        console.error("Run state persistence failed", {
          runId: context.run.id,
        }),
      );
      this.jobs.set(context.run.id, task);
      return context.run;
    } catch (error) {
      release();
      throw error;
    }
  }
  async wait(runId: string) {
    await this.jobs.get(runId);
  }
  async cancel(projectId: string, runId: string) {
    const current = await this.store.getRun(projectId, runId);
    if (isTerminalRun(current)) return current;
    this.controllers.get(runId)?.abort(new Error("Run cancelled"));
    return this.store.updateRun(projectId, runId, (run) => {
      if (!run.cancelRequestedAt) {
        run.cancelRequestedAt = new Date().toISOString();
        addRunEvent(run, "cancellation_requested");
      }
    });
  }
  private async execute(
    context: Awaited<ReturnType<PlatformStore["createRun"]>>,
    controller: AbortController,
  ) {
    const { run, project, workflow, viewport } = context;
    const deadline = this.deadlineSignal(this.maxRunMs);
    const signal = AbortSignal.any([controller.signal, deadline]);
    const published = new Map<string, StepResult>();
    let openAttempted = false;
    try {
      const started = await this.store.updateRun(
        project.id,
        run.id,
        (record) => {
          record.lifecycle = "running";
          record.startedAt = new Date().toISOString();
          addRunEvent(record, "started");
        },
      );
      if (started.cancelRequestedAt) controller.abort();
      const artifactDirectory = `runs/${run.id}`;
      await mkdir(join(this.store.storageRoot, artifactDirectory), {
        recursive: true,
        mode: 0o700,
      });
      const factory = this.factory!;
      const wrapped: SessionFactory = {
        open: async (options, sessionSignal) => {
          sessionSignal.throwIfAborted();
          openAttempted = true;
          const session = await factory.open(options, sessionSignal);
          return {
            execute: async (command, commandSignal) => {
              const result = await session.execute(command, commandSignal);
              if (commandSignal.aborted) throw commandSignal.reason;
              if (
                result.stepId !== command.stepId ||
                !["passed", "failed", "blocked"].includes(result.status) ||
                (result.status !== "passed" &&
                  typeof result.reason !== "string")
              )
                throw new Error("Invalid executor result");
              await this.store.updateRun(project.id, run.id, (record) => {
                record.steps = [...record.steps, result];
                addRunEvent(record, "step", { step: result });
              });
              published.set(result.stepId, structuredClone(result));
              return result;
            },
            evidence: async () => {
              const artifacts = await session.evidence();
              await validateEvidence(
                this.store.storageRoot,
                run.id,
                new Set(workflow.workflow.steps.map((step) => step.id)),
                artifacts,
              );
              return artifacts;
            },
            close: () => session.close(),
          };
        },
      };
      const result = await runWorkflow(
        workflow.workflow,
        {
          runId: run.id,
          allowedOrigins: project.allowedOrigins,
          artifactDirectory,
          viewport,
        },
        wrapped,
        signal,
      );
      await this.store.updateRun(project.id, run.id, (record) => {
        for (const step of result.steps)
          if (
            JSON.stringify(published.get(step.stepId)) !== JSON.stringify(step)
          )
            addRunEvent(record, "step", { step });
        record.steps = result.steps;
        record.evidence = {
          contractVersion: "1",
          runId: run.id,
          artifacts: result.evidence,
          capture: result.evidence.length ? "partial" : "unavailable",
          warnings: result.evidence.length
            ? ["Adapter has not declared completeness of all requested media"]
            : ["No evidence artifacts were captured"],
        };
        this.finish(
          record,
          controller.signal.aborted || !!record.cancelRequestedAt,
          deadline.aborted ||
            result.steps.some((step) => step.failureKind === "infrastructure"),
          result.status,
        );
      });
    } catch (error) {
      // Only a pre-allocation abort proves there were no resources/captures to finalize.
      // An open/evidence/close rejection remains infrastructure failure even during cancellation.
      const cleanCancellation =
        !openAttempted && controller.signal.aborted && error === signal.reason;
      await this.store.updateRun(project.id, run.id, (record) => {
        this.finish(record, cleanCancellation, !cleanCancellation);
      });
    }
  }
  private finish(
    record: RunRecord,
    cancelled: boolean,
    infrastructureError: boolean,
    outcome?: "passed" | "failed" | "blocked",
  ) {
    record.finishedAt = new Date().toISOString();
    if (infrastructureError) {
      record.lifecycle = "error";
      record.outcome = null;
      record.error = {
        code: "infrastructure_error",
        message: "Execution or evidence finalization could not be completed",
      };
      addRunEvent(record, "error", { message: record.error.message });
    } else if (cancelled) {
      record.lifecycle = "cancelled";
      record.outcome = null;
      addRunEvent(record, "cancelled");
    } else {
      record.lifecycle = "completed";
      record.outcome = outcome ?? "blocked";
      addRunEvent(record, "completed");
    }
  }
}
