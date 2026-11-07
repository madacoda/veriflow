import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReport } from "@veriflow/core/fixtures";
import {
  createFailureSummarizer,
  createOpenAISummaryProvider,
} from "../server/agent/index.ts";

// Deliberately separate opt-in. The report is a labeled fixture, not real browser evidence.
test(
  "REAL PROVIDER: failure-summary interpretation of a labeled report fixture",
  {
    skip: process.env.VERIFLOW_VERIFY_OPENAI_SUMMARY !== "1",
    timeout: 90_000,
  },
  async () => {
    const snapshot = structuredClone(demoReport);
    const before = structuredClone(snapshot);
    const summary = await createFailureSummarizer({
      provider: createOpenAISummaryProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
        timeoutMs: 60_000,
      }),
      timeoutMs: 60_000,
    }).summarize(snapshot, AbortSignal.timeout(75_000));
    assert.equal(summary.provider, "model");
    assert.match(summary.text, /recorded outcome: failed/);
    assert.match(summary.text, /Expected: "90000"/);
    assert.match(summary.text, /Actual: "100000"/);
    assert.match(summary.text, /Fixture run/);
    assert.match(summary.text, /AI interpretation/);
    assert.deepEqual(snapshot, before);
  },
);
