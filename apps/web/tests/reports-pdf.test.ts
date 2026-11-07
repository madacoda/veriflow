import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { demoReport } from "@veriflow/core/fixtures";
import type { ReportSnapshot } from "@veriflow/core";
import { renderPdf } from "../server/reports/pdf.ts";

async function inspect(snapshot: ReportSnapshot) {
  const before = structuredClone(snapshot);
  const report = await renderPdf(snapshot);
  assert.deepEqual(snapshot, before, "rendering does not mutate the snapshot");
  assert.equal(report.mediaType, "application/pdf");
  assert.equal(Buffer.from(report.bytes.subarray(0, 5)).toString(), "%PDF-");
  const loading = getDocument({ data: report.bytes.slice() });
  const pdf = await loading.promise;
  const pages: string[] = [];
  const body: string[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: true });
      const fragments: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        fragments.push(item.str);
        if (
          item.transform[5] >= 57 &&
          item.transform[5] <= viewport.height - 60
        )
          body.push(item.str);
        if (!item.str.trim()) continue;
        assert.ok(item.transform[4] >= 45, `left margin: ${item.str}`);
        assert.ok(
          item.transform[4] + item.width <= viewport.width - 44,
          `right margin: ${item.str}`,
        );
        assert.ok(item.transform[5] >= 27, `bottom margin: ${item.str}`);
        assert.ok(
          item.transform[5] <= viewport.height - 27,
          `top margin: ${item.str}`,
        );
      }
      pages.push(fragments.join(" ").replace(/\s+/g, " "));
    }
    return { report, pages, text: pages.join(" "), bodyText: body.join(" ") };
  } finally {
    await loading.destroy();
  }
}

test("PDF preserves the pinned revision, observed outcomes, fake label and evidence identity", async () => {
  const { report, pages, text } = await inspect(structuredClone(demoReport));
  assert.equal(report.filename, "veriflow-run-failed.pdf");
  for (const value of [
    "Checkout acceptance",
    "Discount updates total",
    "checkout-discount",
    "run-failed",
    "Revision 1",
    "FAILED / COMPLETED",
    "FIXTURE RUN",
    'Expected "90000"',
    'Actual "100000"',
    "Order total did not match",
    "evidence-total",
    "screenshot / image/png",
    "3 passed / 1 failed / 0 blocked",
  ])
    assert.ok(text.includes(value), `missing ${value}`);
  assert.doesNotMatch(text, /runs\/run-failed\/total\.png|SAVE10|coupon-input/);
  pages.forEach((page, index) =>
    assert.ok(page.includes(`Page ${index + 1} of ${pages.length}`)),
  );
});

test("PDF reconciles requirements, findings, capture warnings and separately labeled AI interpretation", async () => {
  const snapshot = structuredClone(demoReport);
  snapshot.run.steps = [
    {
      stepId: "requirement-check",
      status: "failed",
      failureKind: "assertion",
      reason: "Requirement unmet",
      expected: "Discount applied",
      actual: "Full price",
      requirement: {
        id: "REQ-12",
        text: "Apply the supplied discount",
        source: "Checkout PRD",
      },
    },
  ];
  snapshot.run.evidence.capture = "partial";
  snapshot.run.evidence.warnings = ["A later screenshot could not be captured"];
  snapshot.findings = [
    {
      id: "finding-12",
      category: "compliance",
      severity: "high",
      ruleId: "REQ-12",
      stepId: "requirement-check",
      message: "The discount was not applied",
      evidenceIds: ["evidence-total"],
    },
  ];
  snapshot.aiSummary = {
    provider: "fixture",
    text: "A summary fixture; inspect the observed assertion above.",
  };
  const { text } = await inspect(snapshot);
  for (const value of [
    "Failure kind assertion",
    "Requirement ID REQ-12",
    "Apply the supplied discount",
    "Source Checkout PRD",
    "finding-12",
    "HIGH / compliance",
    "The discount was not applied",
    "Capture status partial",
    "A later screenshot could not be captured",
    "AI summary",
    "Provider: fixture",
    "Interpretation only",
    "A summary fixture;",
  ])
    assert.ok(text.includes(value), `missing ${value}`);
});

