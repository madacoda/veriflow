import {
  templateDefinitionSchema,
  workflowSchema,
  type TemplateDefinition,
  type ContextDocument,
} from "@veriflow/core";
import { demoTemplate, demoWorkflow } from "@veriflow/core/fixtures";
import { additionalDefinitions } from "./definitions.ts";
import { AgentError } from "../agent/errors.ts";

// Parse once from private copies so neither consumers nor shared fixture mutations alter the catalog.
const definitions = [demoTemplate, ...additionalDefinitions].map((definition) =>
  templateDefinitionSchema.parse(structuredClone(definition)),
);

/** Snapshots prevent callers from mutating the shared fixture or catalog. */
export function listTemplates(): TemplateDefinition[] {
  return structuredClone(definitions);
}

export function resolveTemplates(ids: readonly string[]): TemplateDefinition[] {
  const catalog = listTemplates();
  return [...new Set(ids)].map((id) => {
    const template = catalog.find((entry) => entry.id === id);
    if (!template) throw new AgentError("template_unavailable");
    return template;
  });
}

/** V1 can draft functional and supplied-requirement checks only. Never silently downgrade a category. */
export function resolveGenerationTemplates(
  ids: readonly string[],
  documents: readonly ContextDocument[],
): TemplateDefinition[] {
  const templates = resolveTemplates(ids);
  if (
    templates.some(
      (template) => !["functional", "compliance"].includes(template.category),
    ) ||
    (templates.some((template) => template.category === "compliance") &&
      !documents.some(
        (document) => document.kind === "text" && document.text.trim(),
      ))
  )
    throw new AgentError("template_unavailable");
  return templates;
}

/** Explicitly labeled fixture; it is not a generated workflow or observed run. */
export function functionalTemplateFixture() {
  return {
    provider: "fixture" as const,
    template: listTemplates()[0],
    workflow: workflowSchema.parse(structuredClone(demoWorkflow)),
  };
}
