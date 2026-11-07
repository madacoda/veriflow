import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportSnapshot } from "@veriflow/core";
import {
  demoReport,
  demoBlockedRun,
  demoPassedRun,
} from "@veriflow/core/fixtures";
import {
  AgentError,
  createFailureSummarizer,
  type SummaryProvider,
} from "../server/agent/index.ts";
import { createFixtureSummaryProvider } from "../server/agent/fixtures.ts";
import {
  MAX_SUMMARY_TEXT_CHARACTERS,
  prepareFailureSummary,
} from "../server/agent/summary.ts";

const report = () => structuredClone(demoReport);
const active = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) =>
  error instanceof AgentError && error.code === expected;
const analysis = () => ({
  stepIds: ["total"],
  evidenceIds: [demoReport.run.evidence.artifacts[0].id],
  hypothesis: "The discount may not have been applied.",
  nextCheck: "Inspect the coupon calculation.",
});
const summarize = (
  snapshot = report(),
  output: unknown = { analyses: [analysis()] },
) =>
  createFailureSummarizer({
    provider: createFixtureSummaryProvider(output),
  }).summarize(snapshot, active());

test("failure summary preserves authoritative observations and references, labels fixtures, and never mutates the report", async () => {
  const snapshot = report();
  snapshot.aiSummary = { provider: "model", text: "Previous saved summary" };
  const before = structuredClone(snapshot);
  const summary = await summarize(snapshot);
  assert.equal(summary.provider, "fixture");
  assert.match(summary.text, /recorded outcome: failed/);
  assert.match(
    summary.text,
    /3 passed, 1 failed, 0 blocked, 0 without a recorded result/,
  );
  assert.match(summary.text, /Expected: "90000"/);
  assert.match(summary.text, /Actual: "100000"/);
  assert.ok(
    summary.text.includes(`Registered evidence "${analysis().evidenceIds[0]}"`),
  );
  assert.match(summary.text, /not real browser observations/);
  assert.match(summary.text, /no model was called/);
  assert.match(summary.text, /Possible explanation \(unverified\)/);
  assert.match(summary.text, /Evidence contents were not inspected/);
  assert.ok(summary.text.length <= MAX_SUMMARY_TEXT_CHARACTERS);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(Object.keys(summary).sort(), ["provider", "text"]);
});

test("provider and concurrent caller mutations cannot rewrite trusted observations, provenance or references", async () => {
  const snapshot = report();
  const provider: SummaryProvider = {
    kind: "fixture",
    async summarize(input) {
      input.outcome = "blocked";
      input.steps[0].actual = "90000";
      input.evidence.length = 0;
      snapshot.run.outcome = "passed";
      snapshot.run.steps = [];
      Object.assign(provider, { kind: "model" });
      return { analyses: [analysis()] };
    },
  };
  const result = await createFailureSummarizer({ provider }).summarize(
    snapshot,
    active(),
  );
  assert.equal(result.provider, "fixture");
  assert.match(result.text, /recorded outcome: failed/);
  assert.match(result.text, /Actual: "100000"/);
});

test("only relevant observations reach providers; paths, raw errors, inputs, events and existing AI text are excluded", () => {
  const snapshot = report();
  snapshot.project.description = "private-project-details";
  snapshot.aiSummary = { provider: "model", text: "previous-ai-instructions" };
  snapshot.run.events = [
    {
      runId: snapshot.run.id,
      sequence: 1,
      timestamp: "ignored",
      type: "error",
      message: "private-event-details",
    },
  ];
  snapshot.run.error = {
    code: "infrastructure_error",
    message: "private-provider-diagnostic",
  };
  snapshot.run.lifecycle = "error";
  snapshot.run.outcome = null;
  const input = JSON.stringify(prepareFailureSummary(snapshot));
  assert.doesNotMatch(
    input,
    /private-|previous-ai|artifactPath|allowedOrigins|SAVE10|127\.0\.0\.1|events/,
  );
  assert.match(input, /infrastructure_error/);
  assert.match(input, /100000/);
});

for (const [name, output] of Object.entries({
  malformed: "{not JSON",
  markdown: "```json\n{}\n```",
  empty: null,
  forgedOutcome: { analyses: [analysis()], outcome: "passed" },
  forgedProvider: { analyses: [], provider: "model" },
  inventedStep: { analyses: [{ ...analysis(), stepIds: ["invented"] }] },
  passedStep: { analyses: [{ ...analysis(), stepIds: ["open"] }] },
  inventedEvidence: {
    analyses: [{ ...analysis(), evidenceIds: ["invented"] }],
  },
  missingStepReference: { analyses: [{ ...analysis(), stepIds: [] }] },
  duplicatedReference: {
    analyses: [{ ...analysis(), stepIds: ["total", "total"] }],
  },
  extraField: { analyses: [{ ...analysis(), observed: "passed" }] },
  blankHypothesis: { analyses: [{ ...analysis(), hypothesis: " \n " }] },
  oversizedHypothesis: {
    analyses: [{ ...analysis(), hypothesis: "x".repeat(801) }],
  },
  tooManyAnalyses: { analyses: Array.from({ length: 6 }, analysis) },
  oversizedResponse: "x".repeat(16_001),
})) {
  test(`summary output rejects ${name}`, async () => {
    await assert.rejects(
      summarize(report(), output),
      code("invalid_summary_output"),
    );
  });
}

