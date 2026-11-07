import type { QaEvaluator, StepResult, Evidence } from "@veriflow/core";

export function createEvaluation(evaluator: QaEvaluator) {
  return (
    input: {
      runId: string;
      steps: readonly StepResult[];
      evidence: readonly Evidence[];
    },
    signal: AbortSignal,
  ) => evaluator.evaluate({ ...input, category: "functionality" }, signal);
}
