import { workflowSchema, type Target } from "../domain/workflow.js";

type CommandMetadata = { stepId: string; timeoutMs: number };
export type Command = CommandMetadata &
  (
    | { action: "navigate"; url: string }
    | { action: "fill"; target: Target; value: string }
    | { action: "setChecked"; target: Target; checked: boolean }
  );
export interface ExecutionPlan {
  workflowId: string;
  schemaVersion: "1";
  commands: readonly Command[];
}

/** Validate the entire document before producing any executable commands. */
export function translateWorkflow(input: unknown): ExecutionPlan {
  const workflow = workflowSchema.parse(input);
  const commands = workflow.steps.map((step): Command => {
    const metadata = { stepId: step.id, timeoutMs: step.timeoutMs };
    switch (step.code) {
      case "redirect":
        return { ...metadata, action: "navigate", url: step.url };
      case "fill":
        return {
          ...metadata,
          action: "fill",
          target: step.target,
          value: step.value,
        };
      case "check":
        return {
          ...metadata,
          action: "setChecked",
          target: step.target,
          checked: true,
        };
      case "uncheck":
        return {
          ...metadata,
          action: "setChecked",
          target: step.target,
          checked: false,
        };
      default: {
        const unsupported: never = step;
        throw new Error("Unsupported workflow step: " + String(unsupported));
      }
    }
  });
  return {
    workflowId: workflow.id,
    schemaVersion: workflow.schemaVersion,
    commands,
  };
}