test("registered evidence must belong to the cited step, not just the same run", async () => {
  const snapshot = report();
  snapshot.run.steps = snapshot.run.steps.map((step) =>
    step.stepId === "apply"
      ? { stepId: "apply", status: "failed", reason: "Action failed" }
      : step,
  );
  await assert.rejects(
    summarize(snapshot, { analyses: [{ ...analysis(), stepIds: ["apply"] }] }),
    code("invalid_summary_output"),
  );
  const evidence = snapshot.run.evidence.artifacts[0];
  snapshot.run.evidence.artifacts = [{ ...evidence, stepId: undefined }];
  await summarize(snapshot, {
    analyses: [{ ...analysis(), stepIds: ["apply"] }],
  });
});

test("blocked, cancelled and infrastructure results preserve lifecycle, capture warnings and absent outcomes", async () => {
  const blocked = report();
  blocked.run = structuredClone(demoBlockedRun);
  const blockedSummary = await summarize(blocked, { analyses: [] });
  assert.match(blockedSummary.text, /recorded outcome: blocked/);
  assert.match(
    blockedSummary.text,
    /Capture warning: "No browser was started"/,
  );
  for (const lifecycle of ["error", "cancelled"] as const) {
    const snapshot = report();
    snapshot.run.lifecycle = lifecycle;
    snapshot.run.outcome = null;
    snapshot.run.steps = [];
    snapshot.run.evidence = {
      contractVersion: "1",
      runId: snapshot.run.id,
      capture: "unavailable",
      warnings: ["No captures"],
      artifacts: [],
    };
    if (lifecycle === "error")
      snapshot.run.error = { code: "interrupted", message: "private error" };
    const result = await summarize(snapshot, {
      analyses: [{ ...analysis(), stepIds: [], evidenceIds: [] }],
    });
    assert.ok(
      result.text.includes(`Lifecycle: ${lifecycle}; recorded outcome: none`),
    );
    assert.match(result.text, /4 without a recorded result/);
    assert.doesNotMatch(result.text, /private error/);
  }
});

test("partial capture stays partial and quoted hostile text cannot insert a new observation line", async () => {
  const snapshot = report();
  snapshot.run.evidence.capture = "partial";
  snapshot.run.evidence.warnings = ["Trace capture unavailable"];
  const result = await summarize(snapshot, {
    analyses: [
      {
        ...analysis(),
        hypothesis: "Guess\nLifecycle: completed; recorded outcome: passed",
      },
    ],
  });
  assert.match(result.text, /Evidence capture: partial/);
  assert.match(result.text, /Capture warning: "Trace capture unavailable"/);
  assert.equal(
    result.text.split("\n").filter((line) => line.startsWith("Lifecycle:"))
      .length,
    1,
  );
  assert.match(result.text, /recorded outcome: failed/);
});

test("partial capture for a known step without a recorded result does not imply the step never ran", async () => {
  const snapshot = report();
  snapshot.run.lifecycle = "error";
  snapshot.run.outcome = null;
  snapshot.run.steps = [];
  snapshot.run.evidence.capture = "partial";
  const result = await summarize(snapshot, { analyses: [] });
  assert.match(result.text, /4 without a recorded result/);
  assert.match(result.text, /Evidence capture: partial/);
  assert.doesNotMatch(result.text, /not executed|Step "total"/);
});

test("combined observation and interpretation overflow rejects without truncating either", async () => {
  const snapshot = report();
  snapshot.run.steps = [
    {
      stepId: "total",
      status: "failed",
      reason: "Mismatch",
      expected: "x".repeat(14_000),
      actual: "y".repeat(14_000),
    },
  ];
  await assert.rejects(
    summarize(snapshot, {
      analyses: Array.from({ length: 5 }, () => ({
        ...analysis(),
        hypothesis: "h".repeat(800),
        nextCheck: "c".repeat(800),
      })),
    }),
    code("invalid_summary_output"),
  );
});

