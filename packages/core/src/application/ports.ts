import type { Command } from "./translate-workflow.js";

export type StepResult =
  | { status: "passed"; stepId: string }
  | { status: "failed" | "blocked"; stepId: string; reason: string };

/** Implement in the runner. One command per call, in workflow order. */
export interface StepExecutor {
  execute(command: Command, signal: AbortSignal): Promise<StepResult>;
}
