import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReport } from "@veriflow/core/fixtures";
import { renderCsv } from "../server/reports/csv.js";

test("CSV reconciles the pinned revision, observed steps and evidence with the snapshot", () => {
  const snapshot = structuredClone(demoReport);
  const report = renderCsv(snapshot);
  const text = new TextDecoder().decode(report.bytes);
  const [header, ...lines] = text.trimEnd().split("\r\n");
  const rows = lines.map((line) =>
    Object.fromEntries(
      header
        .split(",")
        .map((column, index) => [column, line.split(",")[index].slice(1, -1)]),
    ),
  );
  assert.equal(report.filename, "veriflow-run-failed.csv");
  assert.equal(report.mediaType, "text/csv; charset=utf-8");
  assert.equal(rows[0].revision, String(snapshot.workflow.revision));
  assert.equal(rows[0].adapter, "fake");
  assert.equal(rows[0].lifecycle, "completed");
  assert.equal(rows[0].outcome, "failed");
  assert.deepEqual(
    rows.filter((row) => row.record_type === "step").map((row) => row.step_id),
    ["open", "coupon", "apply", "total"],
  );
  const assertion = rows.find(
    (row) => row.record_type === "step" && row.step_id === "total",
  );
  assert.equal(assertion?.expected, "90000");
  assert.equal(assertion?.actual, "100000");
  assert.equal(assertion?.status, "failed");
  assert.deepEqual(
    rows
      .filter((row) => row.record_type === "event")
      .map((row) => row.sequence),
    ["1", "2", "3"],
  );
  const evidence = rows.find((row) => row.record_type === "evidence");
  assert.equal(evidence?.evidence_id, "evidence-total");
  assert.equal(evidence?.step_id, "total");
  assert.doesNotMatch(text, /runs\/run-failed\/total\.png/);
  assert.deepEqual(snapshot, demoReport);
});

test("CSV quotes punctuation and line breaks and neutralizes formula-like text", () => {
  const text = new TextDecoder().decode(
    renderCsv({
      ...demoReport,
      project: { ...demoReport.project, title: 'Checkout, "café"' },
      aiSummary: { provider: "fixture", text: "  =1+1\nCheck the discount" },
    }).bytes,
  );
  assert.ok(text.includes('"Checkout, ""café"""'));
  assert.ok(text.includes('"\'  =1+1\nCheck the discount"'));
  assert.match(text, /"ai_summary"[^\r]+,"fixture"\r\n$/);
});

test("CSV keeps infrastructure errors and capture warnings separate from assertion outcomes", () => {
  const text = new TextDecoder().decode(
    renderCsv({
      ...demoReport,
      run: {
        ...demoReport.run,
        lifecycle: "error",
        outcome: null,
        steps: [],
        error: {
          code: "infrastructure_error",
          message: "Browser failed to start",
        },
        evidence: {
          ...demoReport.run.evidence,
          capture: "unavailable",
          artifacts: [],
          warnings: ["No browser evidence was captured"],
        },
      },
    }).bytes,
  );
  assert.match(text, /"error","","unavailable"/);
  assert.match(text, /"infrastructure_error".*"Browser failed to start"/);
  assert.match(text, /"capture_warning".*"No browser evidence was captured"/);
  assert.doesNotMatch(text, /^"step",/m);
});
