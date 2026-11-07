import type { Command } from "./translate-workflow.ts";
import type { Evidence, Evaluation, QaCategory } from "../domain/results.ts";

export type StepResult = {
  expected?: string;
  actual?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Legacy status remains compatible; the coordinator maps infrastructure errors separately. */
  failureKind?: "assertion" | "prerequisite" | "infrastructure" | "cancelled";
} & (
  | { status: "passed"; stepId: string }
  | { status: "failed" | "blocked"; stepId: string; reason: string }
);

export interface StepExecutor {
  execute(command: Command, signal: AbortSignal): Promise<StepResult>;
}
export interface SessionOptions {
  runId: string;
  allowedOrigins: readonly string[];
  /** Storage-relative destination; adapters never accept a client-supplied path. */
  artifactDirectory?: string;
  viewport?: { width: number; height: number };
}
/** One isolated session per run. close must be idempotent and release all resources. */
export interface ExecutionSession extends StepExecutor {
  /** Flush captures before resolving, including finalized video/trace files. May close the context. */
  evidence(): Promise<readonly Evidence[]>;
  close(): Promise<void>;
}
/** An open failure must clean up partially allocated resources. */
export interface SessionFactory {
  open(options: SessionOptions, signal: AbortSignal): Promise<ExecutionSession>;
}
export interface QaEvaluator {
  evaluate(
    input: {
      runId: string;
      category: QaCategory;
      steps: readonly StepResult[];
      evidence: readonly Evidence[];
    },
    signal: AbortSignal,
  ): Promise<Evaluation>;
}
