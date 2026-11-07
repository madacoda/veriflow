import type { Workflow } from "@veriflow/core";
import { demoWorkflow } from "@veriflow/core/fixtures";

/** Bind a new editable fixture to the selected target without changing shared examples. */
export function createCouponFixtureWorkflow(projectUrl: string): Workflow {
  const workflow = structuredClone(demoWorkflow);
  for (const step of workflow.steps) {
    if (step.code === "redirect") step.url = projectUrl;
  }
  return workflow;
}
