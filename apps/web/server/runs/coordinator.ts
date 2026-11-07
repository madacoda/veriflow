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

/** One process owns jobs and their shared session lifetime. No fire-and-forget cleanup. */
export class RunCoordinator {
  private readonly controllers = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  constructor(
    private readonly store: PlatformStore,
    private readonly factory?: SessionFactory,
    private readonly adapter: RunRecord["adapter"] = "browser",
    private readonly maxRunMs = 120000,
  ) {}

  async start(projectId: string, input: unknown): Promise<RunRecord> {
    const parsed = startRunSchema.parse(input);
    await this.store.getWorkflow(projectId, parsed.workflowId, parsed.revision);
    if (!this.factory)
      throw new PlatformError(
        "adapter_unavailable",
        503,
        "Browser adapter is not configured",
      );
    const context = await this.store.createRun(projectId, parsed, this.adapter);
    const controller = new AbortController();
    this.controllers.set(context.run.id, controller);
    const task = this.execute(context, controller).finally(() => {
      this.controllers.delete(context.run.id);
      this.jobs.delete(context.run.id);
    });
    // Errors are handled inside execute; keep a rejection observer for persistence failures too.
    task.catch(() =>
      console.error("Run state persistence failed", { runId: context.run.id }),
    );
    this.jobs.set(context.run.id, task);
    return context.run;
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
    const deadline = AbortSignal.timeout(this.maxRunMs);
    const signal = AbortSignal.any([controller.signal, deadline]);
    const published = new Map<string, StepResult>();
    let cleanupFailed = false;
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
            close: async () => {
              try {
                await session.close();
              } catch (error) {
                cleanupFailed = true;
                throw error;
              }
            },
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
          !cleanupFailed &&
            (controller.signal.aborted || !!record.cancelRequestedAt),
          deadline.aborted ||
            result.steps.some((step) => step.failureKind === "infrastructure"),
          result.status,
        );
      });
    } catch {
      await this.store.updateRun(project.id, run.id, (record) => {
        this.finish(
          record,
          !cleanupFailed &&
            (controller.signal.aborted || !!record.cancelRequestedAt),
          true,
        );
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
    if (cancelled) {
      record.lifecycle = "cancelled";
      record.outcome = null;
      addRunEvent(record, "cancelled");
    } else if (infrastructureError) {
      record.lifecycle = "error";
      record.outcome = null;
      record.error = {
        code: "infrastructure_error",
        message: "Execution or evidence finalization could not be completed",
      };
      addRunEvent(record, "error", { message: record.error.message });
    } else {
      record.lifecycle = "completed";
      record.outcome = outcome ?? "blocked";
      addRunEvent(record, "completed");
    }
  }
}
