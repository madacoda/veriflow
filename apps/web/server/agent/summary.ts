import {
  entityIdSchema,
  workflowSchema,
  type ReportSnapshot,
  type StepResult,
} from "@veriflow/core";
import { DEFAULT_TIMEOUT_MS, withBudget } from "./budget.ts";
import { AgentError } from "./errors.ts";

export const MAX_SUMMARY_INPUT_CHARACTERS = 100_000;
export const MAX_SUMMARY_OUTPUT_CHARACTERS = 16_000;
export const MAX_SUMMARY_TEXT_CHARACTERS = 30_000;

/** Local provider seam. Only the coordinator supplies a trusted, project-scoped report snapshot. */
export interface FailureSummaryInput {
  runId: string;
  workflowId: string;
  revision: number;
  adapter: ReportSnapshot["run"]["adapter"];
  lifecycle: "completed" | "error" | "cancelled";
  outcome: "failed" | "blocked" | null;
  errorCode?: NonNullable<ReportSnapshot["run"]["error"]>["code"];
  counts: {
    passed: number;
    failed: number;
    blocked: number;
    withoutResult: number;
  };
  steps: Array<{
    stepId: string;
    action: string;
    status: "failed" | "blocked";
    failureKind?: StepResult["failureKind"];
    expected?: string;
    actual?: string;
    reason: string;
  }>;
  evidence: Array<{
    id: string;
    kind: "screenshot" | "video" | "trace";
    stepId?: string;
  }>;
  capture: ReportSnapshot["run"]["evidence"]["capture"];
  captureWarnings: string[];
}
export interface SummaryProvider {
  readonly kind: "model" | "fixture";
  summarize(input: FailureSummaryInput, signal: AbortSignal): Promise<unknown>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}
function id(value: unknown): value is string {
  return text(value, 128) && !!value.trim();
}
function failureKind(
  value: unknown,
): value is NonNullable<StepResult["failureKind"]> {
  return (
    value === "assertion" ||
    value === "prerequisite" ||
    value === "infrastructure" ||
    value === "cancelled"
  );
}
const invalidInput = () => new AgentError("invalid_summary_input");

