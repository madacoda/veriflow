import {
  workflowSchema,
  type Target,
  type WorkflowStep,
} from "../domain/workflow.ts";

type CommandMetadata = { stepId: string; timeoutMs: number };
export type Command = CommandMetadata &
  (
    | { action: "navigate"; url: string }
    | { action: "fill"; target: Target; value: string }
    | { action: "setChecked"; target: Target; checked: boolean }
    | { action: "click"; target: Target }
    | {
        action: "assert";
        target: Target;
        expectation: Extract<WorkflowStep, { code: "assert" }>["expectation"];
      }
    | {
        [
          C in
            | "viewport"
            | "assertLayout"
            | "accessibility"
            | "assertHttp"
            | "fillSecret"
            | "assertRequirement"
        ]: Omit<Extract<WorkflowStep, { code: C }>, "id" | "code"> & {
          action: C;
        };
      }[
        | "viewport"
        | "assertLayout"
        | "accessibility"
        | "assertHttp"
        | "fillSecret"
        | "assertRequirement"]
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
      case "assert":
        return {
          ...metadata,
          action: "assert",
          target: step.target,
          expectation: step.expectation,
        };
      case "click":
        return { ...metadata, action: "click", target: step.target };
      case "viewport":
      case "assertLayout":
      case "accessibility":
      case "assertHttp":
      case "fillSecret":
      case "assertRequirement": {
        const { id, code, ...parameters } = step;
        return { ...parameters, stepId: id, action: code } as Command;
      }
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
