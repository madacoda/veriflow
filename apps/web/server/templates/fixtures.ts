import { buildTemplate, templateOptions } from "./coverage.ts";
import {
  demoContext,
  demoProject,
  demoRevision,
  demoWorkflow,
} from "@veriflow/core/fixtures";
import type { ContextDocument, StoredWorkflow, Workflow } from "@veriflow/core";
import { listTemplates } from "./catalog.ts";

/** Definition examples for consumers/tests, never model output or observed execution evidence. */
export function templateDefinitionFixtures() {
  const inputs: Record<
    string,
    {
      parameters: Record<string, unknown>;
      sourceDocuments?: ContextDocument[];
      workflow?: Workflow;
      reviewedWorkflow?: StoredWorkflow;
    }
  > = {
    "functional-exact-total": { parameters: {}, workflow: demoWorkflow },
    "responsive-layout": {
      parameters: {
        viewports: [
          { width: 375, height: 812 },
          { width: 1440, height: 900 },
        ],
        testIds: ["order-total"],
      },
    },
    "security-passive-baseline": {
      parameters: { checks: ["https", "x-content-type-options"] },
    },
    "requirements-acceptance": {
      parameters: {},
      sourceDocuments: [demoContext],
      workflow: demoWorkflow,
    },
    "accessibility-page-audit": {
      parameters: { ruleTags: ["wcag2a", "wcag2aa"] },
    },
    "regression-saved-revision": {
      parameters: {
        workflowId: demoRevision.workflow.id,
        revision: demoRevision.revision,
      },
      reviewedWorkflow: demoRevision,
    },
  };
  for (const option of templateOptions(demoProject.url)) {
    inputs[option.id] = {
      parameters: option.defaults,
      workflow: buildTemplate(
        option.id,
        option.defaults,
        `fixture-${option.id}`,
      ),
    };
  }
  return listTemplates().map((template) => ({
    provider: "fixture" as const,
    warning:
      "Definition fixture only; no model, browser or check adapter was executed",
    template,
    ...structuredClone(inputs[template.id]),
  }));
}