/** Project only consumed fields; never send URLs, fill values, artifact paths or old AI text. */
export function prepareFailureSummary(
  snapshot: ReportSnapshot,
): FailureSummaryInput {
  try {
    const { run, workflow, project } = snapshot;
    const parsed = workflowSchema.safeParse(workflow?.workflow);
    if (
      snapshot.contractVersion !== "1" ||
      !parsed.success ||
      !entityIdSchema.safeParse(project?.id).success ||
      !entityIdSchema.safeParse(run?.id).success ||
      run.contractVersion !== "1" ||
      run.projectId !== project.id ||
      workflow.projectId !== project.id ||
      run.workflowId !== parsed.data.id ||
      run.revision !== workflow.revision ||
      !Number.isSafeInteger(workflow.revision) ||
      workflow.revision < 1 ||
      !["browser", "fake", "unavailable"].includes(run.adapter)
    )
      throw invalidInput();
    if (
      ["queued", "running"].includes(run.lifecycle) ||
      (run.lifecycle === "completed" && run.outcome === "passed")
    )
      throw new AgentError("summary_unavailable");
    if (
      !(["completed", "error", "cancelled"] as string[]).includes(
        run.lifecycle,
      ) ||
      (run.lifecycle === "completed"
        ? run.outcome !== "failed" && run.outcome !== "blocked"
        : run.outcome !== null) ||
      (run.error !== undefined &&
        (run.lifecycle !== "error" ||
          ![
            "adapter_unavailable",
            "infrastructure_error",
            "interrupted",
          ].includes(run.error.code)))
    )
      throw invalidInput();
    if (!Array.isArray(run.steps) || run.steps.length > 1000)
      throw invalidInput();
    const actions = new Map(
      parsed.data.steps.map((step) => [step.id, step.code]),
    );
    const seen = new Set<string>();
    const counts = {
      passed: 0,
      failed: 0,
      blocked: 0,
      withoutResult: actions.size - run.steps.length,
    };
    const steps: FailureSummaryInput["steps"] = [];
    for (const step of run.steps) {
      if (
        !object(step) ||
        !id(step.stepId) ||
        !actions.has(step.stepId) ||
        seen.has(step.stepId) ||
        (step.status !== "passed" &&
          step.status !== "failed" &&
          step.status !== "blocked") ||
        (step.expected !== undefined && !text(step.expected)) ||
        (step.actual !== undefined && !text(step.actual)) ||
        (step.failureKind !== undefined &&
          (!failureKind(step.failureKind) || step.status === "passed"))
      )
        throw invalidInput();
      seen.add(step.stepId);
      counts[step.status]++;
      if (step.status !== "passed") {
        if (!text(step.reason) || !step.reason.trim()) throw invalidInput();
        steps.push({
          stepId: step.stepId,
          action: actions.get(step.stepId)!,
          status: step.status,
          ...(step.failureKind === undefined
            ? {}
            : { failureKind: step.failureKind }),
          ...(step.expected === undefined ? {} : { expected: step.expected }),
          ...(step.actual === undefined ? {} : { actual: step.actual }),
          reason: step.reason,
        });
      }
    }
    const manifest = run.evidence;
    if (
      manifest?.contractVersion !== "1" ||
      manifest.runId !== run.id ||
      !["complete", "partial", "unavailable"].includes(manifest.capture) ||
      !Array.isArray(manifest.artifacts) ||
      manifest.artifacts.length > 1000 ||
      !Array.isArray(manifest.warnings) ||
      manifest.warnings.length > 50 ||
      !manifest.warnings.every((warning) => text(warning, 2000))
    )
      throw invalidInput();
    const evidence: FailureSummaryInput["evidence"] = [];
    const evidenceIds = new Set<string>();
    for (const artifact of manifest.artifacts) {
      if (
        !artifact ||
        !id(artifact.id) ||
        evidenceIds.has(artifact.id) ||
        artifact.runId !== run.id ||
        !["screenshot", "video", "trace"].includes(artifact.kind) ||
        (artifact.stepId !== undefined &&
          (!id(artifact.stepId) || !actions.has(artifact.stepId)))
      )
        throw invalidInput();
      evidenceIds.add(artifact.id);
      if (
        artifact.stepId === undefined ||
        steps.some((step) => step.stepId === artifact.stepId)
      )
        evidence.push({
          id: artifact.id,
          kind: artifact.kind,
          ...(artifact.stepId === undefined ? {} : { stepId: artifact.stepId }),
        });
    }
    if (manifest.capture === "unavailable" && manifest.artifacts.length)
      throw invalidInput();
    const input: FailureSummaryInput = {
      runId: run.id,
      workflowId: parsed.data.id,
      revision: workflow.revision,
      adapter: run.adapter,
      lifecycle: run.lifecycle as FailureSummaryInput["lifecycle"],
      outcome: run.outcome as FailureSummaryInput["outcome"],
      ...(run.error ? { errorCode: run.error.code } : {}),
      counts,
      steps,
      evidence,
      capture: manifest.capture,
      captureWarnings: [...manifest.warnings],
    };
    if (
      JSON.stringify(input).length > MAX_SUMMARY_INPUT_CHARACTERS ||
      renderObservations(input).length > MAX_SUMMARY_TEXT_CHARACTERS
    )
      throw invalidInput();
    return input;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw invalidInput();
  }
}

// JSON quoting keeps observed text and model prose from injecting new section labels/lines.
const quote = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
function renderObservations(input: FailureSummaryInput): string {
  return [
    "Recorded observations (from the supplied report; not decided by AI)",
    `Run ${quote(input.runId)}; workflow ${quote(input.workflowId)} revision ${input.revision}.`,
    `Lifecycle: ${input.lifecycle}; recorded outcome: ${input.outcome ?? "none"}; adapter: ${input.adapter}.`,
    ...(input.adapter === "fake"
      ? ["Fixture run; these are not real browser observations."]
      : []),
    ...(input.errorCode
      ? [`Infrastructure error code: ${input.errorCode}.`]
      : []),
    `Steps: ${input.counts.passed} passed, ${input.counts.failed} failed, ${input.counts.blocked} blocked, ${input.counts.withoutResult} without a recorded result.`,
    ...input.steps.map((step) =>
      [
        `Step ${quote(step.stepId)} (${step.action}): ${step.status}; failure kind: ${step.failureKind ?? "unspecified"}.`,
        ...(step.expected === undefined
          ? []
          : [`Expected: ${quote(step.expected)}.`]),
        ...(step.actual === undefined
          ? []
          : [`Actual: ${quote(step.actual)}.`]),
        `Reason: ${quote(step.reason)}.`,
      ].join(" "),
    ),
    `Evidence capture: ${input.capture}. Evidence contents were not inspected by this summary.`,
    ...input.captureWarnings.map(
      (warning) => `Capture warning: ${quote(warning)}.`,
    ),
    ...(input.evidence.length
      ? input.evidence.map(
          (artifact) =>
            `Registered evidence ${quote(artifact.id)} (${artifact.kind}) for ${artifact.stepId === undefined ? "the run" : `step ${quote(artifact.stepId)}`}.`,
        )
      : ["No relevant evidence references are registered."]),
  ].join("\n");
}