test("PDF keeps errors, cancellations and missing outcomes separate from passing assertions", async () => {
  for (const lifecycle of ["error", "cancelled"] as const) {
    const snapshot = structuredClone(demoReport);
    snapshot.run.lifecycle = lifecycle;
    snapshot.run.outcome = null;
    snapshot.run.adapter = "unavailable";
    snapshot.run.steps = [];
    snapshot.run.events = [];
    snapshot.run.evidence = {
      ...snapshot.run.evidence,
      capture: "unavailable",
      artifacts: [],
      warnings: ["No browser evidence was captured"],
    };
    snapshot.run.error =
      lifecycle === "error"
        ? { code: "infrastructure_error", message: "Browser failed to start" }
        : undefined;
    const { text } = await inspect(snapshot);
    assert.ok(text.includes(`NO OUTCOME / ${lifecycle.toUpperCase()}`));
    assert.ok(text.includes("Outcome Not determined"));
    assert.ok(text.includes("No step results were recorded."));
    assert.ok(text.includes("No evidence artifacts were registered."));
    assert.ok(text.includes("No browser evidence was captured"));
    assert.doesNotMatch(text, /PASSED \/|FAILED \//);
    if (lifecycle === "error")
      assert.ok(text.includes("Browser failed to start"));
  }
});

test("PDF wraps long Unicode observations over pages without clipping or silent character loss", async () => {
  const snapshot = structuredClone(demoReport);
  snapshot.project.title = "Café • Ελληνικά • Привет • Bahasa Indonesia";
  snapshot.run.steps = [
    {
      stepId: "long-text",
      status: "failed",
      reason: "Long observation",
      expected: "Expected café\r\nsecond line\ttab: 🍕 中文",
      actual: `START-${"LongUnbrokenToken".repeat(450)}-END\n${"Observed text with punctuation & < >. ".repeat(110)} FINAL-MARKER`,
    },
  ];
  const { pages, text, bodyText } = await inspect(snapshot);
  assert.ok(pages.length >= 4, "large observations must paginate");
  assert.ok(text.includes("Café"));
  assert.ok(text.includes("Ελληνικά"));
  assert.ok(text.includes("Привет"));
  assert.ok(text.includes("[U+1F355]"));
  assert.ok(text.includes("[U+4E2D]"));
  assert.ok(text.includes("[U+6587]"));
  assert.ok(text.includes("Unicode code points"));
  assert.ok(text.includes("FINAL-MARKER"));
  assert.ok(
    bodyText.replaceAll(" ", "").includes("LongUnbrokenToken".repeat(450)),
  );
});

test("PDF labels a blocked outcome and never exports saved workflow secrets", async () => {
  const snapshot = structuredClone(demoReport);
  snapshot.run.outcome = "blocked";
  snapshot.run.steps = [
    {
      stepId: "login",
      status: "blocked",
      failureKind: "prerequisite",
      reason: "Login prerequisite missing",
    },
  ];
  snapshot.workflow.workflow.steps = [
    {
      id: "login",
      code: "fillSecret",
      target: { by: "label", value: "Password" },
      secret: "SHOULD_NOT_BE_EXPORTED",
      timeoutMs: 30000,
    },
  ];
  const { text } = await inspect(snapshot);
  assert.ok(text.includes("BLOCKED / COMPLETED"));
  assert.ok(text.includes("Failure kind prerequisite"));
  assert.ok(text.includes("Login prerequisite missing"));
  assert.doesNotMatch(text, /SHOULD_NOT_BE_EXPORTED|Password/);
});

test("PDF preserves exact assertion whitespace and empty strings visibly", async () => {
  const snapshot = structuredClone(demoReport);
  snapshot.run.steps = [
    {
      stepId: "double-space",
      status: "failed",
      reason: "Whitespace mismatch",
      expected: "A  B",
      actual: "A B",
    },
    {
      stepId: "empty",
      status: "failed",
      reason: "Empty value",
      expected: " A\t\n",
      actual: "",
    },
    {
      stepId: "nbsp",
      status: "failed",
      reason: "Non-breaking space mismatch",
      expected: "A\u00a0B",
      actual: "A B",
    },
  ];
  const { text } = await inspect(snapshot);
  assert.ok(text.includes('Expected "A\\u0020\\u0020B"'));
  assert.ok(text.includes('Actual "A B"'));
  assert.ok(text.includes('Expected "\\u0020A\\t\\n"'));
  assert.ok(text.includes('Actual ""'));
  assert.ok(text.includes('Expected "A\\u00a0B"'));
  assert.ok(text.includes("repeated or edge spaces use \\u0020"));
});
