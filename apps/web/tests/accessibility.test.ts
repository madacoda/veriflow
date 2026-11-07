import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeEvaluator } from "@veriflow/runner/testing";
import { createEvaluation } from "../server/modules/accessibility/index.js";

test("accessibility can develop against an injected evaluator", async () => {
  const evaluate = createEvaluation(
    new FakeEvaluator({
      status: "failed",
      findings: [
        {
          id: "finding-1",
          category: "accessibility",
          ruleId: "example",
          severity: "medium",
          message: "Fixture finding",
          evidenceIds: [],
        },
      ],
    }),
  );
  const result = await evaluate(
    { runId: "run-1", steps: [], evidence: [] },
    new AbortController().signal,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.findings[0].category, "accessibility");
});