interface Analysis {
  stepIds: string[];
  evidenceIds: string[];
  hypothesis: string;
  nextCheck: string;
}
function parseAnalyses(
  output: unknown,
  input: FailureSummaryInput,
): Analysis[] {
  try {
    const serialized =
      typeof output === "string" ? output : JSON.stringify(output);
    if (!serialized || serialized.length > MAX_SUMMARY_OUTPUT_CHARACTERS)
      throw new Error();
    const decoded: unknown = JSON.parse(serialized);
    if (
      !object(decoded) ||
      Object.keys(decoded).length !== 1 ||
      !Array.isArray(decoded.analyses) ||
      decoded.analyses.length > 5
    )
      throw new Error();
    const availableSteps = new Set(input.steps.map((step) => step.stepId));
    const availableEvidence = new Map(
      input.evidence.map((artifact) => [artifact.id, artifact]),
    );
    return decoded.analyses.map((entry: unknown) => {
      if (
        !object(entry) ||
        Object.keys(entry).sort().join(",") !==
          "evidenceIds,hypothesis,nextCheck,stepIds" ||
        !text(entry.hypothesis, 800) ||
        !entry.hypothesis.trim() ||
        !text(entry.nextCheck, 800) ||
        !entry.nextCheck.trim()
      )
        throw new Error();
      for (const refs of [entry.stepIds, entry.evidenceIds]) {
        if (
          !Array.isArray(refs) ||
          refs.length > 5 ||
          !refs.every(id) ||
          new Set(refs).size !== refs.length
        )
          throw new Error();
      }
      const stepIds = entry.stepIds as string[];
      const evidenceIds = entry.evidenceIds as string[];
      if (
        (input.steps.length > 0 && stepIds.length === 0) ||
        stepIds.some((stepId) => !availableSteps.has(stepId)) ||
        evidenceIds.some((evidenceId) => {
          const artifact = availableEvidence.get(evidenceId);
          return (
            !artifact ||
            (artifact.stepId !== undefined &&
              !stepIds.includes(artifact.stepId))
          );
        })
      )
        throw new Error();
      return {
        stepIds,
        evidenceIds,
        hypothesis: entry.hypothesis,
        nextCheck: entry.nextCheck,
      };
    });
  } catch {
    throw new AgentError("invalid_summary_output");
  }
}

/** Returns only the existing optional aiSummary value. No report mutation, persistence or tools. */
export function createFailureSummarizer(
  options: { provider?: SummaryProvider; timeoutMs?: number } = {},
) {
  return {
    async summarize(
      snapshot: ReportSnapshot,
      signal: AbortSignal,
    ): Promise<NonNullable<ReportSnapshot["aiSummary"]>> {
      return withBudget(
        signal,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        async (boundedSignal, checkActive) => {
          const provider = options.provider;
          if (
            !provider ||
            !["model", "fixture"].includes(provider.kind) ||
            typeof provider.summarize !== "function"
          )
            throw new AgentError("adapter_unavailable");
          const providerKind = provider.kind;
          const input = prepareFailureSummary(snapshot);
          const providerInput = structuredClone(input);
          checkActive();
          let output: unknown;
          try {
            output = await provider.summarize(providerInput, boundedSignal);
          } catch {
            checkActive();
            throw new AgentError("provider_failed");
          }
          checkActive();
          const analyses = parseAnalyses(output, input);
          const result = [
            renderObservations(input),
            "",
            providerKind === "fixture"
              ? "Deterministic fixture interpretation; no model was called."
              : "AI interpretation; hypotheses and suggested checks are unverified.",
            "Interpretation does not change the recorded result. Review before relying on it.",
            ...analyses.map((analysis) =>
              [
                `References: steps ${quote(analysis.stepIds)}; evidence ${quote(analysis.evidenceIds)}.`,
                `Possible explanation (unverified): ${quote(analysis.hypothesis)}.`,
                `Suggested check (not executed): ${quote(analysis.nextCheck)}.`,
              ].join("\n"),
            ),
            ...(analyses.length ? [] : ["No interpretation was supplied."]),
          ].join("\n");
          if (result.length > MAX_SUMMARY_TEXT_CHARACTERS)
            throw new AgentError("invalid_summary_output");
          return { text: result, provider: providerKind };
        },
      );
    },
  };
}
