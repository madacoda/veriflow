import type { ReportRenderer, ReportSnapshot } from "@veriflow/core";

const columns = [
  "record_type",
  "project_id",
  "project_title",
  "workflow_id",
  "workflow_name",
  "revision",
  "run_id",
  "adapter",
  "lifecycle",
  "outcome",
  "capture",
  "timestamp",
  "sequence",
  "step_id",
  "status",
  "failure_kind",
  "expected",
  "actual",
  "evidence_id",
  "evidence_kind",
  "media_type",
  "message",
  "rule_id",
  "severity",
  "category",
  "finding_id",
  "evidence_refs",
  "provider",
] as const;

type Row = Partial<Record<(typeof columns)[number], string | number | null>>;

function cell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  // Quoting alone does not stop spreadsheets from evaluating formulas in text cells.
  const safe =
    typeof value === "string" && /^[\t\r\n]|^\s*[=+@-]/u.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function renderCsv(
  snapshot: ReportSnapshot,
): Awaited<ReturnType<ReportRenderer["render"]>> {
  const { project, workflow, run } = snapshot;
  const common: Row = {
    project_id: project.id,
    project_title: project.title,
    workflow_id: workflow.workflow.id,
    workflow_name: workflow.workflow.name,
    revision: workflow.revision,
    run_id: run.id,
    adapter: run.adapter,
    lifecycle: run.lifecycle,
    outcome: run.outcome,
    capture: run.evidence.capture,
  };

  const rows: Row[] = [
    {
      record_type: "run",
      timestamp: run.finishedAt ?? run.createdAt,
      status: run.error?.code,
      message: run.error?.message,
    },
  ];
  for (const step of run.steps) {
    rows.push({
      record_type: "step",
      step_id: step.stepId,
      status: step.status,
      failure_kind: step.failureKind,
      expected: step.expected,
      actual: step.actual,
      message: "reason" in step ? step.reason : undefined,
    });
  }
  for (const event of [...run.events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    rows.push({
      record_type: "event",
      sequence: event.sequence,
      timestamp: event.timestamp,
      step_id: event.step?.stepId,
      status: event.type,
      message: event.message,
    });
  }
  for (const artifact of run.evidence.artifacts) {
    rows.push({
      record_type: "evidence",
      step_id: artifact.stepId,
      evidence_id: artifact.id,
      evidence_kind: artifact.kind,
      media_type: artifact.mediaType,
    });
  }
  for (const warning of run.evidence.warnings) {
    rows.push({ record_type: "capture_warning", message: warning });
  }
  for (const finding of snapshot.findings) {
    rows.push({
      record_type: "finding",
      finding_id: finding.id,
      step_id: finding.stepId,
      rule_id: finding.ruleId,
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      evidence_refs: finding.evidenceIds.join(" "),
    });
  }
  if (snapshot.aiSummary) {
    rows.push({
      record_type: "ai_summary",
      provider: snapshot.aiSummary.provider,
      message: snapshot.aiSummary.text,
    });
  }

  const lines = [
    columns.join(","),
    ...rows.map((row) => {
      const fields = { ...common, ...row };
      return columns.map((column) => cell(fields[column])).join(",");
    }),
  ];
  return {
    bytes: new TextEncoder().encode(`${lines.join("\r\n")}\r\n`),
    mediaType: "text/csv; charset=utf-8",
    filename: `veriflow-${run.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`,
  };
}