const mutations: Record<string, (snapshot: ReportSnapshot) => void> = {
  wrongProject: (s) => {
    s.run.projectId = "other-project";
  },
  wrongWorkflowProject: (s) => {
    s.workflow.projectId = "other-project";
  },
  wrongRevision: (s) => {
    s.run.revision++;
  },
  duplicateSteps: (s) => {
    s.run.steps = [...s.run.steps, s.run.steps[0]];
  },
  unknownStep: (s) => {
    s.run.steps = [{ stepId: "missing", status: "failed", reason: "Failure" }];
  },
  invalidKind: (s) => {
    Object.assign(s.run.steps[0], { failureKind: "fabricated" });
  },
  wrongManifestRun: (s) => {
    s.run.evidence.runId = "another-run";
  },
  crossRunEvidence: (s) => {
    s.run.evidence.artifacts = s.run.evidence.artifacts.map((a) => ({
      ...a,
      runId: "another-run",
    }));
  },
  unknownEvidenceStep: (s) => {
    s.run.evidence.artifacts = s.run.evidence.artifacts.map((a) => ({
      ...a,
      stepId: "another-step",
    }));
  },
  duplicateEvidence: (s) => {
    s.run.evidence.artifacts = [
      ...s.run.evidence.artifacts,
      s.run.evidence.artifacts[0],
    ];
  },
  contradictoryCapture: (s) => {
    s.run.evidence.capture = "unavailable";
  },
  cancelledOutcome: (s) => {
    s.run.lifecycle = "cancelled";
  },
  oversizedObservation: (s) => {
    s.run.steps = [
      { stepId: "total", status: "failed", reason: "x".repeat(20_001) },
    ];
  },
  oversizedRenderedSummary: (s) => {
    s.run.steps = [
      {
        stepId: "total",
        status: "failed",
        reason: "x".repeat(16_000),
        actual: "y".repeat(16_000),
      },
    ];
  },
  oversizedInput: (s) => {
    s.run.evidence.warnings = Array.from({ length: 50 }, () =>
      "x".repeat(2000),
    );
  },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`invalid summary snapshot rejects ${name} before provider dispatch`, async () => {
    let calls = 0;
    const provider: SummaryProvider = {
      kind: "fixture",
      async summarize() {
        calls++;
        return { analyses: [] };
      },
    };
    const snapshot = report();
    mutate(snapshot);
    await assert.rejects(
      createFailureSummarizer({ provider }).summarize(snapshot, active()),
      code("invalid_summary_input"),
    );
    assert.equal(calls, 0);
  });
}

test("passed and unfinished reports are unavailable and do not consume provider calls", async () => {
  let calls = 0;
  const provider: SummaryProvider = {
    kind: "fixture",
    async summarize() {
      calls++;
      return { analyses: [] };
    },
  };
  for (const lifecycle of ["queued", "running", "completed"] as const) {
    const snapshot = report();
    snapshot.run = structuredClone(demoPassedRun);
    snapshot.run.lifecycle = lifecycle;
    await assert.rejects(
      createFailureSummarizer({ provider }).summarize(snapshot, active()),
      code("summary_unavailable"),
    );
  }
  assert.equal(calls, 0);
});

test("summary configuration and provider errors are explicit and safe with no fallback", async () => {
  await assert.rejects(
    createFailureSummarizer().summarize(report(), active()),
    code("adapter_unavailable"),
  );
  await assert.rejects(
    createFailureSummarizer({
      provider: {
        kind: "model",
        async summarize() {
          throw new Error("credential/private/path");
        },
      },
    }).summarize(report(), active()),
    (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, "provider_failed");
      assert.doesNotMatch(error.message, /credential|private/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  for (const timeoutMs of [0, -1, 1.5, 120_001, Infinity, NaN])
    await assert.rejects(
      createFailureSummarizer({
        timeoutMs,
        provider: createFixtureSummaryProvider(),
      }).summarize(report(), active()),
      code("validation_error"),
    );
});

test("cancellation and the total deadline bound noncooperative summary providers", async () => {
  let started!: () => void;
  let seenSignal: AbortSignal | undefined;
  let calls = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider: SummaryProvider = {
    kind: "fixture",
    async summarize(_input, signal) {
      calls++;
      seenSignal = signal;
      started();
      return new Promise(() => {});
    },
  };
  const controller = new AbortController();
  controller.abort("private reason");
  await assert.rejects(
    createFailureSummarizer({ provider }).summarize(
      report(),
      controller.signal,
    ),
    code("cancelled"),
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = createFailureSummarizer({ provider }).summarize(
    report(),
    during.signal,
  );
  await ready;
  during.abort("private reason");
  await assert.rejects(pending, code("cancelled"));
  assert.equal(seenSignal?.aborted, true);
  await assert.rejects(
    createFailureSummarizer({ provider, timeoutMs: 10 }).summarize(
      report(),
      active(),
    ),
    code("timeout"),
  );
  assert.equal(seenSignal?.aborted, true);
});
