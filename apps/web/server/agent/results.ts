import { z } from "zod";
import {
  testingCategories,
  type StepResult,
  type WorkflowStep,
} from "@veriflow/core";
import { AgentError } from "./errors.ts";

export const MAX_RESULT_FINDINGS = 1000;
export const MAX_FINDING_EVIDENCE_IDS = 100;

// Preserve observed strings exactly; validation must not trim or truncate evidence.
const nonblank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);
const findingSchema = z.object({
  id: nonblank(128),
  category: z.enum(["functionality", ...testingCategories]),
  ruleId: nonblank(128),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  message: nonblank(20_000),
  stepId: nonblank(128).optional(),
  evidenceIds: z
    .array(nonblank(128))
    .max(MAX_FINDING_EVIDENCE_IDS)
    .refine((ids) => new Set(ids).size === ids.length),
});
const resultSchema = z.object({
  stepId: nonblank(128),
  status: z.enum(["passed", "failed", "blocked"]),
  expected: z.string().max(20_000).optional(),
  actual: z.string().max(20_000).optional(),
  reason: z.string().max(20_000).optional(),
  startedAt: z.string().max(20_000).optional(),
  finishedAt: z.string().max(20_000).optional(),
  failureKind: z
    .enum(["assertion", "prerequisite", "infrastructure", "cancelled"])
    .optional(),
  findings: z.array(findingSchema).max(MAX_RESULT_FINDINGS).optional(),
  requirement: z
    .object({
      id: nonblank(128),
      text: nonblank(2000),
      source: nonblank(256).optional(),
    })
    .optional(),
});

/** Copy only validated shared fields; no adapter-owned nested references escape. */
export function observedResult(value: unknown, stepId: string): StepResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new AgentError("tool_failed");
  const result = parsed.data;
  if (
    result.stepId !== stepId ||
    (result.status !== "passed" && !result.reason?.trim()) ||
    (result.status === "passed" && result.failureKind !== undefined) ||
    result.findings?.some(
      (finding) => finding.stepId !== undefined && finding.stepId !== stepId,
    ) ||
    (result.findings &&
      new Set(result.findings.map((finding) => finding.id)).size !==
        result.findings.length)
  )
    throw new AgentError("tool_failed");
  return result as StepResult;
}

/** Match core's independent-check policy without turning any failure into a pass. */
export function canContinueAfter(
  step: Pick<WorkflowStep, "code">,
  result: StepResult,
): boolean {
  return (
    result.status === "passed" ||
    (result.status === "failed" &&
      result.failureKind === "assertion" &&
      (step.code === "assertRequirement" || step.code === "assertLayout"))
  );
}
