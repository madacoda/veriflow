import { coverageTemplates } from "./coverage.ts";
import {
  templateDefinitionSchema,
  workflowSchema,
  type TemplateDefinition,
} from "@veriflow/core";
import { demoTemplate, demoWorkflow } from "@veriflow/core/fixtures";
import { AgentError } from "../agent/errors.ts";

/** Snapshots prevent callers from mutating the shared fixture or catalog. */
export function listTemplates(): TemplateDefinition[] {
  return [demoTemplate, ...coverageTemplates.map((t) => t.definition)].map(
    (t) => templateDefinitionSchema.parse(structuredClone(t)),
  );
}

export function resolveTemplates(ids: readonly string[]): TemplateDefinition[] {
  const catalog = listTemplates();
  return [...new Set(ids)].map((id) => {
    const template = catalog.find((entry) => entry.id === id);
    if (!template) throw new AgentError("template_unavailable");
    return template;
  });
}

/** Explicitly labeled fixture; it is not a generated workflow or observed run. */
export function functionalTemplateFixture() {
  return {
    provider: "fixture" as const,
    template: listTemplates()[0],
    workflow: workflowSchema.parse(structuredClone(demoWorkflow)),
  };
}
