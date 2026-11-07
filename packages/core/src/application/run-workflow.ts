import { translateWorkflow } from "./translate-workflow.ts";
import type { SessionFactory, SessionOptions, StepResult } from "./ports.ts";
import type { Evidence } from "../domain/results.ts";

export interface RunResult {
  runId: string;
  workflowId: string;
  status: "passed" | "failed" | "blocked";
  steps: readonly StepResult[];
  evidence: readonly Evidence[];
}
/** Sequential orchestration. Adapter calls must honor cancellation and timeouts. */
export async function runWorkflow(
  input: unknown,
  options: SessionOptions,
  factory: SessionFactory,
  signal: AbortSignal,
): Promise<RunResult> {
  const plan = translateWorkflow(input);
  signal.throwIfAborted();
  const session = await factory.open(options, signal);
  const steps: StepResult[] = [];
  let stopped = false;
  try {
    for (const command of plan.commands) {
      if (stopped || signal.aborted) {
        steps.push({
          stepId: command.stepId,
          status: "blocked",
          reason: signal.aborted
            ? "Run cancelled"
            : "Earlier step did not pass",
        });
        continue;
      }
      try {
        const stepSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(command.timeoutMs),
        ]);
        const result = await session.execute(command, stepSignal);
        if (stepSignal.aborted) throw stepSignal.reason;
        if (result.stepId !== command.stepId)
          throw new Error("Adapter returned an incorrect step ID");
        steps.push(result);
        stopped = result.status !== "passed";
      } catch {
        steps.push({
          stepId: command.stepId,
          status: signal.aborted ? "blocked" : "failed",
          reason: signal.aborted
            ? "Run cancelled"
            : "Execution failed or timed out",
        });
        stopped = true;
      }
    }
    const evidence = await session.evidence();
    return {
      runId: options.runId,
      workflowId: plan.workflowId,
      status: steps.some((step) => step.status === "failed")
        ? "failed"
        : steps.some((step) => step.status === "blocked")
          ? "blocked"
          : "passed",
      steps,
      evidence,
    };
  } finally {
    await session.close();
  }
}
