import type { RunLifecycle, RunRecord } from "@veriflow/core";
import {
  demoBlockedRun,
  demoFailedRun,
  demoPassedRun,
} from "@veriflow/core/fixtures";

function lifecycleFixture(
  lifecycle: RunLifecycle,
  events: RunRecord["events"],
): RunRecord {
  return {
    contractVersion: "1",
    id: "run-preview",
    projectId: demoFailedRun.projectId,
    workflowId: demoFailedRun.workflowId,
    revision: demoFailedRun.revision,
    adapter: "fake",
    lifecycle,
    outcome: null,
    createdAt: demoFailedRun.createdAt,
    steps: [],
    events: events.map((event) => ({ ...event, runId: "run-preview" })),
    evidence: {
      contractVersion: "1",
      runId: "run-preview",
      capture: "unavailable",
      warnings: ["This fixture has no real media."],
      artifacts: [],
    },
  };
}

const [queued, started] = demoFailedRun.events;
const error = {
  code: "infrastructure_error",
  message: "The fixture browser could not start.",
} as const;

export const runFixtures = {
  Queued: lifecycleFixture("queued", [queued]),
  Running: lifecycleFixture("running", [queued, started]),
  Passed: demoPassedRun,
  Failed: demoFailedRun,
  Blocked: demoBlockedRun,
  Cancelled: lifecycleFixture("cancelled", [
    queued,
    started,
    { ...started, sequence: 3, type: "cancellation_requested" },
    { ...started, sequence: 4, type: "cancelled" },
  ]),
  Error: {
    ...lifecycleFixture("error", [
      queued,
      started,
      { ...started, sequence: 3, type: "error", message: error.message },
    ]),
    error,
  },
} satisfies Record<string, RunRecord>;
